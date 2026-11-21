const fs = require('fs');
const path = require('path');
const { executeHumanSubmission } = require('/root/codexlink/.agents/skills/apivale-comment-outreach/scripts/human_outreach_submitter.js');

const POOL_PATH = '/root/codexlink/APIVALE_Outreach_Hub/03_Pending_Queue/hourly_50_staged_pool.json';
const CSV_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.csv';
const MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.md';
const DEDICATED_MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/gemini_tool_retrieval_mcp_logs.md';
const ARTIFACT_DIR = '/root/codexlink/artifacts';
const LOG_FILE = '/root/codexlink/logs/hourly_batch_runner.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function recordTask(t) {
  const csvLine = `${t.index},2026-11-20,${t.domain},"${t.title.replace(/"/g, '""')}",/blog/gemini-tool-retrieval-api-interactions-mcp-guide/,${t.author_persona},${t.email},published,Row ${t.row_number}\n`;
  fs.appendFileSync(CSV_PATH, csvLine, 'utf8');

  const mdLine = `| ${t.index} | 2026-11-20 | \`${t.domain}\` | [${t.title}](${t.url}) | \`/blog/gemini-tool-retrieval-api-interactions-mcp-guide/\` | \`${t.author_persona}\` | \`${t.email}\` | ✅ Published (Gold Standard) | Row ${t.row_number} |\n`;
  fs.appendFileSync(MD_PATH, mdLine, 'utf8');
  fs.appendFileSync(DEDICATED_MD_PATH, mdLine, 'utf8');
}

async function runBatch(batchNum) {
  if (!fs.existsSync(POOL_PATH)) {
    log('错误: 未找到任务池文件 ' + POOL_PATH);
    return false;
  }

  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
  const pending = pool.filter(t => t.status === 'pending');
  const completed = pool.filter(t => t.status === 'published').length;

  log(`📊 当前总进度: 已发布 ${completed} / 50 | 待发布: ${pending.length}`);

  if (pending.length === 0) {
    log('🎉 全部 50 条任务已全部发布完毕！调度器圆满完成任务。');
    return true; // All done
  }

  // 每次条数随机随机 (3 ~ 7 条，若剩余更少则取剩余)
  const randomQuota = Math.floor(Math.random() * 5) + 3; // 3, 4, 5, 6, 7
  const currentBatchSize = Math.min(randomQuota, pending.length);
  const currentBatchTasks = pending.slice(0, currentBatchSize);

  log(`🚀 [第 ${batchNum} 批次启动] 随机抽样定额: ${currentBatchSize} 条 (剩余未分发: ${pending.length - currentBatchSize})`);

  for (let i = 0; i < currentBatchTasks.length; i++) {
    const t = currentBatchTasks[i];
    log(`  ▶ 正在推进 [${i + 1}/${currentBatchSize}] (#${t.index} Row ${t.row_number}) -> 目标: ${t.domain}`);

    try {
      const res = await executeHumanSubmission({
        pageUrl: t.url,
        targetUrl: t.landing_page,
        author: t.author_persona,
        email: t.email,
        domain: t.domain,
        comment: t.comment
      }, {
        saveScreenshot: true,
        artifactDir: ARTIFACT_DIR,
        syncSheet: true
      });

      t.status = 'published';
      t.batch_id = batchNum;
      t.published_at = new Date().toISOString();

      recordTask(t);
      fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2), 'utf8');
      log(`  ✔ [#${t.index}] ${t.domain} 拟人化提交与数据入库成功！`);
    } catch (err) {
      log(`  ❌ [#${t.index}] ${t.domain} 执行异常: ${err.message}`);
      t.status = 'retry_later';
      fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2), 'utf8');
    }
  }

  const newlyCompleted = pool.filter(t => t.status === 'published').length;
  log(`🏁 [第 ${batchNum} 批次执行完毕] 本批次已发布 ${currentBatchSize} 条 | 累计完成: ${newlyCompleted}/50`);

  if (newlyCompleted >= 50) {
    log('🎉 全量 50 条外链发布计划全部达成！');
    return true;
  }

  return false;
}

async function main() {
  log('======================================================');
  log('🕒 APIVALE 外链专员：50 条小时级随机批量调度器已启动');
  log('策略: 每隔 1 小时执行一次，每次随机 3~7 条，直至 50 条全量完成');
  log('======================================================');

  let batchCount = 1;

  while (true) {
    const allDone = await runBatch(batchCount);
    if (allDone) {
      break;
    }

    batchCount++;
    log(`⏳ 进入 1 小时 (3600 秒) 周期静默等待，下个批次将在 1 小时后自动唤醒推进...`);
    await sleep(3600 * 1000);
  }
}

main().catch(err => {
  log('调度器致命异常: ' + err.stack);
  process.exit(1);
});
