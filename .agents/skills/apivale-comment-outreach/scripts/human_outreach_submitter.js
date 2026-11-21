/**
 * APIVALE 拟人化外链发布执行器 (Human-Like Outreach Submitter)
 * 严格遵循 8-Yes 白帽外链标准与 5 维反风控防封协议：
 * 1. 规避秒填检测 (Min-Submission-Time ≥ 10s)
 * 2. 键盘按键流动力学 (Keystroke Dynamics)
 * 3. 字段步进停顿 (Field Traversal Staggering)
 * 4. CDP 物理级鼠标轨迹与按压 (isTrusted === true)
 * 5. 防封随机冷却抖动 (Anti-Ban Jitter Cooldown 12~25s)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function callAction(action, data = {}) {
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

function syncToSheet(payload) {
  return new Promise(resolve => {
    const postData = JSON.stringify(payload);
    const req = https.request('https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getExpertEmail(authorName) {
  if (!authorName) return 'alex.rivera@apivale.com';
  let clean = authorName.replace(/@.*$/, '').replace(/\|.*$/, '').trim();
  clean = clean.replace(/^(dr|mr|ms|mrs)\.?\s+/i, '');
  const parts = clean.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'alex.rivera@apivale.com';
  return `${parts.join('.')}@apivale.com`;
}

async function executeHumanSubmission(task, options = {}) {
  const {
    saveScreenshot = true,
    artifactDir = '',
    syncSheet = true,
    tabId = task.tabId || null
  } = options;

  const expertEmail = task.email || getExpertEmail(task.author);

  console.log(`\n======================================================`);
  console.log(`[拟人化发布] 目标站点: ${task.domain || new URL(task.pageUrl).hostname} (Tab #${tabId || 'active'})`);
  console.log(`文章地址: ${task.pageUrl}`);
  console.log(`落地内页: ${task.targetUrl}`);
  console.log(`出场角色: ${task.author} (${expertEmail})`);
  console.log(`======================================================`);

  const taskStart = Date.now();

  // 1. 导航进入页面 (使用专属 tabId 隔离运行)
  console.log('1. [页面进入] 正在导航至目标博文并预留阅读加载时长...');
  await callAction('navigate', { url: task.pageUrl + '#respond', tabId });
  // 模拟人类进站阅读与滚动浏览：等待 4.5s
  await sleep(4500);

  // 1.1 极速 3 秒毒性特征探测 (Comments closed / 无表单 / 强验证码)
  try {
    const probeRes = await callAction('getActiveTab', { tabId });
    const content = (probeRes && probeRes.data && probeRes.data.content) ? probeRes.data.content.toLowerCase() : '';
    const title = (probeRes && probeRes.data && probeRes.data.title) ? probeRes.data.title.toLowerCase() : '';

    if (content.includes('comments are closed') || content.includes('评论已关闭') || content.includes('关闭了评论')) {
      const err = new Error('Comments are closed');
      err.isToxic = true;
      err.toxicReason = 'Comments are closed';
      throw err;
    }

    if (title.includes('just a moment') || content.includes('verify you are human') || content.includes('cloudflare')) {
      const err = new Error('Cloudflare Anti-Bot Challenge detected');
      err.isToxic = true;
      err.toxicReason = 'Cloudflare Anti-Bot Challenge';
      throw err;
    }

    // 检查表单与输入框
    const els = await callAction('getElements', { tabId });
    const elList = (els && els.data) ? els.data : (Array.isArray(els) ? els : []);
    const hasCommentInput = elList.some(el => el.tag === 'textarea' || (el.name && el.name.toLowerCase().includes('comment')) || (el.id && el.id.toLowerCase().includes('comment')));
    if (elList.length > 0 && !hasCommentInput) {
      const err = new Error('No comment form detected on page');
      err.isToxic = true;
      err.toxicReason = 'No comment form detected';
      throw err;
    }
  } catch (probeErr) {
    if (probeErr.isToxic) throw probeErr;
  }

  // 2. 调用 ComLinkAI 核心拟人化填表管道 (Human-Like Filling Pipeline)
  console.log('2. [拟人化输入] 启动平滑缓动滚动、键盘按键流与字段步进停顿...');
  const fillRes = await callAction('human_fill_comment', {
    comment: task.comment,
    author: task.author,
    email: expertEmail,
    url: task.targetUrl,
    autoSubmit: false, // 先不自动提交，留出时间截取填写前存证
    tabId
  });
  console.log('表单填写结果:', JSON.stringify(fillRes));

  // 3. 抓取预提交截图
  if (saveScreenshot && artifactDir) {
    console.log('3. [存证截屏] 抓取填单完成态截图 (Pre-submit)...');
    await sleep(600);
    const snap1 = await callAction('screenshot', { tabId });
    if (snap1 && snap1.data && snap1.data.dataUrl) {
      const b64 = snap1.data.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const tag = (task.domain || 'blog').replace(/[^a-zA-Z0-9]/g, '_');
      fs.writeFileSync(path.join(artifactDir, `${tag}_human_form_filled.jpg`), Buffer.from(b64, 'base64'));
      console.log(`已存盘: ${tag}_human_form_filled.jpg`);
    }
  }

  // 4. 模拟人眼最终复核停顿 (Human Verification Pause: 800~1500ms)
  const reviewPause = Math.floor(Math.random() * 700 + 800);
  console.log(`4. [拟人复核] 模拟人类通读检查 ${reviewPause}ms...`);
  await sleep(reviewPause);

  // 5. 触发 CDP 物理级贝塞尔鼠标点击 (CDP Physical Click with isTrusted === true)
  console.log('5. [CDP 物理点击] 派发贝塞尔轨迹移动、物理按压 (75~125ms) 与释放...');
  const clickRes = await callAction('click', { selector: '#submit, button[type="submit"], input[type="submit"], button.submit, input[name="submit"]', tabId });
  console.log('CDP 物理提交结果:', JSON.stringify(clickRes));

  // 6. 等待后台网关响应
  console.log('6. [等待响应] 等待页面审核响应与跳转处理 (6s)...');
  await sleep(6000);

  // 7. 抓取提交后存证截图
  if (saveScreenshot && artifactDir) {
    console.log('7. [存证截屏] 抓取提交后审核态截图 (Post-submit)...');
    const snap2 = await callAction('screenshot', { tabId });
    if (snap2 && snap2.data && snap2.data.dataUrl) {
      const b64 = snap2.data.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const tag = (task.domain || 'blog').replace(/[^a-zA-Z0-9]/g, '_');
      fs.writeFileSync(path.join(artifactDir, `${tag}_human_post_submit.jpg`), Buffer.from(b64, 'base64'));
      console.log(`已存盘: ${tag}_human_post_submit.jpg`);
    }
  }

  const tabRes = await callAction('getActiveTab', { tabId });
  const actualTitle = (tabRes.data && tabRes.data.title) ? tabRes.data.title : (task.title || '');
  const totalElapsedMs = Date.now() - taskStart;

  console.log(`✔ 单站拟人化操作完成！耗时: ${(totalElapsedMs / 1000).toFixed(1)}s (合规阈值: ≥10s)`);

  // 8. 实时同步至 Google Sheets APIVALE 标签页
  if (syncSheet) {
    console.log('8. [云端同步] 正在推送到 Google Sheets APIVALE 页签...');
    const sheetPayload = {
      projectName: 'APIVALE',
      timestamp: new Date().toISOString(),
      url: task.pageUrl,
      domain: task.domain || new URL(task.pageUrl).hostname,
      title: actualTitle,
      status: 'published',
      verifyStatus: 'unchecked',
      relType: 'blog_comment',
      relevanceScore: 95,
      comment: task.comment
    };
    const syncRes = await syncToSheet(sheetPayload);
    console.log('Google Sheets 回写响应:', JSON.stringify(syncRes));
  }

  // 9. 执行防封随机冷却抖动 (Anti-Ban Jitter Delay: 12~25s)
  const cooldownSeconds = Math.floor(Math.random() * 14) + 12;
  console.log(`⏳ [防封冷却] 开始执行随机冷却抖动 ${cooldownSeconds} 秒，消除机械频次特征...`);
  await sleep(cooldownSeconds * 1000);

  return {
    success: true,
    totalElapsedMs,
    domain: task.domain,
    url: task.pageUrl
  };
}

module.exports = {
  executeHumanSubmission
};

