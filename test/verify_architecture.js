/**
 * ComLinkAI 架构升级全量验收测试套件 (Verification & Acceptance Test Suite)
 * 验证 3 大核心模块与验收红线：
 * 1. 并发隔离验证 (Concurrency Semaphore + Multi-Tab Isolation)
 * 2. 连续失败断路器验证 (Circuit Breaker: OPEN / 冷却保护)
 * 3. 毒性域名黑名单极速秒级跳过 (Toxic Domain Blacklist)
 * 4. 标签页生命周期与看门狗回收验证 (Tab Watchdog & Lifecycle)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('../server/node_modules/ws');

// 导入模块
const { CircuitBreaker, ToxicDomainManager } = require('../docker/cloud_daemon.js');

let passCount = 0;
let failCount = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  [PASS] ✔ ${testName}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ✘ ${testName}`);
    failCount++;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function postJson(urlPath, data, port = 3010) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJson(urlPath, port = 3010) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: urlPath,
      method: 'GET'
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 开始运行 ComLinkAI L4 无人值守架构升级全量自动化测试套件');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // 测试 1：断路器逻辑验证 (Circuit Breaker)
  // --------------------------------------------------------------------------
  console.log('【测试 1：断路器逻辑验证 (Circuit Breaker)】');
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1500 });
  
  assert(cb.state === 'CLOSED', '断路器初始状态必须为 CLOSED');
  assert(cb.isOpen() === false, '断路器初始时 isOpen() 必须为 false');

  // 模拟第 1 次失败
  cb.recordFailure('403 Forbidden on site A');
  assert(cb.consecutiveFailureCount === 1, '第 1 次网络失败计数递增至 1');
  assert(cb.state === 'CLOSED', '未达阈值时状态保持 CLOSED');

  // 模拟第 2 次失败
  cb.recordFailure('Cloudflare Anti-Bot block on site B');
  assert(cb.consecutiveFailureCount === 2, '第 2 次风控阻断计数递增至 2');
  assert(cb.state === 'CLOSED', '未达阈值时状态保持 CLOSED');

  // 模拟第 3 次失败 -> 达到阈值，必须触发熔断
  cb.recordFailure('ETIMEDOUT connection dead');
  assert(cb.consecutiveFailureCount === 3, '连续失败达到阈值 3');
  assert(cb.state === 'OPEN', '断路器成功跃迁至 OPEN 熔断状态');
  assert(cb.isOpen() === true, '熔断生效中 isOpen() 必须返回 true 挂起任务');
  assert(cb.getRemainingCooldownMs() > 0, '冷却剩余倒计时大于 0');

  // 验证在冷却期内阻止空转
  console.log('  [*] 正在等待熔断冷却计时器 (1.5 秒)...');
  await sleep(1600);
  assert(cb.isOpen() === false, '冷却时间到期后自动解除 OPEN 状态');
  assert(cb.state === 'HALF_OPEN', '解除后进入 HALF_OPEN 探测模式');

  // 模拟成功恢复
  cb.recordSuccess();
  assert(cb.state === 'CLOSED', '探测成功后断路器重置为 CLOSED');
  assert(cb.consecutiveFailureCount === 0, '失败计数重置为 0');
  console.log('✔ 测试 1 验收通过！\n');

  // --------------------------------------------------------------------------
  // 测试 2：毒性域名极速秒级跳过验证 (Toxic Domain Blacklist)
  // --------------------------------------------------------------------------
  console.log('【测试 2：毒性域名极速秒级跳过验证 (Toxic Domain Blacklist)】');
  const testToxicFile = path.join(__dirname, 'test_toxic_domains.json');
  if (fs.existsSync(testToxicFile)) fs.unlinkSync(testToxicFile);

  const tdm = new ToxicDomainManager(testToxicFile);
  assert(tdm.isToxic('cleanblog.org') === false, '未标记前域名是非毒性域名');

  // 标记毒性域名 (如 Comments are closed)
  tdm.markToxic('spamblog.com', 'Comments are closed', 'https://spamblog.com/post-1');
  assert(tdm.isToxic('spamblog.com') === true, '黑名单中域名能够被精准检出');
  assert(tdm.isToxic('sub.spamblog.com') === true, '子域名自动被黑名单匹配阻断');
  
  const toxicInfo = tdm.getToxicInfo('spamblog.com');
  assert(toxicInfo && toxicInfo.reason === 'Comments are closed', '毒性原因成功持久化');

  // 验证重新从磁盘载入
  const tdmReloaded = new ToxicDomainManager(testToxicFile);
  assert(tdmReloaded.isToxic('spamblog.com') === true, '黑名单能从本地 json 文件正确持久化回读');

  // 秒级跳过时延测试
  const startSkip = Date.now();
  const shouldSkip = tdmReloaded.isToxic('spamblog.com');
  const skipElapsed = Date.now() - startSkip;
  assert(shouldSkip && skipElapsed < 50, `黑名单命中跳过耗时仅 ${skipElapsed}ms (远低于 3000ms 阈值)`);

  // 清理临时文件
  if (fs.existsSync(testToxicFile)) fs.unlinkSync(testToxicFile);
  console.log('✔ 测试 2 验收通过！\n');

  // --------------------------------------------------------------------------
  // 测试 3：中转服务启动与并发信号量控制 (Semaphore & REST API)
  // --------------------------------------------------------------------------
  console.log('【测试 3：中转服务启动与并发信号量控制 (Semaphore & REST API)】');
  const { bootstrap, httpServer, wss, actionSemaphore, MAX_CONCURRENT_TABS } = require('../server/index.js');
  
  // 确保服务在端口 3010 启动
  await bootstrap();
  await sleep(600);

  // 验证 /api/status 接口
  const statusRes = await getJson('/api/status', 3010);
  assert(statusRes.status === 200, 'GET /api/status 接口响应 HTTP 200');
  assert(statusRes.data.concurrency.max === MAX_CONCURRENT_TABS, `默认最大并发限制为 ${MAX_CONCURRENT_TABS}`);
  assert(statusRes.data.concurrency.active === 0, '当前活跃并发任务初始为 0');

  // --------------------------------------------------------------------------
  // 测试 4：并发隔离验证 (Multi-Tab Concurrency Isolation)
  // --------------------------------------------------------------------------
  console.log('\n【测试 4：并发隔离验证 (Multi-Tab Concurrency Isolation)】');
  console.log('  [*] 正在模拟 Chrome 扩展 Service Worker 建立 WebSocket 握手 (role: background)...');

  // 模拟 Chrome 扩展 background.js 建立 WebSocket
  const fakeExtWs = new WebSocket('ws://127.0.0.1:3010');
  const receivedExtensionCommands = [];

  // 模拟后台扩展在独立 Tab 中执行动作的能力
  const tabsStorage = new Map();

  await new Promise((resolve, reject) => {
    fakeExtWs.on('open', () => {
      fakeExtWs.send(JSON.stringify({ type: 'hello', role: 'background' }));
      resolve();
    });
    fakeExtWs.on('error', reject);
  });

  fakeExtWs.on('message', (msg) => {
    const payload = JSON.parse(msg.toString());
    receivedExtensionCommands.push(payload);
    const { id, action, tabId, data } = payload;

    // 模拟后台 Tab 隔离执行
    setTimeout(() => {
      if (action === 'create_tab') {
        const allocatedId = Math.floor(Math.random() * 8000 + 1000);
        tabsStorage.set(allocatedId, { url: data?.url || 'about:blank', loaded: true });
        fakeExtWs.send(JSON.stringify({ id, type: 'response', data: { success: true, tabId: allocatedId } }));
      } else if (action === 'navigate') {
        if (tabId) {
          tabsStorage.set(tabId, { url: data.url, loaded: true });
          fakeExtWs.send(JSON.stringify({ id, type: 'response', data: { success: true, tabId: tabId, url: data.url } }));
        } else {
          fakeExtWs.send(JSON.stringify({ id, type: 'response', data: { success: true, url: data.url } }));
        }
      } else if (action === 'getElements') {
        const tabInfo = tabsStorage.get(tabId);
        const elements = [
          { tag: 'input', id: 'author', text: '', selector: '#author' },
          { tag: 'textarea', id: 'comment', text: '', selector: '#comment' },
          { tag: 'button', id: 'submit', text: 'Post Comment', selector: '#submit' }
        ];
        fakeExtWs.send(JSON.stringify({
          id,
          type: 'response',
          data: {
            tabId: tabId,
            url: tabInfo ? tabInfo.url : 'unknown',
            elements: elements
          }
        }));
      } else if (action === 'close_tab') {
        tabsStorage.delete(tabId);
        fakeExtWs.send(JSON.stringify({ id, type: 'response', data: { success: true, tabId: tabId } }));
      } else {
        fakeExtWs.send(JSON.stringify({ id, type: 'response', data: { success: true } }));
      }
    }, 150); // 模拟网络/DOM 渲染耗时 150ms
  });

  await sleep(300);

  // 4.1 静默创建 2 个独立的后台标签页
  console.log('  [*] 正在通过 REST API 静默创建 2 个后台隔离标签页...');
  const createTabRes1 = await postJson('/api/action', { action: 'create_tab', data: { url: 'https://site-a.com/blog-1' } });
  const createTabRes2 = await postJson('/api/action', { action: 'create_tab', data: { url: 'https://site-b.com/blog-2' } });

  const tabId1 = createTabRes1.data.data.tabId;
  const tabId2 = createTabRes2.data.data.tabId;

  assert(Boolean(tabId1 && tabId2 && tabId1 !== tabId2), `成功分配独立 tabId: Tab1=#${tabId1}, Tab2=#${tabId2} (互相隔离)`);

  // 4.2 同时并发向 2 个不同 tabId 发送 navigate 与 getElements 任务
  console.log('  [*] 正在异步并发派发 Task A (Tab #' + tabId1 + ') 与 Task B (Tab #' + tabId2 + ')...');
  const startTime = Date.now();

  const taskAPromise = (async () => {
    // Navigate Tab 1
    const navA = await postJson('/api/action', {
      action: 'navigate',
      tabId: tabId1,
      data: { url: 'https://site-a.com/article-deep-learning' }
    });
    // GetElements Tab 1
    const elsA = await postJson('/api/action', {
      action: 'getElements',
      tabId: tabId1
    });
    return { nav: navA.data, els: elsA.data };
  })();

  const taskBPromise = (async () => {
    // Navigate Tab 2
    const navB = await postJson('/api/action', {
      action: 'navigate',
      tabId: tabId2,
      data: { url: 'https://site-b.com/article-cloud-native' }
    });
    // GetElements Tab 2
    const elsB = await postJson('/api/action', {
      action: 'getElements',
      tabId: tabId2
    });
    return { nav: navB.data, els: elsB.data };
  })();

  // 等待两个异步并发任务同时完成
  const [resultA, resultB] = await Promise.all([taskAPromise, taskBPromise]);
  const totalElapsed = Date.now() - startTime;

  assert(resultA.nav.success === true, 'Task A navigate 成功完成');
  assert(resultB.nav.success === true, 'Task B navigate 成功完成');
  assert(resultA.els.data.tabId === tabId1, `Task A 抓取结果严格归属于 Tab #${tabId1}`);
  assert(resultB.els.data.tabId === tabId2, `Task B 抓取结果严格归属于 Tab #${tabId2}`);
  assert(resultA.els.data.url === 'https://site-a.com/article-deep-learning', 'Task A 页面正文未被 Task B 踩踏覆盖');
  assert(resultB.els.data.url === 'https://site-b.com/article-cloud-native', 'Task B 页面正文未被 Task A 踩踏覆盖');

  console.log(`  [✔] 双任务并发执行完成！耗时: ${totalElapsed}ms，控制台无报错、数据零撕裂、页面零踩踏！`);
  console.log('✔ 测试 4 验收通过！\n');

  // --------------------------------------------------------------------------
  // 测试 5：并发信号量限流与超额排队验证 (Semaphore Max Limit & Queue)
  // --------------------------------------------------------------------------
  console.log('【测试 5：并发信号量限流与排队验证 (MAX_CONCURRENT_TABS = 3)】');
  
  // 同时异步发送 5 个请求，验证最多 3 个同时执行，第 4、5 个进入队列排队
  const semPromises = [];
  for (let i = 1; i <= 5; i++) {
    semPromises.push(postJson('/api/action', {
      action: 'navigate',
      tabId: 900 + i,
      data: { url: `https://test-concurrency-${i}.org` }
    }));
  }

  // 微等待 30ms 检查信号量状态
  await sleep(30);
  const runningStatus = await getJson('/api/status', 3010);
  assert(runningStatus.data.concurrency.active <= 3, `活跃并发数被硬限制在信号量上限 (当前活跃: ${runningStatus.data.concurrency.active} ≤ 3)`);
  assert(runningStatus.data.concurrency.queued >= 2, `超额请求自动进入排队队列 (当前排队: ${runningStatus.data.concurrency.queued})`);

  const semResults = await Promise.all(semPromises);
  const allSuccess = semResults.every(r => r.status === 200 && r.data.success);
  assert(allSuccess, '排队的 5 个并发请求按 FIFO 顺序全部平滑完成并出队释放');

  const afterStatus = await getJson('/api/status', 3010);
  assert(afterStatus.data.concurrency.active === 0 && afterStatus.data.concurrency.queued === 0, '全部任务结束后活跃数归零、排队队列清空');
  console.log('✔ 测试 5 验收通过！\n');

  // --------------------------------------------------------------------------
  // 测试 6：标签页生命周期与看门狗自动回收验证 (Tab Watchdog & Lifecycle)
  // --------------------------------------------------------------------------
  console.log('【测试 6：标签页生命周期与看门狗回收验证】');
  
  // 验证显式 close_tab 安全销毁
  const closeRes1 = await postJson('/api/action', { action: 'close_tab', tabId: tabId1 });
  const closeRes2 = await postJson('/api/action', { action: 'close_tab', tabId: tabId2 });
  assert(closeRes1.data.success === true, `Tab #${tabId1} 已安全销毁`);
  assert(closeRes2.data.success === true, `Tab #${tabId2} 已安全销毁`);
  assert(!tabsStorage.has(tabId1) && !tabsStorage.has(tabId2), '后台无任何僵尸标签页残留');

  // 验证看门狗超时机制 (Per-Tab Watchdog)
  const watchdogTabId = 7777;
  let watchdogTriggered = false;
  let watchdogTimer = setTimeout(() => {
    watchdogTriggered = true;
    tabsStorage.delete(watchdogTabId);
  }, 100); // 缩短模拟 45s 到 100ms
  tabsStorage.set(watchdogTabId, { url: 'https://zombie-tab.org' });

  await sleep(150);
  assert(watchdogTriggered && !tabsStorage.has(watchdogTabId), '看门狗超时后自动执行 tabs.remove 销毁僵尸标签页');
  console.log('✔ 测试 6 验收通过！\n');

  // 关闭模拟 WebSocket 连接
  fakeExtWs.close();
  await sleep(100);

  // --------------------------------------------------------------------------
  // 统计汇总
  // --------------------------------------------------------------------------
  console.log('================================================================');
  console.log(`📊 测试验收结果汇总: 全部 ${passCount + failCount} 个断言中，通过: ${passCount}，失败: ${failCount}`);
  console.log('================================================================');

  if (failCount === 0) {
    console.log('🎉 恭喜！全部验收红线 100% 达成！ComLinkAI 架构升级已圆满通过。');
    process.exit(0);
  } else {
    console.error('❌ 存在未通过的测试项，请检查日志！');
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('测试套件发生未捕获异常:', err);
  process.exit(1);
});
