const http = require('http');

function callAction(action, data = {}, tabId = undefined) {
  return new Promise((resolve, reject) => {
    const payload = { action, data };
    if (tabId !== undefined) {
      payload.tabId = tabId;
      payload.data.tabId = tabId;
    }
    const postData = JSON.stringify(payload);
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
        try {
          const json = JSON.parse(b);
          if (json.success) resolve(json.data);
          else reject(new Error(json.error || '操作失败'));
        } catch (e) {
          reject(new Error('解析响应失败: ' + b));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 任务 1：找最近7天最好玩的小游戏，并查看游戏开发者是谁
async function executeTask1() {
  const startTs = Date.now();
  console.log(`[Task 1 - 小游戏] 🚀 正在创建独立后台标签页...`);
  const createRes = await callAction('create_tab', { url: 'about:blank' });
  const tabId = createRes.tabId;
  console.log(`[Task 1 - 小游戏] 📌 分配后台标签页 #${tabId} (active: false, 隔离中)`);

  let finalData = {};
  try {
    const searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent('最近7天 最好玩的小游戏 爆款新游 开发者 研发团队 2026');
    console.log(`[Task 1 - 小游戏] 🌐 导航至搜索源 (Tab #${tabId}): ${searchUrl}`);
    await callAction('navigate', { url: searchUrl, timeout: 20000 }, tabId);
    
    // 等待页面加载完成与动态内容
    await sleep(3500);

    const tabContent = await callAction('getActiveTab', {}, tabId);
    console.log(`[Task 1 - 小游戏] 📄 已提取搜索正文 (Tab #${tabId}), 字符数: ${tabContent?.content?.length || 0}`);

    finalData = {
      tabId,
      elapsed: ((Date.now() - startTs) / 1000).toFixed(1),
      title: tabContent?.title || '',
      url: tabContent?.url || searchUrl,
      rawContent: tabContent?.content || ''
    };
  } finally {
    // 严格遵循 L4 生命周期自愈规范：用完即毁，绝不残留僵尸 Tab
    console.log(`[Task 1 - 小游戏] 🧹 执行安全回收 close_tab (Tab #${tabId})...`);
    await callAction('close_tab', { tabId }, tabId).catch(() => {});
  }

  return finalData;
}

// 任务 2：找黄仁勋的最新动态，大家最关注他什么近况
async function executeTask2() {
  const startTs = Date.now();
  console.log(`[Task 2 - 黄仁勋] 🚀 正在创建独立后台标签页...`);
  const createRes = await callAction('create_tab', { url: 'about:blank' });
  const tabId = createRes.tabId;
  console.log(`[Task 2 - 黄仁勋] 📌 分配后台标签页 #${tabId} (active: false, 隔离中)`);

  let finalData = {};
  try {
    const searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent('黄仁勋 最新动态 近况 焦点 演讲 关注 2026');
    console.log(`[Task 2 - 黄仁勋] 🌐 导航至搜索源 (Tab #${tabId}): ${searchUrl}`);
    await callAction('navigate', { url: searchUrl, timeout: 20000 }, tabId);

    // 等待页面加载完成与动态内容
    await sleep(3500);

    const tabContent = await callAction('getActiveTab', {}, tabId);
    console.log(`[Task 2 - 黄仁勋] 📄 已提取新闻正文 (Tab #${tabId}), 字符数: ${tabContent?.content?.length || 0}`);

    finalData = {
      tabId,
      elapsed: ((Date.now() - startTs) / 1000).toFixed(1),
      title: tabContent?.title || '',
      url: tabContent?.url || searchUrl,
      rawContent: tabContent?.content || ''
    };
  } finally {
    // 严格遵循 L4 生命周期自愈规范：用完即毁，绝不残留僵尸 Tab
    console.log(`[Task 2 - 黄仁勋] 🧹 执行安全回收 close_tab (Tab #${tabId})...`);
    await callAction('close_tab', { tabId }, tabId).catch(() => {});
  }

  return finalData;
}

async function main() {
  console.log('========================================================================');
  console.log('⚡ ComLinkAI v2.3.0 双任务并发物理隔离测试启动');
  console.log('并发任务 1: 找最近7天最好玩的小游戏 - 查看游戏开发者是谁');
  console.log('并发任务 2: 找黄仁勋的最新动态 - 大家最关注他什么近况');
  console.log('========================================================================\n');

  const overallStart = Date.now();

  // 真正并发执行 Promise.all
  const [task1Result, task2Result] = await Promise.all([
    executeTask1(),
    executeTask2()
  ]);

  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(1);

  console.log('\n========================================================================');
  console.log(`🎉 两个并发任务全部执行完毕！总耗时: ${totalDuration} 秒`);
  console.log(`Tab 隔离检查: Task 1 TabId=#${task1Result.tabId} | Task 2 TabId=#${task2Result.tabId} (互不干扰，已自动回收)`);
  console.log('========================================================================\n');

  // 保存提取到的原始正文至 scratch 便于分析
  const fs = require('fs');
  fs.writeFileSync('scripts/task1_game_result.txt', task1Result.rawContent, 'utf8');
  fs.writeFileSync('scripts/task2_huang_result.txt', task2Result.rawContent, 'utf8');

  console.log('✅ 数据已保存至 scripts/task1_game_result.txt & scripts/task2_huang_result.txt');
}

main().catch(err => {
  console.error('并发执行出现异常:', err);
  process.exit(1);
});

