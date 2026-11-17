/**
 * ComLinkAI Pro - 评论日志记录与去重数据库模块
 */

const STORAGE_KEYS = {
  PUBLISH_LOG: 'comlinkai_publish_log',
  PROCESSED_URLS: 'comlinkai_processed_urls',
  DOMAIN_HISTORY: 'comlinkai_domain_history'
};

class PublishLogger {
  constructor() {
    this.logs = this._load(STORAGE_KEYS.PUBLISH_LOG, []);
    let modified = false;
    this.logs.forEach(l => {
      if (!l.relevanceScore || l.relevanceScore === 0) {
        l.relevanceScore = l.score || 85;
        modified = true;
      }
    });
    if (modified) {
      this._save(STORAGE_KEYS.PUBLISH_LOG, this.logs);
    }
    this.processedUrls = new Set(this._load(STORAGE_KEYS.PROCESSED_URLS, []));
    this.domainHistory = this._load(STORAGE_KEYS.DOMAIN_HISTORY, {});
  }

  _getRealKey(key) {
    if (typeof window !== 'undefined' && window.projectManager) {
      return window.projectManager.getScopedKey(key);
    }
    return key;
  }

  _load(key, defaultValue) {
    try {
      const realKey = this._getRealKey(key);
      const data = localStorage.getItem(realKey);
      return data ? JSON.parse(data) : defaultValue;
    } catch (e) {
      console.warn(`[PublishLogger] 读取 ${key} 失败:`, e);
      return defaultValue;
    }
  }

  _save(key, data) {
    try {
      const realKey = this._getRealKey(key);
      localStorage.setItem(realKey, JSON.stringify(data));
    } catch (e) {
      console.warn(`[PublishLogger] 写入 ${key} 失败:`, e);
    }
  }

  /**
   * 切换项目时重载当前项目域的日志数据
   */
  reloadProjectContext() {
    this.logs = this._load(STORAGE_KEYS.PUBLISH_LOG, []);
    this.processedUrls = new Set(this._load(STORAGE_KEYS.PROCESSED_URLS, []));
    this.domainHistory = this._load(STORAGE_KEYS.DOMAIN_HISTORY, {});
  }


  /**
   * 检查 URL 是否已经处理/发布过 (高效不敏感容错匹配)
   * @param {string} url 
   * @returns {boolean}
   */
  isUrlProcessed(url) {
    if (!url) return false;
    const cleanUrl = url.split('#')[0].replace(/\/+$/, '').toLowerCase();
    
    if (this.processedUrls.has(cleanUrl) || this.processedUrls.has(url)) {
      return true;
    }

    for (const pUrl of this.processedUrls) {
      if (!pUrl) continue;
      const cleanP = pUrl.split('#')[0].replace(/\/+$/, '').toLowerCase();
      if (cleanP === cleanUrl) return true;
    }
    return false;
  }

  /**
   * 检查域名频率限制（例如同一域名 24 小时内只发布 1 次）
   * @param {string} domain 
   * @param {number} cooldownHours - 冷却小时数，默认 24 小时
   * @returns {boolean} - true 表示被频控锁定，建议跳过
   */
  isDomainRateLimited(domain, cooldownHours = 24) {
    if (!domain) return false;
    const lastTimestamp = this.domainHistory[domain.toLowerCase()];
    if (!lastTimestamp) return false;

    const diffHours = (Date.now() - lastTimestamp) / (1000 * 60 * 60);
    return diffHours < cooldownHours;
  }

  /**
   * 记录发布/审计日志
   * @param {Object} entry 
   * @param {string} entry.url - 目标网页 URL
   * @param {string} entry.domain - 目标域名
   * @param {string} entry.title - 网页标题
   * @param {'published'|'skipped'|'failed'|'toxic_blocked'} entry.status - 处理状态
   * @param {string} [entry.comment] - 生成的评论
   * @param {string} [entry.reason] - 跳过或失败的原因
   * @param {number} [entry.relevanceScore] - AI 主题契合度打分
   */
  logAction(entry) {
    const cleanUrl = (entry.url || '').split('#')[0].replace(/\/$/, '');
    const logItem = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      timestamp: new Date().toISOString(),
      url: cleanUrl,
      domain: entry.domain || (cleanUrl ? new URL(cleanUrl).hostname : ''),
      title: entry.title || '',
      status: entry.status,
      comment: entry.comment || '',
      reason: entry.reason || '',
      relevanceScore: (typeof entry.relevanceScore === 'number' && entry.relevanceScore > 0) ? entry.relevanceScore : (entry.score || 85),
      verifyStatus: entry.verifyStatus || (entry.status === 'published' ? 'unchecked' : 'none'),
      lastVerifiedAt: entry.lastVerifiedAt || null,
      relType: entry.relType || 'unknown',
      httpCode: entry.httpCode || 0
    };

    this.logs.unshift(logItem);
    if (this.logs.length > 2000) this.logs.pop(); // 限制最多保留 2000 条记录

    if (cleanUrl) {
      this.processedUrls.add(cleanUrl);
    }

    if (entry.status === 'published' && logItem.domain) {
      this.domainHistory[logItem.domain.toLowerCase()] = Date.now();
    }

    this._save(STORAGE_KEYS.PUBLISH_LOG, this.logs);
    this._save(STORAGE_KEYS.PROCESSED_URLS, Array.from(this.processedUrls));
    this._save(STORAGE_KEYS.DOMAIN_HISTORY, this.domainHistory);

    // 触发后台 Google Sheets 自动云端同步
    if (typeof window !== 'undefined' && window.googleSheetsSync && window.googleSheetsSync.config.autoSync) {
      try { window.googleSheetsSync.syncLogEntry(logItem); } catch (e) {}
    }

    return logItem;
  }

  /**
   * 更新特定日志条目的验证探针结果
   */
  updateVerifyStatus(id, result) {
    const item = this.logs.find(l => l.id === id);
    if (!item) return false;

    item.verifyStatus = result.verifyStatus;
    item.lastVerifiedAt = result.lastVerifiedAt || new Date().toISOString();
    item.relType = result.relType || item.relType;
    item.httpCode = result.httpCode || item.httpCode;
    if (result.message) item.verifyMessage = result.message;

    this._save(STORAGE_KEYS.PUBLISH_LOG, this.logs);

    // 触发后台 Google Sheets 自动云端同步
    if (typeof window !== 'undefined' && window.googleSheetsSync && window.googleSheetsSync.config.autoSync) {
      try { window.googleSheetsSync.syncLogEntry(item); } catch (e) {}
    }

    return true;
  }


  /**
   * 获取外链存活与统计分析汇总数据
   */
  getStatsSummary() {
    const publishedLogs = this.logs.filter(l => l.status === 'published');
    const totalPublished = publishedLogs.length;

    let liveDofollow = 0;
    let liveNofollow = 0;
    let pending = 0;
    let removed = 0;
    let unchecked = 0;

    let totalScore = 0;

    publishedLogs.forEach(l => {
      totalScore += (l.relevanceScore || 0);
      const v = l.verifyStatus || 'unchecked';
      if (v === 'live_dofollow') liveDofollow++;
      else if (v === 'live_nofollow') liveNofollow++;
      else if (v === 'pending') pending++;
      else if (v === 'removed' || v === 'http_error') removed++;
      else unchecked++;
    });

    const totalLive = liveDofollow + liveNofollow;
    const liveRate = totalPublished > 0 ? Math.round((totalLive / totalPublished) * 100) : 0;
    const avgScore = totalPublished > 0 ? Math.round(totalScore / totalPublished) : 0;

    return {
      totalLogs: this.logs.length,
      totalPublished: totalPublished,
      totalLive: totalLive,
      liveDofollow: liveDofollow,
      liveNofollow: liveNofollow,
      pending: pending,
      removed: removed,
      unchecked: unchecked,
      liveRate: liveRate,
      avgScore: avgScore
    };
  }

  /**
   * 获取所有日志记录
   */
  getLogs(filterStatus = null) {
    if (!filterStatus) return this.logs;
    return this.logs.filter(l => l.status === filterStatus || l.verifyStatus === filterStatus);
  }

  /**
   * 清除特定记录或全部日志
   */
  clearAll() {
    this.logs = [];
    this.processedUrls.clear();
    this.domainHistory = {};
    localStorage.removeItem(STORAGE_KEYS.PUBLISH_LOG);
    localStorage.removeItem(STORAGE_KEYS.PROCESSED_URLS);
    localStorage.removeItem(STORAGE_KEYS.DOMAIN_HISTORY);
  }

  /**
   * 导出日志为 CSV 文件格式字符串 (包含 UTF-8 BOM 防止 Excel 中文乱码)
   */
  exportToCSV() {
    const headers = ['Timestamp', 'URL', 'Domain', 'Title', 'Status', 'VerifyStatus', 'RelType', 'Score', 'Reason', 'Comment'];
    const rows = this.logs.map(l => [
      l.timestamp,
      `"${(l.url || '').replace(/"/g, '""')}"`,
      `"${(l.domain || '').replace(/"/g, '""')}"`,
      `"${(l.title || '').replace(/"/g, '""')}"`,
      l.status,
      l.verifyStatus || 'unchecked',
      l.relType || 'unknown',
      l.relevanceScore || 0,
      `"${(l.reason || '').replace(/"/g, '""')}"`,
      `"${(l.comment || '').replace(/"/g, '""')}"`
    ]);

    return '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

}

// 导出全局单例模式供 extension 使用
if (typeof window !== 'undefined') {
  window.publishLogger = new PublishLogger();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PublishLogger;
}
