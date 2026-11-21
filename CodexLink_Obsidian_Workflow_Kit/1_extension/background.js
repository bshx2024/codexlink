// ==========================================
// ComLinkAI Background Service Worker
// (CDP 物理级操控 + CDP 原生截屏缩放 + 标签组隔离并发底座)
// ==========================================

// 点击插件图标时打开侧边栏
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('设置侧边栏行为失败:', err));
}

// --------------------------------------------------------------------------
// 1. CDP (Chrome DevTools Protocol) 物理级模拟点击与贝塞尔轨迹内核
// --------------------------------------------------------------------------

// 存储已挂载调试器的 Tab 缓存集合
const attachedTabs = new Set();

async function attachCDP(tabId) {
  if (attachedTabs.has(tabId)) return;
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message.includes('Already attached')) {
          attachedTabs.add(tabId);
          return resolve();
        }
        return reject(new Error(chrome.runtime.lastError.message));
      }
      attachedTabs.add(tabId);
      resolve();
    });
  });
}

async function detachCDP(tabId) {
  if (!attachedTabs.has(tabId)) return;
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      resolve();
    });
  });
}

function sendCDPCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(result);
    });
  });
}

// 三阶贝塞尔曲线算法 + 随机微小抖动 (Jitter)
function generateBezierPath(startX, startY, endX, endY, steps = 25) {
  const points = [];
  const controlX = (startX + endX) / 2 + (Math.random() * 120 - 60);
  const controlY = (startY + endY) / 2 + (Math.random() * 120 - 60);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.pow(1 - t, 2) * startX + 2 * (1 - t) * t * controlX + Math.pow(t, 2) * endX;
    const y = Math.pow(1 - t, 2) * startY + 2 * (1 - t) * t * controlY + Math.pow(t, 2) * endY;
    const jitterX = x + (Math.random() * 2 - 1);
    const jitterY = y + (Math.random() * 2 - 1);
    points.push({ x: Math.round(jitterX), y: Math.round(jitterY) });
  }
  return points;
}

// CDP 物理轨迹点击管道 (isTrusted === true)
async function cdpPhysicalClick(tabId, targetX, targetY) {
  await attachCDP(tabId);
  try {
    const startPos = { x: Math.floor(Math.random() * 300 + 100), y: Math.floor(Math.random() * 300 + 100) };
    const path = generateBezierPath(startPos.x, startPos.y, targetX, targetY, 20 + Math.floor(Math.random() * 10));

    // 1. 模拟鼠标沿贝塞尔轨迹移动 (mouseMoved)
    for (const pt of path) {
      await sendCDPCommand(tabId, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: pt.x,
        y: pt.y,
        button: "none"
      });
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 8 + 6)));
    }

    // 2. 模拟物理按下 (mousePressed)
    await sendCDPCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: targetX,
      y: targetY,
      button: "left",
      clickCount: 1
    });

    // 3. 模拟物理按压延迟 (Human Dwell Time: 65ms ~ 125ms)
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 60 + 65)));

    // 4. 模拟物理释放 (mouseReleased)
    await sendCDPCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: targetX,
      y: targetY,
      button: "left",
      clickCount: 1
    });

    return { success: true, isTrusted: true, x: targetX, y: targetY };
  } catch (err) {
    throw err;
  }
}

// CDP 模拟物理滚动 (mouseWheel)
async function cdpPhysicalScroll(tabId, deltaY = 300) {
  await attachCDP(tabId);
  const steps = 4 + Math.floor(Math.random() * 3);
  const chunkY = Math.floor(deltaY / steps);
  for (let i = 0; i < steps; i++) {
    await sendCDPCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 300,
      y: 300,
      deltaX: 0,
      deltaY: chunkY
    });
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 150 + 200)));
  }
}

// CDP 模拟物理键盘按键与原生文本插入 (Input.dispatchKeyEvent / Input.insertText)
async function cdpPhysicalType(tabId, text) {
  await attachCDP(tabId);
  try {
    if (text.length <= 60) {
      // 短文本（如姓名、邮箱、网址）：逐字派发原生物理按键事件，真实 isTrusted
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        await sendCDPCommand(tabId, "Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
          unmodifiedText: char
        });
        await sendCDPCommand(tabId, "Input.dispatchKeyEvent", {
          type: "keyUp"
        });
        const jitter = Math.floor(Math.random() * 25 + 20); // 20ms ~ 45ms 击键微延迟
        await new Promise(r => setTimeout(r, jitter));
      }
    } else {
      // 长文本（评论正文）：分段模拟按键文本流注入，保留原生 isTrusted 输入管道与输入事件
      const chunkSize = 25;
      for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        await sendCDPCommand(tabId, "Input.insertText", { text: chunk });
        const pause = Math.floor(Math.random() * 40 + 30); // 30ms ~ 70ms 块间延迟
        await new Promise(r => setTimeout(r, pause));
      }
    }
    return { success: true };
  } catch (err) {
    throw err;
  }
}

// --------------------------------------------------------------------------
// 2. CDP 原生截屏缩放求解算法 (借鉴自 browser-hands)
// --------------------------------------------------------------------------
const MAX_EDGE = 1568; // 长边上限
const TILE = 28; // 切块边长
const MAX_TILES = 1568; // 块数上限

const fits = (w, h) => w <= MAX_EDGE && h <= MAX_EDGE && Math.ceil(w / TILE) * Math.ceil(h / TILE) <= MAX_TILES;
const scaledH = (w2, w, h) => Math.max(1, Math.round((w2 * h) / w));

function targetSize(w, h) {
  if (fits(w, h)) return [w, h];
  if (h > w) {
    const [a, b] = targetSize(h, w);
    return [b, a];
  }
  let lo = 1;
  let hi = Math.min(w, MAX_EDGE);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid, scaledH(mid, w, h))) lo = mid;
    else hi = mid - 1;
  }
  return [lo, scaledH(lo, w, h)];
}

const clampScale = (s) => (typeof s === 'number' && Number.isFinite(s) && s >= 0.1 && s <= 1 ? s : 1);

// 原生通过 CDP DevTools 协议获取按比例由浏览器内核硬件加速缩放的截图，完全免除页面注入 canvas 重新编码导致的 CPU 飙升与内存占用
async function cdpCaptureScaledScreenshot(tabId, options = {}) {
  const { scale = 1, quality = 80, format = 'jpeg' } = options;
  await attachCDP(tabId);

  // 1. 获取目标视口真实尺寸与设备像素比
  const r = await sendCDPCommand(tabId, 'Runtime.evaluate', {
    expression: '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1, x: window.scrollX || 0, y: window.scrollY || 0 })',
    returnByValue: true
  });
  const v = r?.result?.value;
  const vpWidth = Number(v?.width) || 1280;
  const vpHeight = Number(v?.height) || 800;
  const dpr = Number(v?.dpr) > 0 ? Number(v.dpr) : 1;

  const physW = Math.round(vpWidth * dpr);
  const physH = Math.round(vpHeight * dpr);

  // 2. 求解最佳适配目标尺寸，限制在合理 Token 消耗和像素边长以内
  const [frameWidth] = targetSize(physW, physH);
  const s = clampScale(scale);
  const wantW = Math.max(1, Math.round(frameWidth * s));
  const wantH = Math.max(1, Math.round((physH * Math.min(1, frameWidth / physW)) * s));

  // 缩放系数直接传递给 DevTools Protocol clip.scale
  const clipScale = Math.min(1, wantW / (vpWidth * dpr));

  const params = {
    format: format === 'png' ? 'png' : 'jpeg',
    captureBeyondViewport: false,
    fromSurface: true,
    clip: {
      x: Number(v?.x) || 0,
      y: Number(v?.y) || 0,
      width: vpWidth,
      height: vpHeight,
      scale: clipScale
    }
  };
  if (params.format === 'jpeg') {
    params.quality = quality;
  }

  const shot = await sendCDPCommand(tabId, 'Page.captureScreenshot', params);
  if (!shot || !shot.data) {
    throw new Error('CDP 未返回任何截图数据');
  }

  return {
    dataUrl: `data:image/${params.format};base64,${shot.data}`,
    base64: shot.data,
    format: params.format,
    width: wantW,
    height: wantH,
    viewport: { width: vpWidth, height: vpHeight, dpr }
  };
}

// --------------------------------------------------------------------------
// 3. Chrome 标签组（Tab Groups）隔离机制 (借鉴自 browser-hands 并发底座)
// --------------------------------------------------------------------------
const AUTOPILOT_GROUP_TITLE = '🤖 ComLinkAI Auto-Pilot';
let autoPilotSession = {
  groupId: null,
  tabId: null,
  windowId: null,
  status: 'idle'
};

async function getOrCreateAutoPilotGroup(initialUrl = 'about:blank') {
  // 1. 尝试查找已存在的 Auto-Pilot 标签组
  if (chrome.tabGroups && chrome.tabGroups.query) {
    try {
      const groups = await chrome.tabGroups.query({});
      const existing = groups.find(g => (g.title || '').includes('ComLinkAI Auto-Pilot'));
      if (existing) {
        autoPilotSession.groupId = existing.id;
        autoPilotSession.windowId = existing.windowId;
        // 查找组内的标签页
        const tabs = await chrome.tabs.query({ groupId: existing.id });
        if (tabs && tabs.length > 0) {
          autoPilotSession.tabId = tabs[0].id;
          return { ...autoPilotSession, tab: tabs[0] };
        }
      }
    } catch (e) {
      console.warn('[ComLinkAI] 查询现有 tabGroup 失败:', e);
    }
  }

  // 2. 如果不存在组或组内无标签，新建一个后台隔离标签
  const newTab = await chrome.tabs.create({
    url: initialUrl,
    active: false // 保持后台运行，不抢占用户当前视窗！
  });
  autoPilotSession.tabId = newTab.id;
  autoPilotSession.windowId = newTab.windowId;

  // 3. 将其归并入专属标签组
  if (chrome.tabs.group) {
    try {
      const groupId = await chrome.tabs.group({
        tabIds: [newTab.id],
        createProperties: { windowId: newTab.windowId }
      });
      autoPilotSession.groupId = groupId;
      if (chrome.tabGroups && chrome.tabGroups.update) {
        await chrome.tabGroups.update(groupId, {
          title: `${AUTOPILOT_GROUP_TITLE} [就绪]`,
          color: 'cyan',
          collapsed: false
        });
      }
    } catch (err) {
      console.warn('[ComLinkAI] 创建 Tab Group 失败 (降级为独立标签页运行):', err);
    }
  }

  return { ...autoPilotSession, tab: newTab };
}

async function updateAutoPilotGroupStatus(statusText, color = 'cyan') {
  if (autoPilotSession.groupId && chrome.tabGroups && chrome.tabGroups.update) {
    try {
      await chrome.tabGroups.update(autoPilotSession.groupId, {
        title: `${AUTOPILOT_GROUP_TITLE} [${statusText}]`,
        color: color
      });
    } catch (e) {}
  }
}

// --------------------------------------------------------------------------
// 3.1 Per-Tab 看门狗 (45 秒硬超时) 与标签页生命周期回收
// --------------------------------------------------------------------------
const tabWatchdogs = new Map();
const TAB_WATCHDOG_TIMEOUT_MS = 45000; // 45 秒硬超时看门狗

function registerTabWatchdog(tabId) {
  clearTabWatchdog(tabId);
  const timer = setTimeout(async () => {
    console.warn(`[ComLinkAI Watchdog] ⚠️ 标签页 #${tabId} 超过 45 秒未收到完成信号，触发硬超时自动回收！`);
    try {
      if (attachedTabs.has(tabId)) {
        await detachCDP(tabId);
      }
      await chrome.tabs.remove(tabId);
    } catch (e) {
    } finally {
      tabWatchdogs.delete(tabId);
    }
  }, TAB_WATCHDOG_TIMEOUT_MS);

  tabWatchdogs.set(tabId, {
    timer,
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  });
}

function refreshTabWatchdog(tabId) {
  if (tabId && tabWatchdogs.has(tabId)) {
    const entry = tabWatchdogs.get(tabId);
    clearTimeout(entry.timer);
    entry.lastActiveAt = Date.now();
    entry.timer = setTimeout(async () => {
      console.warn(`[ComLinkAI Watchdog] ⚠️ 标签页 #${tabId} 超过 45 秒无新操作信号，触发硬超时自动回收！`);
      try {
        if (attachedTabs.has(tabId)) {
          await detachCDP(tabId);
        }
        await chrome.tabs.remove(tabId);
      } catch (e) {}
      tabWatchdogs.delete(tabId);
    }, TAB_WATCHDOG_TIMEOUT_MS);
  }
}

function clearTabWatchdog(tabId) {
  if (tabId && tabWatchdogs.has(tabId)) {
    clearTimeout(tabWatchdogs.get(tabId).timer);
    tabWatchdogs.delete(tabId);
  }
}

// 标签被关闭时的自愈保护与清理
chrome.tabs.onRemoved.addListener((closedTabId) => {
  clearTabWatchdog(closedTabId);
  if (attachedTabs.has(closedTabId)) {
    attachedTabs.delete(closedTabId);
  }
  if (autoPilotSession.tabId === closedTabId) {
    autoPilotSession.tabId = null;
  }
});

// 若 Auto-Pilot 标签弹出了子页面，自动吸纳进同一隔离组
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId && tab.openerTabId === autoPilotSession.tabId && autoPilotSession.groupId) {
    try {
      if (chrome.tabs.group) {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: autoPilotSession.groupId });
      }
    } catch (e) {}
  }
});

// --------------------------------------------------------------------------
// 4. 消息通信与指令分发管道
// --------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // 4.1 CDP 物理点击
  if (message.type === 'CDP_PHYSICAL_CLICK') {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('未找到活跃标签页。');
          tabId = tab.id;
        }
        const res = await cdpPhysicalClick(tabId, message.x, message.y);
        sendResponse({ success: true, data: res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4.2 CDP 模拟物理滚动
  if (message.type === 'CDP_PHYSICAL_SCROLL') {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('未找到活跃标签页。');
          tabId = tab.id;
        }
        await cdpPhysicalScroll(tabId, message.deltaY || 300);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4.2.1 CDP 物理按键与原生打字
  if (message.type === 'CDP_PHYSICAL_TYPE') {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('未找到活跃标签页。');
          tabId = tab.id;
        }
        await cdpPhysicalType(tabId, message.text || '');
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4.3 CDP 文字定位点击
  if (message.type === 'CDP_CLICK_BY_TEXT') {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('未找到活跃标签页。');
          tabId = tab.id;
        }

        const [{ result: coords }] = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (searchText) => {
            const els = Array.from(document.querySelectorAll('*'));
            const target = els.find(el => {
              const text = (el.innerText || '').trim();
              return text.toLowerCase() === searchText.trim().toLowerCase() || text.includes(searchText);
            });
            if (!target) return null;
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            const rect = target.getBoundingClientRect();
            return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              text: target.innerText.trim()
            };
          },
          args: [message.text]
        });

        if (!coords) {
          sendResponse({ success: false, error: `未在页面中找到文本为 "${message.text}" 的元素` });
          return;
        }

        await new Promise(r => setTimeout(r, 400));
        const cdpRes = await cdpPhysicalClick(tabId, coords.x, coords.y);
        sendResponse({ success: true, data: { ...cdpRes, text: coords.text } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4.4 🌟 CDP 原生截屏缩放接口 (学习自 browser-hands)
  if (message.type === 'CDP_CAPTURE_SCREENSHOT') {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('未找到活跃标签页。');
          tabId = tab.id;
        }
        const shotResult = await cdpCaptureScaledScreenshot(tabId, message.options || {});
        sendResponse({ success: true, data: shotResult });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4.5 🌟 Auto-Pilot 专属隔离标签组管理接口
  if (message.type === 'AUTOPILOT_GET_GROUP') {
    (async () => {
      try {
        const session = await getOrCreateAutoPilotGroup(message.url || 'about:blank');
        sendResponse({ success: true, data: session });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'AUTOPILOT_SET_STATUS') {
    (async () => {
      try {
        await updateAutoPilotGroupStatus(message.statusText, message.color);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'AUTOPILOT_FOCUS_TAB') {
    (async () => {
      try {
        if (autoPilotSession.tabId) {
          await chrome.tabs.update(autoPilotSession.tabId, { active: true });
          if (autoPilotSession.windowId) {
            await chrome.windows.update(autoPilotSession.windowId, { focused: true });
          }
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4.6 网址临时渲染截图 (已升级优先使用标签组隔离与 CDP 原生硬件缩放)
  if (message.type === 'CAPTURE_URL_SCREENSHOT') {
    (async () => {
      try {
        const targetUrl = message.url;
        if (!targetUrl) throw new Error('缺少目标网址 URL');

        // 在标签组中打开或创建临时 Tab
        const tempTab = await chrome.tabs.create({ url: targetUrl, active: false });

        // 等待网页完全加载
        await new Promise((resolve) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === tempTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(resolve, 8000); // 8秒超时保护
        });

        // 缓冲确保动效/字体渲染完整
        await new Promise(r => setTimeout(r, 1200));

        // 尝试通过 CDP 原生缩放截屏
        let dataUrl;
        try {
          const cdpShot = await cdpCaptureScaledScreenshot(tempTab.id, { quality: 80, scale: 0.8 });
          dataUrl = cdpShot.dataUrl;
        } catch (cdpErr) {
          // 降级使用 captureVisibleTab
          await chrome.tabs.update(tempTab.id, { active: true });
          await new Promise(r => setTimeout(r, 300));
          dataUrl = await new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab(tempTab.windowId, { format: 'jpeg', quality: 80 }, (res) => {
              if (chrome.runtime.lastError || !res) return reject(new Error('截图失败'));
              resolve(res);
            });
          });
        }

        // 清理临时 Tab
        await chrome.tabs.remove(tempTab.id).catch(() => {});

        sendResponse({ success: true, dataUrl });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// --------------------------------------------------------------------------
// 5. 辅助函数：TabId 智能解析与页面加载等待 (无侵入、不抢焦点)
// --------------------------------------------------------------------------
async function resolveTabId(providedTabId) {
  if (providedTabId !== undefined && providedTabId !== null) {
    const num = typeof providedTabId === 'string' ? parseInt(providedTabId, 10) : providedTabId;
    if (!isNaN(num)) {
      return num;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    return tab.id;
  }
  throw new Error('未提供有效 tabId 且当前无活跃标签页');
}

function waitForTabLoaded(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let finished = false;
    const start = Date.now();

    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    const timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        resolve({ loaded: false, timeout: true, elapsed: Date.now() - start });
      }
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (!finished) {
          const elapsed = Date.now() - start;
          cleanup();
          resolve({ loaded: true, timeout: false, elapsed });
        }
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then(t => {
      if (t && t.status === 'complete' && !finished) {
        const elapsed = Date.now() - start;
        cleanup();
        resolve({ loaded: true, timeout: false, elapsed });
      }
    }).catch(() => {});
  });
}

// --------------------------------------------------------------------------
// 6. 统一底层标签页独立动作处理器 (彻底解耦全局 Active Tab，支持纯后台运行)
// --------------------------------------------------------------------------
async function handleBackgroundAction(action, data = {}) {
  // 6.0 唤起/打开 ComLinkAI 侧边栏界面
  if (action === 'open_sidepanel') {
    let sidepanelOpened = false;
    let targetWindowId = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) targetWindowId = tab.windowId;
      if (targetWindowId && chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: targetWindowId });
        sidepanelOpened = true;
      }
    } catch (e) {
      console.warn('[ComLinkAI] chrome.sidePanel.open 需要用户手势，降级以全功能页面打开:', e.message);
    }

    if (!sidepanelOpened) {
      const sidepanelUrl = chrome.runtime.getURL('sidepanel.html');
      const newTab = await chrome.tabs.create({ url: sidepanelUrl, active: true });
      return { success: true, mode: 'tab', tabId: newTab.id, url: sidepanelUrl };
    }
    return { success: true, mode: 'native_sidepanel', windowId: targetWindowId };
  }

  // 6.1 静默创建后台隔离标签页 (active: false)
  if (action === 'create_tab') {
    const { url = 'about:blank' } = data;
    const newTab = await chrome.tabs.create({ url, active: false });
    registerTabWatchdog(newTab.id);
    console.log(`[ComLinkAI Background] 静默创建后台隔离标签页 #${newTab.id} (URL: ${url})`);
    return { success: true, tabId: newTab.id };
  }

  // 6.2 安全销毁指定标签页
  if (action === 'close_tab') {
    const targetTabId = data.tabId;
    if (!targetTabId) throw new Error('缺少 tabId 参数');
    clearTabWatchdog(targetTabId);
    if (attachedTabs.has(targetTabId)) {
      await detachCDP(targetTabId).catch(() => {});
    }
    await chrome.tabs.remove(targetTabId).catch(() => {});
    console.log(`[ComLinkAI Background] 已安全销毁标签页 #${targetTabId}`);
    return { success: true, tabId: targetTabId };
  }

  // 6.3 页面导航 (若提供 tabId 则坚决不切前台，保持后台运行)
  if (action === 'navigate') {
    const { url, tabId } = data;
    if (!url) throw new Error('缺少 url 参数');
    if (tabId) {
      refreshTabWatchdog(tabId);
      await chrome.tabs.update(tabId, { url });
      const loadRes = await waitForTabLoaded(tabId, data.timeout || 25000);
      return { success: true, tabId, url, ...loadRes };
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.tabs.update(tab.id, { url });
        const loadRes = await waitForTabLoaded(tab.id, data.timeout || 25000);
        return { success: true, tabId: tab.id, url, ...loadRes };
      } else {
        const newTab = await chrome.tabs.create({ url, active: true });
        const loadRes = await waitForTabLoaded(newTab.id, data.timeout || 25000);
        return { success: true, tabId: newTab.id, url, ...loadRes };
      }
    }
  }

  // 6.4 模拟真实点击 (支持指定 tabId，优先 CDP 物理轨迹，降级 DOM 点击)
  if (action === 'click') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const { selector } = data;
    if (!selector) throw new Error('缺少 selector 参数');

    let clickSuccess = false;
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
        const cdpRes = await cdpPhysicalClick(targetTabId, coords.x, coords.y);
        if (cdpRes && cdpRes.success) clickSuccess = true;
      }
    } catch (e) {}

    if (!clickSuccess) {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error('未找到元素: ' + sel);
          el.click();
          return true;
        },
        args: [selector]
      });
    }
    return { success: true, tabId: targetTabId };
  }

  // 6.5 模拟真实输入 (支持指定 tabId，优先 CDP 原生物理击键，降级原生 Event 触发)
  if (action === 'type') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const { selector, text, humanLike = true } = data;
    if (!selector) throw new Error('缺少 selector 参数');

    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('未找到输入框: ' + sel);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.focus();
      },
      args: [selector]
    });

    let typedByCdp = false;
    if (humanLike) {
      try {
        await cdpPhysicalType(targetTabId, text || '');
        typedByCdp = true;
      } catch (e) {}
    }

    if (!typedByCdp) {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error('未找到输入框: ' + sel);
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        },
        args: [selector, text || '']
      });
    }
    return { success: true, tabId: targetTabId, isCdp: typedByCdp };
  }

  // 6.6 CDP 原生硬件加速截屏 (原生支持后台 Tab，免去前台激活)
  if (action === 'screenshot') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    try {
      const shotResult = await cdpCaptureScaledScreenshot(targetTabId, data.options || { quality: 80, scale: 0.8 });
      return { dataUrl: shotResult.dataUrl, width: shotResult.width, height: shotResult.height, isNativeCdp: true, tabId: targetTabId };
    } catch (e) {
      return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
          if (chrome.runtime.lastError || !dataUrl) {
            return reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : '截图返回为空'));
          }
          resolve({ dataUrl, tabId: targetTabId });
        });
      });
    }
  }

  // 6.7 提取页面交互元素 (在指定后台 Tab 中执行)
  if (action === 'getElements') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => {
        const items = Array.from(document.querySelectorAll('button, a, input, textarea, select'));
        return items.filter(el => el.offsetHeight > 0 && el.offsetWidth > 0).slice(0, 80).map(el => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          name: el.name || null,
          text: (el.innerText || el.value || el.placeholder || '').trim().slice(0, 60),
          selector: el.id ? `#${el.id}` : (el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : null)
        }));
      }
    });
    return results && results[0] ? results[0].result : [];
  }

  // 6.8 模拟物理滚动
  if (action === 'scroll') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const { direction, amount = 400 } = data;
    const deltaY = direction === 'up' ? -amount : amount;
    try {
      await cdpPhysicalScroll(targetTabId, deltaY);
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (dy) => { window.scrollBy({ top: dy, behavior: 'smooth' }); },
        args: [deltaY]
      });
    }
    return { success: true, tabId: targetTabId };
  }

  // 6.9 键盘按键模拟
  if (action === 'keypress') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const { key, selector } = data;
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (k, sel) => {
        const target = sel ? document.querySelector(sel) : document.activeElement || document.body;
        if (!target) throw new Error('未找到按键目标元素');
        target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
      },
      args: [key, selector || null]
    });
    return { success: true, tabId: targetTabId };
  }

  // 6.10 等待特定元素出现
  if (action === 'waitForElement') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const { selector, timeout = 10000 } = data;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (sel) => !!document.querySelector(sel),
        args: [selector]
      });
      if (res && res[0] && res[0].result) {
        return { success: true, found: true, elapsed: Date.now() - start, tabId: targetTabId };
      }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`等待元素 [${selector}] 超时 (${timeout}ms)`);
  }

  // 6.11 等待页面加载完成
  if (action === 'waitForLoad') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const res = await waitForTabLoaded(targetTabId, data.timeout || 15000);
    return { success: true, tabId: targetTabId, ...res };
  }

  // 6.12 提取页面正文 Markdown 内容
  if (action === 'getActiveTab' || action === 'getTabContent') {
    const targetTabId = await resolveTabId(data.tabId);
    refreshTabWatchdog(targetTabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => ({
        title: document.title,
        url: window.location.href,
        content: document.body ? document.body.innerText : ''
      })
    });
    return results && results[0] ? results[0].result : { title: '', url: '', content: '' };
  }

  // 6.13 列出所有标签页
  if (action === 'listTabs') {
    const tabs = await chrome.tabs.query({});
    return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, groupId: t.groupId, active: t.active }));
  }

  // 6.14 内存自愈与全局上下文清理
  if (action === 'cleanup_context') {
    let closedCount = 0;
    for (const [tId] of tabWatchdogs) {
      try {
        if (attachedTabs.has(tId)) await detachCDP(tId).catch(() => {});
        await chrome.tabs.remove(tId);
        closedCount++;
      } catch (e) {}
    }
    tabWatchdogs.clear();
    console.log(`[ComLinkAI Background] 上下文清理完成，共回收 ${closedCount} 个后台任务标签页。`);
    return { success: true, closedCount };
  }

  // 6.15 重载扩展自身 (读取磁盘最新 manifest 与代码)
  if (action === 'reload_extension') {
    console.log('[ComLinkAI Background] 收到重载指令，正在执行 chrome.runtime.reload()...');
    setTimeout(() => {
      chrome.runtime.reload();
    }, 100);
    return { success: true, message: 'Extension reloading triggered' };
  }

  throw new Error(`[Background] 未知操作指令: ${action}`);
}

// --------------------------------------------------------------------------
// 7. Service Worker 通信长连接下沉 (独立于 Sidepanel，支持 7x24h 纯后台自动化)
// --------------------------------------------------------------------------
const SERVER_URLS = ['ws://127.0.0.1:3010', 'ws://localhost:3010'];
let bgWs = null;
let bgCandidateIdx = 0;
let bgReconnectTimer = null;
let bgHeartbeatTimer = null;

function connectBridgeWebSocket() {
  if (bgWs && (bgWs.readyState === WebSocket.OPEN || bgWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = SERVER_URLS[bgCandidateIdx % SERVER_URLS.length];
  try {
    bgWs = new WebSocket(url);

    bgWs.onopen = () => {
      console.log(`[ComLinkAI Background] 成功连接至本地 Bridge 服务: ${url}`);
      bgWs.send(JSON.stringify({ type: 'hello', role: 'background' }));
      if (bgReconnectTimer) {
        clearInterval(bgReconnectTimer);
        bgReconnectTimer = null;
      }
      if (bgHeartbeatTimer) clearInterval(bgHeartbeatTimer);
      // 10s 心跳保活，防止 MV3 Service Worker 意外休眠
      bgHeartbeatTimer = setInterval(() => {
        if (bgWs && bgWs.readyState === WebSocket.OPEN) {
          bgWs.send(JSON.stringify({ type: 'ping' }));
        }
      }, 10000);
    };

    bgWs.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { id, action, data, tabId, sessionId } = payload;
        if (!action) return;

        const mergedData = { ...(data || {}) };
        if (tabId !== undefined && mergedData.tabId === undefined) mergedData.tabId = tabId;
        if (sessionId !== undefined && mergedData.sessionId === undefined) mergedData.sessionId = sessionId;

        try {
          const res = await handleBackgroundAction(action, mergedData);
          bgWs.send(JSON.stringify({ id, type: 'response', data: res }));
        } catch (actErr) {
          bgWs.send(JSON.stringify({ id, type: 'response', error: actErr.message }));
        }
      } catch (err) {
        console.error('[ComLinkAI Background] 处理 Bridge 消息异常:', err);
      }
    };

    bgWs.onclose = () => {
      if (bgHeartbeatTimer) clearInterval(bgHeartbeatTimer);
      startBgReconnect();
    };

    bgWs.onerror = () => {
      if (bgHeartbeatTimer) clearInterval(bgHeartbeatTimer);
      startBgReconnect();
    };
  } catch (e) {
    startBgReconnect();
  }
}

function startBgReconnect() {
  if (bgReconnectTimer) return;
  bgReconnectTimer = setInterval(() => {
    if (!bgWs || bgWs.readyState === WebSocket.CLOSED) {
      bgCandidateIdx++;
      connectBridgeWebSocket();
    }
  }, 4000);
}

// 扩展初始化即刻启动后台连接
try {
  connectBridgeWebSocket();
} catch (e) {}
