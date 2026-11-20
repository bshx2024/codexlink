/**
 * APIVALE 高鲜活度独立技术博客定向检索脚本
 * 语法公式: site:.com "<关键词>" "Leave a Reply" "Website" "Name" "Email" after:YYYY-MM-DD
 * 用法: node harvest_fresh_blogs.js --keyword "Gemini 4 Neon" [--after "2026-10-01"]
 */
const http = require('http');

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].substring(2);
      const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

const args = parseArgs();
const keyword = args.keyword || 'Gemini 4 Neon';

// 默认取 1 个月前当月第一天
const now = new Date();
now.setMonth(now.getMonth() - 1);
const defaultAfter = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const afterDate = args.after || defaultAfter;

const dorkQuery = `site:.com "${keyword}" "Leave a Reply" "Website" "Name" "Email" after:${afterDate}`;
const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(dorkQuery)}&hl=en&num=100`;

function callBridgeAction(action, data = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3010,
      path: '/api/action',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ action, data }));
    req.end();
  });
}

(async () => {
  console.log('=== APIVALE 高鲜活度博客精准检索脚印 ===');
  console.log(`目标关键词: ${keyword}`);
  console.log(`起始日期: after:${afterDate}`);
  console.log(`生成的 Google Dork 语法: ${dorkQuery}`);
  console.log(`导航目标 URL: ${googleSearchUrl}`);

  console.log('\n正在通过 ComLinkAI 侧边栏在 Chrome 中打开检索页面...');
  await callBridgeAction('navigate', { url: googleSearchUrl });
  console.log('✅ 已成功在当前浏览器标签页中打开 Google 检索页面！');
})();

