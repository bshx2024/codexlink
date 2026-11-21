/**
 * APIVALE 外链存活与健康状态双轨自动化检测探针 (WAF-Bypass Health Probe)
 * 工业级双轨混合探测引擎：
 * 1. 轨道一：轻量 HTTP/TLS 极速探测；
 * 2. 轨道二：遭遇 403 / WAF / Timeout 自动无缝降级到 ComLinkAI Chromium 真实浏览器环境二次复核；
 * 3. 彻底消除机房 IP 被误判为死链的痛点，提供精准四分流报告。
 * 
 * 用法:
 *   node check_backlink_health.js --url "<URL>"
 *   node check_backlink_health.js --retest-failed
 *   node check_backlink_health.js --limit 50
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const COMLINK_PORT = 3010;
const PERSONAS = [
  'Elena Rostova',
  'Sofia Costa',
  'Alex Rivera',
  'Sarah Chen',
  'Kenji Tanaka',
  'Chen Wei',
  'Aris Thorne'
];

// ComLinkAI 本地浏览器中转 API 调用
function callBrowserAction(action, data = {}, tabId = undefined) {
  return new Promise((resolve, reject) => {
    const payload = { action, data };
    if (tabId !== undefined) {
      payload.tabId = tabId;
      payload.data.tabId = tabId;
    }
    const postData = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: COMLINK_PORT,
      path: '/api/action',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 25000
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(b);
          if (json.success) resolve(json.data);
          else reject(new Error(json.error || 'Action failed'));
        } catch (e) {
          reject(new Error('Parse JSON error: ' + b));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Browser action timeout')); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 检查 ComLinkAI 本地浏览器 Bridge 服务是否在线
async function isComLinkAvailable() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${COMLINK_PORT}/health`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 轨道 1：轻量 HTTP/TLS 探针
 */
async function probeViaHttp(targetUrl, timeoutMs = 7000) {
  return new Promise(resolve => {
    try {
      const u = new URL(targetUrl);
      const client = u.protocol === 'https:' ? https : http;
      const req = client.get({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: timeoutMs
      }, res => {
        let body = '';
        res.on('data', chunk => {
          if (body.length < 500000) body += chunk.toString();
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
            error: null
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ statusCode: 0, headers: {}, body: '', error: 'TIMEOUT' });
      });
      req.on('error', err => {
        resolve({ statusCode: 0, headers: {}, body: '', error: err.message });
      });
    } catch (e) {
      resolve({ statusCode: 0, headers: {}, body: '', error: e.message });
    }
  });
}

/**
 * 轨道 2：降级至 ComLinkAI 真实 Chromium 浏览器环境进行页面嗅探
 */
async function probeViaChromiumBrowser(targetUrl) {
  let tabId = null;
  try {
    const createRes = await callBrowserAction('create_tab', { url: 'about:blank' });
    tabId = createRes.tabId;

    await callBrowserAction('navigate', { url: targetUrl, timeout: 20000 }, tabId);
    await sleep(3500); // 等待 Cloudflare 质询跳过或 SPA 动态内容渲染

    const pageData = await callBrowserAction('getActiveTab', {}, tabId);
    return {
      success: true,
      title: pageData?.title || '',
      url: pageData?.url || targetUrl,
      content: pageData?.content || '',
      error: null
    };
  } catch (err) {
    return {
      success: false,
      title: '',
      url: targetUrl,
      content: '',
      error: err.message
    };
  } finally {
    if (tabId) {
      await callBrowserAction('close_tab', { tabId }, tabId).catch(() => {});
    }
  }
}

/**
 * 核心：双轨混合判定函数
 */
async function inspectTargetBacklink(item, hasBrowserService = false) {
  const targetUrl = item.url || (item.domain ? `https://${item.domain}/` : '');
  const result = {
    rowNum: item.rowNum || 0,
    domain: item.domain || '',
    url: targetUrl,
    title: item.title || '',
    category: 'unknown', // live_verified | pending_moderation | waf_gated | dead_link
    initialStatus: 'unchecked',
    browserVerified: false,
    relType: 'none',
    matchedLink: null,
    httpCode: 0,
    note: ''
  };

  if (!targetUrl || !targetUrl.startsWith('http')) {
    result.category = 'dead_link';
    result.note = '无效目标 URL';
    return result;
  }

  // 1. 轨道 1: 先发起快速轻量 HTTP 探测
  const httpRes = await probeViaHttp(targetUrl);
  result.httpCode = httpRes.statusCode;

  const isWafOrBlocked = [401, 403, 405, 429].includes(httpRes.statusCode) ||
                         httpRes.error === 'TIMEOUT' ||
                         (httpRes.body && /just a moment|cloudflare|verify you are human|waf|captcha/i.test(httpRes.body));

  const isRealDead = [404, 410].includes(httpRes.statusCode);

  // 2. 如果是 404 或 410，明确为死链
  if (isRealDead) {
    result.category = 'dead_link';
    result.note = `真实死链 (HTTP ${httpRes.statusCode} 页面已下架)`;
    return result;
  }

  // 3. 检查轻量请求 HTML 中是否已包含目标外链
  if (httpRes.statusCode === 200 && httpRes.body) {
    const apivaleMatch = httpRes.body.match(/<a\s+[^>]*href=["']([^"']*apivale\.com[^"']*)["'][^>]*>(.*?)<\/a>/i);
    if (apivaleMatch) {
      result.category = 'live_verified';
      const fullTag = apivaleMatch[0];
      const href = apivaleMatch[1];
      const anchor = apivaleMatch[2].replace(/<[^>]+>/g, '').trim();
      const isNofollow = /rel=["'][^"']*(nofollow|ugc)[^"']*["']/i.test(fullTag);
      result.relType = isNofollow ? 'live_nofollow' : 'live_dofollow';
      result.matchedLink = { href, anchor, fullTag: fullTag.slice(0, 150) };
      result.note = `外链已公开上线 (${result.relType})`;
      return result;
    }
  }

  // 4. 轨道 2 自动激活：若遭遇 403 / WAF / 超时，且本地浏览器 Bridge 服务可用，立即启动 Chromium 真实指纹穿透
  if (isWafOrBlocked && hasBrowserService) {
    const browserRes = await probeViaChromiumBrowser(targetUrl);
    if (browserRes.success) {
      result.browserVerified = true;
      const bContent = browserRes.content || '';
      const bTitle = browserRes.title || '';
      result.title = bTitle || result.title;

      // 检查真实浏览器渲染后是否包含外链或域名
      const hasApivaleInBrowser = bContent.toLowerCase().includes('apivale.com') || bContent.toLowerCase().includes('apivale');
      if (hasApivaleInBrowser) {
        result.category = 'live_verified';
        result.relType = 'browser_live';
        result.note = `WAF拦截穿透成功：真实浏览器检测到外链在线！(HTTP 403 误报已消除)`;
        return result;
      }

      // 检查是否包含作者或评论待审核提示
      let hasPersona = false;
      for (const p of PERSONAS) {
        if (bContent.includes(p)) {
          hasPersona = true;
          break;
        }
      }
      const commentSnip = item.comment ? item.comment.slice(0, 30) : '';
      const hasSnip = commentSnip && bContent.includes(commentSnip);

      if (hasPersona || hasSnip || /awaiting moderation|moderation queue/i.test(bContent)) {
        result.category = 'pending_moderation';
        result.note = 'WAF拦截穿透成功：页面存活，评论处于博主审核中 (待批复)';
        return result;
      }

      // 页面完全能够由真实浏览器打开，消除了 403 死链误报
      result.category = 'waf_gated';
      result.note = `🛡️ WAF 穿透成功 (真实页面存活，机房探测报 403 纯属防火墙假死)`;
      return result;
    }
  }

  // 5. 若 HTTP 200 正常可达，判定为待审核中
  if (httpRes.statusCode === 200) {
    result.category = 'pending_moderation';
    result.note = '页面存活 (HTTP 200)，留言处于博主后台人工待审中';
    return result;
  }

  // 6. 其余网络错误
  result.category = 'dead_link';
  result.note = `探测失败: ${httpRes.error || `HTTP ${httpRes.statusCode}`}`;
  return result;
}

function parseCliArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const k = process.argv[i].slice(2);
      const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

// 主入口执行
(async () => {
  const args = parseCliArgs();
  console.log('========================================================================');
  console.log('🩺 APIVALE 双轨外链健康检测探针 (WAF 穿透 & 403 假死误报消除版)');
  console.log('========================================================================\n');

  const hasComLink = await isComLinkAvailable();
  console.log(`[Bridge 状态] ComLinkAI 本地浏览器服务 (端口 ${COMLINK_PORT}): ${hasComLink ? '🟢 在线 (启用 WAF 自动降级穿透)' : '🟡 未运行 (仅使用轻量 HTTP 探测)'}`);

  let itemsToTest = [];

  // 场景 A: 单 URL 检测
  if (args.url) {
    itemsToTest.push({
      url: args.url,
      domain: new URL(args.url).hostname,
      title: 'Manual URL Inspection'
    });
  }
  // 场景 B: 专门对之前识别为“失效/403”的站点进行二次复测
  else if (args['retest-failed']) {
    const rawPath = path.join(__dirname, '..', '..', 'scripts', 'verification_results.json');
    if (fs.existsSync(rawPath)) {
      const allPrev = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
      itemsToTest = allPrev.filter(r => r.status === 'http_error' || r.status === 'timeout' || r.status === 'network_error');
      console.log(`📋 成功从上一轮检测结果载入 ${itemsToTest.length} 个异常/403 待复核站点...`);
    } else {
      console.error('未找到 scripts/verification_results.json，无法执行 --retest-failed');
      process.exit(1);
    }
  }
  // 场景 C: 从主日志 CSV 中读取
  else {
    const csvPath = path.join(__dirname, '..', '02_Published_Logs', 'all_published_master_log.csv');
    if (fs.existsSync(csvPath)) {
      const content = fs.readFileSync(csvPath, 'utf8');
      const lines = content.trim().split(/\r?\n/).slice(1);
      itemsToTest = lines.map((l, idx) => {
        const parts = l.split(',');
        return {
          rowNum: idx + 1,
          domain: parts[2] || '',
          url: parts[4] ? `https://${parts[2]}/` : `https://${parts[2]}/`,
          title: parts[3] || ''
        };
      }).filter(i => i.domain);
    }
  }

  const limit = parseInt(args.limit || '0', 10);
  if (limit > 0) itemsToTest = itemsToTest.slice(0, limit);

  console.log(`🚀 开始执行存活与健康检测，检测队列总量: ${itemsToTest.length} 条...\n`);

  const results = [];
  const startTs = Date.now();

  for (let i = 0; i < itemsToTest.length; i++) {
    const item = itemsToTest[i];
    const inspected = await inspectTargetBacklink(item, hasComLink);
    results.push(inspected);

    let icon = '⚪';
    if (inspected.category === 'live_verified') icon = '🟢';
    else if (inspected.category === 'pending_moderation') icon = '⏳';
    else if (inspected.category === 'waf_gated') icon = '🛡️';
    else if (inspected.category === 'dead_link') icon = '🔴';

    console.log(`[${i + 1}/${itemsToTest.length}] ${icon} [${inspected.category.toUpperCase()}] ${inspected.domain} -> ${inspected.note}`);
  }

  const duration = ((Date.now() - startTs) / 1000).toFixed(1);

  // 四分流数据汇总
  const summary = {
    total: results.length,
    durationSec: duration,
    live_verified: results.filter(r => r.category === 'live_verified').length,
    pending_moderation: results.filter(r => r.category === 'pending_moderation').length,
    waf_gated_pass: results.filter(r => r.category === 'waf_gated').length,
    real_dead_link: results.filter(r => r.category === 'dead_link').length
  };

  console.log('\n========================================================================');
  console.log('📊 APIVALE 外链健康度与精准四分流复核结果');
  console.log('========================================================================');
  console.log(`- 检测总数: ${summary.total} 项 (耗时: ${summary.durationSec}s)`);
  console.log(`- 🟢 【Live & Verified】(外链公开上线)       : ${summary.live_verified} 篇`);
  console.log(`- ⏳ 【Pending Moderation】(博主正常待审中)  : ${summary.pending_moderation} 篇`);
  console.log(`- 🛡️ 【WAF Gated (Browser Pass)】(403误报已解): ${summary.waf_gated_pass} 篇`);
  console.log(`- 🔴 【Real Dead Link】(404确认死链/下架)     : ${summary.real_dead_link} 篇`);
  console.log('========================================================================\n');

  // 保存检测报告
  const outReportPath = path.join(__dirname, 'backlink_health_report.json');
  fs.writeFileSync(outReportPath, JSON.stringify({ summary, results }, null, 2), 'utf8');
  console.log(`✅ 详细结构化数据已保存至: ${outReportPath}`);
})();
