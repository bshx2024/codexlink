/**
 * APIVALE 拟人化外链发布执行器 (Human-Like Outreach Submitter - Industrial Grade v2.4)
 * 严格遵循 8-Yes 白帽外链标准与 5 维反风控防封协议：
 * 1. 落地页与邮箱硬性对齐红线 (杜绝首页回退、杜绝 support@ 通用邮箱、正文 0 链接)
 * 2. 集成事前四道门禁预检 (HTTP 200, Indexable, 有外链表单, 30天零竞蚀查重)
 * 3. 欧美工作时区最佳窗口识别 (北京时间 20:00 ~ 次日 08:00)
 * 4. 拟人化防封时钟 (阅读停留 ≥16s、键盘动力学按键流、CDP 物理级鼠标轨迹)
 * 5. 防封随机冷却抖动 (Anti-Ban Jitter Cooldown 15~25s)
 * 6. 填单前/提交后双向高清存证截图
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { probeTargetUrl } = require('./probe_target');

const COMLINK_PORT = 3010;

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
      port: COMLINK_PORT,
      path: '/api/action',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('ComLinkAI action timeout (30s)')); });
    req.on('error', reject);
    req.write(postData);
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
      },
      timeout: 10000
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'TIMEOUT' }); });
    req.on('error', e => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 校验发信时区：判断当前时间是否处于欧美博主工作时间 (北京时间 20:00 ~ 次日 08:00)
 */
function getPostingTimeWindowInfo() {
  const now = new Date();
  const bjHour = (now.getUTCHours() + 8) % 24;
  const isOptimal = (bjHour >= 20 || bjHour < 8);
  return {
    bjHour,
    isOptimal,
    message: isOptimal
      ? `🟢 当前处于欧美博主活跃工作窗口 (北京时间 ${bjHour}:00，对应欧美 08:00~20:00)，邮件即时查阅与审核通过率最高！`
      : `🟡 当前处于欧美博主深夜时段 (北京时间 ${bjHour}:00)，建议将重点大批次任务安排至北京时间 20:00 ~ 次日 08:00 执行。`
  };
}

/**
 * 从作者姓名中提取专家专属企业邮箱
 */
function getExpertEmail(authorName) {
  if (!authorName) return 'alex.rivera@apivale.com';
  let clean = authorName.replace(/@.*$/, '').replace(/\|.*$/, '').trim();
  clean = clean.replace(/^(dr|mr|ms|mrs)\.?\s+/i, '');
  const parts = clean.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'alex.rivera@apivale.com';
  return `${parts.join('.')}@apivale.com`;
}

/**
 * 输入合规硬性校验：严格遵守白帽外链红线
 */
function validateOutreachContract(task) {
  // 1. 落地页严禁首页回退
  const rawTarget = (task.targetUrl || '').trim();
  if (!rawTarget || rawTarget === 'https://apivale.com' || rawTarget === 'https://apivale.com/') {
    throw new Error(`[合规红线阻断] 落地页严禁回退至纯首页 (${rawTarget})！必须为对应模型或架构的精准内页深链接 (如 /blog/...)。`);
  }
  if (!rawTarget.startsWith('https://apivale.com/')) {
    throw new Error(`[合规红线阻断] 落地页必须以 https://apivale.com/ 开头，当前为: ${rawTarget}`);
  }

  // 2. 邮箱铁律：必须为专家专属邮箱，坚决杜绝 support@
  const email = (task.email || getExpertEmail(task.author)).trim().toLowerCase();
  if (email === 'support@apivale.com') {
    throw new Error(`[合规红线阻断] 严禁使用官方客服邮箱 support@apivale.com！必须使用专家专属企业邮箱 (如 alex.rivera@apivale.com)。`);
  }
  if (!email.endsWith('@apivale.com') || !email.includes('.')) {
    throw new Error(`[合规红线阻断] 邮箱格式不合规 (${email})，必须为 firstname.lastname@apivale.com。`);
  }

  // 3. 正文 0 链接与去营销自嗨
  const comment = (task.comment || '').trim();
  if (!comment) throw new Error('[合规红线阻断] 评论内容不能为空！');
  if (/https?:\/\/|www\./i.test(comment)) {
    throw new Error(`[合规红线阻断] 评论正文中严禁插入任何超链接 (0 链接原则，纯靠表单原生 Website/URL 留链)！`);
  }
  if (/\bat apivale\b|\bour api\b|\bour platform\b|\bour product\b|\bcheapest api\b/i.test(comment)) {
    throw new Error(`[合规红线阻断] 评论正文中严禁自报家门 (如 "at APIVALE")，请保持纯同行一线技术交流口吻！`);
  }

  return { cleanTargetUrl: rawTarget, cleanEmail: email, cleanComment: comment };
}

/**
 * 拟人化执行核心入口
 */
async function executeHumanSubmission(task, options = {}) {
  const {
    saveScreenshot = true,
    artifactDir = '',
    syncSheet = true,
    tabId = task.tabId || null,
    skipPreFlightGate = false
  } = options;

  // 1. 验证合约参数
  const { cleanTargetUrl, cleanEmail, cleanComment } = validateOutreachContract(task);
  const timeWindow = getPostingTimeWindowInfo();

  console.log(`\n======================================================`);
  console.log(`[拟人化发布 v2.4] 目标站点: ${task.domain || new URL(task.pageUrl).hostname} (Tab #${tabId || 'active'})`);
  console.log(`文章地址: ${task.pageUrl}`);
  console.log(`落地内页: ${cleanTargetUrl}`);
  console.log(`出场专家: ${task.author} (${cleanEmail})`);
  console.log(`时区判定: ${timeWindow.message}`);
  console.log(`======================================================`);

  // 2. 事前四道门禁拦截链 (Pre-Flight 4-Gate Probe)
  if (!skipPreFlightGate) {
    console.log('0. [事前门禁] 执行 HTTP 200 / SEO NoIndex / 表单外链 / 30天查重嗅探...');
    const gateRes = await probeTargetUrl(task.pageUrl);
    if (!gateRes.canProceed) {
      console.warn(`⛔ [门禁拦截跳过] 触发 ${gateRes.blockingGate}: ${gateRes.blockingReason}`);
      return {
        success: false,
        skipped: true,
        reason: gateRes.blockingReason,
        gate: gateRes.blockingGate,
        domain: task.domain,
        url: task.pageUrl
      };
    }
    console.log('✔ [事前门禁通过] 四道门禁全部放行，允许进入浏览器操作！');
  }

  const taskStart = Date.now();

  // 3. 导航进入页面 (使用专属 tabId 隔离运行)
  console.log('1. [页面进入] 正在导航至目标博文并模拟真实用户深度阅读浏览...');
  const navRes = await callAction('navigate', { url: task.pageUrl + '#respond', tabId });
  const activeTabId = (navRes && navRes.data && navRes.data.tabId) ? navRes.data.tabId : tabId;

  // 强化物理级防封时钟：深度阅读浏览停留 ≥ 16 秒 (规避 Akismet / Turnstile 极速时间戳特征)
  console.log('⏳ [拟人阅读停留] 模拟人类阅读与缓动浏览 (保持 16 秒阅读停留)...');
  await sleep(16000);

  // 4. 调用 ComLinkAI 核心拟人化填表管道 (Human-Like Filling Pipeline)
  console.log('2. [拟人化输入] 启动平滑缓动滚动、键盘动力学按键流与字段步进停顿...');
  const fillRes = await callAction('human_fill_comment', {
    comment: cleanComment,
    author: task.author,
    email: cleanEmail,
    url: cleanTargetUrl,
    autoSubmit: false,
    tabId: activeTabId
  });
  console.log('表单填写结果:', JSON.stringify(fillRes));
  if (!fillRes || fillRes.error || (fillRes.data && !fillRes.data.success)) {
    throw new Error('表单字段填充失败: ' + (fillRes ? fillRes.error : '插件未响应'));
  }

  // 5. 抓取预提交截图 (Pre-Submit，高亮各字段绿色边框)
  if (saveScreenshot && artifactDir) {
    console.log('3. [存证截屏] 抓取填单完成态截图 (Pre-submit)...');
    await sleep(800);
    const snap1 = await callAction('screenshot', { tabId: activeTabId });
    if (snap1 && snap1.data && snap1.data.dataUrl) {
      const b64 = snap1.data.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const tag = (task.domain || 'blog').replace(/[^a-zA-Z0-9]/g, '_');
      fs.writeFileSync(path.join(artifactDir, `${tag}_pre_submit.jpg`), Buffer.from(b64, 'base64'));
      console.log(`已存盘: ${tag}_pre_submit.jpg`);
    }
  }

  // 6. 模拟人眼最终复核停顿 (Human Verification Pause: 800~1500ms)
  const reviewPause = Math.floor(Math.random() * 700 + 800);
  console.log(`4. [拟人复核] 模拟人类通读检查 ${reviewPause}ms...`);
  await sleep(reviewPause);

  // 7. 触发提交点击 (优先精准匹配 WordPress 评论专用提交按钮)
  console.log('5. [物理提交] 派发表单提交按钮物理点击与触发表单提交...');
  const clickRes = await callAction('click', {
    selector: '#comment-submit, #submit, form#commentform input[type="submit"], form#commentform button[type="submit"], input[type="submit"].submit, button[type="submit"].submit, input[name="submit"]',
    tabId: activeTabId
  });
  console.log('CDP 物理提交结果:', JSON.stringify(clickRes));
  if (!clickRes || clickRes.error) {
    throw new Error(`提交按钮点击失败: ${clickRes ? clickRes.error : '未响应'}`);
  }

  // 8. 等待后台网关响应与页面刷新加载
  console.log('6. [等待响应] 等待页面审核响应与跳转处理 (8s)...');
  await sleep(8000);

  // 9. 智能检测是否出现“待审核中 (awaiting moderation)”或评论已挂载，并将审核态居中滚动
  console.log('7. [审核态检测] 嗅探页面审核中 (Awaiting Moderation) 标记并对焦视口...');
  let verifyRes = null;
  try {
    verifyRes = await callAction('verify_and_focus_moderation', { tabId: activeTabId });
    console.log('审核态嗅探结果:', JSON.stringify(verifyRes));
  } catch (e) {
    console.warn('审核态嗅探调用异常:', e.message);
  }

  // 10. 抓取提交后存证截图 (Post-Submit，已精准对焦到待审核区域)
  if (saveScreenshot && artifactDir) {
    console.log('8. [存证截屏] 抓取提交后审核态对焦截图 (Post-submit)...');
    await sleep(600);
    const snap2 = await callAction('screenshot', { tabId: activeTabId });
    if (snap2 && snap2.data && snap2.data.dataUrl) {
      const b64 = snap2.data.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const tag = (task.domain || 'blog').replace(/[^a-zA-Z0-9]/g, '_');
      fs.writeFileSync(path.join(artifactDir, `${tag}_post_submit.jpg`), Buffer.from(b64, 'base64'));
      console.log(`已存盘: ${tag}_post_submit.jpg`);
    }
  }

  const tabRes = await callAction('getActiveTab', { tabId: activeTabId });
  const actualTitle = (tabRes && tabRes.data && tabRes.data.title) ? tabRes.data.title : (task.title || '');
  const totalElapsedMs = Date.now() - taskStart;

  console.log(`✔ 单站拟人化操作完成！耗时: ${(totalElapsedMs / 1000).toFixed(1)}s (合规阈值: ≥16s)`);

  // 10. 实时同步至 Google Sheets APIVALE 标签页
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
      comment: cleanComment
    };
    const syncRes = await syncToSheet(sheetPayload);
    console.log('Google Sheets 回写响应:', JSON.stringify(syncRes));
  }

  // 11. 执行防封随机冷却抖动 (Anti-Ban Jitter Delay: 15~25s)
  const cooldownSeconds = Math.floor(Math.random() * 11) + 15;
  console.log(`⏳ [防封冷却] 开始执行随机冷却抖动 ${cooldownSeconds} 秒，消除机械频次特征...`);
  await sleep(cooldownSeconds * 1000);

  // 12. 善后处理：安全关闭当前任务标签页，释放 Chromium 渲染内存，杜绝进程泄漏
  try {
    if (activeTabId) {
      await callAction('close_tab', { tabId: activeTabId }).catch(() => {});
    }
  } catch (e) {}

  return {
    success: true,
    totalElapsedMs,
    domain: task.domain,
    url: task.pageUrl
  };
}

module.exports = {
  executeHumanSubmission,
  validateOutreachContract,
  getPostingTimeWindowInfo
};
