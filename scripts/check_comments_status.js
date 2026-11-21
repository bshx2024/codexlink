const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec?action=read&projectName=APIVALE';

(async () => {
  try {
    console.log('正在获取 Google Sheets 全部数据...');
    const res = await fetch(WEBHOOK_URL);
    const data = await res.json();
    const rows = data.rows || [];
    console.log('总行数:', rows.length);

    const byDateBeijing = {};
    const byDateUTC = {};
    const verifyStatuses = new Set();
    const statuses = new Set();

    rows.forEach((r, idx) => {
      verifyStatuses.add(r.verifyStatus);
      statuses.add(r.status);
      if (!r.timestamp) return;

      const d = new Date(r.timestamp);
      // Beijing Date
      const bjDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
      if (!byDateBeijing[bjDate]) byDateBeijing[bjDate] = [];
      byDateBeijing[bjDate].push({ rowNum: idx + 1, ...r });

      // UTC Date
      const utcDate = r.timestamp.slice(0, 10);
      if (!byDateUTC[utcDate]) byDateUTC[utcDate] = [];
      byDateUTC[utcDate].push({ rowNum: idx + 1, ...r });
    });

    console.log('唯一 verifyStatus:', Array.from(verifyStatuses));
    console.log('唯一 status:', Array.from(statuses));

    console.log('\n--- 按北京时间 (UTC+8) 统计日期分布 ---');
    for (const [date, list] of Object.entries(byDateBeijing).sort((a,b) => a[0].localeCompare(b[0]))) {
      console.log(`日期 ${date}: 共 ${list.length} 条记录`);
    }

    console.log('\n--- 按 UTC 统计日期分布 ---');
    for (const [date, list] of Object.entries(byDateUTC).sort((a,b) => a[0].localeCompare(b[0]))) {
      console.log(`日期 ${date}: 共 ${list.length} 条记录`);
    }

    // 输出 11-19 和 11-20 的记录详情
    const targetDates = ['2026-11-19', '2026-11-20'];
    console.log('\n======================================================');
    for (const td of targetDates) {
      const records = byDateBeijing[td] || [];
      console.log(`\n【${td} (北京时间)】记录数量: ${records.length}`);
      records.forEach((rec, i) => {
        console.log(` [${i+1}] 行#${rec.rowNum} | 时间: ${rec.timestamp} | 域名: ${rec.domain} | status: ${rec.status} | verifyStatus: ${rec.verifyStatus}`);
        console.log(`     URL: ${rec.url}`);
        console.log(`     Title: ${rec.title}`);
      });
    }

  } catch (e) {
    console.error('异常:', e);
  }
})();

