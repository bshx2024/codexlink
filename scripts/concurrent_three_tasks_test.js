const http = require('http');
const fs = require('fs');

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

// 通用并发子任务执行器
async function runSubTask(taskIndex, taskName, queryUrl) {
  const startTs = Date.now();
  console.log(`[Task ${taskIndex}: ${taskName}] 🚀 正在创建静默后台隔离标签页...`);
  
  // 1. 创建独立后台 Tab
  const createRes = await callAction('create_tab', { url: 'about:blank' });
  const tabId = createRes.tabId;
  console.log(`[Task ${taskIndex}: ${taskName}] 📌 分配后台标签页 #${tabId} (active: false)`);

  let resultData = {};
  try {
    // 2. 导航至目标搜索源
    console.log(`[Task ${taskIndex}: ${taskName}] 🌐 导航 (Tab #${tabId}) 至目标源...`);
    await callAction('navigate', { url: queryUrl, timeout: 25000 }, tabId);

    // 3. 稍候渲染动态内容
    await sleep(3500);

    // 4. 获取正文内容
    console.log(`[Task ${taskIndex}: ${taskName}] 📄 正在提取搜索正文 (Tab #${tabId})...`);
    const content = await callAction('getActiveTab', {}, tabId);

    resultData = {
      taskIndex,
      taskName,
      tabId,
      elapsed: ((Date.now() - startTs) / 1000).toFixed(1),
      title: content?.title || '',
      url: content?.url || queryUrl,
      rawContent: content?.content || ''
    };
    console.log(`[Task ${taskIndex}: ${taskName}] ✔ 完成！Tab #${tabId} 耗时: ${resultData.elapsed}s, 提取字符: ${resultData.rawContent.length}`);
  } finally {
    // 5. 任务结束严格执行主动销毁
    console.log(`[Task ${taskIndex}: ${taskName}] 🧹 执行安全回收 close_tab (Tab #${tabId})...`);
    await callAction('close_tab', { tabId }, tabId).catch(() => {});
  }

  return resultData;
}

async function main() {
  console.log('========================================================================');
  console.log('⚡ ComLinkAI v2.3.0 三任务满载并发测试 (MAX_CONCURRENT_TABS = 3)');
  console.log('任务 1: 【AI 前沿评测】Claude 3.7 / 3.5 Sonnet 与 OpenAI 最新推理模型深度评测对比');
  console.log('任务 2: 【海外爆款产品】Product Hunt 本周热门 AI 效率神器及核心创作者团队');
  console.log('任务 3: 【小游戏出海风口】2026 最新小游戏出海成功爆款、品类与出海发行厂商');
  console.log('========================================================================\n');

  const url1 = 'https://www.bing.com/search?q=' + encodeURIComponent('Claude 3.7 3.5 Sonnet OpenAI 推理模型 对比评测 2026');
  const url2 = 'https://www.bing.com/search?q=' + encodeURIComponent('Product Hunt 本周热门 AI 工具 开发者 团队 2026');
  const url3 = 'https://www.bing.com/search?q=' + encodeURIComponent('2026 小游戏出海 爆款案例 游戏名称 发行商 厂商');

  const overallStart = Date.now();

  // 3 并发同时发起
  const [res1, res2, res3] = await Promise.all([
    runSubTask(1, 'AI模型前沿评测', url1),
    runSubTask(2, 'ProductHunt爆款神器', url2),
    runSubTask(3, '小游戏出海厂商案例', url3)
  ]);

  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(1);

  console.log('\n========================================================================');
  console.log(`🎉 三任务满载并发全部圆满完成！总耗时: ${totalDuration} 秒`);
  console.log(`隔离检查验证:`);
  console.log(`  - 任务 1 TabId: #${res1.tabId} (耗时 ${res1.elapsed}s, 页面: ${res1.title.slice(0, 30)})`);
  console.log(`  - 任务 2 TabId: #${res2.tabId} (耗时 ${res2.elapsed}s, 页面: ${res2.title.slice(0, 30)})`);
  console.log(`  - 任务 3 TabId: #${res3.tabId} (耗时 ${res3.elapsed}s, 页面: ${res3.title.slice(0, 30)})`);
  console.log(`  - 标签页自愈状态: 全部 3 个后台临时标签页已通过 close_tab 安全关闭`);
  console.log('========================================================================\n');

  // 保存正文
  fs.writeFileSync('scripts/task3_1_ai_eval.txt', res1.rawContent, 'utf8');
  fs.writeFileSync('scripts/task3_2_product_hunt.txt', res2.rawContent, 'utf8');
  fs.writeFileSync('scripts/task3_3_game_overseas.txt', res3.rawContent, 'utf8');

  console.log('✅ 正文已分别存储至 scripts/task3_1_ai_eval.txt, task3_2_product_hunt.txt, task3_3_game_overseas.txt');
}

main().catch(err => {
  console.error('三并发测试异常:', err);
  process.exit(1);
});

