/**
 * ComLinkAI - Cloud Autonomous Outreach & Backlink Daemon (7x24h)
 * 运行在 Linux Docker 容器或本地后台环境的 L4 级无人值守自动化守护程序
 * 职责：
 * 1. 周期性执行待发布队列 (Pending Queue) 中的外链任务 (支持 TabId 隔离并发)
 * 2. 连续失败断路器 (Circuit Breaker)：遇连续 3~5 次网络/风控阻断自动挂起休眠 15 分钟
 * 3. 毒性域名极速秒级跳过 (Toxic Domain Blacklist)：遇 Comments closed/无表单秒级标记并跳过
 * 4. Chromium 内存自愈与周期性轮换：每 40 次任务触发全局上下文清理与优雅重启
 * 5. 每 12 小时自动巡检存量外链的审批通过状态
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 路径常量
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(__dirname, '../APIVALE_Outreach_Hub/03_Pending_Queue/pending_queue.json');
const MASTER_LOG_CSV = path.join(__dirname, '../APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.csv');
const MASTER_LOG_MD = path.join(__dirname, '../APIVALE_Outreach_Hub/02_Published_Logs/all_published_master_log.md');
const TOXIC_DOMAINS_FILE = process.env.TOXIC_DOMAINS_FILE || path.join(__dirname, 'toxic_domains.json');

// --------------------------------------------------------------------------
// 1. 连续失败断路器 (Circuit Breaker)
// --------------------------------------------------------------------------
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '3', 10);
    this.cooldownMs = options.cooldownMs || parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || String(15 * 60 * 1000), 10);
    this.consecutiveFailureCount = 0;
    this.state = 'CLOSED'; // 'CLOSED' (正常) | 'OPEN' (熔断休眠) | 'HALF_OPEN' (探测恢复)
    this.lastFailureTime = null;
    this.cooldownUntil = null;
    this.onStateChange = options.onStateChange || null;
  }

  recordSuccess() {
    if (this.consecutiveFailureCount > 0 || this.state !== 'CLOSED') {
      console.log(`[Circuit Breaker] ✅ 任务执行成功，失败计数清零 (${this.consecutiveFailureCount} -> 0)，断路器恢复 CLOSED 状态。`);
    }
    this.consecutiveFailureCount = 0;
    this.state = 'CLOSED';
    this.cooldownUntil = null;
    if (this.onStateChange) this.onStateChange(this.state, null);
  }

  recordFailure(errorReason = '') {
    this.consecutiveFailureCount++;
    this.lastFailureTime = new Date().toISOString();
    console.warn(`[Circuit Breaker] ⚠️ 连续阻断/网络失败计数: #${this.consecutiveFailureCount}/${this.failureThreshold} (原因: ${errorReason})`);

    if (this.consecutiveFailureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.cooldownUntil = Date.now() + this.cooldownMs;
      const cooldownMinutes = Math.round(this.cooldownMs / 60000);
      console.error(`\n🚨🚨🚨==============================================================🚨🚨🚨`);
      console.error(`[Circuit Breaker: OPEN] 连续触发 ${this.consecutiveFailureCount} 次严重阻断/网络死链！`);
      console.error(`系统自动触发熔断冷却，挂起休眠 ${cooldownMinutes} 分钟，防止在风控状态下盲目空转被封 IP！`);
      console.error(`预计冷却解冻时间: ${new Date(this.cooldownUntil).toISOString()}`);
      console.error(`🚨🚨🚨==============================================================🚨🚨🚨\n`);
      if (this.onStateChange) this.onStateChange(this.state, this.cooldownUntil);
    }
  }

  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() >= this.cooldownUntil) {
        console.log(`[Circuit Breaker] ⏳ 熔断冷却时间已到，断路器进入 HALF_OPEN 探测恢复状态...`);
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  getRemainingCooldownMs() {
    if (this.state === 'OPEN' && this.cooldownUntil) {
      return Math.max(0, this.cooldownUntil - Date.now());
    }
    return 0;
  }

  getStatus() {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailureCount,
      failureThreshold: this.failureThreshold,
      cooldownUntil: this.cooldownUntil ? new Date(this.cooldownUntil).toISOString() : null,
      remainingCooldownSeconds: Math.round(this.getRemainingCooldownMs() / 1000)
    };
  }
}

// --------------------------------------------------------------------------
// 2. 毒性域名黑名单管理器 (Toxic Domain Blacklist)
// --------------------------------------------------------------------------
class ToxicDomainManager {
  constructor(filePath = TOXIC_DOMAINS_FILE) {
    this.filePath = filePath;
    this.blacklist = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.domains) {
          for (const [dom, info] of Object.entries(parsed.domains)) {
            this.blacklist.set(dom.toLowerCase(), info);
          }
        }
        console.log(`[ToxicBlacklist] 成功加载本地毒性域名黑名单，共计 ${this.blacklist.size} 个条目。`);
      }
    } catch (e) {
      console.warn(`[ToxicBlacklist] 读取黑名单文件失败，初始化空列表:`, e.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const domainsObj = {};
      for (const [dom, info] of this.blacklist.entries()) {
        domainsObj[dom] = info;
      }
      const data = {
        updatedAt: new Date().toISOString(),
        count: this.blacklist.size,
        domains: domainsObj
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error(`[ToxicBlacklist] 保存毒性域名黑名单失败:`, e.message);
    }
  }

  isToxic(domain) {
    if (!domain) return false;
    const cleanDom = domain.toLowerCase().trim();
    if (this.blacklist.has(cleanDom)) return true;
    for (const key of this.blacklist.keys()) {
      if (cleanDom.endsWith('.' + key)) return true;
    }
    return false;
  }

  getToxicInfo(domain) {
    if (!domain) return null;
    const cleanDom = domain.toLowerCase().trim();
    if (this.blacklist.has(cleanDom)) return this.blacklist.get(cleanDom);
    for (const [key, val] of this.blacklist.entries()) {
      if (cleanDom.endsWith('.' + key)) return val;
    }
    return null;
  }

  markToxic(domain, reason, url = '') {
    if (!domain) return;
    const cleanDom = domain.toLowerCase().trim();
    const info = {
      domain: cleanDom,
      reason: reason || 'Detected as toxic/closed',
      detectedAt: new Date().toISOString(),
      url: url || ''
    };
    this.blacklist.set(cleanDom, info);
    this.save();
    console.warn(`[ToxicBlacklist] 🚫 已将毒性域名 ${cleanDom} 记录至黑名单！原因: ${reason}`);
  }

  get count() {
    return this.blacklist.size;
  }
}

// 实例初始化
const circuitBreaker = new CircuitBreaker();
const toxicDomainManager = new ToxicDomainManager();

let daemonStats = {
  startedAt: new Date().toISOString(),
  lastCheckTime: null,
  lastPublishTime: null,
  totalProcessedInSession: 0,
  tasksProcessedCount: 0,
  activeQueueLength: 0,
  isWorkerBusy: false
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function callBridgeAction(action, data = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ action, data });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3010,
      path: '/api/action',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
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

// --------------------------------------------------------------------------
// 3. Chromium 内存自愈与周期性轮换 (每 40 次任务触发)
// --------------------------------------------------------------------------
async function checkMemoryHealingThreshold() {
  if (daemonStats.tasksProcessedCount > 0 && daemonStats.tasksProcessedCount % 40 === 0) {
    console.log(`\n🧹 [Chromium 内存自愈] 已连续处理 ${daemonStats.tasksProcessedCount} 个任务，达到 40 次全局轮换阈值！`);
    console.log(`正在触发底层标签页全局清理与 V8 引擎垃圾回收...`);
    try {
      await callBridgeAction('cleanup_context');
    } catch (e) {
      console.warn(`[内存自愈] 触发 Bridge 上下文清理异常:`, e.message);
    }

    // 在 Docker 容器环境中支持退出重启以彻底释放物理内存
    if (process.env.CONTAINER_RESTART_ON_ROTATION === 'true') {
      console.log(`[内存自愈] 检测到 CONTAINER_RESTART_ON_ROTATION=true，正在优雅退出供 supervisord 重新拉起以彻底释放物理内存...`);
      process.exit(0);
    }
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

// --------------------------------------------------------------------------
// 4. 处理待发布队列中的任务 (带 TabId 隔离、黑名单秒跳与熔断保护)
// --------------------------------------------------------------------------
async function processPendingQueue() {
  if (daemonStats.isWorkerBusy) return;

  // 1. 检查断路器熔断状态
  if (circuitBreaker.isOpen()) {
    const remainSec = Math.round(circuitBreaker.getRemainingCooldownMs() / 1000);
    console.warn(`[Circuit Breaker] ⏸️ 系统正处于熔断冷却中，剩余休眠时间: ${remainSec} 秒，暂缓处理队列。`);
    return;
  }

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

  const currentTask = pendingTasks[0];
  let domain = currentTask.domain;
  if (!domain && currentTask.url) {
    try { domain = new URL(currentTask.url).hostname; } catch (e) {}
  }

  // 2. 毒性域名黑名单秒级跳过 (Toxic Domain Fast Skip < 1s)
  if (toxicDomainManager.isToxic(domain)) {
    const toxicInfo = toxicDomainManager.getToxicInfo(domain);
    console.warn(`[黑名单秒级跳过] 🚫 任务 [${currentTask.id}] 目标域名 ${domain} 命中本地黑名单 (原因: ${toxicInfo?.reason || 'Toxic'})，极速秒级跳过！`);
    currentTask.status = 'toxic_skipped';
    currentTask.skippedReason = toxicInfo?.reason || 'Toxic Domain Blacklist';
    currentTask.skippedAt = new Date().toISOString();
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

    daemonStats.tasksProcessedCount++;
    await checkMemoryHealingThreshold();
    return;
  }

  const isConnected = await checkBridgeConnection();
  if (!isConnected) {
    console.log(`[${new Date().toISOString()}] ⏳ 等待 Chromium 扩展完成与 Bridge 的连接握手...`);
    return;
  }

  daemonStats.isWorkerBusy = true;
  console.log(`\n[${new Date().toISOString()}] 🚀 发现待发布任务 [${currentTask.id}] 目标: ${currentTask.url} (域名: ${domain})`);

  let isolatedTabId = null;

  try {
    // 3. 静默创建后台隔离标签页 (Multi-Tab Isolation)
    const createRes = await callBridgeAction('create_tab', { url: 'about:blank' });
    if (createRes && createRes.data && createRes.data.tabId) {
      isolatedTabId = createRes.data.tabId;
    } else if (createRes && createRes.tabId) {
      isolatedTabId = createRes.tabId;
    }
    console.log(`[隔离并发底座] 已为任务 [${currentTask.id}] 分配专属后台标签页 #${isolatedTabId}`);

    // 动态载入拟人化执行器
    const { executeHumanSubmission } = require('../.agents/skills/apivale-comment-outreach/scripts/human_outreach_submitter.js');

    const result = await executeHumanSubmission({
      pageUrl: currentTask.url,
      targetUrl: currentTask.landing_page || 'https://apivale.com/',
      author: currentTask.author_persona || 'Elena Rostova @ APIVALE',
      email: currentTask.email,
      domain: domain,
      tabId: isolatedTabId,
      comment: currentTask.comment || `Comprehensive analysis of ${currentTask.keyword || 'API routing and inference optimization'}. In production multi-agent environments, choosing between balanced latency and deep reasoning requires strict cost governance and real-time prompt cache arbitration.`
    }, {
      tabId: isolatedTabId,
      saveScreenshot: true,
      artifactDir: process.env.ARTIFACT_DIR || path.join(__dirname, '../artifacts'),
      syncSheet: true
    });

    if (result && result.success) {
      currentTask.status = 'published';
      currentTask.publishedAt = new Date().toISOString();
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

      daemonStats.totalProcessedInSession++;
      daemonStats.tasksProcessedCount++;
      daemonStats.lastPublishTime = new Date().toISOString();
      
      // 成功恢复断路器
      circuitBreaker.recordSuccess();
      console.log(`✔ 任务 [${currentTask.id}] 自动化发布并同步 Sheets 成功！已处理计数: ${daemonStats.tasksProcessedCount}`);
      await checkMemoryHealingThreshold();
    }
  } catch (err) {
    console.error(`❌ 任务 [${currentTask.id}] 执行异常:`, err.message);
    daemonStats.tasksProcessedCount++;

    if (err.isToxic) {
      // 触发毒性域名 3 秒极速熔断并记入黑名单
      console.warn(`[毒性域名极速熔断] 页面探测到毒性特征 (${err.toxicReason || err.message})，记录黑名单秒级跳过！`);
      toxicDomainManager.markToxic(domain, err.toxicReason || err.message, currentTask.url);
      currentTask.status = 'toxic_skipped';
      currentTask.skippedReason = err.toxicReason || err.message;
      currentTask.skippedAt = new Date().toISOString();
    } else {
      // 网络错误、死链、Cloudflare 盾或 403 阻断 -> 记入连续失败计数器
      const isBlockOrNetwork = err.message.includes('403') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ENOTFOUND') ||
        err.message.includes('Cloudflare') ||
        err.message.includes('Shield') ||
        err.message.includes('风控') ||
        err.message.includes('timeout') ||
        err.message.includes('超时');

      if (isBlockOrNetwork) {
        circuitBreaker.recordFailure(err.message);
      }
      currentTask.status = 'retry_later';
      currentTask.lastError = err.message;
    }

    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    await checkMemoryHealingThreshold();
  } finally {
    // 安全销毁独立标签页，无幽灵残留
    if (isolatedTabId) {
      try {
        await callBridgeAction('close_tab', { tabId: isolatedTabId });
        console.log(`[隔离并发底座] 任务结束，已安全销毁独立后台标签页 #${isolatedTabId}`);
      } catch (e) {
        console.warn(`[隔离并发底座] 销毁标签页 #${isolatedTabId} 异常:`, e.message);
      }
    }
    daemonStats.isWorkerBusy = false;
  }
}

// --------------------------------------------------------------------------
// 5. 守护进程主循环
// --------------------------------------------------------------------------
async function main() {
  console.log('======================================================');
  console.log('🚀 ComLinkAI Linux Cloud Headless Daemon (L4 无人值守升级版)');
  console.log(`启动时间: ${daemonStats.startedAt}`);
  console.log(`断路器阈值: 连续 ${circuitBreaker.failureThreshold} 次失败，冷却 ${Math.round(circuitBreaker.cooldownMs / 60000)} 分钟`);
  console.log(`毒性黑名单: 已载入 ${toxicDomainManager.count} 个域名`);
  console.log(`内存自愈轮换: 每 40 次任务触发 Chromium 全局清理`);
  console.log('======================================================\n');

  // 启动即刻执行一次健康巡检
  await runScheduledHealthAudit();

  // 12 小时周期定时器
  setInterval(runScheduledHealthAudit, 12 * 60 * 60 * 1000);

  // 队列轮询处理循环 (每 30 秒检查一次是否有新任务待推进)
  const pollIntervalMs = parseInt(process.env.DAEMON_POLL_INTERVAL_MS || '30000', 10);
  while (true) {
    try {
      await processPendingQueue();
    } catch (e) {
      console.error('守护主循环异常:', e.message);
    }
    await sleep(pollIntervalMs);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Daemon 致命退出:', err);
    process.exit(1);
  });
}

module.exports = {
  CircuitBreaker,
  ToxicDomainManager,
  circuitBreaker,
  toxicDomainManager,
  daemonStats,
  callBridgeAction,
  processPendingQueue,
  checkMemoryHealingThreshold,
  main
};
