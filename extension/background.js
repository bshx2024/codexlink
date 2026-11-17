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

// 标签被关闭时的自愈保护与清理
chrome.tabs.onRemoved.addListener((closedTabId) => {
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
