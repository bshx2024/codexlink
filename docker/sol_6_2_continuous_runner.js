const fs = require('fs');
const path = require('path');
const { executeHumanSubmission } = require('/root/codexlink/.agents/skills/apivale-comment-outreach/scripts/human_outreach_submitter.js');

const POOL_PATH = '/root/codexlink/APIVALE_Outreach_Hub/03_Pending_Queue/sol_6_2_50_staged_pool.json';
const CSV_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.csv';
const MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.md';
const DEDICATED_MD_PATH = '/root/codexlink/APIVALE_Outreach_Hub/02_Published_Logs/gpt62_sol_api_logs.md';
const ARTIFACT_DIR = '/root/codexlink/artifacts';
const LOG_FILE = '/root/codexlink/logs/sol_6_2_50_runner.log';

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
  const csvLine = `${t.index},2026-11-21,${t.domain},"${t.title.replace(/"/g, '""')}",/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/,${t.author_persona},${t.email},published,Row ${t.row_number}\n`;
  fs.appendFileSync(CSV_PATH, csvLine, 'utf8');

  const mdLine = `| ${t.index} | 2026-11-21 | \`${t.domain}\` | [${t.title}](${t.url}) | \`/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/\` | \`${t.author_persona}\` | \`${t.email}\` | ✅ Published (Gold Standard) | Row ${t.row_number} |\n`;
  fs.appendFileSync(MD_PATH, mdLine, 'utf8');

  const dedicatedLine = `| **#${t.row_number}** | \`${t.domain}\` | [${t.title}](${t.url})<br>• GPT-6.2 Sol API $2/$10 定价、1.05M 上下文与 65 TPS 路由实战 | \`/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/\` | ✅ published |\n`;
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
    log(`⚠️ [自愈检测] 检测到浏览器插件未连接，第 ${attempt}/3 次尝试自动拉起容器...`);
    try {
      require('child_process').execSync('docker restart comlinkai-cloud-engine');
      await sleep(10000);
    } catch (e) {}
  }
  return false;
}

async function main() {
  log('================================================================');
  log('🕒 [APIVALE 外链专员] GPT-6.2 Sol API 50条不定期间隔自动化调度器启动');
  log('目标落地页: https://apivale.com/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/');
  log('排期策略: 6 小时内动态随机拟人间隔分发 (平均 4~6 分钟/篇，伴随自然呼吸停顿)');
  log('人设与邮箱: Alex Rivera @ APIVALE (alex.rivera@apivale.com)');
  log('门禁策略: 严格执行 4-Gate 事前核验 + 提交返回值判空校验，杜绝虚标');
  log('================================================================');

  if (!fs.existsSync(POOL_PATH)) {
    log('错误: 未找到任务池文件 ' + POOL_PATH);
    process.exit(1);
  }

  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));

  let publishedCount = pool.filter(t => t.status === 'published').length;

  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    if (t.status === 'published') {
      continue;
    }

    log(`\n▶ 正在推进 [${publishedCount + 1}/50] (#${t.index} Row ${t.row_number}) -> 目标: ${t.domain}`);

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

      // 严格门禁放行与执行结果判空校验
      if (!res || !res.success || res.skipped) {
        log(`⛔ [#${t.index}] ${t.domain} 门禁未放行或提交未成功: ${res ? (res.reason || res.error || '未知原因') : '无响应'}`);
        t.status = 'skipped';
        t.skip_reason = res ? (res.reason || res.error) : 'Unknown';
        fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2), 'utf8');
        continue;
      }

      t.status = 'published';
      t.published_at = new Date().toISOString();
      t.pre_screenshot = res.preScreenshot || '';
      t.post_screenshot = res.postScreenshot || '';
      recordTask(t);
      publishedCount++;
      fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2), 'utf8');

      log(`✔ [#${t.index} Row ${t.row_number}] ${t.domain} 拟人化提交与数据入库成功！(累计完成: ${publishedCount}/50)`);

      if (publishedCount >= 50) {
        log('🎉 全部 50 条任务已全部发布完毕！调度器圆满完成任务。');
        break;
      }

      // 不定期间隔算法 (Irregular Interval Algorithm: 6小时内50条)
      // 基础动态随机间隔: 210 ~ 380 秒 (3.5 ~ 6.3 分钟)
      let waitSeconds = Math.floor(Math.random() * 170) + 210;

      // 每逢 10 条插入一次 10~15 分钟的“思考与咖啡长休眠”，模拟人类真实工作节律
      if (publishedCount % 10 === 0) {
        const breakMinutes = Math.floor(Math.random() * 5) + 10;
        waitSeconds = breakMinutes * 60;
        log(`☕ [工作节律停顿] 已完成第 ${publishedCount} 篇节点，执行 ${breakMinutes} 分钟自然呼吸长停顿...`);
      } else {
        const waitMinutes = (waitSeconds / 60).toFixed(1);
        log(`⏳ [有机时钟抖动] 批次进入不定期拟人冷却: 等待 ${waitMinutes} 分钟 (${waitSeconds}s) 后触发下一篇...`);
      }

      await sleep(waitSeconds * 1000);

    } catch (err) {
      log(`❌ [#${t.index}] ${t.domain} 执行异常: ${err.message}`);
      t.status = 'retry_later';
      t.last_error = err.message;
      fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2), 'utf8');

      // 异常快速退避 45 秒后尝试下一任务
      log('⏳ 异常退避 45 秒后继续下一项...');
      await sleep(45000);
    }
  }

  log(`🏁 50 条任务全流程执行完成！总成功上线: ${publishedCount}/50`);
}

main().catch(err => {
  log(`致命异常: ${err.message}`);
  process.exit(1);
});
