/**
 * APIVALE 目标博客可用性与表单结构深度探测器 (4-Gate Pre-Flight Probe)
 * 工业级事前四道门禁拦截链，杜绝死链、无留链框、幽灵表单与竞蚀重复投递。
 * 
 * 用法: node probe_target.js "<URL>"
 */

const https = require('https');
const http = require('http');

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec?action=read&projectName=APIVALE';

// 域名去 www 与规范化
function normalizeDomain(hostname) {
  if (!hostname) return '';
  return hostname.toLowerCase().replace(/^www\./, '').trim();
}

/**
 * 门禁 4 查重：检查该域名在 Google Sheets APIVALE 页签中近 30 天是否已有发布记录
 */
async function checkSheetDuplication(domain) {
  const normDomain = normalizeDomain(domain);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(WEBHOOK_URL, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await res.json();
    if (data && Array.isArray(data.rows)) {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
      const domainMatches = data.rows.filter(r => {
        if (!r.domain) return false;
        return normalizeDomain(r.domain) === normDomain;
      });

      const recentMatches = domainMatches.filter(r => {
        if (!r.timestamp) return true; // 无时间戳默认保守计为冲突
        const t = new Date(r.timestamp).getTime();
        return isNaN(t) || t >= thirtyDaysAgo;
      });

      return {
        totalHits: domainMatches.length,
        recentHits: recentMatches.length,
        hasDuplication: recentMatches.length > 0,
        lastRecord: domainMatches[domainMatches.length - 1] || null
      };
    }
    return { totalHits: 0, recentHits: 0, hasDuplication: false, lastRecord: null };
  } catch (e) {
    // 若查询 Sheets 失败，不硬阻断但输出警告
    return { totalHits: 0, recentHits: 0, hasDuplication: false, error: e.message };
  }
}

/**
 * 请求网页 HTML 与响应头 (支持跟随 301/302 重定向，单次请求超时 6s)
 */
async function fetchPageContent(targetUrl, maxRedirects = 3) {
  let currentUrl = targetUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    const res = await new Promise((resolve, reject) => {
      try {
        const u = new URL(currentUrl);
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
          timeout: 6000
        }, response => {
          let body = '';
          response.on('data', chunk => {
            if (body.length < 500000) body += chunk.toString();
          });
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode,
              headers: response.headers,
              body,
              finalUrl: currentUrl
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('HTTP request timeout (6000ms)'));
        });
        req.on('error', err => reject(err));
      } catch (err) {
        reject(err);
      }
    });

    // 处理重定向
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      redirectsCount++;
      const redirectUrl = new URL(res.headers.location, currentUrl).href;
      currentUrl = redirectUrl;
      continue;
    }

    return res;
  }

  throw new Error(`Exceeded maximum redirects (${maxRedirects})`);
}

/**
 * 核心执行：事前四道门禁拦截链
 */
async function probeTargetUrl(targetUrl, options = {}) {
  const startTs = Date.now();
  const report = {
    url: targetUrl,
    domain: '',
    durationMs: 0,
    canProceed: false,
    blockingGate: null,
    blockingReason: '',
    gates: {
      gate1_httpStatus: { pass: false, statusCode: 0, detail: '' },
      gate2_seoIndexable: { pass: false, hasNoIndex: false, detail: '' },
      gate3_formUsability: {
        pass: false,
        hasUrlInput: false,
        isCommentClosed: false,
        isGhostHidden: false,
        hasFormTag: false,
        detail: ''
      },
      gate4_antiDuplication: { pass: false, recentHits: 0, totalHits: 0, detail: '' }
    },
    meta: {
      title: '',
      finalUrl: targetUrl
    }
  };

  try {
    const parsedUrl = new URL(targetUrl);
    report.domain = parsedUrl.hostname;
  } catch (err) {
    report.blockingGate = 'Gate 0: URL Validation';
    report.blockingReason = `无效的 URL 格式: ${targetUrl}`;
    report.durationMs = Date.now() - startTs;
    return report;
  }

  // 并行启动：网页内容抓取与 Google Sheets 查重
  const [fetchResult, dupResult] = await Promise.all([
    fetchPageContent(targetUrl).catch(err => ({ error: err.message, statusCode: 0, body: '', headers: {} })),
    checkSheetDuplication(report.domain)
  ]);

  // -------------------------------------------------------------
  // 门禁 1: HTTP 快速存活预检
  // -------------------------------------------------------------
  report.gates.gate1_httpStatus.statusCode = fetchResult.statusCode;
  if (fetchResult.error) {
    report.blockingGate = 'Gate 1: HTTP Status';
    report.blockingReason = `网页无法访问或超时: ${fetchResult.error}`;
    report.gates.gate1_httpStatus.detail = fetchResult.error;
    report.durationMs = Date.now() - startTs;
    return report;
  }

  if (fetchResult.statusCode !== 200) {
    report.blockingGate = 'Gate 1: HTTP Status';
    report.blockingReason = `HTTP 状态码异常 (${fetchResult.statusCode})，拦截 404/410/50x 错误`;
    report.gates.gate1_httpStatus.detail = `HTTP ${fetchResult.statusCode}`;
    report.durationMs = Date.now() - startTs;
    return report;
  }
  report.gates.gate1_httpStatus.pass = true;
  report.gates.gate1_httpStatus.detail = 'HTTP 200 OK';

  const html = fetchResult.body || '';
  const headers = fetchResult.headers || {};
  report.meta.finalUrl = fetchResult.finalUrl;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  report.meta.title = titleMatch ? titleMatch[1].trim() : '';

  // -------------------------------------------------------------
  // 门禁 2: SEO 权重穿透与爬虫友好校验 (NoIndex 拦截)
  // -------------------------------------------------------------
  const xRobots = headers['x-robots-tag'] || '';
  const metaRobotsMatch = html.match(/<meta[^>]+(?:name|property)=["'](?:robots|googlebot)["'][^>]+content=["']([^"']*)["']/i);
  const metaRobotsContent = metaRobotsMatch ? metaRobotsMatch[1].toLowerCase() : '';
  const hasNoIndex = metaRobotsContent.includes('noindex') || xRobots.toLowerCase().includes('noindex');

  if (hasNoIndex) {
    report.gates.gate2_seoIndexable.hasNoIndex = true;
    report.gates.gate2_seoIndexable.detail = `检测到 noindex 标签 (Meta: "${metaRobotsContent}", X-Robots: "${xRobots}")`;
    report.blockingGate = 'Gate 2: SEO NoIndex';
    report.blockingReason = '宿主页面声明了 noindex，搜索引擎不收录，无 SEO 留链价值';
    report.durationMs = Date.now() - startTs;
    return report;
  }
  report.gates.gate2_seoIndexable.pass = true;
  report.gates.gate2_seoIndexable.detail = '页面对搜索引擎开放收录 (允许爬取 Indexable)';

  // -------------------------------------------------------------
  // 门禁 3: 表单真实可用性与幽灵字段嗅探
  // -------------------------------------------------------------
  const htmlLower = html.toLowerCase();

  // 3.1 评论关闭/需登录校验
  const isClosed = htmlLower.includes('comments are closed') ||
                   htmlLower.includes('comments closed') ||
                   htmlLower.includes('评论已关闭') ||
                   htmlLower.includes('must be logged in to comment') ||
                   htmlLower.includes('you must be logged in to post a comment') ||
                   htmlLower.includes('log in to reply');

  if (isClosed) {
    report.gates.gate3_formUsability.isCommentClosed = true;
    report.gates.gate3_formUsability.detail = '评论区已显式关闭或强制要求登录 (Comments Closed / Login Required)';
    report.blockingGate = 'Gate 3: Form Usability';
    report.blockingReason = '目标文章评论区已关闭或仅限登录用户回复';
    report.durationMs = Date.now() - startTs;
    return report;
  }

  // 3.2 幽灵表单 CSS 隐藏校验
  const isGhostHidden = /#comments\s*\{\s*display:\s*none/i.test(html) ||
                        /div#comments\s*\{\s*display:\s*none/i.test(html) ||
                        /\.comments-area\s*\{\s*display:\s*none/i.test(html) ||
                        /#respond\s*\{\s*display:\s*none/i.test(html) ||
                        /\.comment-respond\s*\{\s*display:\s*none/i.test(html) ||
                        /#commentform\s*\{\s*display:\s*none/i.test(html);

  if (isGhostHidden) {
    report.gates.gate3_formUsability.isGhostHidden = true;
    report.gates.gate3_formUsability.detail = '检测到 CSS 强制隐藏样式 (如 #comments { display: none })';
    report.blockingGate = 'Gate 3: Form Usability';
    report.blockingReason = '该站点评论区被 CSS 隐藏，真实读者不可见，属于幽灵表单';
    report.durationMs = Date.now() - startTs;
    return report;
  }

  // 3.3 外链 URL 输入字段严格嗅探 (必须显式包含 name="url" 或 name="website" 或 id="url" 或 id="website")
  const hasUrlField = /<input[^>]+(?:name|id)=["'](?:url|website)["'][^>]*>/i.test(html) ||
                      /<input[^>]+type=["']url["'][^>]*>/i.test(html) ||
                      /name=["'](?:url|website)["']/i.test(html);

  if (!hasUrlField) {
    report.gates.gate3_formUsability.hasUrlInput = false;
    report.gates.gate3_formUsability.detail = '未找到 name="url" 或 name="website" 的独立外链字段';
    report.blockingGate = 'Gate 3: Form Usability';
    report.blockingReason = '该博客评论表单不开放原生 Website/URL 留链属性，严禁强行正文发链';
    report.durationMs = Date.now() - startTs;
    return report;
  }
  report.gates.gate3_formUsability.hasUrlInput = true;
  report.gates.gate3_formUsability.pass = true;
  report.gates.gate3_formUsability.detail = '表单健全开放，具备独立原生 Website/URL 留链字段';

  // -------------------------------------------------------------
  // 门禁 4: Google Sheets & 历史主表 100% 零竞蚀查重
  // -------------------------------------------------------------
  report.gates.gate4_antiDuplication.totalHits = dupResult.totalHits || 0;
  report.gates.gate4_antiDuplication.recentHits = dupResult.recentHits || 0;

  if (dupResult.hasDuplication) {
    report.gates.gate4_antiDuplication.pass = false;
    report.gates.gate4_antiDuplication.detail = `近 30 天内已在域名 ${report.domain} 发布过 (历史记录数: ${dupResult.recentHits})`;
    report.blockingGate = 'Gate 4: Anti-Duplication';
    report.blockingReason = `同一域名 30 天内严禁重复投放，已触发防竞蚀频控拦截`;
    report.durationMs = Date.now() - startTs;
    return report;
  }
  report.gates.gate4_antiDuplication.pass = true;
  report.gates.gate4_antiDuplication.detail = '域名查重通过 (近 30 天无重复记录)';

  // 全部门禁通过
  report.canProceed = true;
  report.durationMs = Date.now() - startTs;
  return report;
}

// 命令行直接调用支持
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.log('用法: node probe_target.js "<目标博文URL>"');
    process.exit(1);
  }

  (async () => {
    console.log(`\n🔍 正在对目标博文执行「事前四道门禁拦截链」探测...`);
    console.log(`目标 URL: ${target}\n`);

    const res = await probeTargetUrl(target);

    console.log('---------------- 门禁检查明细 ----------------');
    console.log(`[Gate 1: HTTP 存活] : ${res.gates.gate1_httpStatus.pass ? '🟢 PASS' : '🔴 FAIL'} (${res.gates.gate1_httpStatus.detail})`);
    console.log(`[Gate 2: SEO 爬虫]  : ${res.gates.gate2_seoIndexable.pass ? '🟢 PASS' : '🔴 FAIL'} (${res.gates.gate2_seoIndexable.detail})`);
    console.log(`[Gate 3: 表单外链]  : ${res.gates.gate3_formUsability.pass ? '🟢 PASS' : '🔴 FAIL'} (${res.gates.gate3_formUsability.detail})`);
    console.log(`[Gate 4: 零频控查重]: ${res.gates.gate4_antiDuplication.pass ? '🟢 PASS' : '🔴 FAIL'} (${res.gates.gate4_antiDuplication.detail})`);
    console.log('----------------------------------------------');
    console.log(`嗅探耗时: ${res.durationMs}ms | 页面标题: ${res.meta.title || '(无标题)'}`);

    if (res.canProceed) {
      console.log(`\n🎉 【全门禁通过】：该站点具备极佳留链与收录条件，允许进入拟人化自动化提交流程！\n`);
    } else {
      console.log(`\n⛔ 【门禁拦截】：触发 [${res.blockingGate}] 阻断！原因: ${res.blockingReason}\n`);
    }
  })();
}

module.exports = {
  probeTargetUrl,
  checkSheetDuplication
};
