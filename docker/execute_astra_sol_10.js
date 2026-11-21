const fs = require('fs');
const path = require('path');
const { executeHumanSubmission } = require('/root/codexlink/.agents/skills/apivale-comment-outreach/scripts/human_outreach_submitter.js');

const QUEUE_PATH = '/root/codexlink/APIVALE_Outreach_Hub/03_Pending_Queue/astra_sol_10_queue.json';
const CSV_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.csv';
const MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.md';
const DEDICATED_MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/astra_vs_sol_pricing_benchmarks_logs.md';
const ARTIFACT_DIR = '/root/codexlink/artifacts';
const LOG_FILE = '/root/codexlink/logs/astra_sol_10_runner.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {}
}

function recordTask(t) {
  const csvLine = `${t.index},2026-11-21,${t.domain},"${t.title.replace(/"/g, '""')}",/blog/6-2-astra-vs-6-2-sol-pricing-benchmarks-guide/,${t.author_persona},${t.email},published,Row ${t.row_number}\n`;
  fs.appendFileSync(CSV_PATH, csvLine, 'utf8');

  const mdLine = `| ${t.index} | 2026-11-21 | \`${t.domain}\` | [${t.title}](${t.url}) | \`/blog/6-2-astra-vs-6-2-sol-pricing-benchmarks-guide/\` | \`${t.author_persona}\` | \`${t.email}\` | ✅ Published (Gold Standard) | Row ${t.row_number} |\n`;
  fs.appendFileSync(MD_PATH, mdLine, 'utf8');

  // 初始化专属专题日志文件头（如果不存在）
  if (!fs.existsSync(DEDICATED_MD_PATH)) {
    const header = `# 🚀 6.2 Astra vs 6.2 Sol 专属技术外链发布专项日志\n\n` +
      `> **落地内页**: [https://apivale.com/blog/6-2-astra-vs-6-2-sol-pricing-benchmarks-guide/](https://apivale.com/blog/6-2-astra-vs-6-2-sol-pricing-benchmarks-guide/)\n` +
      `> **核心关键词**: \`6.2 Astra vs 6.2 Sol\`\n` +
      `> **专家人设**: \`Alex Rivera @ APIVALE\` (\`alex.rivera@apivale.com\`)\n` +
      `> **执行工具**: ComLinkAI 侧边栏自动化拟人化发布引擎\n\n` +
      `| 序号 | 提交日期 | 目标站点 | 目标文章标题与链接 | 承接内页 | 出场专家 | 专家专属邮箱 | 状态凭证 | 表格行号 |\n` +
      `| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :---: | :---: |\n`;
    fs.writeFileSync(DEDICATED_MD_PATH, header, 'utf8');
  }
  fs.appendFileSync(DEDICATED_MD_PATH, mdLine, 'utf8');
}

async function main() {
  log('======================================================');
  log('🚀 [APIVALE 外链专员] 6.2 Astra vs 6.2 Sol 10条外链发布启动');
  log('落地页: https://apivale.com/blog/6-2-astra-vs-6-2-sol-pricing-benchmarks-guide/');
  log('人设: Alex Rivera @ APIVALE (alex.rivera@apivale.com)');
  log('======================================================');

  const tasks = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.status === 'published') {
      log(`跳过已发布项 [${i + 1}/${tasks.length}] #${t.index} -> ${t.domain}`);
      continue;
    }

    log(`▶ 正在推进 [${i + 1}/${tasks.length}] (#${t.index} Row ${t.row_number}) -> 目标: ${t.domain}`);

    try {
      await executeHumanSubmission({
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

      t.status = 'published';
      t.published_at = new Date().toISOString();
      recordTask(t);
      fs.writeFileSync(QUEUE_PATH, JSON.stringify(tasks, null, 2), 'utf8');
      log(`✔ [#${t.index}] ${t.domain} 拟人化提交与数据入库成功！`);
    } catch (err) {
      log(`❌ [#${t.index}] ${t.domain} 执行异常: ${err.message}`);
      t.status = 'failed';
      t.error = err.message;
      fs.writeFileSync(QUEUE_PATH, JSON.stringify(tasks, null, 2), 'utf8');
    }
  }

  const successCount = tasks.filter(t => t.status === 'published').length;
  log(`🎉 任务执行完毕！成功发布: ${successCount} / ${tasks.length}`);
}

main().catch(err => {
  log(`致命错误: ${err.message}`);
  process.exit(1);
});
