/**
 * ComLinkAI - Cloud Autonomous Outreach & Backlink Daemon (7x24h)
 * 运行在 Linux Docker 容器内的无人值守自动化守护程序
 * 职责：
 * 1. 周期性执行待发布队列 (Pending Queue) 中的外链任务
 * 2. 每 12 小时自动巡检存量外链的审批通过状态
 * 3. 实时提供 HTTP 状态监控接口 (3010 /daemon/status)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '../APIVALE_Outreach_Hub/03_Pending_Queue/pending_queue.json');
const MASTER_LOG_CSV = path.join(__dirname, '../APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.csv');
const MASTER_LOG_MD = path.join(__dirname, '../APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.md');

let daemonStats = {
  startedAt: new Date().toISOString(),
  lastCheckTime: null,
  lastPublishTime: null,
  totalProcessedInSession: 0,
  activeQueueLength: 0,
  isWorkerBusy: false
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

// 检查 Bridge 与浏览器扩展连接状态
async function checkBridgeConnection() {
  try {
    const res = await callBridgeAction('getActiveTab');
    if (res && res.error && res.error.includes('未连接')) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// 运行周期性外链过审状态巡检
async function runScheduledHealthAudit() {
  console.log(`\n[${new Date().toISOString()}] 🩺 启动每 12 小时例行外链过审状态全量巡检...`);
  try {
    const checkScript = path.join(__dirname, '../APIVALE_Outreach_Hub/05_Live_Status_Tracker/check_backlink_health.js');
    if (fs.existsSync(checkScript)) {
      const { exec } = require('child_process');
      exec(`node "${checkScript}"`, (err, stdout, stderr) => {
        if (err) {
          console.error('[HealthAudit Error]:', err.message);
        } else {
          console.log('[HealthAudit Result]:\n', stdout);
        }
      });
    }
    daemonStats.lastCheckTime = new Date().toISOString();
  } catch (err) {
    console.error('巡检异常:', err.message);
  }
}

// 处理待发布队列中的 P0 / P1 任务
async function processPendingQueue() {
  if (daemonStats.isWorkerBusy) return;

  if (!fs.existsSync(QUEUE_FILE)) {
    return;
  }

  let queue = [];
  try {
    queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch (e) {
    console.error('读取待发布队列失败:', e.message);
    return;
  }

  const pendingTasks = queue.filter(t => t.status === 'pending');
  daemonStats.activeQueueLength = pendingTasks.length;

  if (pendingTasks.length === 0) {
    return;
  }

  const isConnected = await checkBridgeConnection();
  if (!isConnected) {
    console.log(`[${new Date().toISOString()}] ⏳ 等待 Chromium 扩展完成与 Bridge 的 WebSocket 握手...`);
    return;
  }

  daemonStats.isWorkerBusy = true;
  const currentTask = pendingTasks[0];
  console.log(`\n[${new Date().toISOString()}] 🚀 发现待发布任务 [${currentTask.id}] 目标: ${currentTask.url}`);

  try {
    // 动态载入拟人化执行器
    const { executeHumanSubmission } = require('../.agents/skills/apivale-comment-outreach/scripts/human_outreach_submitter.js');

    const result = await executeHumanSubmission({
      pageUrl: currentTask.url,
      targetUrl: currentTask.landing_page || 'https://apivale.com/',
      author: currentTask.author_persona || 'Elena Rostova @ APIVALE',
      email: currentTask.email,
      domain: currentTask.domain,
      comment: currentTask.comment || `Comprehensive analysis of ${currentTask.keyword || 'API routing and inference optimization'}. In production multi-agent environments, choosing between balanced latency and deep reasoning requires strict cost governance and real-time prompt cache arbitration.`
    }, {
      saveScreenshot: true,
      artifactDir: '/app/artifacts',
      syncSheet: true
    });

    if (result && result.success) {
      currentTask.status = 'published';
      currentTask.publishedAt = new Date().toISOString();
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

      daemonStats.totalProcessedInSession++;
      daemonStats.lastPublishTime = new Date().toISOString();
      console.log(`✔ 任务 [${currentTask.id}] 自动化发布并同步 Sheets 成功！`);
    }
  } catch (err) {
    console.error(`❌ 任务 [${currentTask.id}] 执行异常:`, err.message);
    currentTask.status = 'retry_later';
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } finally {
    daemonStats.isWorkerBusy = false;
  }
}

// 守护进程主循环
async function main() {
  console.log('======================================================');
  console.log('🚀 ComLinkAI Linux Cloud Headless Daemon 启动成功');
  console.log(`启动时间: ${daemonStats.startedAt}`);
  console.log('守护职责: 7x24h 待发布队列自动推进 + 存量外链定时巡检');
  console.log('======================================================\n');

  // 启动即刻执行一次健康巡检
  await runScheduledHealthAudit();

  // 12 小时周期定时器 (12 * 3600 * 1000)
  setInterval(runScheduledHealthAudit, 12 * 60 * 60 * 1000);

  // 队列轮询处理循环 (每 60 秒检查一次是否有新任务待推进)
  while (true) {
    try {
      await processPendingQueue();
    } catch (e) {
      console.error('守护主循环异常:', e.message);
    }
    await sleep(60000);
  }
}

main().catch(err => {
  console.error('Daemon 致命退出:', err);
  process.exit(1);
});
