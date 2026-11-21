const fs = require('fs');

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec?action=read&projectName=APIVALE';

(async () => {
  const res = await fetch(WEBHOOK_URL);
  const data = await res.json();
  const rows = data.rows || [];

  // 筛选 11-19 和 11-20 的记录（按北京时间与按UTC时间覆盖）
  const targetRows = [];
  rows.forEach((r, idx) => {
    if (!r.timestamp) return;
    const d = new Date(r.timestamp);
    const bj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
    const utc = r.timestamp.slice(0, 10);
    if (bj === '2026-11-19' || bj === '2026-11-20' || utc === '2026-11-19' || utc === '2026-11-20') {
      targetRows.push({
        rowNum: idx + 1,
        bjDate: bj,
        utcDate: utc,
        ...r
      });
    }
  });

  console.log('目标日期 (11-19 & 11-20) 记录总数:', targetRows.length);
  fs.writeFileSync('scripts/target_records_19_20.json', JSON.stringify(targetRows, null, 2), 'utf8');

  // 按日期归类
  const dateCounts = {};
  targetRows.forEach(r => {
    dateCounts[r.bjDate] = (dateCounts[r.bjDate] || 0) + 1;
  });
  console.log('按北京时间统计:', dateCounts);
})();

