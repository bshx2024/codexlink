// ==========================================
// CodexLink Background Service Worker (极简版)
// ==========================================

// 点击插件图标时，直接在浏览器右侧拉起侧边栏，随后该后台进程即可进入睡眠休眠
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('设置侧边栏行为失败:', err));
}
