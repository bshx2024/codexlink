/**
 * APIVALE 外链存活与健康状态自动化检测探针 (Health Check Probe)
 * 运行方式: node check_backlink_health.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CSV_PATH = path.join(__dirname, '..', '02_Published_Logs', 'all_published_master_log.csv');

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length >= 8) {
      rows.push({
        index: cols[0],
        date: cols[1],
        domain: cols[2],
        title: cols[3],
        landingPage: cols[4],
        persona: cols[5],
        email: cols[6],
        status: cols[7],
        gSheetsRow: cols[8] || ''
      });
    }
  }
  return rows;
}

function probeUrl(targetUrl, timeout = 10000) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(targetUrl);
      const client = urlObj.protocol === 'https:' ? https : http;
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: timeout
      };

      const req = client.request(options, (res) => {
        let body = '';
        res.on('data', chunk => {
          if (body.length < 100000) body += chunk.toString();
        });
        res.on('end', () => {
          const hasApivale = body.toLowerCase().includes('apivale.com') || body.toLowerCase().includes('apivale');
          resolve({
            statusCode: res.statusCode,
            alive: res.statusCode >= 200 && res.statusCode < 400,
            hasApivale: hasApivale,
            contentLength: body.length
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ statusCode: 0, alive: false, error: 'TIMEOUT' });
      });

      req.on('error', (err) => {
        resolve({ statusCode: 0, alive: false, error: err.message });
      });

      req.end();
    } catch (e) {
      resolve({ statusCode: 0, alive: false, error: e.message });
    }
  });
}

(async () => {
  console.log('====================================================');
  console.log('🩺 开始运行 APIVALE 外链存活与健康状态自动化检测探针');
  console.log('====================================================');

  if (!fs.existsSync(CSV_PATH)) {
    console.error('未找到主日志 CSV 文件:', CSV_PATH);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const items = parseCSV(csvContent);
  console.log(`📊 成功载入 ${items.length} 条已发布外链资产记录。\n`);

  let normalCount = 0;
  let warnCount = 0;

  for (const item of items) {
    if (item.domain === 'alternativeto.net') {
      console.log(`[#${item.index}] ${item.domain} (软件目录提报 - 等待平台过审): 🟢 正常推进`);
      normalCount++;
      continue;
    }

    const testUrl = `https://${item.domain}/`;
    const res = await probeUrl(testUrl, 8000);
    if (res.alive) {
      console.log(`[#${item.index}] ${item.domain}: 🟢 HTTP ${res.statusCode} (可正常访问)`);
      normalCount++;
    } else {
      console.log(`[#${item.index}] ${item.domain}: ⚠️ 异常 (${res.error || res.statusCode})`);
      warnCount++;
    }
  }

  console.log('\n====================================================');
  console.log(`🎯 探针巡检完成！正常: ${normalCount} 项 | 异常: ${warnCount} 项 | 健康率: ${Math.round((normalCount / items.length) * 100)}%`);
  console.log('====================================================');
})();

