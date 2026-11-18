/**
 * ComLinkAI - Google Sheets 谷歌表格 Webhook 实时同步引擎
 * 支持免 OAuth 的 Google Apps Script Webhook 直连，实现本地+云端表格无缝同步。
 */

const APPS_SCRIPT_TEMPLATE = `// ComLinkAI Google Sheets 动态多项目自动同步接收端 App
// 使用说明：在谷歌表格中点击 [扩展程序] -> [Apps Script]，粘贴本段代码并点击 [部署] -> [新建部署] -> 选择 [Web 应用]，将访问权限设为 [所有人 (Anyone)] 即可。

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = e && e.parameter && e.parameter.projectName ? e.parameter.projectName : null;
    var sheet = sheetName ? (ss.getSheetByName(sheetName) || ss.getActiveSheet()) : ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({"result": "success", "rows": []}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      rows.push({
        "timestamp": row[0] || "",
        "url": row[1] || "",
        "domain": row[2] || "",
        "title": row[3] || "",
        "status": row[4] || "published",
        "verifyStatus": row[5] || "unchecked",
        "relType": row[6] || "unknown",
        "relevanceScore": row[7] || 0,
        "comment": row[8] || ""
      });
    }
    
    return ContentService.createTextOutput(JSON.stringify({"result": "success", "rows": rows}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"result": "error", "error": err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    
    // 1. 处理新建项目自动建页签 (Sheet Tab) 指令
    if (data.action === "create_project") {
      var rawName = data.projectName || "未命名独立站项目";
      var projName = rawName.replace(/[\*\?\:\\\/\-\[\]]/g, " ").trim();
      if (projName.length > 80) projName = projName.substring(0, 80);
      if (!projName) projName = "独立站项目";

      var targetSheet = ss.getSheetByName(projName);
      if (!targetSheet) {
        targetSheet = ss.insertSheet(projName);
        targetSheet.appendRow([
          "时间戳 (Timestamp)", 
          "目标 URL (URL)", 
          "域名 (Domain)", 
          "页面标题 (Title)", 
          "发布/预填状态 (Status)", 
          "存活验证 (Verify Status)", 
          "外链类型 (Category)", 
          "契合度/安全分 (Score)", 
          "提交评论/产品描述 (Comment/Desc)"
        ]);
        targetSheet.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#00f2fe").setFontColor("#000000");
      }
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success", 
        "message": "已成功在谷歌表格中动态生成项目专属 Tab: " + projName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 处理外链存活状态更新指令 (update_status / update_batch)
    if (data.action === "update_status") {
      var projTabName = data.projectName || null;
      var sheet = projTabName ? (ss.getSheetByName(projTabName) || ss.getActiveSheet()) : ss.getActiveSheet();
      var rows = sheet.getDataRange().getValues();
      var updated = 0;
      var targetUrl = (data.url || "").trim();
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][1] === targetUrl) {
          if (data.verifyStatus) sheet.getRange(i + 1, 6).setValue(data.verifyStatus);
          if (data.relType) sheet.getRange(i + 1, 7).setValue(data.relType);
          updated++;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "updatedCount": updated,
        "message": "已成功更新 " + updated + " 条记录的存活状态"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. 处理常规日志写库 (按项目 Tab 归集)
    var projTabName = data.projectName || null;
    var sheet = projTabName ? (ss.getSheetByName(projTabName) || ss.getActiveSheet()) : ss.getActiveSheet();
    
    // 如果是首行，自动写入表头
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "时间戳 (Timestamp)", 
        "目标 URL (URL)", 
        "域名 (Domain)", 
        "页面标题 (Title)", 
        "发布/预填状态 (Status)", 
        "存活验证 (Verify Status)", 
        "外链类型 (Category)", 
        "契合度/安全分 (Score)", 
        "提交评论/产品描述 (Comment/Desc)"
      ]);
      sheet.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#e2e8f0");
    }

    var timestamp = data.timestamp || new Date().toISOString();
    var url = data.url || "";
    var domain = data.domain || "";
    var title = data.title || "";
    var status = data.status || "";
    var verifyStatus = data.verifyStatus || "unchecked";
    var category = data.category || data.relType || "blog_comment";
    var score = data.relevanceScore || 0;
    var comment = data.comment || "";

    // 追加新行
    sheet.appendRow([timestamp, url, domain, title, status, verifyStatus, category, score, comment]);

    return ContentService.createTextOutput(JSON.stringify({"result": "success", "message": "已成功同步至 Google Sheet"}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"result": "error", "error": err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
`;

class GoogleSheetsSync {
  constructor() {
    this.storageKey = 'comlinkai_gsheet_config';
    this.retryQueueKey = 'comlinkai_gsheet_retry_queue';
    this.config = this.loadConfig();
    this._isFlushing = false;
  }

  _getRealKey(key) {
    if (typeof window !== 'undefined' && window.projectManager) {
      return window.projectManager.getScopedKey(key);
    }
    return key;
  }

  loadConfig() {
    let cfg = { webhookUrl: '', autoSync: false };

    // 1. 严格针对当前独立站项目读取其专属 Webhook (多项目严格隔离，绝不串号)
    if (typeof window !== 'undefined' && window.projectManager) {
      try {
        const activeProj = window.projectManager.getActiveProject();
        if (activeProj && activeProj.gsheetWebhook && activeProj.gsheetWebhook.startsWith('https://script.google.com')) {
          cfg.webhookUrl = activeProj.gsheetWebhook;
          cfg.autoSync = activeProj.gsheetAutoSync !== false;
          return cfg;
        }
      } catch (e) {}
    }

    // 2. 从当前项目隔离的专属 localStorage 读取
    try {
      const realKey = this._getRealKey(this.storageKey);
      const data = localStorage.getItem(realKey);
      if (data) {
        cfg = { ...cfg, ...JSON.parse(data) };
      }
    } catch (e) {}

    return cfg;
  }

  /**
   * 切换独立站项目时，自动重载当前项目的专属 Webhook 配置
   */
  reloadProjectContext() {
    this.config = this.loadConfig();
    const input = document.getElementById('input-gsheet-webhook');
    const chk = document.getElementById('chk-gsheet-autosync');
    if (input) input.value = this.config.webhookUrl || '';
    if (chk) chk.checked = Boolean(this.config.autoSync);

    const activeProj = (typeof window !== 'undefined' && window.projectManager) ? window.projectManager.getActiveProject() : null;
    const projName = activeProj ? (activeProj.name || activeProj.profileName) : '当前独立站';
    const label = document.getElementById('lbl-gsheet-webhook-target');
    if (label) {
      label.textContent = `项目专属 Webhook URL (${projName})`;
    }
    console.log(`[GSheetsSync] 已切替至项目 [${projName}] 专属 Google Sheets 配置: ${this.config.webhookUrl ? '已绑定' : '未配置 (纯净待填)'}`);
  }

  _loadRetryQueue() {
    try {
      const realKey = this._getRealKey(this.retryQueueKey);
      const data = localStorage.getItem(realKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  _saveRetryQueue(queue) {
    try {
      const realKey = this._getRealKey(this.retryQueueKey);
      localStorage.setItem(realKey, JSON.stringify((queue || []).slice(0, 500)));
    } catch (e) {
      console.warn('[GSheetsSync] 保存离线重试队列失败:', e);
    }
  }

  getPendingRetryCount() {
    return this._loadRetryQueue().length;
  }

  saveConfig(webhookUrl, autoSync) {
    this.config = {
      webhookUrl: (webhookUrl || '').trim(),
      autoSync: Boolean(autoSync)
    };

    // 1. 严格写入当前项目的隔离专属 localStorage
    try {
      const realKey = this._getRealKey(this.storageKey);
      localStorage.setItem(realKey, JSON.stringify(this.config));
    } catch (e) {
      console.warn('[GSheetsSync] 保存配置失败:', e);
    }

    // 2. 同步绑定至当前活跃独立站项目的专属工程档案
    if (typeof window !== 'undefined' && window.projectManager) {
      try {
        window.projectManager.updateActiveProject({
          gsheetWebhook: this.config.webhookUrl,
          gsheetAutoSync: this.config.autoSync
        });
      } catch (e) {}
    }

    // 3. 写入 chrome.storage.local (项目级隔离键)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const realKey = this._getRealKey(this.storageKey);
        chrome.storage.local.set({ [realKey]: this.config });
      } catch (e) {}
    }

    return this.config;
  }

  getAppsScriptCode() {
    return APPS_SCRIPT_TEMPLATE;
  }

  isConfigured() {
    return Boolean(this.config.webhookUrl && this.config.webhookUrl.startsWith('https://script.google.com'));
  }

  /**
   * 从 Google Sheet 双向拉取所有数据记录
   */
  async fetchLogEntriesFromSheet() {
    if (!this.isConfigured()) {
      throw new Error('未配置有效的 Google Sheet Webhook URL');
    }

    const resp = await fetch(this.config.webhookUrl, {
      method: 'GET'
    });

    if (!resp.ok) {
      throw new Error(`Google Sheet 接口响应错误 (HTTP ${resp.status})`);
    }

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('script completed')) {
        throw new Error('谷歌 Apps Script 代码中缺失 doGet 函数 (返回了 HTML 网页错误)。请确保将最新代码粘贴覆盖 Code.gs 编辑窗口，并重新部署 [新版本]。');
      }
      throw new Error(`解析 Google Sheet 数据失败: ${e.message}`);
    }

    if (data.result === 'error') {
      throw new Error(data.error || 'Google Apps Script 读取失败');
    }

    return data.rows || [];
  }

  /**
   * 通知 Google Sheet 自动创建项目专属 Tab 页签
   * @param {string} projectName 
   * @param {string} customWebhookUrl 
   */
  async createProjectTab(projectName, customWebhookUrl = null) {
    const webhook = customWebhookUrl || this.config.webhookUrl;
    if (!webhook || !webhook.startsWith('https://script.google.com')) {
      return { success: false, reason: '未配置有效的 Google Sheet Webhook URL' };
    }

    try {
      await fetch(webhook, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project',
          projectName: projectName || '未命名独立站项目'
        })
      });
      return { success: true, message: `已向 Google Sheet 发送自动创建项目页签指令: ${projectName}` };
    } catch (e) {
      console.warn('[GSheetsSync] 自动创建项目页签失败:', e);
      return { success: false, reason: e.message };
    }
  }

  /**
   * 同步单条日志条目至 Google Sheet
   */
  async syncLogEntry(logEntry) {
    if (!this.isConfigured()) {
      return { success: false, reason: '未配置有效的 Google Sheet Webhook URL' };
    }

    const activeProj = (typeof window !== 'undefined' && window.projectManager) ? window.projectManager.getActiveProject() : null;
    const targetProjName = logEntry.projectName || (activeProj ? (activeProj.name || activeProj.profileName) : '');

    const payload = {
      action: 'sync_log',
      projectName: targetProjName,
      timestamp: logEntry.timestamp || new Date().toISOString(),
      url: logEntry.url || '',
      domain: logEntry.domain || '',
      title: logEntry.title || '',
      status: logEntry.status || 'published',
      verifyStatus: logEntry.verifyStatus || 'unchecked',
      category: logEntry.category || logEntry.relType || 'blog_comment',
      relevanceScore: logEntry.relevanceScore || 0,
      comment: logEntry.comment || ''
    };

    try {
      // 使用 no-cors 跨域处理 Google Apps Script 的重定向
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      // 发送成功后，若有历史离线条目，后台异步触发刷新
      setTimeout(() => this.flushRetryQueue(), 500);

      return { success: true, message: '数据已平滑推送至 Google Sheet' };
    } catch (e) {
      console.warn('[GSheetsSync] 推送 Google Sheet 失败，已加入离线重试队列:', e);
      // 离线容错：将失败条目持久化到重试队列
      const queue = this._loadRetryQueue();
      queue.push(payload);
      this._saveRetryQueue(queue);
      return { success: false, queuedForRetry: true, reason: e.message };
    }
  }

  /**
   * 渐进式消费离线重试队列，自动恢复补发
   */
  async flushRetryQueue() {
    if (this._isFlushing || !this.isConfigured()) return;
    const queue = this._loadRetryQueue();
    if (!queue.length) return;

    this._isFlushing = true;
    console.log(`[GSheetsSync] 正在尝试清空离线重试队列，待重试: ${queue.length} 条...`);

    const remaining = [...queue];
    try {
      while (remaining.length > 0) {
        const item = remaining[0];
        try {
          await fetch(this.config.webhookUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          remaining.shift();
          this._saveRetryQueue(remaining);
          await new Promise(r => setTimeout(r, 400));
        } catch (postErr) {
          console.warn('[GSheetsSync] 离线队列重试中断 (网络仍未恢复):', postErr);
          break;
        }
      }
    } finally {
      this._saveRetryQueue(remaining);
      this._isFlushing = false;
    }
  }

  /**
   * 批量将历史日志全量同步至 Google Sheet
   */
  async syncBatch(logEntries, onProgress = null) {
    if (!this.isConfigured()) {
      throw new Error('未配置有效的 Google Sheet Webhook URL');
    }

    const total = logEntries.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const entry = logEntries[i];
      const res = await this.syncLogEntry(entry);
      if (res.success) successCount++;

      if (onProgress) {
        onProgress(i + 1, total, entry);
      }

      // 400ms 间隔避免触发 谷歌脚本并发写风控
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    return { total, successCount };
  }
}

// 导出单例模式
if (typeof window !== 'undefined') {
  window.googleSheetsSync = new GoogleSheetsSync();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GoogleSheetsSync;
}
