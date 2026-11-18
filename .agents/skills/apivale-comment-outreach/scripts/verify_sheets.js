/**
 * APIVALE Google Sheets 专属页签实时数据读取与校验脚本
 * 用法: node verify_sheets.js [--limit 10] [--domain <domain>]
 */
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec?action=read&projectName=APIVALE';

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
const limit = parseInt(args.limit || '10', 10);
const searchDomain = args.domain || null;

(async () => {
  try {
    console.log('正在连接 Google Apps Script Webhook 查询 APIVALE 页签...');
    const res = await fetch(WEBHOOK_URL);
    const data = await res.json();
    if (!data || !data.rows) {
      console.error('获取表格数据失败:', data);
      return;
    }

    const rows = data.rows;
    console.log(`✅ APIVALE 页签当前总记录行数: ${rows.length}`);

    if (searchDomain) {
      const matches = rows.filter(r => r.domain && r.domain.toLowerCase().includes(searchDomain.toLowerCase()));
      console.log(`🔍 针对域名 [${searchDomain}] 的搜索结果 (共 ${matches.length} 条):`);
      matches.forEach((m, idx) => {
        console.log(`  [#${idx + 1}] 时间: ${m.timestamp} | 状态: ${m.status} | 标题: ${m.title}`);
        console.log(`      目标URL: ${m.url}`);
      });
      return;
    }

    console.log(`--- 最近 ${limit} 条发布记录 ---`);
    const recent = rows.slice(-limit);
    recent.forEach((r, idx) => {
      const rowNum = rows.length - recent.length + idx + 1;
      console.log(`[行 #${rowNum}] ${r.timestamp} | 域名: ${r.domain} | 状态: ${r.status}`);
      console.log(`         标题: ${r.title.slice(0, 60)}...`);
      console.log(`         页面: ${r.url}`);
    });
  } catch (err) {
    console.error('查询异常:', err.message);
  }
})();
