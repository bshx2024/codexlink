/**
 * 目标博客可用性与表单结构探测脚本
 * 用法: node probe_target.js "<URL>"
 */
const https = require('https');
const http = require('http');

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error('用法: node probe_target.js "<目标博文URL>"');
  process.exit(1);
}

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec?action=read&projectName=APIVALE';

async function checkSheetDuplication(domain) {
  try {
    const res = await fetch(WEBHOOK_URL);
    const data = await res.json();
    if (data && data.rows) {
      const hits = data.rows.filter(r => r.domain && r.domain.toLowerCase().includes(domain.toLowerCase()));
      return hits.length;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

async function probeUrl(url) {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const client = u.protocol === 'https:' ? https : http;
      client.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
      }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', async () => {
          const hasForm = b.includes('commentform') || b.includes('comment-form') || b.includes('comment_form');
          const hasAuthor = b.includes('name="author"') || b.includes('id="author"');
          const hasEmail = b.includes('name="email"') || b.includes('id="email"');
          const hasUrl = b.includes('name="url"') || b.includes('id="url"');
          const hasTextarea = b.includes('<textarea');
          const isClosed = b.toLowerCase().includes('comments are closed');
          const title = (b.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
          
          const domain = u.hostname;
          const sheetHits = await checkSheetDuplication(domain);

          resolve({
            url,
            domain,
            status: res.statusCode,
            title: title.trim(),
            hasForm,
            hasAuthor,
            hasEmail,
            hasUrl,
            hasTextarea,
            isClosed,
            sheetHits,
            canProceed: res.statusCode === 200 && hasForm && hasUrl && !isClosed && sheetHits === 0
          });
        });
      }).on('error', e => resolve({ url, error: e.message, canProceed: false }));
    } catch(e) { resolve({ url, error: e.message, canProceed: false }); }
  });
}

(async () => {
  const result = await probeUrl(targetUrl);
  console.log(JSON.stringify(result, null, 2));
  if (!result.canProceed) {
    if (result.sheetHits > 0) {
      console.warn(`[警告] 域名 ${result.domain} 在 Google 表格中已存在 ${result.sheetHits} 条记录，违反防重复准则！`);
    } else if (!result.hasUrl) {
      console.warn(`[警告] 该站点评论区无 Website/URL 输入字段！`);
    } else if (result.isClosed) {
      console.warn(`[警告] 该站点评论已关闭！`);
    }
  }
})();

