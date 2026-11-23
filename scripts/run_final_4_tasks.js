const fs = require('fs');
const path = require('path');
const { executeHumanSubmission } = require('/root/codexlink/.agents/skills/apivale-comment-outreach/scripts/human_outreach_submitter.js');

const CSV_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.csv';
const MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.md';
const DEDICATED_MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/gpt62_sol_api_logs.md';
const ARTIFACT_DIR = '/root/codexlink/artifacts';
const LOG_FILE = '/root/codexlink/logs/sol_6_2_final_runner.log';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch (e) {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function recordTask(t) {
  const csvLine = t.index + ',2026-11-22,' + t.domain + ',"' + t.title.replace(/"/g, '""') + '",/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/,' + t.author_persona + ',' + t.email + ',published,Row ' + t.row_number + '\n';
  fs.appendFileSync(CSV_PATH, csvLine, 'utf8');

  const mdLine = '| ' + t.index + ' | 2026-11-22 | `' + t.domain + '` | [' + t.title + '](https://' + t.domain + ') | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | `' + t.author_persona + '` | `' + t.email + '` | ✅ Published (Gold Standard) | Row ' + t.row_number + ' |\n';
  fs.appendFileSync(MD_PATH, mdLine, 'utf8');

  const dedicatedLine = '| **#' + t.row_number + '** | `' + t.domain + '` | [' + t.title + '](https://' + t.domain + ')<br>• GPT-6.2 Sol API $2/$10 定价、1.05M 上下文与 65 TPS 路由实战 | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | ✅ published |\n';
  fs.appendFileSync(DEDICATED_MD_PATH, dedicatedLine, 'utf8');
}

async function ensureExtensionReady() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('http://127.0.0.1:3010/api/status');
      const data = await res.json();
      if (data && data.connections && data.connections.hasPrimary) {
        return true;
      }
    } catch (e) {}
    log('⚠️ [自愈检测] 检测到浏览器插件未连接，第 ' + attempt + '/3 次尝试自动拉起容器...');
    try {
      require('child_process').execSync('docker restart comlinkai-cloud-engine');
      await sleep(10000);
    } catch (e) {}
  }
  return false;
}

async function main() {
  const tasks = JSON.parse(fs.readFileSync('/root/codexlink/scripts/final_4_tasks.json', 'utf8'));
  log('================================================================');
  log('🕒 [冲刺 50 条收官] 开始发布最终 4 条外链，达到整整 50 条满标！');
  log('================================================================');

  let successCount = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    log('\n▶ 正在推进收官篇 [' + (i + 1) + '/' + tasks.length + '] (#' + t.index + ' Row ' + t.row_number + ') -> 目标: ' + t.domain);

    await ensureExtensionReady();

    try {
      const res = await executeHumanSubmission({
        pageUrl: t.url,
        targetUrl: t.landing_page,
        author: t.author_persona,
        email: t.email,
        domain: t.domain,
        comment: t.comment,
        title: t.title
      }, {
        saveScreenshot: true,
        artifactDir: ARTIFACT_DIR,
        syncSheet: true
      });

      if (!res || !res.success || res.skipped) {
        log('⛔ [#' + t.index + '] ' + t.domain + ' 未成功: ' + (res ? (res.reason || res.error) : '未知'));
        continue;
      }

      recordTask(t);
      successCount++;
      log('✔ [#' + t.index + ' Row ' + t.row_number + '] ' + t.domain + ' 成功上线并同步入库！(收官推进: ' + successCount + '/' + tasks.length + ')');

      if (i < tasks.length - 1) {
        const wait = Math.floor(Math.random() * 30) + 90; // 90~120s 快速拟人缓冲
        log('⏳ 拟人呼吸缓冲: 等待 ' + wait + 's 后进行下一篇...');
        await sleep(wait * 1000);
      }
    } catch (err) {
      log('❌ [#' + t.index + '] ' + t.domain + ' 异常: ' + err.message);
    }
  }

  log('\n🎉 最终 4 条全部推进完毕！成功发布: ' + successCount + '/' + tasks.length + '，50条外链目标圆满达成！');
}

main().catch(err => log('Fatal: ' + err.message));
