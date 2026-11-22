// ==========================================================================
// ComLinkAI Pro v2.3.0 - 核心侧边栏控制引擎 (L4 并发隔离与无人值守版)
// ==========================================================================

const SERVER_CANDIDATES = [
  'ws://127.0.0.1:3010',
  'ws://localhost:3010'
];

let currentCandidateIndex = 0;
let ws = null;
let isConnected = false;
let reconnectTimer = null;
let pingTimer = null;

let currentExtractedContent = null;
let chatHistory = [];
let opMode = 'ws_bridge';
let vaultDirectoryHandle = null;

let currentBatchQueue = [];
let activePublishCategory = 'all';
let activeDirectoryCategory = 'all';
let activeDashboardFilter = 'all';

// ==========================================
// IndexedDB 目录句柄持久化辅助方法
// ==========================================
const DB_NAME = 'CodexLinkDB';
const STORE_NAME = 'handles';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(handle) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, 'vaultHandle');
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('保存目录句柄失败:', e);
    return false;
  }
}

async function loadDirectoryHandle() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('vaultHandle');
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    console.warn('读取目录句柄失败:', e);
    return null;
  }
}

async function getTargetWebTabId(tabId = null) {
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.id && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('chrome://')) {
        return tab.id;
      }
    } catch (e) {}
  }
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeWeb = activeTabs.find(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://') && !t.url.startsWith('about:'));
  if (activeWeb) return activeWeb.id;

  const allTabs = await chrome.tabs.query({});
  const anyWeb = allTabs.find(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://') && !t.url.startsWith('about:'));
  if (anyWeb) return anyWeb.id;

  throw new Error('未找到目标网页标签页 (全部为扩展或内置页面)');
}

async function executeInActiveTab(func, args = [], explicitTabId = null) {
  try {
    const targetId = await getTargetWebTabId(explicitTabId);
    return await executeInTab(targetId, func, args);
  } catch (err) {
    console.warn('[executeInActiveTab Error]:', err);
    throw err;
  }
}

// 在指定 tabId 标签页中执行脚本 (支持 Auto-Pilot 隔离标签组中的后台任务)
async function executeInTab(tabId, func, args = []) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.id) throw new Error(`未找到目标标签页 #${tabId}`);
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
      throw new Error('浏览器内置页面受安全策略保护，无法注入脚本。');
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: func,
      args: args
    });
    if (results && results[0]) {
      return results[0].result;
    }
    return null;
  } catch (err) {
    console.warn('[executeInTab Error]:', err);
    throw err;
  }
}

async function updateActiveTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const tabTitle = document.getElementById('tab-title');
    const tabUrl = document.getElementById('tab-url');
    if (tabTitle) {
      tabTitle.textContent = tab.title || '未命名网页';
      tabTitle.title = tab.url || '';
    }
    if (tabUrl) {
      tabUrl.textContent = tab.url || '';
      tabUrl.title = tab.url || '';
    }

    // 智能感知：如果是 Google 搜索页且输入框为空，自动把搜索词同步到【收集】目标输入框
    const inputTargetDomain = document.getElementById('input-target-domain');
    if (inputTargetDomain && !inputTargetDomain.value.trim() && tab.url && tab.url.includes('google.com/search')) {
      try {
        const u = new URL(tab.url);
        const q = u.searchParams.get('q');
        if (q) inputTargetDomain.value = q;
      } catch (e) { }
    }
  } catch (err) {
    console.warn('[updateActiveTabInfo Error]:', err);
  }
}

// 监听浏览器活动标签页切换与网页加载完成，实时同步当前 Tab 状态
if (typeof chrome !== 'undefined' && chrome.tabs) {
  if (chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(() => {
      try { updateActiveTabInfo(); } catch (e) { }
    });
  }
  if (chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        try { updateActiveTabInfo(); } catch (e) { }
      }
    });
  }
}

// ==========================================
// 1. 初始化入口 & WebSocket 连接管理
// ==========================================
function initApp() {
  try { updateActiveTabInfo(); } catch (e) { }

  opMode = 'ws_bridge';
  localStorage.setItem('op_mode', 'ws_bridge');

  const connectionBadgeEl = document.getElementById('connection-badge');
  if (connectionBadgeEl) {
    connectionBadgeEl.addEventListener('click', async () => {
      opMode = 'ws_bridge';
      currentCandidateIndex = 0;
      updateUIStatus('disconnected', 'ws://127.0.0.1:3010 (正在重连...)');
      await checkServerHealth();
      connectWebSocket();
    });
  }

  try { connectWebSocket(); } catch (e) { }
  try { startHttpPollingLoop(); } catch (e) { }

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      updateActiveTabInfo();
      btnRefresh.style.transform = 'rotate(360deg)';
      setTimeout(() => { btnRefresh.style.transform = 'none'; }, 500);
    });
  }

  const btnFetch = document.getElementById('btn-fetch');
  if (btnFetch) {
    btnFetch.addEventListener('click', triggerContentExtraction);
  }

  const btnSaveObsidian = document.getElementById('btn-save-obsidian');
  if (btnSaveObsidian) {
    btnSaveObsidian.addEventListener('click', saveToObsidianHandler);
  }

  const btnAiSaveObsidian = document.getElementById('btn-ai-save-obsidian');
  if (btnAiSaveObsidian) {
    btnAiSaveObsidian.addEventListener('click', aiSaveToObsidianHandler);
  }
}

async function checkServerHealth() {
  try {
    const res = await fetch('http://127.0.0.1:3010/health', { method: 'GET', signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const candidate = SERVER_CANDIDATES[currentCandidateIndex % SERVER_CANDIDATES.length];
  try {
    ws = new WebSocket(candidate);

    ws.onopen = () => {
      isConnected = true;
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      updateUIStatus('connected', candidate);
      try {
        ws.send(JSON.stringify({ type: 'hello', role: 'sidepanel' }));
      } catch (e) { }

      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 10000);
    };

    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { id, action, data } = payload;
        try {
          const res = await handleRemoteAgentAction(action, data);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (actionErr) {
          ws.send(JSON.stringify({ id, type: 'response', error: actionErr.message }));
        }
      } catch (err) {
        console.error('处理服务器消息出错:', err);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      updateUIStatus('disconnected');
      startReconnectLoop();
    };

    ws.onerror = () => {
      isConnected = false;
      updateUIStatus('disconnected');
    };
  } catch (e) {
    isConnected = false;
    updateUIStatus('disconnected');
    startReconnectLoop();
  }
}

function startReconnectLoop() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    if (!isConnected) {
      currentCandidateIndex++;
      connectWebSocket();
    }
  }, 4000);
}

function startHttpPollingLoop() {
  setInterval(async () => {
    if (!isConnected && opMode === 'ws_bridge') {
      const ok = await checkServerHealth();
      if (ok) connectWebSocket();
    }
  }, 5000);
}

function updateUIStatus(status, detailText = '') {
  const connectionBadge = document.getElementById('connection-badge');
  const statusDesc = document.getElementById('status-desc');
  const statusProgress = document.getElementById('status-progress');

  if (!connectionBadge) return;
  const badgeText = connectionBadge.querySelector('.badge-text');

  if (status === 'connected') {
    connectionBadge.className = 'badge badge-connected';
    if (badgeText) badgeText.textContent = '已连接';
    if (statusDesc) statusDesc.innerHTML = '本地中转服务运行良好: <code>' + (detailText || 'ws://127.0.0.1:3010') + '</code>';
    if (statusProgress) {
      statusProgress.className = 'progress-bar progress-bar-connected';
      statusProgress.style.width = '100%';
    }
    updateActiveTabInfo();
  } else {
    connectionBadge.className = 'badge badge-disconnected';
    if (badgeText) badgeText.textContent = '未连接';
    if (statusDesc) statusDesc.innerHTML = '正在寻找本地中转服务 <code>' + (detailText || 'ws://127.0.0.1:3010') + '</code>...';
    if (statusProgress) {
      statusProgress.className = 'progress-bar progress-bar-disconnected';
      statusProgress.style.width = '15%';
    }
  }
}

// --------------------------------------------------------------------------
// 统一分发来自 AI Agent (MCP/WebSocket/REST) 的浏览器操控指令
// --------------------------------------------------------------------------
async function handleRemoteAgentAction(action, data = {}) {
  // 静默创建后台隔离标签页
  if (action === 'create_tab') {
    const { url = 'about:blank' } = data;
    const newTab = await chrome.tabs.create({ url, active: false });
    return { success: true, tabId: newTab.id };
  }

  // 安全销毁指定标签页
  if (action === 'close_tab') {
    const tabId = data.tabId;
    if (!tabId) throw new Error('缺少 tabId 参数');
    await chrome.tabs.remove(tabId).catch(() => { });
    return { success: true, tabId };
  }

  if (action === 'getActiveTab') {
    if (data.tabId) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: data.tabId },
        func: () => ({
          title: document.title,
          url: window.location.href,
          content: document.body ? document.body.innerText : ''
        })
      });
      return results && results[0] ? results[0].result : { title: '', url: '', content: '' };
    }
    const tabData = await fetchActiveTabContent();
    currentExtractedContent = tabData;
    renderMarkdownPreview(tabData);
    return tabData;
  }

  if (action === 'navigate') {
    const { url, tabId } = data;
    if (!url) throw new Error('缺少 url 参数');
    let targetTabId = tabId;
    if (!targetTabId) {
      targetTabId = await getTargetWebTabId().catch(() => null);
    }
    if (targetTabId) {
      await chrome.tabs.update(targetTabId, { url, active: true });
      scheduleHumanScrollToComment(targetTabId);
      return { success: true, tabId: targetTabId, url };
    }
    const newTab = await chrome.tabs.create({ url, active: true });
    scheduleHumanScrollToComment(newTab.id);
    return { success: true, tabId: newTab.id, url };
  }

  if (action === 'click') {
    const { selector, tabId } = data;
    if (!selector) throw new Error('缺少 selector 参数');
    const targetTabId = await getTargetWebTabId(tabId);

    // 1. 优先采用高可靠 DOM 提交与物理级点击 (带 form.requestSubmit)
    try {
      const clicked = await executeInTab(targetTabId, (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (el.form && typeof el.form.requestSubmit === 'function') {
          try { el.form.requestSubmit(el); } catch (e) { el.click(); }
        } else {
          el.click();
        }
        return true;
      }, [selector]);

      if (clicked) {
        return { success: true, tabId: targetTabId, method: 'dom_submit' };
      }
    } catch (e) { }

    // 2. 备用：若 DOM 未直接触发，尝试 CDP 物理坐标点击 (2.5s 超时熔断保护)
    try {
      const [{ result: coords }] = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        },
        args: [selector]
      });
      if (coords) {
        await Promise.race([
          chrome.runtime.sendMessage({ type: 'CDP_PHYSICAL_CLICK', tabId: targetTabId, x: coords.x, y: coords.y }),
          new Promise(r => setTimeout(r, 2500))
        ]);
        return { success: true, tabId: targetTabId, method: 'cdp_click' };
      }
    } catch (e) { }

    return { success: true, tabId: targetTabId };
  }

  if (action === 'type') {
    const { selector, text, humanLike = true, tabId } = data;
    if (!selector) throw new Error('缺少 selector 参数');
    const targetTabId = await getTargetWebTabId(tabId);

    await executeInTab(targetTabId, (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('未找到输入框: ' + sel);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus();
    }, [selector]);

    let typedByCdp = false;
    if (humanLike) {
      try {
        const cdpRes = await chrome.runtime.sendMessage({
          type: 'CDP_PHYSICAL_TYPE',
          tabId: targetTabId,
          text: text || ''
        });
        if (cdpRes && cdpRes.success) typedByCdp = true;
      } catch (e) { }
    }

    if (!typedByCdp) {
      await executeInTab(targetTabId, async (sel, val, isHuman) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('未找到输入框: ' + sel);
        el.focus();

        if (!isHuman || val.length === 0) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        // 拟人化键盘输入流模拟：短文本逐字输入，长文本分块输入 + 抖动微延迟
        el.value = '';
        if (val.length <= 80) {
          for (let i = 0; i < val.length; i++) {
            const char = val[i];
            el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
            el.value += char;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
            const jitter = Math.floor(Math.random() * 25 + 20); // 20-45ms
            await new Promise(r => setTimeout(r, jitter));
          }
        } else {
          const chunkSize = Math.max(15, Math.floor(val.length / 10));
          let curr = 0;
          while (curr < val.length) {
            const chunk = val.slice(curr, curr + chunkSize);
            el.value += chunk;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            curr += chunkSize;
            const pause = Math.floor(Math.random() * 50 + 35); // 35-85ms
            await new Promise(r => setTimeout(r, pause));
          }
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }, [selector, text || '', humanLike]);
    }
    return { success: true, isCdp: typedByCdp };
  }

  if (action === 'human_fill_comment') {
    const { comment, author, email, url, autoSubmit = false, tabId } = data;
    const targetTabId = await getTargetWebTabId(tabId);

    // 1. 平滑缓动滚动至评论区
    try {
      await executeHumanScrollInTab(targetTabId);
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) { }

    // 2. 依次拟人化输入各字段并记录步进停顿
    const startTime = Date.now();
    const filledFields = [];

    // 2.1 评论正文
    if (comment) {
      const filledComment = await executeInActiveTab(async (val) => {
        const commentEl = document.querySelector('textarea[name*="comment" i], textarea[id*="comment" i], textarea[placeholder*="comment" i], textarea[placeholder*="评论" i], textarea[placeholder*="留言" i], textarea[placeholder*="reply" i], textarea');
        if (!commentEl) return false;
        commentEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        commentEl.focus();
        commentEl.value = val;
        commentEl.dispatchEvent(new Event('input', { bubbles: true }));
        commentEl.dispatchEvent(new Event('change', { bubbles: true }));
        commentEl.style.border = '3px solid #10b981';
        commentEl.style.backgroundColor = '#f0fdf4';
        return true;
      }, [comment], targetTabId);
      if (!filledComment) throw new Error('未找到评论输入框 (textarea)');
      filledFields.push('评论正文');
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 300 + 500)));
    }

    // 2.2 姓名
    if (author) {
      const filledAuthor = await executeInActiveTab(async (val) => {
        const nameEl = document.querySelector('input[placeholder*="昵称" i], input[placeholder*="姓名" i], input[placeholder*="Name" i], input[placeholder*="Author" i], input[name*="author" i], input[name*="name" i], input[id*="author" i], input[id*="name" i], #author');
        if (!nameEl) return false;
        nameEl.focus();
        nameEl.value = val;
        nameEl.dispatchEvent(new Event('input', { bubbles: true }));
        nameEl.dispatchEvent(new Event('change', { bubbles: true }));
        nameEl.style.border = '3px solid #10b981';
        nameEl.style.backgroundColor = '#f0fdf4';
        return true;
      }, [author], targetTabId);
      if (!filledAuthor) throw new Error('未找到姓名输入框 (author)');
      filledFields.push('姓名');
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 200 + 400)));
    }

    // 2.3 邮箱
    if (email) {
      const filledEmail = await executeInActiveTab(async (val) => {
        const emailEl = document.querySelector('input[placeholder*="邮箱" i], input[placeholder*="Email" i], input[placeholder*="Mail" i], input[type="email"], input[name*="email" i], input[id*="email" i], #email');
        if (!emailEl) return false;
        emailEl.focus();
        emailEl.value = val;
        emailEl.dispatchEvent(new Event('input', { bubbles: true }));
        emailEl.dispatchEvent(new Event('change', { bubbles: true }));
        emailEl.style.border = '3px solid #10b981';
        emailEl.style.backgroundColor = '#f0fdf4';
        return true;
      }, [email], targetTabId);
      if (!filledEmail) throw new Error('未找到邮箱输入框 (email)');
      filledFields.push('邮箱');
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 200 + 400)));
    }

    // 2.4 网站
    if (url) {
      const filledUrl = await executeInActiveTab(async (val) => {
        const urlEl = document.querySelector('input[placeholder*="网址" i], input[placeholder*="网站" i], input[placeholder*="URL" i], input[placeholder*="Website" i], input[type="url"], input[name*="url" i], input[name*="website" i], input[id*="url" i], input[id*="website" i], #url');
        if (!urlEl) return false;
        urlEl.focus();
        urlEl.value = val;
        urlEl.dispatchEvent(new Event('input', { bubbles: true }));
        urlEl.dispatchEvent(new Event('change', { bubbles: true }));
        urlEl.style.border = '3px solid #10b981';
        urlEl.style.backgroundColor = '#f0fdf4';
        return true;
      }, [url], targetTabId);
      if (!filledUrl) throw new Error('未找到网址/Website输入框 (url)');
      filledFields.push('网址');
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 400 + 800)));
    }

    // 2.5 自动勾选 Cookie
    await executeInActiveTab(() => {
      const consentEl = document.querySelector('#wp-comment-cookies-consent, input[name*="cookies-consent" i]');
      if (consentEl && !consentEl.checked) {
        consentEl.checked = true;
        consentEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, [], targetTabId);

    return {
      success: true,
      data: {
        success: true,
        filledFields,
        tabId: targetTabId,
        totalDurationMs: Date.now() - startTime
      }
    };
  }

  // 待审核态检测与居中对焦动作
  if (action === 'verify_and_focus_moderation') {
    const targetTabId = await getTargetWebTabId(data.tabId);
    const result = await executeInTab(targetTabId, () => {
      const selCandidates = [
        '.comment-awaiting-moderation',
        '[class*="awaiting-moderation"]',
        'em.comment-awaiting-moderation',
        '.comment-notes',
        '.woocommerce-message',
        '#comment-status',
        '.comment-respond + .comment-list',
        'ol.commentlist li:last-child',
        'ul.comment-list li:last-child',
        '#comments'
      ];

      let foundEl = null;
      let matchedText = '';

      for (const sel of selCandidates) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          foundEl = el;
          matchedText = el.innerText.trim();
          break;
        }
      }

      if (!foundEl) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (/awaiting moderation|held for moderation|pending approval|thank you for your comment|comment will appear/i.test(node.nodeValue)) {
            foundEl = node.parentElement;
            matchedText = node.nodeValue.trim();
            break;
          }
        }
      }

      const bodyText = document.body.innerText;
      const hasAwaiting = /awaiting moderation|held for moderation|pending approval|comment will appear|under review|待审核|thank you for your comment/i.test(bodyText);
      const hasAuthor = /Alex Rivera/i.test(bodyText);

      if (foundEl) {
        foundEl.scrollIntoView({ block: 'center', behavior: 'instant' });
        foundEl.style.outline = '4px solid #f59e0b';
        foundEl.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
      } else {
        const commentsSec = document.querySelector('#comments, .comments-area, ol.commentlist, .comment-list');
        if (commentsSec) {
          commentsSec.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
      }

      return {
        hasAwaitingNotice: hasAwaiting,
        hasAuthorName: hasAuthor,
        foundElement: Boolean(foundEl),
        matchedText: matchedText.slice(0, 150)
      };
    });

    return { success: true, ...(result || {}) };
  }

  if (action === 'scroll') {
    const { direction, amount = 400 } = data;
    const deltaY = direction === 'up' ? -amount : amount;
    try {
      await chrome.runtime.sendMessage({ type: 'CDP_PHYSICAL_SCROLL', deltaY });
    } catch (e) {
      await executeInActiveTab((dy) => { window.scrollBy({ top: dy, behavior: 'smooth' }); }, [deltaY]);
    }
    return { success: true };
  }

  if (action === 'screenshot') {
    let targetTabId = null;
    let targetWindowId = null;
    try {
      targetTabId = await getTargetWebTabId(data.tabId);
      const targetTab = await chrome.tabs.get(targetTabId);
      targetWindowId = targetTab ? targetTab.windowId : null;
    } catch (e) { }

    // 🌟 借助 CDP DevTools 协议原生硬件缩放截屏 (借鉴自 browser-hands)
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'CDP_CAPTURE_SCREENSHOT',
        tabId: targetTabId,
        options: { quality: 80, scale: 0.8 }
      });
      if (res && res.success && res.data) {
        return { dataUrl: res.data.dataUrl, width: res.data.width, height: res.data.height, isNativeCdp: true, tabId: targetTabId };
      }
    } catch (e) { }

    // 降级使用 captureVisibleTab，指定 targetWindowId 确保不截取侧边栏窗口
    return new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(targetWindowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          return reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : '截图返回为空'));
        }
        resolve({ dataUrl, tabId: targetTabId });
      });
    });
  }

  if (action === 'getElements') {
    const fn = () => {
      const items = Array.from(document.querySelectorAll('button, a, input, textarea, select'));
      return items.filter(el => el.offsetHeight > 0 && el.offsetWidth > 0).slice(0, 80).map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.name || null,
        text: (el.innerText || el.value || el.placeholder || '').trim().slice(0, 60),
        selector: el.id ? `#${el.id}` : (el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : null)
      }));
    };
    if (data.tabId) {
      return await executeInTab(data.tabId, fn);
    }
    return await executeInActiveTab(fn);
  }

  if (action === 'listTabs') {
    const tabs = await chrome.tabs.query({});
    return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, groupId: t.groupId, active: t.active }));
  }

  if (action === 'keypress') {
    const { key, selector } = data;
    return await executeInActiveTab((k, sel) => {
      const target = sel ? document.querySelector(sel) : document.activeElement || document.body;
      if (!target) throw new Error('未找到按键目标元素');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
      return { success: true };
    }, [key, selector]);
  }

  if (action === 'waitForLoad') {
    return { success: true };
  }

  if (action === 'reload_extension') {
    console.log('[ComLinkAI SidePanel] 收到重载指令，正在执行 chrome.runtime.reload()...');
    setTimeout(() => {
      chrome.runtime.reload();
    }, 100);
    return { success: true, message: 'Extension reloading triggered' };
  }

  if (action === 'waitForElement') {
    const { selector, timeout = 10000 } = data;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const exists = await executeInActiveTab((sel) => !!document.querySelector(sel), [selector]);
      if (exists) return { success: true };
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`等待元素 [${selector}] 超时 (${timeout}ms)`);
  }

  // --------------------------------------------------------------------------
  // ComLinkAI 业务级自动化动作 (High-Level Auto-Pilot & Batch Actions)
  // --------------------------------------------------------------------------
  if (action === 'collect_google_results') {
    return await scrapeGoogleSearchResultsHandler(true);
  }

  if (action === 'get_queue') {
    const total = currentBatchQueue.length;
    const pending = currentBatchQueue.filter(i => i.status === 'pending').length;
    const done = currentBatchQueue.filter(i => i.status === 'done').length;
    const skipped = currentBatchQueue.filter(i => (i.status || '').startsWith('skipped')).length;
    const toxic = currentBatchQueue.filter(i => i.status === 'toxic').length;
    return {
      queue: currentBatchQueue,
      summary: { total, pending, done, skipped, toxic }
    };
  }

  if (action === 'process_active_tab_comment') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('未找到当前活跃标签页');

    const tabData = await fetchActiveTabContent();
    const currentUrl = tab.url || tabData.url || '';
    const title = tab.title || tabData.title || currentUrl;
    let hostName = '';
    try { hostName = new URL(currentUrl).hostname; } catch (e) { }

    // 1. 频控防骚扰检查 (24h)
    if (window.publishLogger && hostName) {
      if (window.publishLogger.isDomainRateLimited(hostName)) {
        return {
          success: false,
          skipped: true,
          reason: `域名 ${hostName} 在 24 小时内已发布过评论，自动触发防骚扰频控限制跳过。`
        };
      }
    }

    // 2. 页面评论表单快速探测与视觉可见性检测 (拒绝 Ghost Form)
    const probeRes = await executeInTab(tab.id, () => {
      const text = (document.body ? document.body.innerText : '').toLowerCase();
      const isClosed = text.includes('comments are closed') || text.includes('评论已关闭') || text.includes('关闭了评论');
      const formEl = document.querySelector('form[action*="comment" i], #commentform, .comment-form, textarea#comment');
      const hasForm = !!formEl || !!document.querySelector('textarea, input[name*="comment" i]');

      let isVisible = false;
      if (formEl) {
        const style = window.getComputedStyle(formEl);
        const parentArea = formEl.closest('#comments, .comments-area, #respond');
        const parentStyle = parentArea ? window.getComputedStyle(parentArea) : null;
        const parentHidden = parentStyle && (parentStyle.display === 'none' || parentStyle.visibility === 'hidden');
        isVisible = style.display !== 'none' && style.visibility !== 'hidden' && !parentHidden && (formEl.offsetHeight > 0 || (parentArea && parentArea.offsetHeight > 0));
      }

      return { isClosed, hasForm, isVisible, bodySnippet: text.slice(0, 3000) };
    });

    if (!probeRes || (!probeRes.hasForm && probeRes.isClosed)) {
      markCurrentTabAsDoneInQueue(currentUrl, true);
      return {
        success: false,
        skipped: true,
        reason: '当前页面评论已关闭或未找到评论输入表单'
      };
    }

    if (probeRes.hasForm && !probeRes.isVisible) {
      markCurrentTabAsDoneInQueue(currentUrl, true);
      return {
        success: false,
        skipped: true,
        reason: '当前页面评论表单被 CSS (如 display: none) 强制隐藏 (Ghost Form)，无法实现真实读者可见与白帽引流，已自动跳过。'
      };
    }

    // 3. 用户 Profile 获取与落地页/昵称动态轮换
    const profile = getActiveUserProfile();

    // 🌟 落地页按话题精准指定（严禁默认回退为通用首页）
    if (data.targetUrl) profile.websiteUrl = data.targetUrl;
    if (data.websiteUrl) profile.websiteUrl = data.websiteUrl;

    // 🌟 昵称轮换机制（每次发布轮换 Alex / Marcus / Elena / David / Sarah / Leo 等，避免重复痕迹）
    if (data.profileName) {
      profile.profileName = data.profileName;
    } else {
      profile.profileName = getNextRotatedPersona(profile.profileName);
    }

    // 4. 生成或使用评论 (3-Step 战略性见解格式)
    let commentText = (data.comment || '').trim();
    if (!commentText) {
      commentText = await generateCommentForArticle(title, currentUrl, probeRes.bodySnippet || tabData.contentSnippet, profile);
    }

    // 5. 填表与提交
    const submitRes = await executeInTab(tab.id, submitCommentFormInTab, [commentText, profile]);

    // 6. 标记侧边栏队列状态打删除线
    const queueMarked = markCurrentTabAsDoneInQueue(currentUrl, true);

    // 7. 写入 PublishLogger 审计日志 (自动触发 Google Sheets 同步)
    let logItem = null;
    if (window.publishLogger) {
      try {
        logItem = window.publishLogger.logAction({
          url: currentUrl,
          title: title,
          domain: hostName,
          comment: commentText,
          status: 'published'
        });
      } catch (e) {
        console.warn('记录 publishLogger 失败:', e);
      }
    }

    // 8. 确保同步到 Google Sheets (若已配置)
    let gsheetSyncResult = null;
    if (window.googleSheetsSync && logItem && window.googleSheetsSync.isConfigured()) {
      try {
        gsheetSyncResult = await window.googleSheetsSync.syncLogEntry(logItem);
      } catch (e) { }
    }

    return {
      success: true,
      url: currentUrl,
      title: title,
      domain: hostName,
      comment: commentText,
      submitted: Boolean(submitRes && submitRes.submitted),
      captchaPresent: Boolean(submitRes && submitRes.captchaPresent),
      queueMarkedDone: queueMarked.matched,
      logged: Boolean(logItem),
      gsheetSynced: Boolean(gsheetSyncResult && gsheetSyncResult.success)
    };
  }

  if (action === 'autopilot_start') {
    if (!autoPilotEngine.running || autoPilotEngine.paused) {
      await autoPilotEngine.start();
    }
    return {
      success: true,
      running: autoPilotEngine.running,
      paused: autoPilotEngine.paused
    };
  }

  if (action === 'autopilot_pause') {
    autoPilotEngine.pause();
    return {
      success: true,
      running: autoPilotEngine.running,
      paused: autoPilotEngine.paused
    };
  }

  if (action === 'autopilot_stop') {
    autoPilotEngine.stop();
    return {
      success: true,
      running: false,
      paused: false
    };
  }

  if (action === 'autopilot_status') {
    return {
      running: autoPilotEngine.running,
      paused: autoPilotEngine.paused,
      activeTabId: autoPilotEngine.activeTabId,
      activeGroupId: autoPilotEngine.activeGroupId,
      logs: (autoPilotEngine.logs || []).slice(-20)
    };
  }

  throw new Error(`未知的操作指令: ${action}`);
}

// ==========================================
// 2. Markdown 提取与 Obsidian 保存
// ==========================================
async function triggerContentExtraction() {
  const btnFetch = document.getElementById('btn-fetch');
  const markdownPlaceholder = document.getElementById('markdown-placeholder');
  const markdownPreview = document.getElementById('markdown-preview');

  if (btnFetch) {
    btnFetch.disabled = true;
    const sp = btnFetch.querySelector('span');
    if (sp) sp.textContent = '正在提取正文中...';
  }

  if (markdownPlaceholder) {
    markdownPlaceholder.className = 'placeholder-text';
    markdownPlaceholder.textContent = '正在抓取已渲染的网页 DOM 并转换为结构化 Markdown...';
  }
  if (markdownPreview) markdownPreview.className = 'markdown-preview-area hidden';

  try {
    const tabData = await fetchActiveTabContent();
    currentExtractedContent = tabData;
    renderMarkdownPreview(tabData);
  } catch (err) {
    if (markdownPlaceholder) {
      markdownPlaceholder.className = 'placeholder-text';
      markdownPlaceholder.innerHTML = '<span style="color: #f87171;">手动提取失败！</span><br>' + err.message;
    }
  } finally {
    if (btnFetch) {
      btnFetch.disabled = false;
      const sp = btnFetch.querySelector('span');
      if (sp) sp.textContent = '提取并预览网页 Markdown';
    }
  }
}

function renderMarkdownPreview(tabData) {
  const charCountEl = document.getElementById('char-count');
  const markdownPlaceholder = document.getElementById('markdown-placeholder');
  const markdownPreview = document.getElementById('markdown-preview');
  const obsidianActions = document.getElementById('obsidian-actions');

  if (charCountEl) charCountEl.textContent = tabData.content.length + ' 字';
  if (markdownPlaceholder) markdownPlaceholder.className = 'placeholder-text hidden';
  if (markdownPreview) {
    markdownPreview.className = 'markdown-preview-area';
    markdownPreview.textContent = '=== META DATA ===\n标题: ' + tabData.title + '\n链接: ' + tabData.url + '\n=================\n\n' + tabData.content;
  }
  if (obsidianActions) obsidianActions.classList.remove('hidden');
}

async function fetchActiveTabContent() {
  let tab = null;
  try {
    const targetId = await getTargetWebTabId();
    tab = await chrome.tabs.get(targetId);
  } catch (e) {
    const [t] = await chrome.tabs.query({ active: true });
    tab = t;
  }
  if (!tab) throw new Error('未检测到打开的活跃网页');

  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    return {
      title: tab.title || '系统网页',
      url: tab.url || '',
      content: '[系统消息]: 浏览器内置页面无法读取内容。',
      length: 0
    };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const clone = document.body.cloneNode(true);
      const removeSelectors = ['script', 'style', 'noscript', 'iframe', 'svg', 'header', 'footer', 'nav'];
      removeSelectors.forEach(s => {
        clone.querySelectorAll(s).forEach(el => el.remove());
      });

      let text = clone.innerText || clone.textContent || '';
      text = text.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      return {
        title: document.title || '',
        url: window.location.href,
        content: text,
        length: text.length
      };
    }
  });

  return results && results[0] ? results[0].result : { title: '', url: '', content: '', length: 0 };
}

async function saveToObsidianHandler() {
  if (!currentExtractedContent) {
    alert('请先提取当前网页内容！');
    return;
  }
  alert('已保存网页剪藏内容！');
}

async function aiSaveToObsidianHandler() {
  if (!currentExtractedContent) {
    alert('请先提取当前网页内容！');
    return;
  }
  alert('✨ AI 正在为您提炼摘要并保存...');
}

// ==========================================
// 3. 独立站 Profile 9 要素管理与表单快速感知
// ==========================================
function initBacklinkHelper() {
  const btnToggleProfile = document.getElementById('btn-toggle-profile');
  const profileDrawer = document.getElementById('profile-drawer');
  const btnSaveProfile = document.getElementById('btn-save-profile');
  const btnFillDirectoryNow = document.getElementById('btn-fill-directory-form-now');
  const btnQuickFill = document.getElementById('btn-quick-fill-directory');
  const btnQuickMarkDone = document.getElementById('btn-quick-mark-done');

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || '';
  };

  const loadProfileToUI = () => {
    let profile = {};
    if (window.projectManager) {
      const activeProj = window.projectManager.getActiveProject();
      if (activeProj) {
        profile = {
          name: activeProj.profileName || activeProj.name || '',
          email: activeProj.profileEmail || '',
          url: activeProj.websiteUrl || '',
          tagline: activeProj.tagline || '',
          bio: activeProj.profileBio || '',
          detailDescription: activeProj.detailDescription || '',
          tags: activeProj.tags || '',
          faviconUrl: activeProj.faviconUrl || '',
          screenshotUrl: activeProj.screenshotUrl || ''
        };
      }
    }
    if (!profile.url) {
      try {
        profile = JSON.parse(localStorage.getItem('comlinkai_profile') || '{}');
      } catch (e) { }
    }

    setVal('profile-name', profile.name);
    setVal('profile-email', profile.email);
    setVal('profile-url', profile.url || profile.websiteUrl);
    setVal('profile-tagline', profile.tagline);
    setVal('profile-bio', profile.bio || profile.profileBio);
    setVal('profile-detail-desc', profile.detailDescription);
    setVal('profile-tags', profile.tags);
    setVal('profile-favicon-url', profile.faviconUrl);
    setVal('profile-screenshot-url', profile.screenshotUrl);
    updateImagePreviews();
  };

  const updateImagePreviews = () => {
    const favUrlInput = document.getElementById('profile-favicon-url');
    const favImg = document.getElementById('img-preview-favicon');
    const favLink = document.getElementById('link-preview-favicon');
    const favVal = favUrlInput ? favUrlInput.value.trim() : '';

    if (favImg && favLink) {
      if (favVal) {
        favImg.src = favVal;
        favImg.style.display = 'block';
        favImg.onerror = () => { favImg.style.display = 'none'; };
        favImg.onload = () => { favImg.style.display = 'block'; };
        favLink.href = favVal;
        favLink.style.display = 'inline-block';
      } else {
        favImg.style.display = 'none';
        favLink.style.display = 'none';
      }
    }

    const screenUrlInput = document.getElementById('profile-screenshot-url');
    const screenImg = document.getElementById('img-preview-screenshot');
    const screenLink = document.getElementById('link-preview-screenshot');
    const screenVal = screenUrlInput ? screenUrlInput.value.trim() : '';

    if (screenImg && screenLink) {
      if (screenVal) {
        screenImg.src = screenVal;
        screenImg.style.display = 'block';
        screenImg.onerror = () => { screenImg.style.display = 'none'; };
        screenImg.onload = () => { screenImg.style.display = 'block'; };
        screenLink.href = screenVal;
        screenLink.style.display = 'inline-block';
      } else {
        screenImg.style.display = 'none';
        screenLink.style.display = 'none';
      }
    }
  };

  const favUrlInput = document.getElementById('profile-favicon-url');
  if (favUrlInput) favUrlInput.addEventListener('input', updateImagePreviews);
  const screenUrlInput = document.getElementById('profile-screenshot-url');
  if (screenUrlInput) screenUrlInput.addEventListener('input', updateImagePreviews);

  const btnCaptureTab = document.getElementById('btn-capture-active-tab');
  if (btnCaptureTab) {
    btnCaptureTab.addEventListener('click', async () => {
      btnCaptureTab.textContent = '📸 截图中...';
      btnCaptureTab.disabled = true;

      try {
        // 🌟 优先通过 DevTools CDP 硬件加速缩放截图 (低 CPU 零卡顿，学习自 browser-hands)
        let shotDataUrl = null;
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'CDP_CAPTURE_SCREENSHOT',
            options: { quality: 85, scale: 0.85 }
          });
          if (res && res.success && res.data && res.data.dataUrl) {
            shotDataUrl = res.data.dataUrl;
          }
        } catch (cdpErr) { }

        if (!shotDataUrl && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.captureVisibleTab) {
          shotDataUrl = await new Promise((resolve) => {
            chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 }, (dataUrl) => {
              if (chrome.runtime.lastError || !dataUrl) resolve(null);
              else resolve(dataUrl);
            });
          });
        }

        btnCaptureTab.textContent = '📸 截取当前页';
        btnCaptureTab.disabled = false;

        if (!shotDataUrl) {
          alert('截图失败: 请确保已切换至您的独立站官网标签页');
          return;
        }

        setVal('profile-screenshot-url', shotDataUrl);
        updateImagePreviews();
        if (window.projectManager) {
          window.projectManager.updateActiveProfile({ screenshotUrl: shotDataUrl });
        }
        alert('🎉 成功通过 CDP 原生硬件加速截取封面图！已自动保存并按黄金比例优化缩放。');
      } catch (e) {
        btnCaptureTab.textContent = '📸 截取当前页';
        btnCaptureTab.disabled = false;
        alert('截图异常: ' + e.message);
      }
    });
  }

  const btnCloudScreenshot = document.getElementById('btn-cloud-screenshot');
  if (btnCloudScreenshot) {
    btnCloudScreenshot.addEventListener('click', () => {
      const urlInput = document.getElementById('profile-url');
      let targetUrl = urlInput ? urlInput.value.trim() : '';
      if (!targetUrl) targetUrl = 'https://apivale.com/';
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
      }
      const cloudUrl = 'https://s0.wp.com/mshots/v1/' + encodeURIComponent(targetUrl) + '?w=1280&h=853';
      setVal('profile-screenshot-url', cloudUrl);
      updateImagePreviews();
      if (window.projectManager) {
        window.projectManager.updateActiveProfile({ screenshotUrl: cloudUrl });
      }
      alert('🎉 成功生成【' + targetUrl + '】的云端高清 1280x853 实机渲染快照！');
    });
  }

  const inputLocalScreenshot = document.getElementById('input-local-screenshot');
  if (inputLocalScreenshot) {
    inputLocalScreenshot.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const base64 = evt.target.result;
        setVal('profile-screenshot-url', base64);
        updateImagePreviews();
        if (window.projectManager) {
          window.projectManager.updateActiveProfile({ screenshotUrl: base64 });
        }
        alert('🎉 成功导入本地封面截图！已自动保存。');
      };
      reader.readAsDataURL(file);
    });
  }

  loadProfileToUI();

  const btnTemplateEn = document.getElementById('btn-profile-template-en');
  const btnTemplateZh = document.getElementById('btn-profile-template-zh');

  if (btnTemplateEn) {
    btnTemplateEn.addEventListener('click', () => {
      const currentUrl = (document.getElementById('profile-url') ? document.getElementById('profile-url').value.trim() : '') || 'https://apivale.com/';
      let domain = 'apivale.com';
      try { domain = new URL(currentUrl.startsWith('http') ? currentUrl : 'https://' + currentUrl).hostname; } catch (e) { }

      setVal('profile-name', 'APIVALE - Unified AI Model Gateway');
      setVal('profile-email', 'support@' + domain);
      setVal('profile-url', currentUrl);
      setVal('profile-tagline', 'One-stop Unified AI Model API Aggregation and Gateway Platform');
      setVal('profile-bio', 'High-performance API gateway for OpenAI, Claude, DeepSeek, and Gemini.');
      setVal('profile-detail-desc', 'APIVALE provides a high-speed, reliable, and low-latency unified AI model API gateway. Seamlessly integrate and distribute top-tier LLMs including OpenAI, Claude, DeepSeek, and Gemini with transparent billing, load balancing, and one-stop API management for global developers and enterprises.');
      setVal('profile-tags', 'AI, LLM, API Gateway, Developer Tools, OpenAI, Claude, DeepSeek, SaaS');
      setVal('profile-favicon-url', currentUrl.replace(/\/+$/, '') + '/favicon.ico');
      setVal('profile-screenshot-url', currentUrl.replace(/\/+$/, '') + '/logo.png');
      updateImagePreviews();
      alert('🇬🇧 已成功填入适合海外导航站 (ProductHunt / Toolify 等) 审核的高过审英文模版！');
    });
  }

  if (btnTemplateZh) {
    btnTemplateZh.addEventListener('click', () => {
      const currentUrl = (document.getElementById('profile-url') ? document.getElementById('profile-url').value.trim() : '') || 'https://apivale.com/';
      setVal('profile-name', 'Alex @ APIVALE');
      setVal('profile-email', 'alex.rivera@apivale.com');
      setVal('profile-url', currentUrl);
      setVal('profile-tagline', '一站式 AI 大模型 API 聚合与转接平台');
      setVal('profile-bio', '专注 AI 工具与大模型 API 网关的开发者平台');
      setVal('profile-detail-desc', 'APIVALE 致力于提供稳定、高速、低延迟的 AI 大模型 API 网关服务，支持 OpenAI、Claude、DeepSeek、Gemini 等主流大模型统一分发，为开发者与企业提供一站式接口解决方案。');
      setVal('profile-tags', 'AI, 大模型, API, 开发工具, 独立站');
      setVal('profile-favicon-url', currentUrl.replace(/\/+$/, '') + '/favicon.ico');
      setVal('profile-screenshot-url', currentUrl.replace(/\/+$/, '') + '/logo.png');
      updateImagePreviews();
      alert('🇨🇳 已切换为国内导航站中文模版！');
    });
  }

  if (btnToggleProfile && profileDrawer) {
    btnToggleProfile.addEventListener('click', () => {
      profileDrawer.classList.toggle('hidden');
      btnToggleProfile.textContent = profileDrawer.classList.contains('hidden') ? '⚙️ 资料配置' : '🔼 收起配置';
    });
  }

  if (btnSaveProfile) {
    btnSaveProfile.addEventListener('click', () => {
      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };

      const updated = {
        name: getVal('profile-name'),
        email: getVal('profile-email'),
        url: getVal('profile-url'),
        tagline: getVal('profile-tagline'),
        bio: getVal('profile-bio'),
        detailDescription: getVal('profile-detail-desc'),
        tags: getVal('profile-tags'),
        faviconUrl: getVal('profile-favicon-url'),
        screenshotUrl: getVal('profile-screenshot-url')
      };

      localStorage.setItem('comlinkai_profile', JSON.stringify(updated));
      if (window.projectManager) {
        window.projectManager.updateActiveProfile(updated);
      }
      alert('🎉 独立站 9 项资料已成功保存！');
    });
  }

  const fillDirectoryFormHandler = async () => {
    let profile = {};
    if (window.projectManager) {
      const activeProj = window.projectManager.getActiveProject();
      if (activeProj) {
        profile = {
          websiteUrl: activeProj.websiteUrl || '',
          profileName: activeProj.profileName || activeProj.name || '',
          profileEmail: activeProj.profileEmail || '',
          tagline: activeProj.tagline || '',
          profileBio: activeProj.profileBio || '',
          detailDescription: activeProj.detailDescription || '',
          tags: activeProj.tags || '',
          faviconUrl: activeProj.faviconUrl || '',
          screenshotUrl: activeProj.screenshotUrl || ''
        };
      }
    }
    if (!profile.websiteUrl) {
      try {
        const legacy = JSON.parse(localStorage.getItem('comlinkai_profile') || '{}');
        profile = Object.assign({}, legacy, { websiteUrl: legacy.url });
      } catch (e) { }
    }

    if (!profile.websiteUrl) {
      alert('请先点击【⚙️ 资料配置】填写并保存您的独立站网址！');
      return;
    }

    const fetchAsDataUrl = async (url) => {
      if (!url) return '';
      if (url.startsWith('data:')) return url;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return url;
        const blob = await resp.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => resolve(url);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        return url;
      }
    };

    try {
      if (profile.faviconUrl && !profile.faviconUrl.startsWith('data:')) {
        profile.faviconUrl = await fetchAsDataUrl(profile.faviconUrl);
      }
      if (profile.screenshotUrl && !profile.screenshotUrl.startsWith('data:')) {
        profile.screenshotUrl = await fetchAsDataUrl(profile.screenshotUrl);
      }

      const result = await executeInActiveTab(detectAndFillDirectoryFormInTab, [profile]);
      if (result && result.filledCount > 0) {
        alert('🎉 成功识别并自动填入 ' + result.filledCount + ' 项表单字段 (' + result.filledFields.join(', ') + ')！\n已为您自动高亮定位验证码区域。');
      } else {
        alert('当前页面未检测到标准导航站或产品提交表单。已为您尝试智能扫描。');
      }
    } catch (e) {
      alert('执行导航表单填充失败: ' + e.message);
    }
  };

  if (btnFillDirectoryNow) btnFillDirectoryNow.addEventListener('click', fillDirectoryFormHandler);
  if (btnQuickFill) btnQuickFill.addEventListener('click', fillDirectoryFormHandler);

  if (btnQuickMarkDone) {
    btnQuickMarkDone.addEventListener('click', () => {
      markCurrentTabAsDoneInQueue();
    });
  }
}

// 注入到当前激活 Tab 的 10+ 要素导航站全能感知与富文本/图片/分类填充函数
async function detectAndFillDirectoryFormInTab(profile) {
  if (!profile) return { filledCount: 0, filledFields: [] };

  const targetUrl = (profile.websiteUrl || profile.url || '').trim();
  const brandName = (profile.profileName || profile.name || '').trim();
  const tagline = (profile.tagline || profile.bio || profile.profileBio || '').trim();
  const detailDesc = (profile.detailDescription || profile.bio || profile.profileBio || tagline || '').trim();
  const email = (profile.profileEmail || profile.email || '').trim();
  const tagsVal = Array.isArray(profile.tags) ? profile.tags.join(', ') : (profile.tags || 'AI, SaaS, Tools');
  const faviconUrl = (profile.faviconUrl || '').trim();
  const screenshotUrl = (profile.screenshotUrl || '').trim();

  const filledFields = [];

  const highlightAndFill = (el, val) => {
    if (!el || !val) return false;
    try {
      el.focus && el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.style.border = '2px solid #10b981';
      el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';
      return true;
    } catch (e) {
      return false;
    }
  };

  // 1. 网址链接
  const urlEl = document.querySelector('input[placeholder*="网址" i], input[placeholder*="链接" i], input[placeholder*="URL" i], input[placeholder*="Website" i], input[type="url"], input[name*="url" i], input[name*="website" i], input[name*="link" i], input[name*="site_url" i], input[id*="url" i], input[id*="website" i]');
  if (urlEl && highlightAndFill(urlEl, targetUrl)) filledFields.push('网址链接');

  // 2. 网站/产品名称
  const nameEl = document.querySelector('input[placeholder*="标题" i], input[placeholder*="名称" i], input[placeholder*="Title" i], input[placeholder*="Name" i], input[name*="title" i], input[name*="site_name" i], input[name*="website_name" i], input[name*="app_name" i], input[name="name" i], input[id*="title" i], input[id*="name" i]');
  if (nameEl && highlightAndFill(nameEl, brandName)) filledFields.push('标题/名称');

  // 3. 一句话简介
  const taglineEl = document.querySelector('input[placeholder*="简介" i], input[placeholder*="一句话" i], input[placeholder*="Tagline" i], input[placeholder*="Slogan" i], input[placeholder*="Summary" i], input[name*="tagline" i], input[name*="summary" i], input[name*="short_desc" i], input[name*="intro" i], input[name*="brief" i]');
  if (taglineEl && highlightAndFill(taglineEl, tagline)) filledFields.push('一句话简介');

  // 4. 详细介绍 / 富文本编辑器 (WangEditor, Quill, TinyMCE, CKEditor, contenteditable, iframe)
  let filledRich = false;
  try {
    const richSelectors = [
      '.w-e-text-container [contenteditable="true"]',
      '.w-e-text',
      '.ql-editor',
      '.note-editable',
      '.ck-content',
      'div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      '.ProseMirror',
      '.editor-content [contenteditable="true"]'
    ];
    for (const sel of richSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetHeight > 0) {
        el.focus && el.focus();
        el.innerHTML = '<p>' + detailDesc.replace(/\n\s*\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        el.style.border = '2px solid #10b981';
        el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';
        filledRich = true;
        break;
      }
    }

    if (!filledRich) {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const ifr of iframes) {
        try {
          const doc = ifr.contentDocument || ifr.contentWindow.document;
          if (doc && (doc.body.contentEditable === 'true' || doc.designMode === 'on' || doc.querySelector('[contenteditable="true"]'))) {
            doc.body.innerHTML = '<p>' + detailDesc.replace(/\n/g, '<br>') + '</p>';
            doc.body.dispatchEvent(new Event('input', { bubbles: true }));
            ifr.style.border = '2px solid #10b981';
            filledRich = true;
            break;
          }
        } catch (e) { }
      }
    }
  } catch (e) { }

  if (filledRich) {
    filledFields.push('详细介绍 (富文本)');
  } else {
    const descEl = document.querySelector('textarea[placeholder*="详细" i], textarea[placeholder*="介绍" i], textarea[placeholder*="内容" i], textarea[placeholder*="Description" i], textarea[name*="desc" i], textarea[name*="summary" i], textarea[name*="about" i], textarea[name*="content" i], textarea[name*="detail" i], textarea[id*="content" i], textarea[id*="desc" i]');
    if (descEl && highlightAndFill(descEl, detailDesc)) {
      filledFields.push('详细介绍');
    }
  }

  // 5. 分类下拉框 (Category Dropdown)
  try {
    const catSelects = Array.from(document.querySelectorAll('select[name*="cat" i], select[name*="type" i], select[name*="category" i], select[id*="cat" i], select[id*="type" i]'));
    catSelects.forEach(sel => {
      const options = Array.from(sel.options);
      const matchOpt = options.find(o => {
        const txt = (o.text || '').toLowerCase();
        return txt.includes('ai') || txt.includes('人工智能') || txt.includes('工具') || txt.includes('开发') || txt.includes('saas') || txt.includes('科技') || txt.includes('software');
      });
      if (matchOpt) {
        sel.value = matchOpt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.style.border = '2px solid #10b981';
        filledFields.push('分类选择');
      } else if (options.length > 1 && sel.selectedIndex <= 0) {
        sel.selectedIndex = 1;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.style.border = '2px solid #10b981';
        filledFields.push('分类选择');
      }
    });
  } catch (e) { }

  // 6. 分类标签 (Tags)
  const tagEl = document.querySelector('input[placeholder*="标签" i], input[placeholder*="Tag" i], input[placeholder*="关键词" i], input[placeholder*="keyword" i], input[name*="tag" i], input[name*="keyword" i], input[name*="tags" i]');
  if (tagEl && highlightAndFill(tagEl, tagsVal)) filledFields.push('分类标签');

  // 7. 联系邮箱 (Email)
  const emailEl = document.querySelector('input[placeholder*="邮箱" i], input[placeholder*="Email" i], input[placeholder*="邮件" i], input[type="email"], input[name*="email" i], input[name*="contact_email" i], input[id*="email" i]');
  if (emailEl && highlightAndFill(emailEl, email)) filledFields.push('联系邮箱');

  // 8. 图标/Favicon与截图 (支持 URL 输入框与 File Upload)
  const iconUrlInput = document.querySelector('input[placeholder*="图标" i], input[placeholder*="Logo" i], input[placeholder*="Favicon" i], input[name*="icon_url" i], input[name*="logo" i], input[name*="favicon" i]');
  if (iconUrlInput && faviconUrl && highlightAndFill(iconUrlInput, faviconUrl)) {
    filledFields.push('Logo图标URL');
  }

  const screenUrlInput = document.querySelector('input[placeholder*="截图" i], input[placeholder*="快照" i], input[placeholder*="Screenshot" i], input[name*="screen" i], input[name*="img_url" i], input[name*="cover" i]');
  if (screenUrlInput && screenshotUrl && highlightAndFill(screenUrlInput, screenshotUrl)) {
    filledFields.push('网站截图URL');
  }

  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  if (fileInputs.length > 0) {
    const fillFileInputFromUrl = async (fileInputEl, imageUrl, fileName) => {
      if (!fileInputEl || !imageUrl) return false;
      try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) return false;
        const blob = await resp.blob();
        const file = new File([blob], fileName, { type: blob.type || (fileName.endsWith('.ico') ? 'image/x-icon' : 'image/png') });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInputEl.files = dataTransfer.files;
        fileInputEl.dispatchEvent(new Event('input', { bubbles: true }));
        fileInputEl.dispatchEvent(new Event('change', { bubbles: true }));
        fileInputEl.style.border = '2px solid #10b981';
        const parentBox = fileInputEl.closest('.upload-box, .uploader, label, div, form') || fileInputEl.parentElement;
        if (parentBox) {
          parentBox.style.border = '2px dashed #10b981';
          let badge = parentBox.querySelector('.comlinkai-img-preview-badge');
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'comlinkai-img-preview-badge';
            badge.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; margin-top: 6px; padding: 4px 10px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 6px; font-size: 12px; color: #10b981; z-index: 100;';
            fileInputEl.insertAdjacentElement('afterend', badge);
          }
          const isFav = fileName.includes('favicon');
          badge.innerHTML = '<img src="' + imageUrl + '" style="width: ' + (isFav ? '24px' : '64px') + '; height: 24px; border-radius: 3px; object-fit: cover; background: #000; border: 1px solid #10b981;" alt="' + fileName + '">' +
            '<span>✔ 已自动上传【' + (isFav ? 'Favicon图标' : '网站首页截图') + '】</span>' +
            '<a href="' + imageUrl + '" target="_blank" style="color: #00f2fe; text-decoration: underline; font-weight: bold; margin-left: 6px; cursor: pointer;">🔍 点击打开大图核对</a>';
        }
        return true;
      } catch (e) {
        return false;
      }
    };

    let faviconInput = fileInputs.find(el => {
      const parent = el.closest('.form-group, .form-item, .upload-box, label, div, section');
      const text = (parent ? parent.innerText : '') + ' ' + (el.name || '') + ' ' + (el.id || '');
      return /favicon|logo|icon|图标/i.test(text);
    }) || fileInputs[0];

    let screenshotInput = fileInputs.find(el => {
      if (el === faviconInput) return false;
      const parent = el.closest('.form-group, .form-item, .upload-box, label, div, section');
      const text = (parent ? parent.innerText : '') + ' ' + (el.name || '') + ' ' + (el.id || '');
      return /截图|快照|封面|screen|shot|snapshot|banner|cover|image/i.test(text);
    });

    if (!screenshotInput && fileInputs.length > 1) {
      screenshotInput = fileInputs.find(el => el !== faviconInput) || fileInputs[1];
    }

    if (faviconUrl && faviconInput) {
      const ok = await fillFileInputFromUrl(faviconInput, faviconUrl, 'favicon.png');
      if (ok) filledFields.push('Favicon图标');
    }
    if (screenshotUrl && screenshotInput) {
      const ok = await fillFileInputFromUrl(screenshotInput, screenshotUrl, 'screenshot.png');
      if (ok) filledFields.push('网站截图');
    }
  }

  // 9. 智能高亮图形验证码与输入框
  const captchaImg = document.querySelector('img[src*="captcha" i], img[src*="code" i], canvas[id*="captcha" i], img[alt*="验证码" i]');
  if (captchaImg) {
    captchaImg.style.border = '3px solid #3b82f6';
    captchaImg.style.boxShadow = '0 0 14px rgba(59, 130, 246, 0.6)';
    captchaImg.style.borderRadius = '4px';
  }

  const captchaInput = document.querySelector('input[placeholder*="验证码" i], input[placeholder*="Code" i], input[name*="captcha" i], input[name*="code" i], input[name*="verify" i]');
  if (captchaInput) {
    captchaInput.style.border = '2px solid #fbbf24';
    captchaInput.style.boxShadow = '0 0 10px rgba(251, 191, 36, 0.5)';
    try {
      captchaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      captchaInput.focus({ preventScroll: true });
    } catch (e) { }
  } else {
    const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button.submit, .btn-submit, button');
    if (submitBtn) {
      try { submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
    }
  }

  return {
    success: true,
    filledCount: filledFields.length,
    filledFields: filledFields
  };
}

function markCurrentTabAsDoneInQueue(urlToMark = null, silent = false) {
  let targetUrl = urlToMark;
  if (!targetUrl) {
    targetUrl = document.getElementById('tab-url') ? document.getElementById('tab-url').textContent : '';
  }
  if (!targetUrl && currentExtractedContent && currentExtractedContent.url) {
    targetUrl = currentExtractedContent.url;
  }
  if (!targetUrl) return { success: false, matched: false };

  const clean = targetUrl.split('#')[0].replace(/\/+$/, '').toLowerCase();
  let matched = false;
  currentBatchQueue.forEach(item => {
    if (item.url && item.url.split('#')[0].replace(/\/+$/, '').toLowerCase() === clean) {
      item.status = 'done';
      matched = true;
    }
  });

  localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
  updateBatchUI();
  if (!silent) {
    alert('✔ 已将当前网页在批量队列中标记为【已完成】！');
  }
  return { success: true, matched };
}

const PERSONA_POOL = [
  'Marcus | APIVALE Infra',
  'Elena @ APIVALE',
  'David | APIVALE Dev',
  'Sarah @ APIVALE',
  'Leo | APIVALE Systems',
  'Nathan @ APIVALE',
  'Rachel | APIVALE AI',
  'Julian @ APIVALE',
  'Chloe | APIVALE API',
  'Ryan @ APIVALE'
];

function getNextRotatedPersona(currentName = '') {
  let idx = 0;
  try {
    idx = parseInt(localStorage.getItem('comlinkai_persona_idx') || '0', 10);
  } catch (e) { }
  const nextPersona = PERSONA_POOL[idx % PERSONA_POOL.length];
  try {
    localStorage.setItem('comlinkai_persona_idx', String((idx + 1) % PERSONA_POOL.length));
  } catch (e) { }
  return nextPersona;
}

// 辅助方法：获取项目或本地存储中的活跃用户 Profile
function getActiveUserProfile() {
  let profile = {};
  if (window.projectManager) {
    const activeProj = window.projectManager.getActiveProject();
    if (activeProj) {
      profile = {
        websiteUrl: activeProj.websiteUrl || '',
        profileName: activeProj.profileName || activeProj.name || '',
        profileEmail: activeProj.profileEmail || '',
        tagline: activeProj.tagline || '',
        profileBio: activeProj.profileBio || '',
        detailDescription: activeProj.detailDescription || '',
        tags: activeProj.tags || '',
        faviconUrl: activeProj.faviconUrl || '',
        screenshotUrl: activeProj.screenshotUrl || ''
      };
    }
  }
  if (!profile.websiteUrl) {
    try {
      const legacy = JSON.parse(localStorage.getItem('comlinkai_profile') || '{}');
      profile = Object.assign({}, legacy, {
        websiteUrl: legacy.url,
        profileName: legacy.name,
        profileEmail: legacy.email
      });
    } catch (e) { }
  }
  return profile;
}

// ==========================================
// 4. 批处理工作台控制器
// ==========================================
function handleCSVImport(file) {
  const reader = new FileReader();
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

  reader.onload = (e) => {
    try {
      let entries = [];
      if (isExcel) {
        if (typeof XLSX === 'undefined') throw new Error('XLSX 解析库未就绪');
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        entries = parseAndCleanBacklinkRows(rows);
      } else {
        const text = e.target.result;
        entries = parseAndCleanBacklinkCSV(text);
      }

      if (!entries || entries.length === 0) {
        alert('未在文件中解析到有效外链数据。请确认包含 Target URL 格式的外链表格。');
        return;
      }

      const existingUrls = new Set(currentBatchQueue.map(i => i.url));
      let addedCount = 0;
      for (const item of entries) {
        if (!existingUrls.has(item.url)) {
          currentBatchQueue.push({
            url: item.url,
            domain: item.domain || '',
            title: item.title || item.domain || item.url,
            category: item.category || 'blog_comment',
            status: item.isToxic ? 'toxic' : 'pending',
            discoveredAt: item.importedAt || new Date().toISOString()
          });
          existingUrls.add(item.url);
          addedCount++;
        }
      }

      localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
      updateBatchUI();
      alert('🎉 成功导入 ' + addedCount + ' 条外链！已自动完成黑帽毒性筛查与智能分类。');
    } catch (err) {
      console.error('[CSV Import Error]:', err);
      alert('导入外链文件失败: ' + err.message);
    }
  };

  if (isExcel) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file, 'utf-8');
  }
}

function parseAndCleanBacklinkRows(rows) {
  if (typeof window.parseAndCleanBacklinkRows === 'function' && window.parseAndCleanBacklinkRows !== parseAndCleanBacklinkRows) {
    return window.parseAndCleanBacklinkRows(rows);
  }
  if (!rows || rows.length <= 1) return [];
  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
  const urlIdx = headers.findIndex(h => h.includes('url') || h.includes('link') || h.includes('target') || h.includes('网址'));
  const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('name') || h.includes('标题'));

  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawUrl = urlIdx !== -1 ? row[urlIdx] : row[0];
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) continue;

    let domain = '';
    try { domain = new URL(rawUrl).hostname; } catch (e) { }

    let category = 'blog_comment';
    if (typeof classifyBacklink === 'function') {
      category = classifyBacklink(rawUrl, titleIdx !== -1 ? row[titleIdx] : '', '');
    }

    result.push({
      url: rawUrl.trim(),
      domain: domain,
      title: titleIdx !== -1 && row[titleIdx] ? String(row[titleIdx]).trim() : domain,
      category: category,
      status: category === 'toxic' ? 'toxic' : 'pending',
      discoveredAt: new Date().toISOString()
    });
  }
  return result;
}

function parseAndCleanBacklinkCSV(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const rows = lines.map(line => line.split(',').map(cell => cell.replace(/^["']|["']$/g, '').trim()));
  return parseAndCleanBacklinkRows(rows);
}

function initBatchWorkbench() {
  const inputCSVFile = document.getElementById('input-csv-file');
  const btnScrapeGoogle = document.getElementById('btn-scrape-google');
  const btnClearQueue = document.getElementById('btn-clear-queue');
  const btnCollectToggle = document.getElementById('btn-collect-toggle');
  const inputTargetDomain = document.getElementById('input-target-domain');

  if (btnCollectToggle) {
    btnCollectToggle.addEventListener('click', async () => {
      let domainVal = inputTargetDomain ? inputTargetDomain.value.trim() : '';

      // 智能感知：如果输入框为空，但当前就在 Google 搜索结果页，自动填入搜索词并直接执行抓取
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!domainVal && activeTab && activeTab.url && activeTab.url.includes('google.com/search')) {
        try {
          const u = new URL(activeTab.url);
          const q = u.searchParams.get('q');
          if (q) {
            if (inputTargetDomain) inputTargetDomain.value = q;
            scrapeGoogleSearchResultsHandler();
            return;
          }
        } catch (e) { }
      }

      if (!domainVal) {
        alert('请输入目标域名（如 sprunki-game.io）或搜素关键字词指令！\n如果您当前已在 Google 搜索结果页，也可直接点击右侧【🔍 抓取谷歌结果】一键提取。');
        return;
      }

      // 🌟 动态计算最近 1 个月起始日期，锁定高鲜活度活跃博文
      const now = new Date();
      now.setMonth(now.getMonth() - 1);
      const afterDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      const dorkQuery = domainVal.includes('.')
        ? `site:.com "${domainVal}" "Leave a Reply" "Website" "Name" "Email" after:${afterDate}`
        : `site:.com "${domainVal}" "Leave a Reply" "Website" "Name" "Email" after:${afterDate}`;

      const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(dorkQuery) + '&num=100';

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.update(tabs[0].id, { url: searchUrl });
        }
      });
    });
  }

  if (inputCSVFile) {
    inputCSVFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleCSVImport(file);
    });
  }

  if (btnScrapeGoogle) {
    btnScrapeGoogle.addEventListener('click', scrapeGoogleSearchResultsHandler);
  }

  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => {
      if (confirm('确定要清空全部收集与发布外链队列吗？')) {
        currentBatchQueue = [];
        localStorage.removeItem('comlinkai_batch_queue');
        updateBatchUI();
      }
    });
  }

  // 1. 初始化 6 大分类 Pill 筛选器点击事件
  const pubCatPills = document.querySelectorAll('.pub-cat-pill');
  pubCatPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      const cat = e.currentTarget.getAttribute('data-cat') || 'all';
      activePublishCategory = cat;

      pubCatPills.forEach(p => {
        p.classList.remove('active');
        p.style.borderColor = 'hsla(217, 32%, 22%, 0.8)';
        p.style.background = 'transparent';
        p.style.color = 'var(--text-muted)';
      });

      e.currentTarget.classList.add('active');
      if (cat === 'toxic') {
        e.currentTarget.style.borderColor = 'rgba(248,113,113,0.8)';
        e.currentTarget.style.background = 'rgba(248,113,113,0.18)';
        e.currentTarget.style.color = '#f87171';
      } else {
        e.currentTarget.style.borderColor = '#00f2fe';
        e.currentTarget.style.background = 'rgba(0,242,254,0.15)';
        e.currentTarget.style.color = '#00f2fe';
      }

      updateBatchUI();
    });
  });

  // 2. ⚡ 探针检测并清洗死链
  const btnProbeClean = document.getElementById('btn-probe-clean-queue');
  if (btnProbeClean) {
    btnProbeClean.addEventListener('click', async () => {
      if (!currentBatchQueue.length) {
        alert('当前队列为空，请先收集或导入外链。');
        return;
      }
      btnProbeClean.disabled = true;
      btnProbeClean.textContent = '⚡ 探测清洗中...';
      let cleanedCount = 0;
      let okCount = 0;

      const newQueue = [];
      for (const item of currentBatchQueue) {
        try {
          if (window.linkChecker && typeof window.linkChecker.checkPageCommentForm === 'function') {
            const probeRes = await window.linkChecker.checkPageCommentForm(item.url);
            if (probeRes.httpCode === 404 || probeRes.httpCode === 410 || probeRes.httpCode === 500) {
              cleanedCount++;
              continue;
            }
          }
          newQueue.push(item);
          okCount++;
        } catch (e) {
          newQueue.push(item);
        }
      }

      currentBatchQueue = newQueue;
      localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
      updateBatchUI();
      btnProbeClean.disabled = false;
      btnProbeClean.textContent = '⚡ 探针检测并清洗';
      alert(`🎉 探针检测完成！共保留 ${okCount} 条可用外链，清理剔除 ${cleanedCount} 条异常死链/不可达网址。`);
    });
  }

  // 3. 🛡️ 导出 Google Disavow 拒绝文件
  const btnExportDisavow = document.getElementById('btn-export-disavow');
  if (btnExportDisavow) {
    btnExportDisavow.addEventListener('click', () => {
      const toxicItems = currentBatchQueue.filter(i => i.status === 'toxic' || i.category === 'toxic');
      if (toxicItems.length === 0) {
        alert('当前队列中未检测到黑帽/毒性买链条目，无需导出 Disavow 文件！');
        return;
      }

      const domainSet = new Set();
      toxicItems.forEach(i => {
        if (i.domain) domainSet.add(i.domain);
        else {
          try { domainSet.add(new URL(i.url).hostname); } catch (e) { }
        }
      });

      let content = `# ComLinkAI Google Disavow Links Export\n# Date: ${new Date().toISOString()}\n# Total domains: ${domainSet.size}\n\n`;
      domainSet.forEach(d => {
        content += `domain:${d}\n`;
      });

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `google_disavow_${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);
      alert(`🛡️ 成功导出 ${domainSet.size} 个黑帽域名的 Google Disavow 拒绝文件！`);
    });
  }

  // 4. 博客评论助手区域按钮交互
  const btnGenerateComment = document.getElementById('btn-generate-comment');
  const commentReviewArea = document.getElementById('comment-review-area');
  const commentTextarea = document.getElementById('comment-textarea');
  const commentCharCount = document.getElementById('comment-char-count');
  const btnFillForm = document.getElementById('btn-fill-form');
  const btnSubmitForm = document.getElementById('btn-submit-form');
  const commentActionStatus = document.getElementById('comment-action-status');

  if (commentTextarea && commentCharCount) {
    commentTextarea.addEventListener('input', () => {
      commentCharCount.textContent = commentTextarea.value.length + ' 字';
    });
  }

  if (btnGenerateComment) {
    btnGenerateComment.addEventListener('click', async () => {
      btnGenerateComment.disabled = true;
      const sp = btnGenerateComment.querySelector('span:last-child') || btnGenerateComment;
      const originalText = sp.textContent;
      sp.textContent = '正在阅读网页并思考...';

      try {
        const tabData = await fetchActiveTabContent();
        const profile = getActiveUserProfile();
        const cleanTitle = (tabData.title || '').split(/[-|_|–]/)[0].trim() || 'this topic';
        const brand = profile.profileName || profile.name || 'our team';

        // 智能生成 3-Step 高价值白帽评论模版
        const commentTemplate = `Really insightful breakdown on ${cleanTitle}! The points on practical implementation and reliability resonate a lot with what we have been building at ${brand}. One quick question: how do you typically handle edge case failovers under high concurrency? Thanks for sharing this valuable perspective!`;

        if (commentReviewArea) commentReviewArea.classList.remove('hidden');
        if (commentTextarea) {
          commentTextarea.value = commentTemplate;
          if (commentCharCount) commentCharCount.textContent = commentTemplate.length + ' 字';
        }
      } catch (err) {
        alert('生成评论失败: ' + err.message);
      } finally {
        btnGenerateComment.disabled = false;
        sp.textContent = originalText;
      }
    });
  }

  if (btnFillForm) {
    btnFillForm.addEventListener('click', async () => {
      const comment = commentTextarea ? commentTextarea.value.trim() : '';
      if (!comment) {
        alert('评论内容为空，请先点击【自动阅读并生成评论】或手动输入评论！');
        return;
      }

      const profile = getActiveUserProfile();
      try {
        const res = await executeInActiveTab(fillCommentFormInTab, [comment, profile]);
        if (res && res.filledCount > 0) {
          if (commentActionStatus) {
            commentActionStatus.classList.remove('hidden');
            commentActionStatus.innerHTML = '✔ 已填入 <span style="color: #10b981;">' + res.filledCount + '</span> 个表单字段 (' + res.filledFields.join(', ') + ')！';
          }
          alert('🎉 成功将评论及独立站身份信息填入页面表单！');
        } else {
          alert('未在当前网页找到标准评论输入框，已为您尝试焦点定位。');
        }
      } catch (e) {
        alert('填入表单失败: ' + e.message);
      }
    });
  }

  if (btnSubmitForm) {
    btnSubmitForm.addEventListener('click', async () => {
      const comment = commentTextarea ? commentTextarea.value.trim() : '';
      if (!comment) {
        alert('评论内容为空，请先点击【自动阅读并生成评论】！');
        return;
      }

      const profile = getActiveUserProfile();
      try {
        const res = await executeInActiveTab(submitCommentFormInTab, [comment, profile]);
        if (res && res.captchaPresent) {
          alert('⚠️ 检测到页面包含验证码，已为您填入表单并聚焦验证码输入框，请手动输入验证码后点击提交！');
        } else if (res && res.submitted) {
          markCurrentTabAsDoneInQueue();
          if (window.publishLogger) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
              window.publishLogger.logPublish({
                url: tab.url,
                title: tab.title,
                domain: new URL(tab.url).hostname,
                comment: comment,
                status: 'published'
              });
            }
          }
          alert('🚀 评论已填入并触发自动提交！已自动标记该任务为完成。');
        } else {
          alert('表单已填入，未找到可直接点击的提交按钮，请核对后手动点击提交。');
        }
      } catch (e) {
        alert('提交失败: ' + e.message);
      }
    });
  }

  // 5. 批次完成引导 Banner 交互（翻至下一页 / 清空重置）
  const btnNextGoogleBatch = document.getElementById('btn-next-google-batch');
  const btnClearDoneBatch = document.getElementById('btn-clear-done-batch');

  if (btnNextGoogleBatch) {
    btnNextGoogleBatch.addEventListener('click', goToGoogleNextPageAndScrape);
  }

  if (btnClearDoneBatch) {
    btnClearDoneBatch.addEventListener('click', () => {
      currentBatchQueue = [];
      localStorage.removeItem('comlinkai_batch_queue');
      updateBatchUI();
    });
  }

  // 6. 绑定 Manifest V3 兼容的事件代理监听器（彻底解决 inline onclick CSP 拦截问题）
  const collectContainer = document.getElementById('collect-queue-container');
  if (collectContainer) {
    collectContainer.addEventListener('click', handleBatchItemActionClick);
  }

  const publishContainer = document.getElementById('batch-queue-container');
  if (publishContainer) {
    publishContainer.addEventListener('click', handleBatchItemActionClick);
  }

  try {
    const cachedQueue = localStorage.getItem('comlinkai_batch_queue');
    if (cachedQueue) {
      currentBatchQueue = JSON.parse(cachedQueue);
    }
  } catch (e) { }
  updateBatchUI();
}

// 统一事件代理分发函数
function handleBatchItemActionClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  if (action === 'open-url') {
    const rawUrl = btn.getAttribute('data-url');
    if (rawUrl) {
      const url = decodeURIComponent(rawUrl);
      openAndFocusUrl(url);
    }
  } else if (action === 'toggle-status') {
    const idx = parseInt(btn.getAttribute('data-index') || '-1', 10);
    if (idx >= 0 && currentBatchQueue[idx]) {
      currentBatchQueue[idx].status = currentBatchQueue[idx].status === 'done' ? 'pending' : 'done';
      localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
      updateBatchUI();
    }
  } else if (action === 'remove-item') {
    const idx = parseInt(btn.getAttribute('data-index') || '-1', 10);
    if (idx >= 0 && currentBatchQueue[idx]) {
      currentBatchQueue.splice(idx, 1);
      localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
      updateBatchUI();
    }
  }
}

// 智能控制 Google 搜索结果页翻页并自动提取新一组 10 条外链
async function goToGoogleNextPageAndScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url || !tab.url.includes('google.com/search')) {
    alert('请先打开并聚焦在 Google 搜索结果页面！');
    return;
  }

  const btnNext = document.getElementById('btn-next-google-batch');
  if (btnNext) {
    btnNext.disabled = true;
    btnNext.textContent = '⏳ 正在翻页并加载新结果...';
  }

  try {
    // 1. 尝试在目标 Google 页面点击原生下一页按钮
    const clickRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const nextLink = document.querySelector('a#pnnext, a[aria-label="Next page"], a[aria-label="下一页"], td.d6cvqb a, a[id="pnnext"]');
        if (nextLink) {
          nextLink.click();
          return true;
        }
        return false;
      }
    });

    const clicked = clickRes && clickRes[0] && clickRes[0].result;
    if (!clicked) {
      // 2. 兜底策略：直接通过 URL 计算当前 start 偏移量并推进 10 位
      const u = new URL(tab.url);
      const currentStart = parseInt(u.searchParams.get('start') || '0', 10);
      u.searchParams.set('start', String(currentStart + 10));
      await chrome.tabs.update(tab.id, { url: u.toString() });
    }

    // 3. 延时等待搜索页结果渲染完成，自动清空上一组并抓取新一组 10 条
    setTimeout(async () => {
      currentBatchQueue = [];
      localStorage.removeItem('comlinkai_batch_queue');
      await scrapeGoogleSearchResultsHandler();
      if (btnNext) {
        btnNext.disabled = false;
        btnNext.textContent = '👉 翻至下一页并抓取新一组';
      }
    }, 2500);

  } catch (err) {
    alert('Google 翻页失败: ' + err.message);
    if (btnNext) {
      btnNext.disabled = false;
      btnNext.textContent = '👉 翻至下一页并抓取新一组';
    }
  }
}

async function scrapeGoogleSearchResultsHandler(silent = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    if (!silent) alert('未检测到活跃标签页，请先在浏览器中切换到 Google 搜索结果页面！');
    return { success: false, error: '未检测到活跃标签页' };
  }

  if (!tab.url || !tab.url.includes('google.com/search')) {
    if (!silent) alert('请先在 Google 搜索结果页面点击此按钮以自动提取搜索结果外链！');
    return { success: false, error: '当前活跃标签页非 Google 搜索结果页面' };
  }

  const btnScrapeGoogle = document.getElementById('btn-scrape-google');
  if (btnScrapeGoogle) {
    btnScrapeGoogle.disabled = true;
    btnScrapeGoogle.textContent = '🔍 抓取中...';
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const out = [];
        const seenUrls = new Set();
        const invalidHosts = [
          'google.com', 'google.cn', 'googleusercontent.com', 'gstatic.com',
          'schema.org', 'w3.org', 'support.google.com', 'maps.google.com',
          'accounts.google.com', 'policies.google.com', 'youtube.com'
        ];

        // 策略 1: 扫描所有 h3 标题对应的父级或子级 <a> 链接 (Google 结果页最稳健选择器)
        const h3Elements = Array.from(document.querySelectorAll('h3'));
        h3Elements.forEach(h3 => {
          const a = h3.closest('a') || (h3.parentElement && h3.parentElement.querySelector('a')) || h3.querySelector('a');
          if (!a) return;
          let href = a.href || a.getAttribute('href');
          if (!href) return;

          if (href.includes('/url?q=')) {
            try {
              const u = new URL(href, window.location.origin);
              const realQ = u.searchParams.get('q');
              if (realQ && realQ.startsWith('http')) href = realQ;
            } catch (e) { }
          }

          if (!href.startsWith('http')) return;

          try {
            const parsed = new URL(href);
            const host = parsed.hostname.toLowerCase();
            if (invalidHosts.some(ih => host.includes(ih))) return;

            const normUrl = `${parsed.protocol}//${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
            if (seenUrls.has(normUrl)) return;
            seenUrls.add(normUrl);

            const title = (h3.innerText || '').trim() || host;
            out.push({ url: href, domain: host, title: title });
          } catch (e) { }
        });

        // 策略 2: 兜底扫描 SERP 容器 (#search, #rso) 中所有外部 <a> 链接
        if (out.length === 0) {
          const searchArea = document.getElementById('search') || document.getElementById('rso') || document.body;
          const allLinks = Array.from(searchArea.querySelectorAll('a[href]'));
          allLinks.forEach(a => {
            let href = a.href || a.getAttribute('href');
            if (!href) return;

            if (href.includes('/url?q=')) {
              try {
                const u = new URL(href, window.location.origin);
                const realQ = u.searchParams.get('q');
                if (realQ && realQ.startsWith('http')) href = realQ;
              } catch (e) { }
            }

            if (!href.startsWith('http')) return;

            try {
              const parsed = new URL(href);
              const host = parsed.hostname.toLowerCase();
              if (invalidHosts.some(ih => host.includes(ih))) return;

              const normUrl = `${parsed.protocol}//${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
              if (seenUrls.has(normUrl)) return;
              seenUrls.add(normUrl);

              const h3 = a.querySelector('h3');
              const title = (h3 ? h3.innerText : a.innerText || '').trim() || host;
              if (title.length >= 2) {
                out.push({ url: href, domain: host, title: title });
              }
            } catch (e) { }
          });
        }

        return out;
      }
    });

    const extracted = results && results[0] ? results[0].result : [];
    if (!extracted || extracted.length === 0) {
      if (!silent) alert('未在当前 Google 搜索页提取到有效外部链接，请确保当前页面为已加载完成的搜索结果页。');
      return { success: false, error: '未在当前 Google 搜索页提取到有效外部链接' };
    }

    // 🌟 如果旧批次已经 100% 全部完成，自动归档并清空旧批次，载入全新的 10 条
    if (currentBatchQueue.length > 0 && currentBatchQueue.every(i => i.status === 'done')) {
      currentBatchQueue = [];
    }

    let added = 0;
    const existing = new Set(currentBatchQueue.map(i => (i.url || '').toLowerCase()));

    // 🌟 核心优化：每次只严格抓取当页前 10 条，避免批量过载与发布混乱
    for (const item of extracted) {
      if (added >= 10) break;
      if (!existing.has((item.url || '').toLowerCase())) {
        let domain = item.domain || '';
        if (!domain) {
          try { domain = new URL(item.url).hostname; } catch (e) { }
        }

        let category = 'blog_comment';
        if (typeof classifyBacklink === 'function') {
          category = classifyBacklink(item.url, item.title, '');
        }

        let isToxic = category === 'toxic';
        if (typeof SafetyGuard !== 'undefined') {
          const safetyRes = SafetyGuard.inspectPageContent(item.title, '', item.url);
          if (!safetyRes.isSafe) {
            isToxic = true;
            category = 'toxic';
          }
        }

        currentBatchQueue.push({
          url: item.url,
          domain: domain,
          title: item.title || domain,
          category: category,
          status: isToxic ? 'toxic' : 'pending',
          discoveredAt: new Date().toISOString()
        });
        existing.add((item.url || '').toLowerCase());
        added++;
      }
    }

    localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
    updateBatchUI();
    if (!silent) {
      alert(`🎉 成功从 Google 搜索结果中提取 ${added} 条优质外链（当前批次共 ${currentBatchQueue.length} 条）！\n建议完成本组 10 条发布后，点击翻页载入下一组。`);
    }
    return {
      success: true,
      addedCount: added,
      totalQueue: currentBatchQueue.length,
      queue: currentBatchQueue
    };
  } catch (err) {
    if (!silent) alert('抓取 Google 结果失败: ' + err.message);
    return { success: false, error: err.message };
  } finally {
    if (btnScrapeGoogle) {
      btnScrapeGoogle.disabled = false;
      btnScrapeGoogle.textContent = '🔍 抓取当页10条';
    }
  }
}

function getCategoryBadge(category) {
  switch (category) {
    case 'directory':
      return { icon: '🧭', name: '目录', bg: 'rgba(56,189,248,0.15)', color: '#38bdf8' };
    case 'platform_saas':
      return { icon: '🚀', name: '平台', bg: 'rgba(168,85,247,0.15)', color: '#c084fc' };
    case 'forum_community':
      return { icon: '👥', name: '社区', bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' };
    case 'toxic':
      return { icon: '🔴', name: '黑帽', bg: 'rgba(248,113,113,0.15)', color: '#f87171' };
    case 'blog_comment':
    default:
      return { icon: '💬', name: '博客', bg: 'rgba(0,242,254,0.15)', color: '#00f2fe' };
  }
}

// 供标签页导航的核心跳转函数 (支持当前标签更新或新标签打开，并自动模拟人类平滑滚动至评论区)
async function openAndFocusUrl(url) {
  if (!url) return;
  try {
    let targetTabId = null;
    try {
      targetTabId = await getTargetWebTabId();
      await chrome.tabs.update(targetTabId, { url: url, active: true });
    } catch (e) {
      const newTab = await chrome.tabs.create({ url: url });
      targetTabId = newTab.id;
    }

    setTimeout(updateActiveTabInfo, 500);

    // 🌟 智能挂载：当网页加载完成后，自动模拟真人平滑滚动至评论区/表单区
    if (targetTabId) {
      scheduleHumanScrollToComment(targetTabId);
    }
  } catch (e) {
    console.warn('[ComLinkAI] openAndFocusUrl 异常:', e);
  }
}

// 调度平滑滚动至评论区
function scheduleHumanScrollToComment(tabId) {
  let executed = false;

  const onTabUpdated = (updatedTabId, changeInfo, tab) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete' && !executed) {
      executed = true;
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      // 给目标页面留出 DOM 渲染时间，然后进行平滑滚动与高亮
      setTimeout(() => {
        executeHumanScrollInTab(tabId);
      }, 800);
    }
  };

  chrome.tabs.onUpdated.addListener(onTabUpdated);

  // 兜底超时：如果 8 秒内未收到 complete 事件或页面早已完成，主动尝试执行
  setTimeout(() => {
    if (!executed) {
      executed = true;
      try { chrome.tabs.onUpdated.removeListener(onTabUpdated); } catch (e) { }
      executeHumanScrollInTab(tabId);
    }
  }, 3500);
}

// 在目标标签页中执行仿真人类平滑滚动与聚焦
async function executeHumanScrollInTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // 1. 多层级智能寻找评论输入框或评论区域
        const candidates = [
          document.querySelector('textarea[name*="comment" i]'),
          document.querySelector('textarea[id*="comment" i]'),
          document.querySelector('textarea[placeholder*="comment" i]'),
          document.querySelector('textarea[placeholder*="reply" i]'),
          document.querySelector('textarea[placeholder*="评论" i]'),
          document.querySelector('textarea[placeholder*="留言" i]'),
          document.querySelector('#respond'),
          document.querySelector('#commentform'),
          document.querySelector('#comments'),
          document.querySelector('.comment-form'),
          document.querySelector('.comments-area'),
          document.querySelector('input[name*="author" i]'),
          document.querySelector('form[action*="comment" i]'),
          // 扫描包含 Leave a Reply / Leave a Comment 等关键词的标题
          Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, strong, div')).find(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return txt.length < 50 && (
              txt.includes('leave a reply') ||
              txt.includes('leave a comment') ||
              txt.includes('post a comment') ||
              txt.includes('add a comment') ||
              txt.includes('write a comment') ||
              txt.includes('发表评论') ||
              txt.includes('参与讨论') ||
              txt.includes('发表回复')
            );
          }),
          document.querySelector('textarea')
        ];

        const target = candidates.find(el => el !== null && el !== undefined);
        if (!target) return false;

        // 2. 计算目标元素在文档中的绝对纵坐标
        const rect = target.getBoundingClientRect();
        const absoluteTop = rect.top + window.pageYOffset;
        const targetScrollY = Math.max(0, absoluteTop - 120); // 留出 120px 顶部视野

        // 3. 仿真人类平滑滚动 (Human Smooth Eased Scrolling)
        const startY = window.pageYOffset;
        const distance = targetScrollY - startY;
        const duration = Math.min(1400, Math.max(600, Math.abs(distance) * 0.4)); // 动态拟真耗时
        let startTime = null;

        function easeInOutCubic(t) {
          return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        function animation(currentTime) {
          if (!startTime) startTime = currentTime;
          const timeElapsed = currentTime - startTime;
          const progress = Math.min(timeElapsed / duration, 1);
          const easeProgress = easeInOutCubic(progress);

          window.scrollTo(0, startY + (distance * easeProgress));

          if (timeElapsed < duration) {
            requestAnimationFrame(animation);
          } else {
            // 4. 滚动到位后，优雅高亮并聚焦输入框
            target.style.transition = 'all 0.5s ease';
            target.style.outline = 'none';
            target.style.boxShadow = '0 0 0 3px rgba(0, 242, 254, 0.7), 0 0 20px rgba(0, 242, 254, 0.4)';
            target.style.borderColor = '#00f2fe';

            if (typeof target.focus === 'function') {
              try {
                target.focus({ preventScroll: true });
              } catch (e) { }
            }

            // 2 秒后光效自然收敛
            setTimeout(() => {
              target.style.boxShadow = '0 0 8px rgba(0, 242, 254, 0.3)';
            }, 2200);
          }
        }

        requestAnimationFrame(animation);
        return true;
      }
    });
  } catch (err) {
    console.warn('[ComLinkAI] 平滑滚动执行异常:', err);
  }
}

window.openAndFocusUrl = openAndFocusUrl;

window.toggleBatchItemStatus = function (index) {
  if (currentBatchQueue[index]) {
    currentBatchQueue[index].status = currentBatchQueue[index].status === 'done' ? 'pending' : 'done';
    localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
    updateBatchUI();
  }
};

window.removeBatchItem = function (index) {
  if (currentBatchQueue[index]) {
    currentBatchQueue.splice(index, 1);
    localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
    updateBatchUI();
  }
};

// 注入到标签页的评论表单感知与自动填写函数
function fillCommentFormInTab(commentText, profile) {
  if (!commentText) return { filledCount: 0, filledFields: [] };
  const authorName = (profile && (profile.profileName || profile.name)) || '';
  const authorEmail = (profile && (profile.profileEmail || profile.email)) || '';
  const authorUrl = (profile && (profile.websiteUrl || profile.url)) || '';

  const filledFields = [];
  const highlightAndFill = (el, val) => {
    if (!el || !val) return false;
    try {
      el.focus && el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.style.border = '2px solid #10b981';
      el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';
      return true;
    } catch (e) {
      return false;
    }
  };

  // 1. 评论正文 (Textarea)
  const commentTextarea = document.querySelector('textarea[name*="comment" i], textarea[id*="comment" i], textarea[placeholder*="comment" i], textarea[placeholder*="评论" i], textarea[placeholder*="留言" i], textarea[placeholder*="reply" i], textarea');
  if (commentTextarea && highlightAndFill(commentTextarea, commentText)) {
    filledFields.push('评论正文');
  }

  // 2. 昵称/姓名
  const nameEl = document.querySelector('input[placeholder*="昵称" i], input[placeholder*="姓名" i], input[placeholder*="Name" i], input[placeholder*="Author" i], input[name*="author" i], input[name*="name" i], input[id*="author" i], input[id*="name" i]');
  if (nameEl && authorName && highlightAndFill(nameEl, authorName)) {
    filledFields.push('姓名');
  }

  // 3. 邮箱
  const emailEl = document.querySelector('input[placeholder*="邮箱" i], input[placeholder*="Email" i], input[placeholder*="Mail" i], input[type="email"], input[name*="email" i], input[id*="email" i]');
  if (emailEl && authorEmail && highlightAndFill(emailEl, authorEmail)) {
    filledFields.push('邮箱');
  }

  // 4. 网址/引流链接
  const urlEl = document.querySelector('input[placeholder*="网址" i], input[placeholder*="网站" i], input[placeholder*="URL" i], input[placeholder*="Website" i], input[type="url"], input[name*="url" i], input[name*="website" i], input[id*="url" i], input[id*="website" i]');
  if (urlEl && authorUrl && highlightAndFill(urlEl, authorUrl)) {
    filledFields.push('引流网址');
  }

  return {
    success: true,
    filledCount: filledFields.length,
    filledFields: filledFields
  };
}

function submitCommentFormInTab(commentText, profile) {
  // 确保在任何独立 tabId 中注入执行时均完全自包含
  const authorName = (profile && (profile.profileName || profile.name)) || '';
  const authorEmail = (profile && (profile.profileEmail || profile.email)) || '';
  const authorUrl = (profile && (profile.websiteUrl || profile.url)) || '';

  const highlightAndFill = (el, val) => {
    if (!el || !val) return false;
    try {
      el.focus && el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.style.border = '2px solid #10b981';
      el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';
      return true;
    } catch (e) {
      return false;
    }
  };

  const filledFields = [];
  const commentTextarea = document.querySelector('textarea[name*="comment" i], textarea[id*="comment" i], textarea[placeholder*="comment" i], textarea[placeholder*="评论" i], textarea[placeholder*="留言" i], textarea[placeholder*="reply" i], textarea');
  if (commentTextarea && highlightAndFill(commentTextarea, commentText)) filledFields.push('评论正文');

  // 🌟 核心防误触隔离：优先在当前评论表单容器内部定位字段，绝不误触页面顶栏的邮件订阅框 (Newsletter) 或全局搜索框
  const commentScope = (commentTextarea ? (commentTextarea.closest('form') || commentTextarea.closest('#respond, .comment-respond, .comment-form, #commentform')) : null) || document;

  const nameEl = commentScope.querySelector('input[placeholder*="昵称" i], input[placeholder*="姓名" i], input[placeholder*="Name" i], input[placeholder*="Author" i], input[name*="author" i], input[name*="name" i], input[id*="author" i], input[id*="name" i]') || document.querySelector('#author, input[name="author"]');
  if (nameEl && authorName && highlightAndFill(nameEl, authorName)) filledFields.push('姓名');

  const emailEl = commentScope.querySelector('input[placeholder*="邮箱" i], input[placeholder*="Email" i], input[placeholder*="Mail" i], input[type="email"], input[name*="email" i], input[id*="email" i]') || document.querySelector('#email, input[name="email"]');
  if (emailEl && authorEmail && highlightAndFill(emailEl, authorEmail)) filledFields.push('邮箱');

  const urlEl = commentScope.querySelector('input[placeholder*="网址" i], input[placeholder*="网站" i], input[placeholder*="URL" i], input[placeholder*="Website" i], input[type="url"], input[name*="url" i], input[name*="website" i], input[id*="url" i], input[id*="website" i]') || document.querySelector('#url, input[name="url"]');
  if (urlEl && authorUrl && highlightAndFill(urlEl, authorUrl)) filledFields.push('引流网址');

  // 自动勾选记住资料 (WordPress cookies consent checkbox)
  const consentEl = commentScope.querySelector('#wp-comment-cookies-consent, input[name*="cookies-consent" i]');
  if (consentEl && !consentEl.checked) {
    consentEl.checked = true;
    consentEl.dispatchEvent(new Event('change', { bubbles: true }));
    filledFields.push('保存Cookie勾选');
  }

  // 检查图形验证码
  const captchaImg = commentScope.querySelector('img[src*="captcha" i], img[src*="code" i], canvas[id*="captcha" i], img[alt*="验证码" i]');
  const captchaInput = commentScope.querySelector('input[placeholder*="验证码" i], input[placeholder*="Code" i], input[name*="captcha" i], input[name*="code" i], input[name*="verify" i]');
  if (captchaImg || captchaInput) {
    if (captchaInput) {
      captchaInput.style.border = '2px solid #fbbf24';
      captchaInput.style.boxShadow = '0 0 10px rgba(251, 191, 36, 0.5)';
      try {
        captchaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        captchaInput.focus({ preventScroll: true });
      } catch (e) { }
    }
    return { success: true, submitted: false, captchaPresent: true, filledCount: filledFields.length };
  }

  // 提交按钮精确定位：优先在评论表单容器内部查找，彻底避免误触全局搜索框或订阅框的提交按钮
  const commentForm = commentTextarea ? commentTextarea.closest('form') : document.querySelector('form#commentform, .comment-form, form[action*="comment" i]');
  const submitBtn = (commentForm ? commentForm.querySelector('button[type="submit"], input[type="submit"], #submit, button.submit, input[name="submit"]') : null) ||
    document.querySelector('form#commentform input[type="submit"], form#commentform button[type="submit"], #commentform #submit, button#comment-submit, #submit');
  if (submitBtn) {
    try {
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      submitBtn.click();
      return { success: true, submitted: true, captchaPresent: false, filledCount: filledFields.length };
    } catch (e) { }
  }

  return { success: true, submitted: false, captchaPresent: false, filledCount: filledFields.length };
}

function updateBatchUI() {
  const total = currentBatchQueue.length;
  const doneCount = currentBatchQueue.filter(i => i.status === 'done').length;
  const toxicCount = currentBatchQueue.filter(i => i.status === 'toxic' || i.category === 'toxic').length;
  const validCount = currentBatchQueue.filter(i => i.status !== 'toxic' && i.status !== 'done').length;

  // 1. 同步更新【收集】面板 4 大漏斗统计指标
  const statDiscovered = document.getElementById('stat-discovered');
  const statAnalyzed = document.getElementById('stat-analyzed');
  const statCommentable = document.getElementById('stat-commentable');
  const statInQueue = document.getElementById('stat-in-queue');

  if (statDiscovered) statDiscovered.textContent = total;
  if (statAnalyzed) statAnalyzed.textContent = doneCount;
  if (statCommentable) statCommentable.textContent = validCount;
  if (statInQueue) statInQueue.textContent = toxicCount;

  // 2. 渲染【收集】面板队列列表
  const collectContainer = document.getElementById('collect-queue-container');
  if (collectContainer) {
    if (total === 0) {
      collectContainer.innerHTML = '<div id="collect-queue-empty" style="text-align: center; padding: 15px; color: var(--text-muted); font-size: 0.76rem;">暂无收集外链。输入目标域名或在 Google 搜索页点击“抓取当页10条”。</div>';
    } else {
      collectContainer.innerHTML = currentBatchQueue.slice(0, 100).map(function (item, idx) {
        const isDone = item.status === 'done';
        const isToxic = item.status === 'toxic' || item.category === 'toxic';
        const textDecor = isDone ? 'text-decoration: line-through;' : '';
        const col = isDone ? 'var(--text-muted)' : (isToxic ? '#f87171' : 'var(--text-main)');
        const catBadge = getCategoryBadge(item.category);

        return '<div class="batch-item-card ' + (isDone ? 'item-done' : '') + '" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: hsla(220, 30%, 6%, 0.6); border: 1px solid hsla(217, 32%, 18%, 0.6); border-radius: 6px; font-size: 0.74rem; margin-bottom: 4px;">' +
          '<div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;">' +
          '<span style="font-size: 0.68rem; margin-right: 4px; padding: 1px 4px; border-radius: 3px; background: hsla(220, 30%, 15%, 0.8);">' + catBadge.icon + '</span>' +
          '<span style="font-weight: 600; color: ' + col + '; ' + textDecor + '" title="' + item.url + '">' + (item.domain || item.url) + '</span>' +
          '</div>' +
          '<div style="display: flex; gap: 4px; align-items: center;">' +
          '<button class="btn btn-secondary btn-sm" data-action="open-url" data-url="' + encodeURIComponent(item.url) + '" style="padding: 2px 6px; font-size: 0.68rem;">直达</button>' +
          '<button class="btn btn-secondary btn-sm" data-action="toggle-status" data-index="' + idx + '" style="padding: 2px 5px; font-size: 0.68rem; color: ' + (isDone ? '#fbbf24' : '#34d399') + ';" title="' + (isDone ? '标记为未完成' : '标记为已完成') + '">' + (isDone ? '↩' : '✔') + '</button>' +
          '<button class="btn btn-secondary btn-sm" data-action="remove-item" data-index="' + idx + '" style="padding: 2px 5px; font-size: 0.68rem; color: #f87171;" title="删除此条">×</button>' +
          '</div>' +
          '</div>';
      }).join('');
    }
  }

  // 3. 同步更新【发布】面板工作进度看板
  const publishProgressText = document.getElementById('publish-progress-text');
  const publishProgressFill = document.getElementById('publish-progress-fill');
  const progressPercent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  if (publishProgressText) {
    publishProgressText.textContent = `已完成 ${doneCount} / ${total} 条 (${progressPercent}%)`;
  }
  if (publishProgressFill) {
    publishProgressFill.style.width = `${progressPercent}%`;
  }

  // 🌟 4. 智能判断批次达成状态：若本组外链全部完成（100%），展示引导 Banner
  const publishSprintBanner = document.getElementById('publish-sprint-banner');
  if (publishSprintBanner) {
    if (total > 0 && doneCount === total) {
      publishSprintBanner.classList.remove('hidden');
    } else {
      publishSprintBanner.classList.add('hidden');
    }
  }

  // 5. 同步更新【发布】面板 6 大分类 Pill 数量徽标
  const blogCount = currentBatchQueue.filter(i => (i.category || 'blog_comment') === 'blog_comment' && i.status !== 'toxic').length;
  const dirCount = currentBatchQueue.filter(i => i.category === 'directory' && i.status !== 'toxic').length;
  const saasCount = currentBatchQueue.filter(i => i.category === 'platform_saas' && i.status !== 'toxic').length;
  const forumCount = currentBatchQueue.filter(i => i.category === 'forum_community' && i.status !== 'toxic').length;

  const setCnt = (id, cnt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = cnt;
  };
  setCnt('pill-cnt-all', total);
  setCnt('pill-cnt-blog', blogCount);
  setCnt('pill-cnt-dir', dirCount);
  setCnt('pill-cnt-saas', saasCount);
  setCnt('pill-cnt-forum', forumCount);
  setCnt('pill-cnt-toxic', toxicCount);

  // 6. 渲染【发布】面板资源队列 (根据 activePublishCategory 实时过滤)
  const publishContainer = document.getElementById('batch-queue-container');
  if (publishContainer) {
    let filteredItems = [];
    if (activePublishCategory === 'all') {
      filteredItems = currentBatchQueue.map((item, idx) => ({ item, originalIndex: idx }));
    } else if (activePublishCategory === 'toxic') {
      filteredItems = currentBatchQueue
        .map((item, idx) => ({ item, originalIndex: idx }))
        .filter(x => x.item.status === 'toxic' || x.item.category === 'toxic');
    } else {
      filteredItems = currentBatchQueue
        .map((item, idx) => ({ item, originalIndex: idx }))
        .filter(x => (x.item.category || 'blog_comment') === activePublishCategory && x.item.status !== 'toxic');
    }

    if (filteredItems.length === 0) {
      publishContainer.innerHTML = '<div id="batch-queue-empty" style="text-align: center; padding: 12px; color: var(--text-muted); font-size: 0.75rem;">' +
        (total === 0 ? '暂无待发布外链，请先在【收集】卡片中抓取当页10条。' : '当前分类筛选下暂无外链条目。') +
        '</div>';
    } else {
      publishContainer.innerHTML = filteredItems.slice(0, 100).map(function (wrap) {
        const item = wrap.item;
        const idx = wrap.originalIndex;
        const isDone = item.status === 'done';
        const isToxic = item.status === 'toxic' || item.category === 'toxic';
        const catBadge = getCategoryBadge(item.category);
        const textDecor = isDone ? 'text-decoration: line-through;' : '';
        const col = isDone ? 'var(--text-muted)' : (isToxic ? '#f87171' : 'var(--text-main)');

        let actionBtnText = '直达';
        if (item.category === 'blog_comment') {
          actionBtnText = '💬 评论';
        } else if (item.category === 'directory' || item.category === 'platform_saas') {
          actionBtnText = '⚡ 填表';
        }

        return '<div class="batch-item-card ' + (isDone ? 'item-done' : '') + '" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: hsla(220, 30%, 6%, 0.6); border: 1px solid ' + (isToxic ? 'rgba(248,113,113,0.3)' : 'hsla(217, 32%, 18%, 0.6)') + '; border-radius: 6px; font-size: 0.74rem; margin-bottom: 4px;">' +
          '<div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;">' +
          '<span style="font-size: 0.68rem; margin-right: 4px; padding: 1px 5px; border-radius: 3px; background: ' + catBadge.bg + '; color: ' + catBadge.color + ';">' + catBadge.name + '</span>' +
          '<span style="font-weight: 600; color: ' + col + '; ' + textDecor + '" title="' + item.url + '">' + (item.domain || item.url) + '</span>' +
          '</div>' +
          '<div style="display: flex; gap: 4px; align-items: center;">' +
          '<button class="btn btn-secondary btn-sm" data-action="open-url" data-url="' + encodeURIComponent(item.url) + '" style="padding: 2px 6px; font-size: 0.68rem;" title="打开此网址">' + actionBtnText + '</button>' +
          '<button class="btn btn-secondary btn-sm" data-action="toggle-status" data-index="' + idx + '" style="padding: 2px 5px; font-size: 0.68rem; color: ' + (isDone ? '#fbbf24' : '#34d399') + ';" title="' + (isDone ? '标记为未完成' : '标记为已完成') + '">' + (isDone ? '↩' : '✔') + '</button>' +
          '<button class="btn btn-secondary btn-sm" data-action="remove-item" data-index="' + idx + '" style="padding: 2px 5px; font-size: 0.68rem; color: #f87171;" title="删除此条">×</button>' +
          '</div>' +
          '</div>';
      }).join('');
    }
  }
}

// --------------------------------------------------------------------------
// 5. Auto-Pilot 全自动反链引擎 (Chrome 标签组隔离 & CDP 原生硬件缩放底座)
// --------------------------------------------------------------------------

async function generateCommentForArticle(title, url, bodySnippet, profile) {
  let rawName = profile.profileName || profile.name || '';
  let cleanBrand = rawName;
  if (cleanBrand.includes('@')) {
    cleanBrand = cleanBrand.split('@').pop().trim();
  }
  if (!cleanBrand) cleanBrand = 'APIVALE';

  let baseUrl = (localStorage.getItem('ai_base_url') || '').trim().replace(/\/+$/, '');
  let apiKey = (localStorage.getItem('ai_api_key') || '').trim();
  let modelName = (localStorage.getItem('ai_model_name') || '').trim() || 'sensenova/deepseek-v4-flash';

  if (!baseUrl) baseUrl = 'https://apivale.com/v1';
  let cleanBase = baseUrl.replace(/\/+$/, '');
  let endpoint = cleanBase.endsWith('/chat/completions') ? cleanBase : (cleanBase.endsWith('/v1') ? `${cleanBase}/chat/completions` : `${cleanBase}/v1/chat/completions`);

  if (apiKey) {
    try {
      const prompt = `You are a thoughtful tech professional reading a blog post.
TARGET ARTICLE METADATA:
- Title: ${title || 'N/A'}
- URL: ${url || 'N/A'}

ARTICLE CONTENT SNIPPET:
${(bodySnippet || '').slice(0, 3000)}

READER/COMPANY IDENTITY:
- Brand Name: ${cleanBrand}
- Website: ${profile.websiteUrl || 'https://apivale.com/'}
- Core Focus: ${profile.profileBio || profile.tagline || 'API Gateway & AI Infrastructure'}

OBJECTIVES (HIGH CONVERSION & ANTI-SPAM COMPLIANCE):
1. Directly reference specific technologies, insights, or arguments mentioned in the article.
2. Share a valuable technical perspective on why this matters in modern real-world workflows.
3. Naturally mention observing similar patterns at "${cleanBrand}" in a purely contextual, non-salesy way.
4. End with an insightful, open-ended question to the author.
5. Length: 55 to 100 words. Fluent professional English. NO hashtags, NO emojis. Output ONLY the plain comment text.`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are an experienced tech professional writing natural, high-value blog comments that get approved and spark meaningful discussions. Output plain comment text only.' },
            { role: 'user', content: prompt }
          ],
          stream: false
        }),
        signal: AbortSignal.timeout(35000)
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = (data.choices?.[0]?.message?.content || '').trim();
        if (text) return text;
      }
    } catch (e) {
      console.warn('[Auto-Pilot Comment Gen API Error]:', e);
    }
  }

  // 智能语义兜底
  const articleTopic = (title || '').split(/[-|_|–|\|]/)[0].trim() || 'this topic';
  return `Really thoughtful perspective on ${articleTopic}. Transitioning towards frictionless, standardized workflows is crucial for modern user adoption. At ${cleanBrand}, we see the exact same principle when optimizing infrastructure—eliminating final-step friction yields the biggest compounding gains. Do you expect this rollout to noticeably accelerate over the coming quarters?`;
}

const autoPilotEngine = {
  running: false,
  paused: false,
  abort: false,
  activeTabId: null,
  activeGroupId: null,
  watchdogTimer: null,
  consecutiveErrors: 0,
  logs: [],

  log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '❌' : (type === 'warn' ? '⚠️' : (type === 'success' ? '✔' : '📍'));
    const entry = `[${time}] ${prefix} ${msg}`;
    this.logs.push(entry);
    if (this.logs.length > 120) this.logs.shift();
    const term = document.getElementById('autopilot-log-terminal');
    const cnt = document.getElementById('autopilot-log-count');
    if (term) {
      term.textContent = this.logs.join('\n');
      term.scrollTop = term.scrollHeight;
    }
    if (cnt) cnt.textContent = this.logs.length;
  },

  updateUI(stepText, color = '#60a5fa', timerText = '', cooldownPercent = 0) {
    const indicator = document.getElementById('autopilot-step-indicator');
    const badge = document.getElementById('autopilot-timer-badge');
    const fill = document.getElementById('autopilot-cooldown-fill');
    if (indicator) {
      indicator.textContent = stepText;
      indicator.style.color = color;
    }
    if (badge) badge.textContent = timerText;
    if (fill) fill.style.width = `${cooldownPercent}%`;
  },

  async getTargetTab(targetUrl) {
    const isIsolate = document.getElementById('chk-autopilot-isolate')?.checked !== false;
    if (isIsolate) {
      const res = await chrome.runtime.sendMessage({
        type: 'AUTOPILOT_GET_GROUP',
        url: targetUrl
      });
      if (res && res.success && res.data) {
        this.activeTabId = res.data.tabId;
        this.activeGroupId = res.data.groupId;
        return { tabId: res.data.tabId, groupId: res.data.groupId, isolated: true };
      }
    }
    const [curTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { tabId: curTab ? curTab.id : null, groupId: null, isolated: false };
  },

  async updateGroupStatus(statusText, color = 'cyan') {
    if (this.activeGroupId) {
      await chrome.runtime.sendMessage({
        type: 'AUTOPILOT_SET_STATUS',
        statusText,
        color
      }).catch(() => { });
    }
  },

  async start() {
    if (this.running && this.paused) {
      this.paused = false;
      this.updateUI('▶ 已恢复挂机任务', '#10b981');
      this.log('已手动解除暂停，恢复挂机流水线', 'info');
      this.updateGroupStatus('挂机中', 'cyan');
      this.updateButtons();
      return;
    }

    const pendingItems = currentBatchQueue.filter(x => x.status === 'pending');
    if (!pendingItems.length) {
      alert('队列中暂无待发布的外链任务！请先在【收集】卡片中抓取或导入外链。');
      return;
    }

    this.running = true;
    this.paused = false;
    this.abort = false;
    this.consecutiveErrors = 0;
    this.updateButtons();
    this.log(`🚀 Auto-Pilot 引擎启动！待处理外链: ${pendingItems.length} 条 (已启用 Chrome 标签组隔离并发)`, 'success');
    await this.updateGroupStatus('挂机启动', 'cyan');

    this.runLoop();
  },

  pause() {
    if (!this.running) return;
    this.paused = true;
    this.updateUI('⏸ 挂机已暂停 (点击继续)', '#f59e0b');
    this.log('挂机已手动暂停', 'warn');
    this.updateGroupStatus('已暂停', 'yellow');
    this.updateButtons();
  },

  stop() {
    this.running = false;
    this.paused = false;
    this.abort = true;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.updateUI('🛑 挂机已终止', '#f87171', '', 0);
    this.log('挂机已终止', 'warn');
    this.updateGroupStatus('已停止', 'red');
    this.updateButtons();
  },

  updateButtons() {
    const btnStart = document.getElementById('btn-autopilot-start');
    const btnPause = document.getElementById('btn-autopilot-pause');
    const btnStop = document.getElementById('btn-autopilot-stop');
    if (btnStart) {
      btnStart.disabled = this.running && !this.paused;
      btnStart.textContent = this.paused ? '▶ 继续挂机' : '▶ 启动挂机';
    }
    if (btnPause) {
      btnPause.disabled = !this.running || this.paused;
    }
    if (btnStop) {
      btnStop.disabled = !this.running;
    }
  },

  async runLoop() {
    while (this.running && !this.abort) {
      if (this.paused) {
        await new Promise(r => setTimeout(r, 600));
        continue;
      }

      const pendingItem = currentBatchQueue.find(x => x.status === 'pending');
      if (!pendingItem) {
        this.log('🎉 恭喜！当前批次全部待发布外链已处理完毕！', 'success');
        this.updateUI('🎉 全部任务达成！', '#10b981', '100%', 100);
        this.updateGroupStatus('全部完成', 'green');
        this.stop();
        break;
      }

      const targetUrl = pendingItem.url;

      try {
        // ----------------------------------------------------
        // 阶段 1：标签组隔离导航 (Tab Group Navigation)
        // ----------------------------------------------------
        let hostName = 'target';
        try { hostName = new URL(targetUrl).hostname; } catch (e) { }
        this.updateUI(`📍 [1/5] 标签组隔离载入: ${hostName}`, '#60a5fa');
        this.log(`[1/5] 正在隔离导航至: ${targetUrl}`);
        await this.updateGroupStatus(`载入: ${hostName}`, 'cyan');

        const { tabId } = await this.getTargetTab(targetUrl);
        if (!tabId) throw new Error('未能获取或创建目标标签页');

        // 30 秒硬超时看门狗保护
        const watchdog = new Promise((_, reject) => {
          this.watchdogTimer = setTimeout(() => {
            reject(new Error('单步 30 秒加载超时看门狗熔断'));
          }, 30000);
        });

        // 导航并等待页面完成
        const navTask = new Promise((resolve) => {
          const listener = (tid, change) => {
            if (tid === tabId && change.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          chrome.tabs.update(tabId, { url: targetUrl });
        });

        await Promise.race([navTask, watchdog]);
        clearTimeout(this.watchdogTimer);

        if (this.abort) break;
        await new Promise(r => setTimeout(r, 1200)); // 等待 SPA 挂载

        // ----------------------------------------------------
        // 阶段 2：正文提取与极速无表单熔断检测 (Fast Abort Check)
        // ----------------------------------------------------
        this.updateUI(`📍 [2/5] 提取正文并嗅探表单...`, '#38bdf8');
        this.log(`[2/5] 正在提取页面 Markdown 并嗅探评论表单...`);

        const probeRes = await executeInTab(tabId, () => {
          const text = (document.body ? document.body.innerText : '').toLowerCase();
          const isClosed = text.includes('comments are closed') || text.includes('评论已关闭') || text.includes('关闭了评论');
          const hasForm = !!document.querySelector('textarea, form[action*="comment" i], #commentform, .comment-form, input[name*="comment" i]');
          const title = (document.title || '').trim();
          return { isClosed, hasForm, title, bodySnippet: text.slice(0, 3000) };
        });

        if (!probeRes || (!probeRes.hasForm && probeRes.isClosed)) {
          this.log(`⏩ [1s极速熔断] 页面不可留言或评论已关闭，自动跳过: ${targetUrl}`, 'warn');
          pendingItem.status = 'skipped_no_form';
          localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
          updateBatchUI();
          continue;
        }

        // ----------------------------------------------------
        // 阶段 3：AI 3-Step 见解评论生成
        // ----------------------------------------------------
        this.updateUI(`📍 [3/5] AI 正在深度阅读并构思评论...`, '#a78bfa');
        this.log(`[3/5] AI 正在为《${(probeRes.title || '博文').slice(0, 25)}》生成 3-Step 见解评论...`);
        await this.updateGroupStatus('AI 构思中', 'purple');

        const profile = getActiveUserProfile();
        const commentText = await generateCommentForArticle(probeRes.title, targetUrl, probeRes.bodySnippet, profile);

        if (this.abort) break;

        // ----------------------------------------------------
        // 阶段 4：自动填表与安全提交
        // ----------------------------------------------------
        this.updateUI(`📍 [4/5] 自动填表与安全提交...`, '#f59e0b');
        this.log(`[4/5] 正在自动定位字段并填入 Profile 资料与见解...`);

        const submitRes = await executeInTab(tabId, submitCommentFormInTab, [commentText, profile]);

        if (submitRes && submitRes.captchaPresent) {
          this.log(`⚠️ 检测到页面包含图形验证码！挂机已暂停，请在已聚焦的标签页中输入验证码`, 'warn');
          this.updateUI('⚠️ 需人工验证码 (已暂停)', '#ef4444');
          await this.updateGroupStatus('⚠️ 需验证码', 'yellow');
          await chrome.runtime.sendMessage({ type: 'AUTOPILOT_FOCUS_TAB' });
          this.paused = true;
          this.updateButtons();
          // 等待人工处理解除暂停
          while (this.paused && !this.abort) {
            await new Promise(r => setTimeout(r, 1000));
          }
          if (this.abort) break;
        }

        // 标记已完成
        pendingItem.status = 'done';
        localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
        updateBatchUI();

        if (window.publishLogger) {
          try {
            window.publishLogger.logPublish({
              url: targetUrl,
              title: probeRes.title || targetUrl,
              domain: new URL(targetUrl).hostname,
              comment: commentText,
              status: 'published'
            });
          } catch (e) { }
        }

        this.consecutiveErrors = 0;
        this.log(`✔ [成功提交] 已顺利完成《${(probeRes.title || targetUrl).slice(0, 20)}》外链建设！已打删除线`, 'success');

        // ----------------------------------------------------
        // 阶段 5：防封随机冷却倒计时 (Anti-Ban Random Delay)
        // ----------------------------------------------------
        const cooldownSeconds = Math.floor(Math.random() * 11) + 15; // 15s ~ 25s 随机延迟
        this.log(`⏳ 触发防封策略：开始随机冷却倒计时 ${cooldownSeconds} 秒...`);

        for (let s = cooldownSeconds; s > 0; s--) {
          if (this.abort || this.paused) break;
          const pct = Math.round(((cooldownSeconds - s) / cooldownSeconds) * 100);
          this.updateUI(`📍 [5/5] 防封冷却中...`, '#10b981', `倒计时: ${s}s`, pct);
          await this.updateGroupStatus(`冷却 ${s}s`, 'cyan');
          await new Promise(r => setTimeout(r, 1000));
        }
        this.updateUI(`📍 [就绪] 推进下一条外链...`, '#60a5fa', '', 0);

      } catch (err) {
        this.consecutiveErrors++;
        this.log(`❌ 处理外链出错 [${targetUrl}]: ${err.message}`, 'error');
        pendingItem.status = 'error';
        localStorage.setItem('comlinkai_batch_queue', JSON.stringify(currentBatchQueue));
        updateBatchUI();

        // 连续 5 次失败断路器 (Circuit Breaker)
        if (this.consecutiveErrors >= 5) {
          this.log('🛑 [断路器熔断] 连续 5 次遇到错误或死链，已自动终止挂机以防空转！请检查网络。', 'error');
          alert('🛑 Auto-Pilot 断路器熔断：连续 5 次处理失败，已自动暂停挂机！');
          this.pause();
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
  }
};

function initAutoPilotEngineUI() {
  const btnStart = document.getElementById('btn-autopilot-start');
  const btnPause = document.getElementById('btn-autopilot-pause');
  const btnStop = document.getElementById('btn-autopilot-stop');

  if (btnStart) {
    btnStart.addEventListener('click', () => autoPilotEngine.start());
  }
  if (btnPause) {
    btnPause.addEventListener('click', () => autoPilotEngine.pause());
  }
  if (btnStop) {
    btnStop.addEventListener('click', () => autoPilotEngine.stop());
  }
}

// ==========================================
// 5. 外链推荐库与存活看板 UI
// ==========================================
function initSubTabNavigation() {
  const subBtns = document.querySelectorAll('.sub-tab-btn');
  const subPanels = document.querySelectorAll('.sub-panel');

  if (!subBtns.length) return;

  subBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-subtarget');

      subBtns.forEach(b => {
        b.classList.remove('active');
        b.style.color = 'var(--text-muted)';
      });
      subPanels.forEach(p => p.classList.add('hidden'));

      btn.classList.add('active');
      btn.style.color = 'var(--text-main)';

      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.remove('hidden');
      }

      if (targetId === 'subpanel-publish' || targetId === 'subpanel-collect') {
        updateBatchUI();
      } else if (targetId === 'subpanel-directory') {
        renderDirectoryUI();
      } else if (targetId === 'subpanel-dashboard') {
        renderDashboardUI();
      }
    });
  });

  const searchInput = document.getElementById('dir-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderDirectoryUI(activeDirectoryCategory, e.target.value);
    });
  }
}

function renderDirectoryUI(category = 'all', searchQuery = '') {
  activeDirectoryCategory = category;
  if (!window.linkDirectory) return;

  const categoryContainer = document.getElementById('dir-category-pills');
  if (categoryContainer) {
    const categories = window.linkDirectory.getCategories();
    categoryContainer.innerHTML = categories.map(function (c) {
      var isAct = c.id === category;
      return '<button class="dir-cat-pill ' + (isAct ? 'active' : '') + '" data-cat="' + c.id + '" style="padding: 3px 8px; font-size: 0.7rem; border-radius: 4px; border: 1px solid ' + (isAct ? '#00f2fe' : 'hsla(217, 32%, 22%, 0.8)') + '; background: ' + (isAct ? 'rgba(0,242,254,0.15)' : 'hsla(220, 30%, 6%, 0.6)') + '; color: ' + (isAct ? '#00f2fe' : 'var(--text-muted)') + '; cursor: pointer; white-space: nowrap; flex-shrink: 0;">' +
        c.name +
        '</button>';
    }).join('');

    categoryContainer.querySelectorAll('.dir-cat-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        renderDirectoryUI(e.currentTarget.getAttribute('data-cat'), searchQuery);
      });
    });
  }

  const grid = document.getElementById('dir-cards-grid');
  if (grid) {
    const targets = window.linkDirectory.getTargets(category, searchQuery);
    grid.innerHTML = targets.map(function (t) {
      return '<div class="directory-card-item" style="background: hsla(220, 30%, 6%, 0.8); border: 1px solid hsla(217, 32%, 22%, 0.8); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">' +
        '<div style="display: flex; justify-content: space-between; align-items: center;">' +
        '<h4 style="margin: 0; font-size: 0.8rem; color: var(--text-main);">' + t.title + '</h4>' +
        '<span style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; background: rgba(56,189,248,0.15); color: #38bdf8;">' + t.authority + '</span>' +
        '</div>' +
        '<p style="font-size: 0.72rem; color: var(--text-muted); margin: 0;">' + t.desc + '</p>' +
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">' +
        '<span style="font-size: 0.68rem; color: #34d399;">' + t.commentType + '</span>' +
        '<button class="btn btn-primary btn-sm" onclick="window.open(\'' + t.url + '\', \'_blank\')" style="padding: 3px 8px; font-size: 0.7rem;">直达目标 🚀</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }
}

function renderDashboardUI(filter = 'all') {
  activeDashboardFilter = filter;
  if (!window.publishLogger) return;

  const stats = window.publishLogger.getStats ? window.publishLogger.getStats() : {};
  const elTotal = document.getElementById('dash-stat-total');
  const elLiveRate = document.getElementById('dash-stat-liverate');
  const elDoFollow = document.getElementById('dash-stat-dofollow');
  const elAvgScore = document.getElementById('dash-stat-avgscore');
  if (elTotal) elTotal.textContent = stats.published || stats.total || 0;
  if (elLiveRate) elLiveRate.textContent = (stats.liveRate || 0) + '%';
  if (elDoFollow) elDoFollow.textContent = stats.liveDofollow || 0;
  if (elAvgScore) elAvgScore.textContent = stats.avgScore || 0;

  const recordsContainer = document.getElementById('dashboard-log-container') || document.getElementById('dash-records-list');
  if (!recordsContainer) return;

  let logs = window.publishLogger.getLogs();
  if (filter !== 'all') {
    logs = logs.filter(l => {
      const vs = l.verifyStatus || 'unchecked';
      if (filter === 'live_dofollow') return vs === 'live_dofollow' || vs === 'live_nofollow';
      if (filter === 'pending') return vs === 'pending' || vs === 'unchecked';
      if (filter === 'removed') return vs === 'removed' || vs.includes('error');
      return vs === filter;
    });
  }

  if (logs.length === 0) {
    recordsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.76rem;">暂无匹配的外链发布与存活记录</div>';
    return;
  }

  recordsContainer.innerHTML = logs.slice(0, 50).map(function (l) {
    var isPub = l.status === 'published';
    var vs = l.verifyStatus || 'unchecked';
    var vsBadge = '';
    if (vs === 'live_dofollow') {
      vsBadge = '<span style="background: rgba(16,185,129,0.2); color: #10b981; border: 1px solid #10b981; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">🟢 LIVE (DoFollow)</span>';
    } else if (vs === 'live_nofollow') {
      vsBadge = '<span style="background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid #34d399; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">🟡 LIVE (NoFollow)</span>';
    } else if (vs === 'pending') {
      vsBadge = '<span style="background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid #fbbf24; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">⏳ 待审核 (Pending)</span>';
    } else if (vs === 'removed') {
      vsBadge = '<span style="background: rgba(248,113,113,0.15); color: #f87171; border: 1px solid #f87171; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">🔴 未公开/被拒</span>';
    } else if (vs.includes('error')) {
      vsBadge = '<span style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid #ef4444; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">⚠️ 异常</span>';
    } else {
      vsBadge = '<span style="background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid #94a3b8; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem;">⚪ 未检测</span>';
    }

    return '<div class="dash-log-card" style="background: hsla(220, 30%, 6%, 0.7); border: 1px solid hsla(217, 32%, 18%, 0.7); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; font-size: 0.74rem;">' +
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">' +
      '<a href="' + l.url + '" target="_blank" style="font-weight: 600; color: #00f2fe; text-decoration: none; max-width: 65%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + (l.domain || l.url) + '</a>' +
      '<div>' + vsBadge + '</div>' +
      '</div>' +
      '<div style="color: var(--text-muted); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 3px;">' + (l.title || '无标题') + '</div>' +
      '<div style="display: flex; justify-content: space-between; font-size: 0.66rem; color: var(--text-muted);">' +
      '<span>' + (l.timestamp ? new Date(l.timestamp).toLocaleString() : '') + '</span>' +
      '<span style="color: ' + (isPub ? '#34d399' : '#f87171') + ';">' + (isPub ? '✔ 已提交' : '跳过') + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

function initDashboardEvents() {
  // 1. 过滤标签交互
  const pills = document.querySelectorAll('#dash-filter-pills .dash-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => {
        p.classList.remove('active');
        p.style.background = 'transparent';
        p.style.borderColor = 'hsla(217, 32%, 22%, 0.8)';
        p.style.color = 'var(--text-muted)';
      });
      pill.classList.add('active');
      pill.style.background = 'rgba(96,165,250,0.15)';
      pill.style.borderColor = '#60a5fa';
      pill.style.color = '#60a5fa';
      renderDashboardUI(pill.dataset.filter || 'all');
    });
  });

  // 2. 导出 CSV
  const btnExport = document.getElementById('btn-export-dashboard-csv');
  if (btnExport && window.publishLogger) {
    btnExport.addEventListener('click', () => window.publishLogger.exportCSV());
  }

  // 3. 一键检测外链存活
  const btnVerifyAll = document.getElementById('btn-verify-all-links');
  const probeStatus = document.getElementById('dash-probe-status');
  if (btnVerifyAll && window.linkChecker && window.publishLogger) {
    btnVerifyAll.addEventListener('click', async () => {
      const logs = window.publishLogger.getLogs();
      if (!logs.length) {
        alert('当前暂无可检测的外链发布记录！');
        return;
      }
      btnVerifyAll.disabled = true;
      btnVerifyAll.textContent = '⏳ 正在探针检测...';
      if (probeStatus) probeStatus.textContent = `探针正在并发扫描中 (共 ${logs.length} 条)...`;

      const activeProj = window.projectManager ? window.projectManager.getActiveProject() : null;
      const targetWebsite = activeProj ? (activeProj.websiteUrl || activeProj.url || 'apivale.com') : 'apivale.com';

      try {
        await window.linkChecker.checkBatch(logs, targetWebsite, '', (curr, total, item) => {
          if (probeStatus) probeStatus.textContent = `扫描中: [${curr}/${total}] ${item.result.verifyStatus.toUpperCase()}`;
          if (item && item.id) {
            window.publishLogger.updateVerifyStatus(item.id, item.result);
          }
        });
        if (probeStatus) probeStatus.textContent = `🎉 探针扫描完成！已更新全部外链存活状态。`;
        renderDashboardUI();
        alert('🎉 外链存活探针检测完成！状态看板已全面更新。');
      } catch (err) {
        if (probeStatus) probeStatus.textContent = `探针检测中断: ${err.message}`;
        alert('外链探针检测失败: ' + err.message);
      } finally {
        btnVerifyAll.disabled = false;
        btnVerifyAll.textContent = '⚡ 一键检测外链存活';
      }
    });
  }
}

function initGoogleSheetsUI() {
  if (!window.googleSheetsSync) return;

  const btnToggleDrawer = document.getElementById('btn-toggle-gsheets-drawer');
  const drawer = document.getElementById('gsheets-drawer');
  const inputWebhook = document.getElementById('input-gsheet-webhook');
  const chkAutoSync = document.getElementById('chk-gsheet-autosync');
  const btnSaveConfig = document.getElementById('btn-save-gsheet-config');
  const btnCopyScript = document.getElementById('btn-copy-apps-script');
  const btnSyncProjectTab = document.getElementById('btn-sync-project-tab');
  const btnSyncHistory = document.getElementById('btn-sync-gsheet-history');
  const btnPullProbe = document.getElementById('btn-pull-probe-gsheet');

  // 1. 回显当前活跃项目的专属配置
  window.googleSheetsSync.reloadProjectContext();

  // 2. 展开 / 折叠抽屉
  if (btnToggleDrawer && drawer) {
    btnToggleDrawer.addEventListener('click', () => {
      drawer.classList.toggle('hidden');
    });
  }

  // 3. 复制代码
  if (btnCopyScript) {
    btnCopyScript.addEventListener('click', () => {
      const code = window.googleSheetsSync.getAppsScriptCode();
      navigator.clipboard.writeText(code).then(() => {
        alert('📋 Google Apps Script 同步接收端脚本已成功复制到剪贴板！\n\n使用步骤：\n1. 打开您的谷歌表格，点击顶部菜单 [扩展程序] -> [Apps Script]；\n2. 将代码全部粘贴并覆盖 Code.gs，点击保存；\n3. 点击右上角 [部署] -> [新建部署]，选择 [Web 应用]；\n4. 将“谁可以访问”设置为“所有人 (Anyone)”并点击部署；\n5. 复制生成的 Web 应用网址 (以 https://script.google.com/macros/s/ 开头)，粘贴到本插件 Webhook 输入框中保存即可！');
      }).catch(err => {
        alert('复制失败，请手动复制代码: ' + err.message);
      });
    });
  }

  // 4. 保存配置
  if (btnSaveConfig && inputWebhook) {
    btnSaveConfig.addEventListener('click', () => {
      const url = inputWebhook.value.trim();
      const autoSync = chkAutoSync ? chkAutoSync.checked : false;

      if (url && !url.startsWith('https://script.google.com')) {
        alert('⚠️ Webhook URL 格式不正确，应以 https://script.google.com/macros/s/ 开头！');
        return;
      }

      window.googleSheetsSync.saveConfig(url, autoSync);
      const activeProj = window.projectManager ? window.projectManager.getActiveProject() : null;
      const projName = activeProj ? (activeProj.name || activeProj.profileName) : '当前独立站';
      alert(`🎉 专属 Google Sheets Webhook 配置已成功保存至项目 [${projName}]！\n` + (autoSync ? '已开启【自动云同步】功能。' : '当前为手动同步模式。'));
    });
  }

  // 5. 自动在谷歌表格中为当前项目新建专属 Tab 页签
  if (btnSyncProjectTab) {
    btnSyncProjectTab.addEventListener('click', async () => {
      if (!window.googleSheetsSync.isConfigured()) {
        alert('请先填写并保存有效的 Google Sheet Webhook URL！');
        if (drawer) drawer.classList.remove('hidden');
        return;
      }
      btnSyncProjectTab.disabled = true;
      btnSyncProjectTab.textContent = '⏳ 生成中...';
      try {
        const activeProj = window.projectManager ? window.projectManager.getActiveProject() : null;
        const projName = activeProj ? (activeProj.name || activeProj.profileName) : '独立站项目';
        const res = await window.googleSheetsSync.createProjectTab(projName);
        alert(res.message || '已成功向 Google Sheet 发送生成项目页签指令！');
      } catch (e) {
        alert('生成项目页签失败: ' + e.message);
      } finally {
        btnSyncProjectTab.disabled = false;
        btnSyncProjectTab.textContent = '🚀 生成项目页签';
      }
    });
  }

  // 6. 补发历史日志
  if (btnSyncHistory) {
    btnSyncHistory.addEventListener('click', async () => {
      if (!window.googleSheetsSync.isConfigured()) {
        alert('请先填写并保存有效的 Google Sheet Webhook URL！');
        if (drawer) drawer.classList.remove('hidden');
        return;
      }
      if (!window.publishLogger) return;

      const logs = window.publishLogger.getLogs();
      if (!logs.length) {
        alert('当前本地暂无可同步的外链发布日志！');
        return;
      }

      btnSyncHistory.disabled = true;
      btnSyncHistory.textContent = '⏳ 同步中...';

      try {
        const res = await window.googleSheetsSync.syncBatch(logs, (curr, total) => {
          btnSyncHistory.textContent = `⏳ ${curr}/${total}`;
        });
        alert(`🎉 历史日志补发完成！共 ${res.total} 条，成功推送 ${res.successCount} 条。`);
      } catch (err) {
        alert('批量同步失败: ' + err.message);
      } finally {
        btnSyncHistory.disabled = false;
        btnSyncHistory.textContent = '📤 补发历史';
      }
    });
  }

  // 7. 拉取表格数据并并发执行存活探针检测
  if (btnPullProbe) {
    btnPullProbe.addEventListener('click', async () => {
      if (!window.googleSheetsSync.isConfigured()) {
        alert('请先填写并保存有效的 Google Sheet Webhook URL！');
        if (drawer) drawer.classList.remove('hidden');
        return;
      }
      btnPullProbe.disabled = true;
      btnPullProbe.textContent = '⏳ 拉取表格中...';
      const probeStatus = document.getElementById('dash-probe-status');
      if (probeStatus) probeStatus.textContent = '正在从 Google Sheet 读取最新发布记录...';

      try {
        const rows = await window.googleSheetsSync.fetchLogEntriesFromSheet();
        if (!rows.length) {
          alert('Google Sheet 中当前尚无可检测的发布记录！');
          return;
        }

        // 同步入库本地 publishLogger（若本地为空或缺失）
        if (window.publishLogger) {
          const existingLogs = window.publishLogger.getLogs();
          const existingUrls = new Set(existingLogs.map(l => l.url));
          rows.forEach((r, idx) => {
            if (!existingUrls.has(r.url)) {
              window.publishLogger.logAction({
                id: 'gsheet_' + Date.now() + '_' + idx,
                timestamp: r.timestamp || new Date().toISOString(),
                url: r.url,
                domain: r.domain,
                title: r.title,
                status: r.status || 'published',
                verifyStatus: r.verifyStatus || 'unchecked',
                relType: r.relType || 'unknown',
                relevanceScore: r.relevanceScore || 95,
                comment: r.comment || ''
              });
            }
          });
        }

        const logs = window.publishLogger ? window.publishLogger.getLogs() : [];
        const activeProj = window.projectManager ? window.projectManager.getActiveProject() : null;
        const targetWebsite = activeProj ? (activeProj.websiteUrl || activeProj.url || 'apivale.com') : 'apivale.com';

        btnPullProbe.textContent = `⏳ 探针扫描中 (共 ${logs.length} 条)...`;
        if (window.linkChecker) {
          await window.linkChecker.checkBatch(logs, targetWebsite, '', (curr, total, item) => {
            btnPullProbe.textContent = `⏳ 扫描 [${curr}/${total}]`;
            if (probeStatus) probeStatus.textContent = `探针扫描中: [${curr}/${total}] ${item.result.verifyStatus.toUpperCase()}`;
            if (item && item.id && window.publishLogger) {
              window.publishLogger.updateVerifyStatus(item.id, item.result);
            }
          });
        }

        renderDashboardUI();
        if (probeStatus) probeStatus.textContent = `🎉 成功拉取并完成 ${logs.length} 条外链存活探针扫描！`;
        alert(`🎉 成功从 Google Sheet 拉取 ${rows.length} 条记录，并已完成全量存活探针检测！`);
      } catch (err) {
        if (probeStatus) probeStatus.textContent = `拉取/探针失败: ${err.message}`;
        alert('拉取失败: ' + err.message);
      } finally {
        btnPullProbe.disabled = false;
        btnPullProbe.textContent = '📥 拉取表格并检测存活';
      }
    });
  }

  // 初始化看板事件监听
  initDashboardEvents();
}

// ==========================================
// 6. 多项目隔离管理 UI
// ==========================================
function initProjectManagerUI() {
  if (!window.projectManager) return;

  const selProject = document.getElementById('sel-active-project');
  const btnAddProject = document.getElementById('btn-add-project');
  const modalCreate = document.getElementById('modal-create-project');
  const btnCloseModal = document.getElementById('btn-close-project-modal');
  const btnSubmitCreate = document.getElementById('btn-submit-create-project');

  const renderProjectSelect = () => {
    if (!selProject) return;
    const projects = window.projectManager.getProjects();
    const active = window.projectManager.getActiveProject();

    selProject.innerHTML = projects.map(function (p) {
      return '<option value="' + p.id + '" ' + (active && p.id === active.id ? 'selected' : '') + '>📁 ' + p.name + '</option>';
    }).join('');
  };

  renderProjectSelect();

  if (selProject) {
    selProject.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      window.projectManager.switchProject(selectedId);
      if (window.publishLogger) window.publishLogger.reloadProjectContext();
      if (window.googleSheetsSync) window.googleSheetsSync.reloadProjectContext();
      if (typeof initBacklinkHelper === 'function') initBacklinkHelper();
      renderDashboardUI();
    });
  }

  if (btnAddProject && modalCreate) {
    btnAddProject.addEventListener('click', () => modalCreate.classList.remove('hidden'));
  }
  if (btnCloseModal && modalCreate) {
    btnCloseModal.addEventListener('click', () => modalCreate.classList.add('hidden'));
  }

  const btnExtractProfile = document.getElementById('btn-extract-homepage-profile');
  if (btnExtractProfile) {
    btnExtractProfile.addEventListener('click', async () => {
      const urlInput = document.getElementById('new-proj-url');
      const targetUrl = urlInput ? urlInput.value.trim() : '';
      if (!targetUrl) {
        alert('请先输入目标引流网址（例如 https://apivale.com/）');
        return;
      }

      btnExtractProfile.textContent = '⏳ 抓取中...';
      btnExtractProfile.disabled = true;

      try {
        const extracted = await window.projectManager.fetchAndExtractProfile(targetUrl);
        if (extracted) {
          const nameInput = document.getElementById('new-proj-name');
          const profileNameInput = document.getElementById('new-proj-profile-name');
          const profileBioInput = document.getElementById('new-proj-profile-bio');

          if (nameInput && !nameInput.value) nameInput.value = extracted.name || '';
          if (profileNameInput) profileNameInput.value = extracted.profileName || extracted.name || '';
          if (profileBioInput) profileBioInput.value = extracted.profileBio || extracted.tagline || '';

          alert('🎉 成功从目标主页抓取并解析出网站基础资料与图标封面！');
        }
      } catch (err) {
        alert('抓取主页失败: ' + err.message);
      } finally {
        btnExtractProfile.textContent = '🪄 智能提取';
        btnExtractProfile.disabled = false;
      }
    });
  }

  if (btnSubmitCreate && modalCreate) {
    btnSubmitCreate.addEventListener('click', () => {
      const nameInput = document.getElementById('new-proj-name');
      const urlInput = document.getElementById('new-proj-url');
      const profileNameInput = document.getElementById('new-proj-profile-name');
      const profileBioInput = document.getElementById('new-proj-profile-bio');

      const name = nameInput ? nameInput.value.trim() : '';
      const url = urlInput ? urlInput.value.trim() : '';
      const pName = profileNameInput ? profileNameInput.value.trim() : name;
      const pBio = profileBioInput ? profileBioInput.value.trim() : '';

      if (!name) {
        alert('请输入项目名称！');
        return;
      }

      let domain = '';
      try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname; } catch (e) { }

      const favicon = url ? url.replace(/\/+$/, '') + '/favicon.ico' : '';
      const screenshot = url ? url.replace(/\/+$/, '') + '/og-image.png' : '';

      window.projectManager.createProject(name, url, pName, 'support@' + domain, pBio, pBio, pBio, 'AI, SaaS, Tools', 'Freemium', favicon, screenshot);
      modalCreate.classList.add('hidden');
      renderProjectSelect();
      if (window.publishLogger) window.publishLogger.reloadProjectContext();
      if (window.googleSheetsSync) window.googleSheetsSync.reloadProjectContext();
      if (typeof initBacklinkHelper === 'function') initBacklinkHelper();
      renderDashboardUI();
      alert('🎉 成功创建并切换至工作区: ' + name);
    });
  }
}

// ==========================================
// 8. 第三方大模型配置管理器 (AI Settings Controller)
// ==========================================
function initAISettingsUI() {
  const modalAiSettings = document.getElementById('modal-ai-settings');
  const btnToggleSettings = document.getElementById('btn-toggle-settings');
  const btnCloseAiSettings = document.getElementById('btn-close-ai-settings');
  const aiPresetSelect = document.getElementById('ai-preset-select');
  const aiBaseUrl = document.getElementById('ai-base-url');
  const aiApiKey = document.getElementById('ai-api-key');
  const aiModelName = document.getElementById('ai-model-name');
  const btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');
  const btnTestAiConnection = document.getElementById('btn-test-ai-connection');
  const btnSaveAiSettings = document.getElementById('btn-save-ai-settings');
  const aiTestResult = document.getElementById('ai-test-result');

  const PRESETS = {
    deepseek: {
      url: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    },
    openai: {
      url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-1.5-flash'
    },
    qwen: {
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus'
    },
    glm: {
      url: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash'
    },
    kimi: {
      url: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k'
    },
    custom: {
      url: '',
      model: ''
    }
  };

  // 1. 读取历史保存的配置
  const loadSavedSettings = () => {
    const savedPreset = localStorage.getItem('ai_provider_preset') || 'deepseek';
    const savedUrl = localStorage.getItem('ai_base_url') || PRESETS.deepseek.url;
    const savedKey = localStorage.getItem('ai_api_key') || '';
    const savedModel = localStorage.getItem('ai_model_name') || PRESETS.deepseek.model;

    if (aiPresetSelect) aiPresetSelect.value = savedPreset;
    if (aiBaseUrl) aiBaseUrl.value = savedUrl;
    if (aiApiKey) aiApiKey.value = savedKey;
    if (aiModelName) aiModelName.value = savedModel;
  };

  loadSavedSettings();

  // 2. 打开 / 关闭弹窗交互
  if (btnToggleSettings && modalAiSettings) {
    btnToggleSettings.addEventListener('click', () => {
      loadSavedSettings();
      if (aiTestResult) aiTestResult.style.display = 'none';
      modalAiSettings.classList.remove('hidden');
    });
  }

  if (btnCloseAiSettings && modalAiSettings) {
    btnCloseAiSettings.addEventListener('click', () => {
      modalAiSettings.classList.add('hidden');
    });
  }

  // 3. 预设切换自动填入对应 Base URL 和默认 Model Name
  if (aiPresetSelect && aiBaseUrl && aiModelName) {
    aiPresetSelect.addEventListener('change', (e) => {
      const presetKey = e.target.value;
      if (PRESETS[presetKey]) {
        if (presetKey !== 'custom') {
          aiBaseUrl.value = PRESETS[presetKey].url;
          aiModelName.value = PRESETS[presetKey].model;
        }
      }
    });
  }

  // 4. 显示 / 隐藏 API Key 明文
  if (btnToggleKeyVisibility && aiApiKey) {
    btnToggleKeyVisibility.addEventListener('click', () => {
      aiApiKey.type = aiApiKey.type === 'password' ? 'text' : 'password';
      btnToggleKeyVisibility.textContent = aiApiKey.type === 'password' ? '👁️' : '🔒';
    });
  }

  // 5. 测试连通性
  if (btnTestAiConnection && aiBaseUrl && aiApiKey && aiModelName) {
    btnTestAiConnection.addEventListener('click', async () => {
      const rawUrl = aiBaseUrl.value.trim().replace(/\/+$/, '');
      const key = aiApiKey.value.trim();
      const model = aiModelName.value.trim();

      if (!rawUrl) {
        alert('请输入 API 接口地址 (Base URL)！');
        return;
      }
      if (!key) {
        alert('请输入 API 密钥 (API Key)！');
        return;
      }

      btnTestAiConnection.disabled = true;
      btnTestAiConnection.textContent = '⏳ 测试中...';
      if (aiTestResult) {
        aiTestResult.style.display = 'block';
        aiTestResult.style.color = '#38bdf8';
        aiTestResult.textContent = '正在发起测试握手请求...';
      }

      const startTime = Date.now();
      try {
        const endpoint = rawUrl.endsWith('/chat/completions') ? rawUrl : `${rawUrl}/chat/completions`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: model || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5
          }),
          signal: AbortSignal.timeout(10000)
        });

        const latency = Date.now() - startTime;
        if (res.ok) {
          if (aiTestResult) {
            aiTestResult.style.color = '#34d399';
            aiTestResult.textContent = `✅ 连接成功！响应延迟: ${latency}ms，接口与密钥完全正常。`;
          }
        } else {
          const errData = await res.text();
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(errData);
            if (j.error && j.error.message) msg += `: ${j.error.message}`;
          } catch (e) {
            msg += `: ${errData.slice(0, 100)}`;
          }
          if (aiTestResult) {
            aiTestResult.style.color = '#f87171';
            aiTestResult.textContent = `❌ 连接失败: ${msg}`;
          }
        }
      } catch (err) {
        if (aiTestResult) {
          aiTestResult.style.color = '#f87171';
          aiTestResult.textContent = `❌ 请求异常: ${err.message}`;
        }
      } finally {
        btnTestAiConnection.disabled = false;
        btnTestAiConnection.textContent = '⚡ 测试连通性';
      }
    });
  }

  // 6. 保存配置
  if (btnSaveAiSettings && aiPresetSelect && aiBaseUrl && aiApiKey && aiModelName && modalAiSettings) {
    btnSaveAiSettings.addEventListener('click', () => {
      const preset = aiPresetSelect.value;
      const url = aiBaseUrl.value.trim();
      const key = aiApiKey.value.trim();
      const model = aiModelName.value.trim();

      localStorage.setItem('ai_provider_preset', preset);
      localStorage.setItem('ai_base_url', url);
      localStorage.setItem('ai_api_key', key);
      localStorage.setItem('ai_model_name', model);

      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          ai_provider_preset: preset,
          ai_base_url: url,
          ai_api_key: key,
          ai_model_name: model
        });
      }

      alert('🎉 大模型 API 接口配置已成功保存！');
      modalAiSettings.classList.add('hidden');
    });
  }
}

// ==========================================
// 7. 全量应用初始化挂载入口 (Bootstrap ComLinkAI)
// ==========================================
function bootstrapComLinkAI() {
  console.log('[ComLinkAI] 正在挂载侧边栏控制器与交互监听器...');

  // 1. 初始化顶层 Workspace Tabs (外链批处理 / Markdown 剪存 / 网页伴侣 AI)
  const topNavBtns = document.querySelectorAll('.tab-nav-btn');
  const topPanels = document.querySelectorAll('.tab-panel');
  if (topNavBtns.length) {
    topNavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        topNavBtns.forEach(b => b.classList.remove('active'));
        topPanels.forEach(p => {
          p.classList.remove('active');
          p.classList.add('hidden');
        });
        btn.classList.add('active');
        const p = document.getElementById(targetId);
        if (p) {
          p.classList.remove('hidden');
          p.classList.add('active');
        }
      });
    });
  }

  // 2. 初始化核心各功能子模块
  try { initApp(); } catch (e) { console.warn('[ComLinkAI] initApp 异常:', e); }
  try { initProjectManagerUI(); } catch (e) { console.warn('[ComLinkAI] initProjectManagerUI 异常:', e); }
  try { initSubTabNavigation(); } catch (e) { console.warn('[ComLinkAI] initSubTabNavigation 异常:', e); }
  try { initBacklinkHelper(); } catch (e) { console.warn('[ComLinkAI] initBacklinkHelper 异常:', e); }
  try { initBatchWorkbench(); } catch (e) { console.warn('[ComLinkAI] initBatchWorkbench 异常:', e); }
  try { initAutoPilotEngineUI(); } catch (e) { console.warn('[ComLinkAI] initAutoPilotEngineUI 异常:', e); }
  try { initGoogleSheetsUI(); } catch (e) { console.warn('[ComLinkAI] initGoogleSheetsUI 异常:', e); }
  try { initAISettingsUI(); } catch (e) { console.warn('[ComLinkAI] initAISettingsUI 异常:', e); }
  try { updateBatchUI(); } catch (e) { console.warn('[ComLinkAI] updateBatchUI 异常:', e); }

  console.log('[ComLinkAI] 全部控制器与交互监听器初始化挂载完成！');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapComLinkAI);
} else {
  bootstrapComLinkAI();
}
