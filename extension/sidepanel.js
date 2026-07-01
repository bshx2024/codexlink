// ==========================================================================
// CodexLink Sidepanel Controller (稳定长连接 + 叶子块累计抓取 + AI 对话流式联动版)
// ==========================================================================

const LOCAL_SERVER_WS = 'ws://localhost:3010';
let ws = null;
let isConnected = false;
let reconnectTimer = null;

// 全局变量用于存储当前已抓取网页的上下文内容，供 Chat 联动使用
let currentExtractedContent = null;
let chatHistory = [];

// DOM 元素引用
const connectionBadge = document.getElementById('connection-badge');
const statusDesc = document.getElementById('status-desc');
const statusProgress = document.getElementById('status-progress');
const startupGuideTrigger = document.getElementById('startup-guide-trigger');
const startupGuideContent = document.getElementById('startup-guide-content');

const tabTitleEl = document.getElementById('tab-title');
const tabUrlEl = document.getElementById('tab-url');
const btnRefresh = document.getElementById('btn-refresh');

const btnFetch = document.getElementById('btn-fetch');
const charCountEl = document.getElementById('char-count');
const markdownPlaceholder = document.getElementById('markdown-placeholder');
const markdownPreview = document.getElementById('markdown-preview');

// Obsidian 剪存 DOM 元素
const obsidianActions = document.getElementById('obsidian-actions');
const btnSaveObsidian = document.getElementById('btn-save-obsidian');
const btnAiSaveObsidian = document.getElementById('btn-ai-save-obsidian');

// 单机模式运行状态与目录句柄全局变量
let opMode = 'ws_bridge'; // 'ws_bridge' 或 'standalone'
let vaultDirectoryHandle = null;

// ==========================================
// IndexedDB 目录句柄持久化辅助方法
// ==========================================
const DB_NAME = 'CodexLinkDB';
const STORE_NAME = 'handles';

function saveDirectoryHandle(handle) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(handle, 'vaultDir');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function loadDirectoryHandle() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('vaultDir');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function verifyPermission(fileHandle, readWrite) {
  const options = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }
  try {
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
  } catch (e) {
    console.warn('获取目录权限异常:', e);
  }
  return false;
}

// ==========================================
// 1. 初始化入口
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 1.1 初始化活跃标签页预览
  updateActiveTabInfo();

  // 1.2 启动与本地 Node.js 桥接服务的 WebSocket 连接
  connectWebSocket();

  // 1.2.1 绑定运行模式及直写目录授权逻辑
  const selOpMode = document.getElementById('sel-op-mode');
  const bridgeModeUi = document.getElementById('bridge-mode-ui');
  const standaloneModeUi = document.getElementById('standalone-mode-ui');
  const btnChooseDir = document.getElementById('btn-choose-dir');
  const dirStatusText = document.getElementById('dir-status-text');

  // 读取已保存的模式
  const savedMode = localStorage.getItem('op_mode') || 'ws_bridge';
  opMode = savedMode;
  selOpMode.value = opMode;

  if (opMode === 'standalone') {
    bridgeModeUi.classList.add('hidden');
    standaloneModeUi.classList.remove('hidden');
  } else {
    bridgeModeUi.classList.remove('hidden');
    standaloneModeUi.classList.add('hidden');
  }

  // 尝试加载 IndexedDB 内持久化的目录句柄
  loadDirectoryHandle().then(async (handle) => {
    if (handle) {
      vaultDirectoryHandle = handle;
      const hasPerm = await verifyPermission(handle, true);
      if (hasPerm) {
        dirStatusText.textContent = `已授权: ${handle.name}`;
      } else {
        dirStatusText.textContent = `点击重新授权: ${handle.name}`;
      }
    } else {
      dirStatusText.textContent = '未选择目录';
    }
    updateUIStatus(isConnected ? 'connected' : 'disconnected');
  }).catch(e => {
    console.error('加载本地持久化目录失败:', e);
    updateUIStatus(isConnected ? 'connected' : 'disconnected');
  });

  // 监听运行模式切换
  selOpMode.addEventListener('change', (e) => {
    opMode = e.target.value;
    localStorage.setItem('op_mode', opMode);
    if (opMode === 'standalone') {
      bridgeModeUi.classList.add('hidden');
      standaloneModeUi.classList.remove('hidden');
    } else {
      bridgeModeUi.classList.remove('hidden');
      standaloneModeUi.classList.add('hidden');
    }
    updateUIStatus(isConnected ? 'connected' : 'disconnected');
  });

  // 监听文件夹选择按钮
  btnChooseDir.addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      vaultDirectoryHandle = handle;
      await saveDirectoryHandle(handle);
      dirStatusText.textContent = `已授权: ${handle.name}`;
      updateUIStatus(isConnected ? 'connected' : 'disconnected');
    } catch (err) {
      console.warn('选择目录操作取消或失败:', err);
    }
  });

  // 1.3 绑定网页抓取按钮事件
  btnRefresh.addEventListener('click', () => {
    updateActiveTabInfo();
    btnRefresh.style.transform = 'rotate(360deg)';
    setTimeout(() => btnRefresh.style.transform = 'none', 500);
  });
  
  btnFetch.addEventListener('click', triggerContentExtraction);

  // 绑定 Obsidian 剪存按钮事件
  btnSaveObsidian.addEventListener('click', saveToObsidianHandler);
  btnAiSaveObsidian.addEventListener('click', aiSaveToObsidianHandler);

  // 1.4 绑定开机自启引导点击折叠事件
  startupGuideTrigger.addEventListener('click', () => {
    startupGuideContent.classList.toggle('hidden');
    const isHidden = startupGuideContent.classList.contains('hidden');
    startupGuideTrigger.querySelector('span').textContent = `💡 想要开机自动秒连？点击${isHidden ? '查看' : '收起'}`;
  });

  // 1.5 初始化 AI 网页伴侣 Chat 对话框控制器
  initChatController();
});

// ==========================================
// 2. 实时监测浏览器标签页切换，同步显示信息
// ==========================================
chrome.tabs.onActivated.addListener(() => {
  updateActiveTabInfo();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateActiveTabInfo();
  }
});

// 获取并更新 UI 上的活跃标签页信息
async function updateActiveTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      tabTitleEl.textContent = tab.title || '无标题网页';
      tabUrlEl.textContent = tab.url || '无法获取链接';
      
      // 系统内置网页限制
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        btnFetch.disabled = true;
        btnFetch.querySelector('span').textContent = '系统网页无法提取内容';
      } else {
        if (isConnected || opMode === 'standalone') {
          btnFetch.disabled = false;
          btnFetch.querySelector('span').textContent = '提取并预览网页 Markdown';
        } else {
          btnFetch.disabled = true;
          btnFetch.querySelector('span').textContent = '等待中转桥接服务连接...';
        }
      }
    }
  } catch (err) {
    console.error('更新标签页信息失败:', err);
    tabTitleEl.textContent = '无法获取当前网页';
    tabUrlEl.textContent = err.message;
  }
}

// ==========================================
// 2.5 浏览器网页自动化操控注入函数
// ==========================================
async function executeInActiveTab(func, args = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('未检测到打开的活跃网页。');
  }
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    throw new Error('系统内置网页无法进行自动化操作。');
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func,
    args: args
  });
  if (results && results[0]) {
    return results[0].result;
  }
  throw new Error('自动化脚本执行未返回任何结果。');
}

// 模拟人类真实点击事件的注入函数
function simulateClick(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: `未找到选择器对应的元素: ${selector}` };
  
  el.focus && el.focus();
  
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  
  const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
  el.dispatchEvent(new MouseEvent('click', opts));
  
  return { success: true };
}

// 模拟输入文本并触发框架事件的注入函数
function simulateType(selector, text) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: `未找到选择器对应的元素: ${selector}` };
  
  el.focus && el.focus();
  el.value = text;
  
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { success: true };
}

// 模拟页面滚动的注入函数
function simulateScroll(direction, amount) {
  const scrollX = direction === 'right' ? amount : (direction === 'left' ? -amount : 0);
  const scrollY = direction === 'down' ? amount : (direction === 'up' ? -amount : 0);
  
  window.scrollBy(scrollX, scrollY);
  return { success: true, scrollTop: window.scrollY, scrollLeft: window.scrollX };
}

// 模拟键盘按键的注入函数
function simulateKeypress(keyCombo) {
  const parts = keyCombo.split('+');
  const mainKey  = parts[parts.length - 1];
  const ctrlKey  = parts.some(p => p.toLowerCase() === 'ctrl');
  const shiftKey = parts.some(p => p.toLowerCase() === 'shift');
  const altKey   = parts.some(p => p.toLowerCase() === 'alt');
  const metaKey  = parts.some(p => ['meta', 'cmd', 'command'].includes(p.toLowerCase()));

  const keyMap = {
    enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
    backspace: 'Backspace', delete: 'Delete', del: 'Delete',
    arrowup: 'ArrowUp', up: 'ArrowUp', arrowdown: 'ArrowDown', down: 'ArrowDown',
    arrowleft: 'ArrowLeft', left: 'ArrowLeft', arrowright: 'ArrowRight', right: 'ArrowRight',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', space: ' ',
    f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
    f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12'
  };

  const resolvedKey = keyMap[mainKey.toLowerCase()] || mainKey;
  const target = document.activeElement || document.body;
  const opts = {
    key: resolvedKey, code: resolvedKey,
    ctrlKey, shiftKey, altKey, metaKey,
    bubbles: true, cancelable: true
  };

  target.dispatchEvent(new KeyboardEvent('keydown',  opts));
  target.dispatchEvent(new KeyboardEvent('keypress', opts));
  target.dispatchEvent(new KeyboardEvent('keyup',    opts));

  return { success: true, key: resolvedKey, ctrlKey, shiftKey, altKey, metaKey };
}

// 等待指定 CSS 选择器元素出现的注入函数（异步轮询）
async function pollForSelector(selector, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  return new Promise((resolve) => {
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) {
        resolve({ success: true, found: true, selector });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ success: false, found: false, selector, reason: 'timeout' });
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

// 获取网页中所有可见交互元素的注入函数
function getInteractiveElements() {
  const items = [];
  const els = document.querySelectorAll('button, input, select, textarea, a, [role="button"], [onclick]');
  
  els.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return;
    
    let selector = '';
    if (el.id) {
      selector = `#${el.id}`;
    } else {
      const tagName = el.tagName.toLowerCase();
      const classes = el.className ? '.' + Array.from(el.classList).filter(c => typeof c === 'string' && c.trim() && !el.className.includes(':') && !c.includes(':')).join('.') : '';
      selector = tagName + classes;
      
      try {
        if (document.querySelectorAll(selector).length > 1) {
          const matches = Array.from(document.querySelectorAll(selector));
          const idx = matches.indexOf(el);
          if (idx !== -1) {
            selector = `${selector}:nth-of-type(${idx + 1})`;
          }
        }
      } catch (e) {}
    }
    
    items.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      text: el.innerText ? el.innerText.trim().substring(0, 100) : '',
      placeholder: el.getAttribute('placeholder') || '',
      href: el.getAttribute('href') || '',
      selector: selector,
      type: el.getAttribute('type') || ''
    });
  });
  
  return items.slice(0, 100);
}

// 截取当前活跃标签页的可见区域截图
async function captureTabScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('未检测到打开的活跃网页。');
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!dataUrl) {
        reject(new Error('截图返回为空。'));
      } else {
        resolve({ dataUrl });
      }
    });
  });
}

// 等待页面加载完成
async function waitForTabLoad(timeoutMs = 10000) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('未检测到打开的活跃网页。');
  
  if (tab.status === 'complete') {
    return { loaded: true, elapsed: 0 };
  }
  
  const startTime = Date.now();
  return new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ loaded: true, elapsed: Date.now() - startTime });
      }
    };
    
    chrome.tabs.onUpdated.addListener(listener);
    
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ loaded: false, elapsed: Date.now() - startTime });
    }, timeoutMs);
  });
}

// ==========================================
// 3. WebSocket 核心连接与重连逻辑 (常驻 Sidepanel)
// ==========================================
function connectWebSocket() {
  if (opMode !== 'ws_bridge') {
    updateUIStatus('disconnected');
    return;
  }
  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  updateUIStatus('disconnected');
  console.log('正在尝试连接本地服务: ' + LOCAL_SERVER_WS);
  ws = new WebSocket(LOCAL_SERVER_WS);

  ws.onopen = () => {
    console.log('成功连接到 CodexLink 本地桥接服务！');
    isConnected = true;
    updateUIStatus('connected');
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      const { id, action, data } = payload;
      console.log(`[WebSocket] 收到指令: ${action}`, data);

      if (action === 'navigate') {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('未检测到活跃标签页');
          await chrome.tabs.update(tab.id, { url: data.url });
          ws.send(JSON.stringify({ id, type: 'response', data: { success: true } }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'getActiveTab') {
        try {
          const tabData = await fetchActiveTabContent();
          ws.send(JSON.stringify({ id, type: 'response', data: tabData }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'click') {
        try {
          const res = await executeInActiveTab(simulateClick, [data.selector]);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'type') {
        try {
          const res = await executeInActiveTab(simulateType, [data.selector, data.text]);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'scroll') {
        try {
          const res = await executeInActiveTab(simulateScroll, [data.direction, data.amount]);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'keypress') {
        try {
          const res = await executeInActiveTab((selector, key) => {
            if (selector) {
              const el = document.querySelector(selector);
              if (el) el.focus();
            }
            return simulateKeypress(key);
          }, [data.selector, data.key]);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'screenshot') {
        try {
          const res = await captureTabScreenshot();
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'waitForElement') {
        try {
          const res = await executeInActiveTab(pollForSelector, [data.selector, data.timeout]);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'waitForLoad') {
        try {
          const res = await waitForTabLoad(data.timeout);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      } else if (action === 'getElements') {
        try {
          const res = await executeInActiveTab(getInteractiveElements, []);
          ws.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (err) {
          ws.send(JSON.stringify({ id, type: 'response', error: err.message }));
        }
      }
    } catch (err) {
      console.error('处理服务器消息时出错:', err);
    }
  };

  ws.onclose = () => {
    console.log('与本地服务的连接断开，即将启动自动重连。');
    isConnected = false;
    updateUIStatus('disconnected');
    startReconnectLoop();
  };

  ws.onerror = (err) => {
    console.error('WebSocket 发生错误:', err);
    isConnected = false;
    updateUIStatus('disconnected');
  };
}

// 自动重连循环 (每 3 秒检测一次)
function startReconnectLoop() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    if (opMode === 'ws_bridge' && !isConnected) {
      connectWebSocket();
    }
  }, 3000);
}

// 更新连接状态 UI
function updateUIStatus(status) {
  const badgeText = connectionBadge.querySelector('.badge-text');
  
  if (opMode === 'standalone') {
    connectionBadge.className = 'badge badge-connected';
    badgeText.textContent = '单机模式';
    
    if (vaultDirectoryHandle) {
      statusDesc.innerHTML = `已选择 Vault 目录: <code>${vaultDirectoryHandle.name}</code>`;
    } else {
      statusDesc.innerHTML = `<span style="color: #fbbf24;">⚠️ 请点击下方按钮选择您的 Obsidian 库目录</span>`;
    }
    
    statusProgress.className = 'progress-bar progress-bar-connected';
    statusProgress.style.width = '100%';
    
    // 隐藏开机自启引导
    startupGuideTrigger.classList.add('hidden');
    startupGuideContent.classList.add('hidden');
    
    // 激活提取按钮
    updateActiveTabInfo();
    return;
  }

  if (status === 'connected') {
    connectionBadge.className = 'badge badge-connected';
    badgeText.textContent = '已连接';
    statusDesc.innerHTML = '本地中转服务运行良好: <code>ws://localhost:3010</code>';
    
    statusProgress.className = 'progress-bar progress-bar-connected';
    statusProgress.style.width = '100%';
    
    // 隐藏开机自启引导
    startupGuideTrigger.classList.add('hidden');
    startupGuideContent.classList.add('hidden');
    
    // 如果不是系统内置页面，则激活提取按钮
    updateActiveTabInfo();
  } else {
    connectionBadge.className = 'badge badge-disconnected';
    badgeText.textContent = '未连接';
    statusDesc.innerHTML = '正在寻找本地服务 <code>ws://localhost:3010</code>... 请运行 run-server.ps1 脚本。';
    
    statusProgress.className = 'progress-bar progress-bar-disconnected';
    statusProgress.style.width = '15%';
    btnFetch.disabled = true;
    
    // 展现开机自启引导
    startupGuideTrigger.classList.remove('hidden');
  }
}

// ==========================================
// 4. 手动提取内容与 UI 渲染
// ==========================================
async function triggerContentExtraction() {
  btnFetch.disabled = true;
  btnFetch.querySelector('span').textContent = '正在提取正文中...';
  
  markdownPlaceholder.className = 'placeholder-text';
  markdownPlaceholder.textContent = '正在抓取已渲染的网页 DOM 并转换为结构化 Markdown...';
  markdownPreview.className = 'markdown-preview-area hidden';

  try {
    const tabData = await fetchActiveTabContent();
    currentExtractedContent = tabData; // 存入全局缓存
    renderMarkdownPreview(tabData);
  } catch (err) {
    charCountEl.textContent = '0 字';
    markdownPlaceholder.className = 'placeholder-text';
    markdownPlaceholder.innerHTML = `<span style="color: #f87171;">手动提取失败！</span><br>${err.message}`;
  } finally {
    btnFetch.disabled = false;
    btnFetch.querySelector('span').textContent = '提取并预览网页 Markdown';
  }
}

// 将 Markdown 内容呈现在侧边栏中
function renderMarkdownPreview(tabData) {
  charCountEl.textContent = `${tabData.content.length} 字`;
  markdownPlaceholder.className = 'placeholder-text hidden';
  markdownPreview.className = 'markdown-preview-area';
  
  markdownPreview.textContent = `=== META DATA ===\n标题: ${tabData.title}\n链接: ${tabData.url}\n=================\n\n${tabData.content}`;
  
  // 显示 Obsidian 一键操作区域
  if (obsidianActions) {
    obsidianActions.classList.remove('hidden');
  }
}

// ==========================================
// 5. 网页正文抓取核心 (注入式执行)
// ==========================================
async function fetchActiveTabContent() {
  // 1. 获取活跃标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('未检测到打开的活跃网页，请先访问一个正常的网站。');
  }

  // 2. 检查协议限制
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    return {
      title: tab.title || '系统网页',
      url: tab.url || '',
      content: `[系统消息]: 这是一个浏览器内置页面（如设置页或新标签页），无法读取其内容。\n请在浏览器中访问一个正常的外部网站。`,
      length: 0
    };
  }

  // 3. 动态检测目标网站是否为基于“虚拟滚动/懒加载”的复杂编辑器页面 (飞书, Lark, Notion 等)
  const isLazyLoaded = tab.url && (
    tab.url.includes('feishu.cn') || 
    tab.url.includes('larksuite.com') || 
    tab.url.includes('notion.so')
  );

  const chkOutliner = document.getElementById('chk-outliner-mode');
  const isOutliner = chkOutliner ? chkOutliner.checked : false;

  // 4. 在活跃网页中动态注入 DOM 解析器
  try {
    console.log(`执行 DOM 解析，懒加载模式: ${isLazyLoaded ? '开启' : '关闭'}, 大纲模式: ${isOutliner ? '开启' : '关闭'}`);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: convertDomToMarkdownInTab,
      args: [{ isLazyLoaded, isOutliner }]
    });

    if (results && results[0] && results[0].result) {
      const pageData = results[0].result;
      return {
        title: pageData.title || tab.title || '无标题',
        url: tab.url,
        content: pageData.markdown || '未读取到任何网页文本内容。',
        length: pageData.length || 0
      };
    } else {
      throw new Error('网页脚本注入未返回任何数据。');
    }
  } catch (err) {
    console.error('DOM 提取失败:', err);
    throw new Error(`无法提取当前网页内容 (${err.message})。请检查页面是否加载完成，或尝试刷新网页。`);
  }
}

// ==========================================
// 6. DOM-to-Markdown 解析引擎 (由 scripting API 注入并在网页环境执行)
// ==========================================
async function convertDomToMarkdownInTab(options) {
  try {
    const isLazyLoaded = options && options.isLazyLoaded;
    const isOutliner = options && options.isOutliner;

    // 大纲格式转换辅助函数
    function convertToOutliner(md) {
      const lines = md.split('\n');
      let outlinerLines = [];
      let inCodeBlock = false;
      let currentHeaderLevel = 0;

      for (let line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          const indent = '  '.repeat(currentHeaderLevel);
          outlinerLines.push(indent + line);
          continue;
        }
        
        if (inCodeBlock) {
          const indent = '  '.repeat(currentHeaderLevel);
          outlinerLines.push(indent + line);
          continue;
        }

        if (!trimmed) {
          outlinerLines.push('');
          continue;
        }

        const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          currentHeaderLevel = level;
          const indent = '  '.repeat(level - 1);
          outlinerLines.push(`${indent}- ${headerMatch[2]}`);
          continue;
        }

        const listMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
        if (listMatch) {
          const indent = '  '.repeat(currentHeaderLevel + 1);
          outlinerLines.push(`${indent}- ${listMatch[2]}`);
          continue;
        }

        const indent = '  '.repeat(currentHeaderLevel + (currentHeaderLevel > 0 ? 1 : 0));
        outlinerLines.push(`${indent}- ${trimmed}`);
      }

      return outlinerLines.join('\n');
    }

    // 6.1 HTML-to-Markdown 核心转换逻辑
    function parseNode(node) {
      if (node.nodeType === 3) { // 文本节点
        const val = node.nodeValue;
        if (val) {
          const trimmed = val.trim();
          if (trimmed === 'Unable to print' || trimmed === 'unable to print') {
            return '';
          }
        }
        return val;
      }
      if (node.nodeType !== 1) { // 非元素节点
        return '';
      }

      const tagName = node.tagName.toLowerCase();
      let childrenContent = '';
      
      for (let i = 0; i < node.childNodes.length; i++) {
        childrenContent += parseNode(node.childNodes[i]);
      }

      switch (tagName) {
        case 'h1': return `\n\n# ${childrenContent.trim()}\n\n`;
        case 'h2': return `\n\n## ${childrenContent.trim()}\n\n`;
        case 'h3': return `\n\n### ${childrenContent.trim()}\n\n`;
        case 'h4': return `\n\n#### ${childrenContent.trim()}\n\n`;
        case 'h5': return `\n\n##### ${childrenContent.trim()}\n\n`;
        case 'h6': return `\n\n###### ${childrenContent.trim()}\n\n`;
        case 'p': return `\n\n${childrenContent.trim()}\n\n`;
        case 'br': return `\n`;
        case 'strong':
        case 'b': return ` **${childrenContent.trim()}** `;
        case 'em':
        case 'i': return ` *${childrenContent.trim()}* `;
        case 'code': {
          const isBlock = node.parentNode && node.parentNode.tagName.toLowerCase() === 'pre';
          if (isBlock) {
            return node.textContent || childrenContent;
          }
          return ` \`${childrenContent.trim()}\` `;
        }
        case 'pre': {
          let lang = '';
          const codeChild = Array.from(node.childNodes).find(n => n.nodeType === 1 && n.tagName.toLowerCase() === 'code');
          const targetNode = codeChild || node;
          if (targetNode.className) {
            const classes = targetNode.className.split(/\s+/);
            for (const c of classes) {
              if (c.startsWith('language-')) {
                lang = c.replace('language-', '');
                break;
              } else if (c.startsWith('lang-')) {
                lang = c.replace('lang-', '');
                break;
              }
            }
          }
          const cleanText = targetNode.textContent || childrenContent;
          return `\n\n\`\`\`${lang}\n${cleanText.trim()}\n\`\`\`\n\n`;
        }
        case 'a': {
          const href = node.getAttribute('href');
          const text = childrenContent.trim();
          if (href && text && !href.startsWith('javascript:')) {
            return ` [${text}](${href}) `;
          }
          return text;
        }
        case 'img': {
          let src = node.getAttribute('src') || 
                    node.getAttribute('data-src') || 
                    node.getAttribute('data-original-src') || 
                    node.getAttribute('data-actualsrc') ||
                    node.getAttribute('data-lazy-src');
          if (src) {
            try {
              src = new URL(src, document.baseURI).href;
            } catch (e) {}
            // 过滤极小图标或 svg 占位符以确保纯净
            const width = parseInt(node.getAttribute('width') || node.style.width || '100', 10);
            const height = parseInt(node.getAttribute('height') || node.style.height || '100', 10);
            if (src.startsWith('data:image/svg+xml') || (width > 0 && width < 20) || (height > 0 && height < 20)) {
              return '';
            }
            const alt = node.getAttribute('alt') || '图片';
            return `\n\n![${alt}](${src})\n\n`;
          }
          return '';
        }
        case 'li': return `\n- ${childrenContent.trim()}`;
        case 'ul': return `\n${childrenContent}\n`;
        case 'ol': return `\n${childrenContent}\n`;
        case 'table': return `\n\n${childrenContent}\n\n`;
        case 'tr': return `\n| ${childrenContent}`;
        case 'th':
        case 'td': return `${childrenContent.trim()} |`;
        case 'div':
        case 'span':
        case 'section':
          return childrenContent;
        default:
          return childrenContent;
      }
    }

    // ----------------------------------------------------
    // 方案 A: 针对虚拟滚动/懒加载编辑器 (飞书、Notion) 的累计抓取机制
    // ----------------------------------------------------
    if (isLazyLoaded) {
      // 1. 获取正确的滚动容器
      function getScrollContainer() {
        const selectors = ['.scroll-container', '.docx-scroll-container', '.editor-scroll-container', '.wiki-scroll-container', '.client-scroll-container'];
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) return el;
        }
        // 自动兜底检测所有包含 overflow 且可见的容器
        const divs = document.querySelectorAll('div');
        for (const el of divs) {
          const style = window.getComputedStyle(el);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.clientHeight > 0 && el.scrollHeight > el.clientHeight) {
            return el;
          }
        }
        return window;
      }

      const container = getScrollContainer();
      const isWindow = container === window;
      const originalScrollTop = isWindow ? window.scrollY : container.scrollTop;

      // 2. 锁定主编辑器内容元素，排除全局侧边栏 and 评论区
      const editorEl = document.querySelector('.docx-editor') || 
                       document.querySelector('.editor-root') || 
                       document.querySelector('.editor-container') || 
                       document.body;

      const blockMap = new Map();
      const blockOrder = [];

      // 收集当前视窗中已渲染的所有文档块 (Block)
      function collectCurrentBlocks() {
        // 在飞书中，每个文档块均包含唯一的 [data-block-id] 属性
        // 我们只收集叶子节点块（即自身拥有 data-block-id 且内部不再嵌套其他 data-block-id 的最小内容单元）
        const elements = Array.from(editorEl.querySelectorAll('[data-block-id]')).filter(el => {
          // 排除干扰容器 (如悬浮评论、非正文区域等)
          if (el.closest('.comment-panel') || el.closest('.sidebar') || el.closest('header') || el.closest('footer')) {
            return false;
          }
          
          // 排除 AI 自动生成的摘要区块 (Feishu AI QuickView)，保留纯粹的中文原文
          if (el.innerText.includes('AI QuickView') || el.closest('[class*="quickview"]') || el.closest('[class*="ai-summary"]')) {
            return false;
          }

          // 核心过滤：如果内部还含有 data-block-id，说明它是一个布局包装容器，我们不直接解析它，只解析它的叶子内容节点
          if (el.querySelector('[data-block-id]')) {
            return false;
          }
          return true;
        });

        elements.forEach(el => {
          const blockId = el.getAttribute('data-block-id');
          if (!blockId) return;

          const md = parseNode(el);
          if (md && md.trim().length > 0) {
            // 用唯一的 blockId 作为键，累计收集。已收集 the blockId 绝不覆盖，确保绝对完整！
            if (!blockMap.has(blockId)) {
              blockMap.set(blockId, md);
              blockOrder.push(blockId);
            }
          }
        });
      }

      // 3. 执行异步滚屏抓取流程
      const viewportHeight = isWindow ? window.innerHeight : container.clientHeight;
      const totalHeight = isWindow ? document.documentElement.scrollHeight : container.scrollHeight;
      let currentScrollTop = 0;

      // 首先回到顶部开始收集
      if (isWindow) window.scrollTo(0, 0);
      else container.scrollTop = 0;
      await new Promise(r => setTimeout(r, 150)); // 留 150ms 缓冲

      // 确保单次滚动步长至少为 100px，防止 viewportHeight 为 0 或过小时步长为 0 导致死循环
      const scrollStep = Math.max(100, Math.floor(viewportHeight * 0.7));

      // 设置最大滚动次数和最大高度限制，避免在无限滚动页面中死循环
      let scrollCount = 0;
      const maxScrolls = 100; // 最多滚动 100 次
      const maxScrollHeight = 50000; // 最多滚动 50000 像素

      // 逐步向下滚动，每次滚动以 scrollStep 像素以确保内容有完美的重叠覆盖，不漏掉任何一个 block
      while (currentScrollTop < totalHeight && currentScrollTop < maxScrollHeight && scrollCount < maxScrolls) {
        collectCurrentBlocks();
        currentScrollTop += scrollStep;
        scrollCount++;
        
        if (isWindow) window.scrollTo(0, currentScrollTop);
        else container.scrollTop = currentScrollTop;
        
        // 核心：每次滚动挂起 100ms 强制给浏览器渲染虚拟 DOM 的时间
        await new Promise(r => setTimeout(r, 100));
      }

      // 滚动到最底部进行最后一次补漏收集
      collectCurrentBlocks();

      // 4. 恢复用户本来的滚动位置，做到无感静默
      if (isWindow) window.scrollTo(0, originalScrollTop);
      else container.scrollTop = originalScrollTop;

      // 5. 按原文档逻辑顺序拼接 Markdown 内容
      let markdown = blockOrder.map(id => blockMap.get(id)).join('\n\n');

      // 格式化清理多余的空白与换行
      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();

      if (isOutliner) {
        markdown = convertToOutliner(markdown);
      }

      return {
        title: document.title,
        markdown: markdown,
        length: markdown.length
      };

    } else {
      // ----------------------------------------------------
      // 方案 B: 针对标准网页 (快速 instant DOM 模式)
      // ----------------------------------------------------
      const docCopy = document.cloneNode(true);
      const scripts = docCopy.querySelectorAll('script, style, iframe, noscript, svg, header, footer, nav, link');
      scripts.forEach(el => el.remove());

      let rootElement = docCopy.body;
      const specialContainers = [
        '#js_content',
        'article',
        '.article-content',
        '.post-content',
        'main',
        '#main-content'
      ];

      for (const selector of specialContainers) {
        const found = docCopy.querySelector(selector);
        if (found && found.innerText.trim().length > 200) {
          rootElement = found;
          break;
        }
      }

      let markdown = parseNode(rootElement);

      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();

      if (isOutliner) {
        markdown = convertToOutliner(markdown);
      }

      return {
        title: document.title,
        markdown: markdown,
        length: markdown.length
      };
    }
  } catch (err) {
    return {
      title: document.title,
      markdown: '抓取 DOM 出错: ' + err.message,
      length: 0
    };
  }
}

// ==========================================
// 7. AI 网页伴侣 Chat 对话框控制逻辑 (流式 SSE / 直连 PilotDeck 双通道版)
// ==========================================
async function loadAiSettings() {
  const useCustomAi = localStorage.getItem('ai_use_custom') === 'true';
  const chkUseCustomAi = document.getElementById('chk-use-custom-ai');
  if (chkUseCustomAi) {
    chkUseCustomAi.checked = useCustomAi;
  }

  let chatMode = localStorage.getItem('ai_chat_mode');
  let apiUrl = localStorage.getItem('ai_api_url');
  let apiKey = localStorage.getItem('ai_api_key') || 'placeholder';
  let model = localStorage.getItem('ai_model');
  
  // 尝试从本地桥接服务读取当前 Codex config.toml 的实际配置与 auth.json 密钥
  if (!useCustomAi) {
    try {
      const res = await fetch('http://localhost:3010/api/codex-config');
      if (res.ok) {
        const codexConf = await res.json();
        console.log('[CodexLink] 成功自本地桥接服务同步 Codex 实时配置与密钥:', codexConf);
        
        if (codexConf.baseUrl) {
          apiUrl = codexConf.baseUrl;
          localStorage.setItem('ai_api_url', apiUrl);
        }
        if (codexConf.model) {
          model = codexConf.model;
          localStorage.setItem('ai_model', model);
        }
        if (codexConf.apiKey) {
          apiKey = codexConf.apiKey;
          localStorage.setItem('ai_api_key', apiKey);
        }
      }
    } catch (e) {
      console.warn('[CodexLink] 获取本地 Codex 实时代理配置与密钥失败，将降级使用本地缓存:', e);
    }
  }
  
  // 兜底默认值
  if (!chatMode) chatMode = 'direct';
  if (!apiUrl) apiUrl = 'http://localhost:28642/v1';
  if (!model) model = 'gpt-5.5';
  
  document.getElementById('ai-chat-mode').value = chatMode;
  document.getElementById('ai-api-url').value = apiUrl;
  document.getElementById('ai-api-key').value = apiKey === 'placeholder' ? '' : apiKey;
  document.getElementById('ai-model').value = model;
}

function initChatController() {
  const btnToggleSettings = document.getElementById('btn-toggle-settings');
  const aiSettingsDrawer = document.getElementById('ai-settings-drawer');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnClearChat = document.getElementById('btn-clear-chat');
  const btnSendChat = document.getElementById('btn-send-chat');
  const chatInput = document.getElementById('chat-input');
  
  // 7.1 加载保存的历史设置
  loadAiSettings();
  
  // 7.2 切换设置抽屉显隐
  btnToggleSettings.addEventListener('click', () => {
    aiSettingsDrawer.classList.toggle('hidden');
  });
  
  // 7.3 保存 API 配置与模式选择
  btnSaveSettings.addEventListener('click', () => {
    const useCustomAi = document.getElementById('chk-use-custom-ai').checked;
    const chatMode = document.getElementById('ai-chat-mode').value;
    const apiUrl = document.getElementById('ai-api-url').value.trim() || 'http://localhost:28642/v1';
    let apiKey = document.getElementById('ai-api-key').value.trim();
    if (!apiKey) apiKey = 'placeholder';
    const model = document.getElementById('ai-model').value.trim() || 'gpt-5.5';
    
    localStorage.setItem('ai_use_custom', useCustomAi ? 'true' : 'false');
    localStorage.setItem('ai_chat_mode', chatMode);
    localStorage.setItem('ai_api_url', apiUrl);
    localStorage.setItem('ai_api_key', apiKey);
    localStorage.setItem('ai_model', model);
    
    btnSaveSettings.textContent = '保存成功！';
    btnSaveSettings.style.background = '#10b981';
    setTimeout(() => {
      btnSaveSettings.textContent = '保存配置';
      btnSaveSettings.style.background = '';
      aiSettingsDrawer.classList.add('hidden');
    }, 1000);
  });
  
  // 7.4 清空对话历史
  btnClearChat.addEventListener('click', () => {
    chatHistory = [];
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
      <div class="msg msg-system">
        💬 对话历史已清空。您可以继续提问！
      </div>
    `;
  });
  
  // 7.5 自适应文本框高度
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(100, chatInput.scrollHeight - 4) + 'px';
  });
  
  // 7.6 快捷键监听：Enter 发送，Shift+Enter 换行
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  
  // 7.7 点击发送
  btnSendChat.addEventListener('click', sendChatMessage);
}

// 核心：发送聊天消息
async function sendChatMessage() {
  const chatInput = document.getElementById('chat-input');
  const text = chatInput.value.trim();
  if (!text) return;
  
  // 1. 读取当前的联动模式配置
  const chatMode = localStorage.getItem('ai_chat_mode') || 'direct';
  
  // 2. 禁用输入及发送按钮，展示加载状态
  chatInput.value = '';
  chatInput.style.height = '36px';
  chatInput.disabled = true;
  document.getElementById('btn-send-chat').disabled = true;
  
  // ----------------------------------------------------
  // 通道 A1: 🚀 直连 Codex 窗口 (Direct Inject to Codex Tab)
  // ----------------------------------------------------
  if (chatMode === 'codex_inject') {
    const aiMsgDiv = startAiMessage();
    aiMsgDiv.textContent = '正在寻找左侧 Codex 浏览器标签页...';
    
    try {
      // 1. 查询当前所有浏览器标签页，寻找 Codex/Apivale UI
      const tabs = await chrome.tabs.query({});
      const codexTab = tabs.find(t => 
        t.url && (
          t.url.includes('codex') ||
          t.url.includes('apivale') ||
          t.url.includes('localhost:3000') ||
          t.url.includes('localhost:3001') ||
          t.url.includes('localhost:5173') ||
          t.url.includes('127.0.0.1')
        )
      );
      
      if (!codexTab) {
        throw new Error('未在浏览器中检测到打开的 Codex 页面！请确保 Codex Web UI 处于打开状态，或者点击右上角小齿轮 ⚙️ 将联动模式切换为“独立伴侣模式”。');
      }
      
      const useContext = document.getElementById('chk-use-context').checked;
      
      // 2. 如果携带上下文且当前缓存为空，自动在后台滚动抓取
      if (useContext && !currentExtractedContent) {
        aiMsgDiv.textContent = '正在提取当前网页正文上下文...';
        try {
          currentExtractedContent = await fetchActiveTabContent();
          renderMarkdownPreview(currentExtractedContent);
        } catch (err) {
          console.error('自动抓取上下文失败:', err);
        }
      }
      
      // 3. 构建穿透给 Codex 的完美混合 Prompt
      let compiledPrompt = '';
      if (useContext && currentExtractedContent) {
        compiledPrompt = `【💡 已通过 CodexLink 自动携带网页上下文：${currentExtractedContent.title}】
网页链接：${currentExtractedContent.url}

=== 网页 Markdown 正文开始 ===
${currentExtractedContent.content}
=== 网页 Markdown 正文结束 ===

用户提问：${text}`;
      } else {
        compiledPrompt = text;
      }
      
      aiMsgDiv.textContent = '正在将 Prompt 跨标签注入左侧 Codex 对话框并提交...';
      
      // 4. 将 Prompt 远程注入到 Codex tab 内的 DOM 元素上并自动提交
      const results = await chrome.scripting.executeScript({
        target: { tabId: codexTab.id },
        func: injectPromptToPilotDeckDOM, // 共享极简通用的 DOM 注入提交逻辑
        args: [compiledPrompt]
      });
      
      if (results && results[0] && results[0].result && results[0].result.success) {
        aiMsgDiv.className = 'msg msg-system';
        aiMsgDiv.innerHTML = `🚀 <b>穿透发送成功！</b><br>已将问题与网页正文一键注入并同步至左侧 Codex 窗口！请在左侧查看 AI 执行与实时输出进度。`;
      } else {
        const errMsg = (results && results[0] && results[0].result && results[0].result.error) || '未知注入错误';
        throw new Error(`注入失败: ${errMsg}`);
      }
      
    } catch (err) {
      console.error('直连 Codex 窗口失败:', err);
      aiMsgDiv.className = 'msg msg-error';
      aiMsgDiv.textContent = `❌ ${err.message}`;
    } finally {
      chatInput.disabled = false;
      document.getElementById('btn-send-chat').disabled = false;
      chatInput.focus();
    }
    return;
  }

  // ----------------------------------------------------
  // 通道 A2: 🚀 直连/穿透 PilotDeck 工作舱模式 (Direct Linked Mode)
  // ----------------------------------------------------
  if (chatMode === 'pilotdeck') {
    const aiMsgDiv = startAiMessage();
    aiMsgDiv.textContent = '正在寻找左侧 PilotDeck 浏览器标签页...';
    
    try {
      // 1. 查询当前所有浏览器标签页，寻找 PilotDeck UI
      const tabs = await chrome.tabs.query({});
      const pilotDeckTab = tabs.find(t => 
        t.url && (
          t.url.includes('localhost:3000') ||
          t.url.includes('localhost:3001') ||
          t.url.includes('localhost:5173') ||
          t.url.includes('pilotdeck')
        )
      );
      
      if (!pilotDeckTab) {
        throw new Error('未在浏览器中检测到打开的 PilotDeck 页面！请先确保 PilotDeck Web UI 处于打开状态（如 http://localhost:3001），或者点击右上角小齿轮 ⚙️ 将联动模式切换为“独立对话模式”。');
      }
      
      const useContext = document.getElementById('chk-use-context').checked;
      
      // 2. 如果携带上下文且当前缓存为空，自动在后台滚动抓取
      if (useContext && !currentExtractedContent) {
        aiMsgDiv.textContent = '正在提取当前网页正文上下文...';
        try {
          currentExtractedContent = await fetchActiveTabContent();
          renderMarkdownPreview(currentExtractedContent);
        } catch (err) {
          console.error('自动抓取上下文失败:', err);
        }
      }
      
      // 3. 构建穿透给 PilotDeck 的完美混合 Prompt
      let compiledPrompt = '';
      if (useContext && currentExtractedContent) {
        compiledPrompt = `【💡 已通过 CodexLink 自动携带网页上下文：${currentExtractedContent.title}】
网页链接：${currentExtractedContent.url}

=== 网页 Markdown 正文开始 ===
${currentExtractedContent.content}
=== 网页 Markdown 正文结束 ===

用户提问：${text}`;
      } else {
        compiledPrompt = text;
      }
      
      aiMsgDiv.textContent = '正在将 Prompt 跨标签注入左侧 PilotDeck 对话框并提交...';
      
      // 4. 将 Prompt 远程注入到 PilotDeck tab 内的 DOM 元素上并自动提交
      const results = await chrome.scripting.executeScript({
        target: { tabId: pilotDeckTab.id },
        func: injectPromptToPilotDeckDOM,
        args: [compiledPrompt]
      });
      
      if (results && results[0] && results[0].result && results[0].result.success) {
        // 在右侧展示注入成功，引导用户看左侧执行
        aiMsgDiv.className = 'msg msg-system';
        aiMsgDiv.innerHTML = `🚀 <b>穿透发送成功！</b><br>已将问题与网页正文一键注入并同步至左侧 PilotDeck 舱体！请在左侧查看 AI 执行与实时输出进度。`;
      } else {
        const errMsg = (results && results[0] && results[0].result && results[0].result.error) || '未知注入错误';
        throw new Error(`注入失败: ${errMsg}`);
      }
      
    } catch (err) {
      console.error('直连 PilotDeck 舱体失败:', err);
      aiMsgDiv.className = 'msg msg-error';
      aiMsgDiv.textContent = `❌ ${err.message}`;
    } finally {
      chatInput.disabled = false;
      document.getElementById('btn-send-chat').disabled = false;
      chatInput.focus();
    }
    return;
  }
  
  // ----------------------------------------------------
  // 通道 B: 💬 独立 AI 侧边栏对话模式 (Stand-alone Chat Mode)
  // ----------------------------------------------------
  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  
  const aiMsgDiv = startAiMessage();
  aiMsgDiv.textContent = '思考中...';
  
  try {
    const apiUrl = localStorage.getItem('ai_api_url') || 'http://localhost:28642/v1';
    const apiKey = localStorage.getItem('ai_api_key') || 'placeholder';
    const modelName = localStorage.getItem('ai_model') || 'sensenova/sensenova-6.7-flash-lite';
    const useContext = document.getElementById('chk-use-context').checked;
    
    if (useContext && !currentExtractedContent) {
      aiMsgDiv.textContent = '正在获取当前网页正文上下文...';
      try {
        currentExtractedContent = await fetchActiveTabContent();
        renderMarkdownPreview(currentExtractedContent);
      } catch (err) {
        console.error('后台自动抓取失败:', err);
      }
    }
    
    const apiMessages = [];
    
    if (useContext && currentExtractedContent) {
      apiMessages.push({
        role: 'system',
        content: `You are Codex Web Copilot, a highly capable AI assistant embedded in a browser side panel.
You are given the high-fidelity structured Markdown text of the web page the user is currently viewing.

=== CURRENT WEB PAGE INFO ===
URL: ${currentExtractedContent.url}
Title: ${currentExtractedContent.title}
=== PAGE CONTENT ===
${currentExtractedContent.content}
====================

Use the page content above as a comprehensive knowledge source to answer the user's questions, translate segments, summarize text, or analyze layout.
When answering questions about the page, base your response strictly on the provided content. If the information is not in the page content, use your general knowledge but make sure to clarify so.`
      });
    } else {
      apiMessages.push({
        role: 'system',
        content: 'You are Codex Web Copilot, a helpful AI assistant. Answer the user\'s queries directly.'
      });
    }
    
    apiMessages.push(...chatHistory);
    aiMsgDiv.textContent = '';
    
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: apiMessages,
        stream: true
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 报错: ${response.status} - ${errText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let aiResponseText = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line === 'data: [DONE]') continue;
        
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              aiResponseText += content;
              aiMsgDiv.innerHTML = parseMarkdown(aiResponseText);
              document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
            }
          } catch (e) {}
        }
      }
    }
    
    if (buffer && buffer.startsWith('data: ')) {
      try {
        const parsed = JSON.parse(buffer.slice(6));
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          aiResponseText += content;
          aiMsgDiv.innerHTML = parseMarkdown(aiResponseText);
        }
      } catch (e) {}
    }
    
    chatHistory.push({ role: 'assistant', content: aiResponseText });
    
  } catch (err) {
    console.error('AI 链路故障:', err);
    aiMsgDiv.className = 'msg msg-error';
    aiMsgDiv.textContent = `❌ 对话链路失败: ${err.message}\n请点击右上角 ⚙️ 配置正确的 API 接口地址、API Key 与模型名称。如果是本地代理，请确认本地代理服务 (28642端口) 是否正常开启。`;
    chatHistory.pop();
  } finally {
    chatInput.disabled = false;
    document.getElementById('btn-send-chat').disabled = false;
    chatInput.focus();
  }
}

// ==========================================
// 8. 远程 DOM 操控注入函数 (由 scripting API 注入并在 PilotDeck Tab 环境执行)
// ==========================================
function injectPromptToPilotDeckDOM(promptText) {
  try {
    // 1. 寻找页面上的对话输入框 textarea
    const textarea = document.querySelector('textarea');
    if (!textarea) {
      return { success: false, error: '未能在 PilotDeck 页面上寻寻找输入框。请先确认您在左侧对话中打开并激活了一个工作舱（WorkSpace）会话界面。' };
    }

    // 2. 写入 Prompt 文本值
    textarea.value = promptText;
    
    // 3. 强行分发 React 捕获所需的所有 input/change 事件，保证 React 状态和输入框同步
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    // 4. 搜寻提交表单或表单内置的 submit 按钮
    const form = textarea.closest('form');
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        return { success: true };
      }
      // 兜底方案：直接对 form 分发 submit 事件
      form.dispatchEvent(new Event('submit', { bubbles: true }));
      return { success: true };
    }
    
    return { success: false, error: '未能定位到输入框归属的发送表单，请尝试刷新左侧 PilotDeck 网页。' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 极其高效极简的 Markdown 渲染器，增强大模型回复的排版美观度与可读性
function parseMarkdown(text) {
  if (!text) return '';
  
  // 安全转义 HTML 防御 XSS 注入
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 0. 解析图片: ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const decUrl = url.replace(/&amp;/g, '&');
    return `<img src="${decUrl}" alt="${alt || '图片'}" class="md-image" />`;
  });

  // 1. 解析代码块: ```javascript\ncode\n```
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const lines = code.trim().split('\n');
    let lang = '';
    let codeBody = code;
    if (lines.length > 1 && lines[0].length < 15 && !lines[0].includes(' ') && !lines[0].includes('\n')) {
      lang = lines[0];
      codeBody = lines.slice(1).join('\n');
    }
    return `<pre class="code-block">${lang ? `<span class="code-lang">${lang}</span>` : ''}<code>${codeBody.trim()}</code></pre>`;
  });

  // 2. 解析行内代码: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // 3. 解析加粗: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 4. 解析斜体: *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 5. 解析标题: ### text, ## text, # text
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // 6. 解析无序列表: - item 或 * item
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');

  // 7. 解析有序列表: 1. item
  html = html.replace(/^\s*(\d+)\.\s+(.*?)$/gm, '<li class="num-item">$2</li>');
  html = html.replace(/(<li class="num-item">.*?<\/li>)+/g, '<ol>$&</ol>');

  // 8. 精准拆分非 Block 文本段落，并转换换行符为段落段落及 br 换行
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<ul[\s\S]*?<\/ul>|<ol[\s\S]*?<\/ol>|<h1>.*?<\/h1>|<h2>.*?<\/h2>|<h3>.*?<\/h3>)/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && !parts[i].startsWith('<pre') && !parts[i].startsWith('<ul') && !parts[i].startsWith('<ol') && !parts[i].startsWith('<h1') && !parts[i].startsWith('<h2') && !parts[i].startsWith('<h3')) {
      parts[i] = parts[i]
        .split('\n\n')
        .map(p => {
          const trimmed = p.trim();
          if (!trimmed) return '';
          return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
        })
        .join('');
    }
  }
  html = parts.join('');

  return html;
}

// 辅助：往对话历史塞入气泡
function appendMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg msg-${role}`;
  if (role === 'ai') {
    msgDiv.innerHTML = parseMarkdown(content);
  } else {
    msgDiv.textContent = content;
  }
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
  return msgDiv;
}

// 辅助：流式气泡初始化
function startAiMessage() {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg msg-ai`;
  msgDiv.innerHTML = '';
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
  return msgDiv;
}

// ==========================================
// 9. 一键剪存至 Obsidian 核心业务层
// ==========================================
async function fetchLocalImages(markdown) {
  const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const matches = [...markdown.matchAll(imgRegex)];
  const images = [];
  const processedUrls = new Set();
  let imgIndex = 1;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const url = match[2];
    if (processedUrls.has(url)) continue;
    processedUrls.add(url);

    try {
      console.log(`[Image Downloader] Fetching: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const blob = await res.blob();
      
      let ext = 'png';
      const contentType = res.headers.get('content-type') || blob.type;
      if (contentType) {
        const parts = contentType.split('/');
        if (parts.length === 2) {
          ext = parts[1].split(';')[0].split('+')[0];
          if (ext === 'jpeg') ext = 'jpg';
        }
      }

      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const filename = `image_${imgIndex++}.${ext}`;
      images.push({
        originalUrl: url,
        base64Data: base64Data,
        filename: filename
      });
      console.log(`[Image Downloader] Successfully downloaded: ${filename}`);
    } catch (e) {
      console.warn(`[Image Downloader] Failed to download image ${url}:`, e.message);
    }
  }

  return images;
}

async function writeToLocalVault(title, content, summary, images) {
  if (!vaultDirectoryHandle) {
    throw new Error('未授权本地 Obsidian 库目录，请先选择目录。');
  }

  // 验证与获取写入权限
  const hasPerm = await verifyPermission(vaultDirectoryHandle, true);
  if (!hasPerm) {
    throw new Error('未获得本地目录的写入授权，请重新授权。');
  }

  // 1. 获取或创建 CodexLink 根保存目录
  const codexLinkDir = await vaultDirectoryHandle.getDirectoryHandle('CodexLink', { create: true });

  const safeTitle = title.replace(/[\\\/:\*\?"<>\|]/g, '_').trim();
  const filename = `${safeTitle}.md`;

  // 2. 本地化保存图片并替换相对链接
  let updatedContent = content;
  if (images && images.length > 0) {
    const attachmentsDir = await codexLinkDir.getDirectoryHandle('attachments', { create: true });
    const assetSubDir = await attachmentsDir.getDirectoryHandle(`${safeTitle}_assets`, { create: true });

    for (const img of images) {
      try {
        const imgFileHandle = await assetSubDir.getFileHandle(img.filename, { create: true });
        const writable = await imgFileHandle.createWritable();
        
        // base64 转二进制 ArrayBuffer 写入
        const byteCharacters = atob(img.base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        
        await writable.write(byteArray);
        await writable.close();
        console.log(`[Standalone Mode] 成功保存本地图片: ${img.filename}`);

        // 重定向链接为本地相对路径
        const relativePath = `attachments/${safeTitle}_assets/${img.filename}`;
        const escapedUrl = img.originalUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const urlRegex = new RegExp(`\\(${escapedUrl}\\)`, 'g');
        updatedContent = updatedContent.replace(urlRegex, `(${relativePath})`);
      } catch (err) {
        console.warn(`[Standalone Mode] 保存图片失败 ${img.filename}:`, err);
      }
    }
  }

  // 3. 组装 Markdown 数据
  const currentDate = new Date().toLocaleString('zh-CN', { hour12: false });
  let fileContent = `---
title: "${title.replace(/"/g, '\\"')}"
url: ${currentExtractedContent.url || ''}
clipped_at: ${currentDate}
tags:
  - clipped
  - web
---

`;

  if (summary && summary.trim()) {
    fileContent += `## 💡 AI 核心摘要\n\n${summary.trim()}\n\n---\n\n`;
  }

  fileContent += `## 📄 网页排版正文\n\n${updatedContent.trim()}\n`;

  // 4. 直写本地文件
  const fileHandle = await codexLinkDir.getFileHandle(filename, { create: true });
  const mdWritable = await fileHandle.createWritable();
  await mdWritable.write(fileContent);
  await mdWritable.close();
  
  console.log(`[Standalone Mode] 成功写入本地 Obsidian 笔记: ${filename}`);
  return { filename, folderName: vaultDirectoryHandle.name };
}

async function saveToObsidianHandler() {
  if (!currentExtractedContent) {
    alert('请先提取当前网页正文内容！');
    return;
  }

  btnSaveObsidian.disabled = true;

  try {
    // 自动拦截逻辑：如果处于单机直写模式且未授权目录，直接在此处自动调起目录选择
    if (opMode === 'standalone' && !vaultDirectoryHandle) {
      btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '请选择保存目录...';
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        vaultDirectoryHandle = handle;
        await saveDirectoryHandle(handle);
        document.getElementById('dir-status-text').textContent = `已授权: ${handle.name}`;
        updateUIStatus(isConnected ? 'connected' : 'disconnected');
      } catch (err) {
        console.warn('[Standalone Mode] 自动触发选择目录取消或失败:', err);
        alert('请先选择本地 Obsidian 库目录，否则无法在单机模式下直写保存文件。');
        btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '一键剪存至 Obsidian';
        btnSaveObsidian.disabled = false;
        return;
      }
    }

    btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在下载图片...';
    const images = await fetchLocalImages(currentExtractedContent.content);
    
    if (opMode === 'standalone') {
      btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在直写本地...';
      const result = await writeToLocalVault(
        currentExtractedContent.title,
        currentExtractedContent.content,
        null,
        images
      );
      console.log('[Standalone Mode] 保存成功:', result);
    } else {
      btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在剪存...';

      const response = await fetch('http://localhost:3010/api/save-to-obsidian', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: currentExtractedContent.title,
          url: currentExtractedContent.url,
          content: currentExtractedContent.content,
          images: images
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || '保存失败');
      }
      console.log('[Obsidian] 保存成功:', resData);
    }

    btnSaveObsidian.style.background = '#10b981';
    btnSaveObsidian.style.borderColor = '#10b981';
    btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '✔ 剪存成功！';

    setTimeout(() => {
      btnSaveObsidian.style.background = '';
      btnSaveObsidian.style.borderColor = '';
      btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '一键剪存至 Obsidian';
      btnSaveObsidian.disabled = false;
    }, 2000);

  } catch (err) {
    console.error('[Obsidian] 剪存失败:', err);
    alert('剪存至 Obsidian 失败：' + err.message);
    btnSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '一键剪存至 Obsidian';
    btnSaveObsidian.disabled = false;
  }
}

async function aiSaveToObsidianHandler() {
  if (!currentExtractedContent) {
    alert('请先提取当前网页正文内容！');
    return;
  }

  btnAiSaveObsidian.disabled = true;
  btnSaveObsidian.disabled = true;

  try {
    // 自动拦截逻辑：如果处于单机直写模式且未授权目录，直接在此处自动调起目录选择
    if (opMode === 'standalone' && !vaultDirectoryHandle) {
      btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '请选择保存目录...';
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        vaultDirectoryHandle = handle;
        await saveDirectoryHandle(handle);
        document.getElementById('dir-status-text').textContent = `已授权: ${handle.name}`;
        updateUIStatus(isConnected ? 'connected' : 'disconnected');
      } catch (err) {
        console.warn('[Standalone Mode] 自动触发选择目录取消或失败:', err);
        alert('请先选择本地 Obsidian 库目录，否则无法在单机模式下直写保存文件。');
        btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = 'AI 摘要并剪存';
        btnAiSaveObsidian.disabled = false;
        btnSaveObsidian.disabled = false;
        return;
      }
    }

    btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在生成 AI 摘要...';

    // 1. 获取本地 AI 设置与代理配置
    const apiUrl = localStorage.getItem('ai_api_url') || 'http://localhost:28642/v1';
    const apiKey = localStorage.getItem('ai_api_key') || 'placeholder';
    const modelName = localStorage.getItem('ai_model') || 'sensenova/sensenova-6.7-flash-lite';

    // 2. 构造高频提纯 Prompt
    const prompt = `请帮我为以下网页内容制作一个极其精炼的摘要（约 200-300 字），并提炼出 3-5 个最相关的关键词（作为标签）：
网页标题：${currentExtractedContent.title}
网页链接：${currentExtractedContent.url}
网页正文：
${currentExtractedContent.content.slice(0, 12000)}

请严格使用以下 Markdown 格式输出：
### 💡 核心摘要
[在此处写入精炼的中文摘要]

### 🏷️ 推荐标签
- [标签1]
- [标签2]`;

    // 3. 请求本地 AI 代理进行单次大模型推理
    console.log('[Obsidian] 正在调用本地 AI 模型生成网页摘要:', modelName);
    const aiResponse = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: 'You are a professional knowledge management assistant.' },
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI 服务出错: ${aiResponse.status} - ${errText}`);
    }

    const aiData = await aiResponse.json();
    const summaryText = aiData.choices?.[0]?.message?.content || '（AI 摘要生成失败）';
    console.log('[Obsidian] AI 网页摘要生成完毕:', summaryText);

    // 4. 将摘要与原文合并，完成保存
    btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在下载图片...';
    const images = await fetchLocalImages(currentExtractedContent.content);

    if (opMode === 'standalone') {
      btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在直写本地...';
      const result = await writeToLocalVault(
        currentExtractedContent.title,
        currentExtractedContent.content,
        summaryText,
        images
      );
      console.log('[Standalone Mode] AI 保存成功:', result);
    } else {
      btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '正在写入 Obsidian...';
      
      const response = await fetch('http://localhost:3010/api/save-to-obsidian', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: currentExtractedContent.title,
          url: currentExtractedContent.url,
          content: currentExtractedContent.content,
          summary: summaryText,
          images: images
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || '保存失败');
      }
      console.log('[Obsidian] AI 剪存成功:', resData);
    }

    btnAiSaveObsidian.style.background = '#10b981';
    btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = '✔ AI 剪存成功！';

    setTimeout(() => {
      btnAiSaveObsidian.style.background = '';
      btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = 'AI 摘要并剪存';
      btnAiSaveObsidian.disabled = false;
      btnSaveObsidian.disabled = false;
    }, 2000);

  } catch (err) {
    console.error('[Obsidian] AI 剪存失败:', err);
    alert('AI 剪存失败：' + err.message + '\n提示：请确认您已成功启动本地 AI 代理端口 (28642)。');
    btnAiSaveObsidian.querySelector('span:not(.btn-icon)').textContent = 'AI 摘要并剪存';
    btnAiSaveObsidian.disabled = false;
    btnSaveObsidian.disabled = false;
  }
}