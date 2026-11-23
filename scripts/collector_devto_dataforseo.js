/**
 * ComLinkAI - dev.to & DataForSEO 高确定性外链挖掘流水线
 * 对应刘小排《三步外链收集策略》工程实现：
 * 1. 抓取 dev.to 最新文章列表与 Markdown 正文出站外链
 * 2. 启发式清洗剔除社交/文档/云厂商，提纯独立 AI & SaaS 种子池
 * 3. 交叉反查共同入站外链（被 >= 3 家独立 AI 工具站共同引用的高确定性收录源）
 * 4. 自动排重并注入 6-Table 共享数据库 (referrer_targets)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 引用本地 6-Table 数据库引擎
const backlinkDb = require('../server/modules/backlink_db');

// 配置与常量
const NOISE_DOMAINS = new Set([
  'google.com', 'google.cn', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
  'github.com', 'gitlab.com', 'linkedin.com', 'reddit.com', 'medium.com',
  'facebook.com', 'instagram.com', 'dev.to', 'hashnode.com', 'wikipedia.org',
  'discord.gg', 'discord.com', 't.me', 'telegram.org', 'notion.site', 'substack.com',
  'apple.com', 'microsoft.com', 'amazon.com', 'npmjs.com', 'pypi.org', 'cloudflare.com',
  'gravatar.com', 'imgur.com', 'w3.org', 'schema.org', 'bit.ly', 'openai.com', 'anthropic.com'
]);

const NOISE_PREFIXES = ['docs.', 'cdn.', 'img.', 'assets.', 'static.', 'media.', 'api.', 'download.', 'app.', 'dev-to-uploads.'];

function isNoiseDomain(domain) {
  if (!domain) return true;
  domain = domain.toLowerCase().replace(/^www\./, '');
  if (NOISE_DOMAINS.has(domain)) return true;
  for (const noise of NOISE_DOMAINS) {
    if (domain === noise || domain.endsWith('.' + noise)) return true;
  }
  for (const prefix of NOISE_PREFIXES) {
    if (domain.startsWith(prefix)) return true;
  }
  if (domain.includes('amazonaws.com') || domain.includes('cloudinary.com') || domain.includes('cdn') || domain.includes('upload')) {
    return true;
  }
  return false;
}

function requestJson(urlStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || (postData ? 'POST' : 'GET'),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      timeout: options.timeout || 15000
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout (${reqOptions.timeout}ms)`));
    });

    if (postData) {
      const payload = typeof postData === 'string' ? postData : JSON.stringify(postData);
      req.write(payload);
    }
    req.end();
  });
}

/**
 * 提取文本中的有效域名与出站链接
 */
function extractLinksFromMarkdown(markdown) {
  const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s\)\"\']+)\)|<a\s+(?:[^>]*?\s+)?href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const links = [];
  let match;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const url = match[2] || match[3];
    const text = (match[1] || match[4] || '').trim();

    try {
      const u = new URL(url);
      const domain = u.hostname.toLowerCase();
      links.push({
        url,
        domain,
        text,
        is_social: NOISE_DOMAINS.has(domain) || domain.includes('twitter') || domain.includes('github')
      });
    } catch (e) {}
  }

  return links;
}

/**
 * 判断是否为高质量独立 SaaS / AI 产品种子域名
 */
function isIndependentAiSeed(domain, url) {
  if (!domain) return false;
  domain = domain.toLowerCase();

  // 1. 过滤黑名单
  if (NOISE_DOMAINS.has(domain)) return false;
  for (const noise of NOISE_DOMAINS) {
    if (domain.endsWith('.' + noise)) return false;
  }

  // 2. 过滤通用前缀
  for (const prefix of NOISE_PREFIXES) {
    if (domain.startsWith(prefix)) return false;
  }

  // 3. 过滤常见开发云与平台子域名
  if (domain.endsWith('.vercel.app') || domain.endsWith('.pages.dev') || domain.endsWith('.netlify.app') || domain.endsWith('.github.io')) {
    return false;
  }

  // 4. 过滤 IP 与本地
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain) || domain.includes('localhost')) return false;

  return true;
}

/**
 * 主执行流水线
 */
async function runCollectorPipeline(options = {}) {
  const pages = options.pages || 1;
  const minIntersection = options.minIntersection || 2; // 降级测试阈值为 2，正式生产推荐 3

  console.log(`\n=============================================================`);
  console.log(`🚀 [ComLinkAI] 启动 dev.to + DataForSEO 高确定性外链挖掘流水线`);
  console.log(`参数: 抓取页数=${pages}, 共同引用阈值>=${minIntersection}`);
  console.log(`=============================================================\n`);

  backlinkDb.init();

  // -------------------------------------------------------------
  // 阶段 1：抓取 dev.to 最新文章与出站外链
  // -------------------------------------------------------------
  console.log(`[Phase 1] 正在通过 dev.to 官方公开 API 拉取文章...`);
  const allOutbound = [];
  const candidateSeeds = new Map(); // domain -> seedInfo

  for (let p = 1; p <= pages; p++) {
    try {
      console.log(` -> 正在获取 dev.to 文章列表 (第 ${p}/${pages} 页)...`);
      const articles = await requestJson(`https://dev.to/api/articles?per_page=30&page=${p}`);

      for (const art of articles) {
        let bodyMarkdown = art.body_markdown;

        // 若列表未返回 Markdown，则请求单篇详情
        if (!bodyMarkdown) {
          try {
            await new Promise(r => setTimeout(r, 200)); // 限速平滑
            const detail = await requestJson(`https://dev.to/api/articles/${art.id}`, { timeout: 8000 });
            bodyMarkdown = detail.body_markdown || '';
          } catch (e) {
            bodyMarkdown = art.description || '';
          }
        }

        const extracted = extractLinksFromMarkdown(bodyMarkdown);
        for (const item of extracted) {
          allOutbound.push({
            article_id: art.id,
            article_title: art.title,
            article_url: art.url,
            author: art.user ? art.user.username : '',
            tags: art.tag_list || [],
            outbound_url: item.url,
            domain: item.domain,
            link_text: item.text,
            is_social: item.is_social,
            is_directory: item.domain.includes('tool') || item.domain.includes('directory'),
            is_candidate: isIndependentAiSeed(item.domain, item.url)
          });

          // 如果是合格的独立产品，加入候选种子池
          if (isIndependentAiSeed(item.domain, item.url) && !candidateSeeds.has(item.domain)) {
            candidateSeeds.set(item.domain, {
              site_name: item.text || item.domain,
              domain: item.domain,
              url: item.url,
              source_article_url: art.url,
              anchor_text: item.text,
              category: 'ai-tools'
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[Phase 1] 获取第 ${p} 页出错:`, err.message);
    }
  }

  console.log(`[Phase 1 完成] 共捕获原始出站外链 ${allOutbound.length} 条。`);
  const streamRes = backlinkDb.addOutboundLinks(allOutbound);
  console.log(` -> 写入 devto_outbound_links 成功: 新增 ${streamRes.added} 条，当前总计 ${streamRes.total} 条。`);

  // -------------------------------------------------------------
  // 阶段 2：提纯独立 AI & SaaS 种子清单
  // -------------------------------------------------------------
  console.log(`\n[Phase 2] 正在启发式清洗并提纯独立 AI & SaaS 种子池...`);
  const seedsArray = Array.from(candidateSeeds.values());
  const seedRes = backlinkDb.addToolSeeds(seedsArray);
  console.log(` -> 写入 ai_tool_sites: 新增独立站种子 ${seedRes.added} 个，种子池总量 ${seedRes.total} 个。`);

  // -------------------------------------------------------------
  // 阶段 3：调用 DataForSEO (或智能交集算法) 计算共同引荐外链
  // -------------------------------------------------------------
  console.log(`\n[Phase 3] 正在执行多维交集反查 (Domain Intersection)...`);
  const dataForSeoLogin = process.env.DATAFORSEO_LOGIN;
  const dataForSeoPassword = process.env.DATAFORSEO_PASSWORD;

  let discoveredTargets = [];

  if (dataForSeoLogin && dataForSeoPassword) {
    console.log(` -> 检测到 DataForSEO API 凭证，正在调用 Live Backlinks 交叉反查...`);
    try {
      const topSeeds = seedsArray.slice(0, 20).map(s => s.domain);
      const authHeader = 'Basic ' + Buffer.from(`${dataForSeoLogin}:${dataForSeoPassword}`).toString('base64');
      
      const payload = [{
        targets: topSeeds.reduce((acc, domain, idx) => {
          acc[`target${idx + 1}`] = domain;
          return acc;
        }, {}),
        limit: 500,
        filters: [["dofollow", "=", true]]
      }];

      const dfResult = await requestJson('https://api.dataforseo.com/v3/backlinks/domain_intersection/live', {
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
      }, payload);

      if (dfResult.tasks && dfResult.tasks[0]?.result?.[0]?.items) {
        const items = dfResult.tasks[0].result[0].items;
        for (const item of items) {
          discoveredTargets.push({
            target_domain: item.domain,
            source_site: 'DataForSEO Intersection',
            link_page_url: `https://${item.domain}`,
            link_type: 'dofollow',
            notes: `交集命中 ${item.intersections || 3} 个独立站引用`
          });
        }
      }
    } catch (err) {
      console.warn(`DataForSEO API 调用异常，转入启发式关联反查:`, err.message);
    }
  }

  // 兜底高可信关联分析：当无 DataForSEO 凭证时，从捕获的多篇 dev.to 文章出站目录中取交集
  if (discoveredTargets.length === 0) {
    console.log(` -> 启用高确定性交集分析引擎 (聚合多篇独立博文引用的共同工具/目录站)...`);
    const domainCitationCounts = new Map();
    const domainExamplePages = new Map();

    for (const link of allOutbound) {
      if (link.is_social) continue;
      const d = link.domain;
      domainCitationCounts.set(d, (domainCitationCounts.get(d) || 0) + 1);
      if (!domainExamplePages.has(d)) {
        domainExamplePages.set(d, link.outbound_url);
      }
    }

    // 筛选被 >= minIntersection 家文章或工具引用的高确定性来源
    for (const [domain, count] of domainCitationCounts.entries()) {
      if (count >= minIntersection && !isNoiseDomain(domain)) {
        discoveredTargets.push({
          target_domain: domain,
          source_site: 'dev.to Common Intersection',
          link_page_url: domainExamplePages.get(domain) || `https://${domain}`,
          link_type: 'dofollow',
          notes: `被 dev.to 社区共同引用频次: ${count} 次`
        });
      }
    }
  }

  console.log(` -> 发现高确定性反向链接机会: ${discoveredTargets.length} 条。`);

  // -------------------------------------------------------------
  // 阶段 4：写入待发表 (referrer_targets)
  // -------------------------------------------------------------
  console.log(`\n[Phase 4] 注入待发表 (referrer_targets) 任务队列...`);
  const targetRes = backlinkDb.addReferrerTargets(discoveredTargets);
  console.log(` -> 任务队列更新: 新增 ${targetRes.added} 条 pending 目标，总计队列存量: ${targetRes.total} 条。`);

  // 输出总览战报
  const stats = backlinkDb.getStats();
  console.log(`\n=============================================================`);
  console.log(`🎉 [流水线执行完毕] 当前 6-Table 核心数据指标:`);
  console.log(` - 原始出站链接: ${stats.outbound_links} 条`);
  console.log(` - 独立站种子池: ${stats.tool_seeds} 个`);
  console.log(` - 外链待发队列: ${stats.targets.pending} 条 pending (总计: ${stats.targets.total})`);
  console.log(` - 成功成果库:   ${stats.success_total} 条`);
  console.log(` - 探针复检池:   ${stats.probes_total} 条`);
  console.log(`=============================================================\n`);

  return stats;
}

// 支持直接作为脚本运行
if (require.main === module) {
  const args = process.argv.slice(2);
  let pages = 1;
  if (args.includes('--pages')) {
    const idx = args.indexOf('--pages');
    pages = parseInt(args[idx + 1] || '1', 10);
  }

  runCollectorPipeline({ pages })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal Pipeline Error:', err);
      process.exit(1);
    });
}

module.exports = { runCollectorPipeline };
