/**
 * ComLinkAI - 外链存活探针与状态检测模块
 * 用于异步检测提交过的反链目标网页，验证 HTTP 可达性、留言存活状态及 DoFollow/NoFollow 属性。
 */

class LinkChecker {
  constructor() {
    this.timeoutMs = 8000;
  }

  /**
   * 规范化 URL 清理
   */
  _normalizeUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.origin + parsed.pathname;
    } catch (e) {
      return url.split('#')[0].replace(/\/$/, '');
    }
  }

  /**
   * 核心检测函数：针对单条日志进行探针检测
   * @param {Object} logEntry - 日志条目
   * @param {string} userWebsiteUrl - 用户的引流目标网址 (Profile 中设置的 Website)
   * @param {string} [userName] - 用户的留言姓名
   * @returns {Promise<Object>} 结构化检测结果
   */
  async checkLogEntry(logEntry, userWebsiteUrl, userName = '') {
    if (!logEntry || !logEntry.url) {
      return {
        verifyStatus: 'error',
        httpCode: 0,
        relType: 'unknown',
        lastVerifiedAt: new Date().toISOString(),
        message: '无效的目标 URL'
      };
    }

    const targetUrl = logEntry.url;
    const cleanUserWebsite = this._normalizeUrl(userWebsiteUrl);
    const rawUserWebsite = (userWebsiteUrl || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const resp = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const httpCode = resp.status;
      if (!resp.ok) {
        return {
          verifyStatus: 'http_error',
          httpCode: httpCode,
          relType: 'none',
          lastVerifiedAt: new Date().toISOString(),
          message: `目标网页响应错误 (HTTP ${httpCode})`
        };
      }

      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 搜索包含用户网址的 <a> 标签
      const links = Array.from(doc.querySelectorAll('a[href]'));
      let matchedLink = null;

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (cleanUserWebsite && href.includes(cleanUserWebsite)) {
          matchedLink = link;
          break;
        }
        if (rawUserWebsite && href.includes(rawUserWebsite)) {
          matchedLink = link;
          break;
        }
      }

      // 1. 如果找到了包含用户网址的外链 <a> 标签 -> 存活公开 (Live)
      if (matchedLink) {
        const relAttr = (matchedLink.getAttribute('rel') || '').toLowerCase();
        const isNoFollow = relAttr.includes('nofollow') || relAttr.includes('ugc');
        const relType = isNoFollow ? 'nofollow' : 'dofollow';
        const verifyStatus = isNoFollow ? 'live_nofollow' : 'live_dofollow';

        return {
          verifyStatus: verifyStatus,
          httpCode: httpCode,
          relType: relType,
          lastVerifiedAt: new Date().toISOString(),
          message: `外链完全在线！属性: ${relType.toUpperCase()}`
        };
      }

      // 2. 如果没找到外链，检查页面中是否包含留言作者姓名或评论片段 -> 待审核中 (Pending)
      const pageText = doc.body ? doc.body.textContent || '' : '';
      const cleanComment = (logEntry.comment || '').substring(0, 30).trim();

      const nameMatched = userName && pageText.includes(userName);
      const commentMatched = cleanComment && pageText.includes(cleanComment);

      if (nameMatched || commentMatched) {
        return {
          verifyStatus: 'pending',
          httpCode: httpCode,
          relType: 'pending',
          lastVerifiedAt: new Date().toISOString(),
          message: '评论已录入页面，博主审核中/尚无公开外链'
        };
      }

      // 3. 既无公开外链也无显式痕迹 -> 新近提交 (72小时内) 归为博主人工待审核中 (Pending)，超过 72 小时才标记为未通过/未公开
      const hoursSinceSubmit = logEntry.timestamp ? (Date.now() - new Date(logEntry.timestamp).getTime()) / (1000 * 3600) : 0;
      if (hoursSinceSubmit < 72) {
        return {
          verifyStatus: 'pending',
          httpCode: httpCode,
          relType: 'pending',
          lastVerifiedAt: new Date().toISOString(),
          message: '目标网页正常可达 (HTTP 200)，留言已进入博主后台人工审核队列 (通常需 12-48 小时博主批复)'
        };
      }

      return {
        verifyStatus: 'removed',
        httpCode: httpCode,
        relType: 'none',
        lastVerifiedAt: new Date().toISOString(),
        message: '未侦测到公开外链 (博主未通过或未发表)'
      };

    } catch (e) {
      const isAbort = e.name === 'AbortError' || e.message.includes('abort') || e.message.includes('fetch');
      return {
        verifyStatus: isAbort ? 'timeout_error' : 'http_error',
        httpCode: isAbort ? 408 : 0,
        relType: 'unknown',
        lastVerifiedAt: new Date().toISOString(),
        message: isAbort ? '目标站响应超时 (海外节点慢/CORS拦截)' : `网络探针失败: ${e.message}`
      };
    }
  }

  /**
   * 自动探测单条目标 URL 是否包含开放的留言/评论表单
   * @param {string} targetUrl 
   * @returns {Promise<{ isCommentable: boolean, reason: string, fields: string[], httpCode: number }>}
   */
  async checkPageCommentForm(targetUrl) {
    if (!targetUrl) {
      return { isCommentable: false, reason: 'URL 无效', fields: [], httpCode: 0 };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs || 8000);

      const resp = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        return { isCommentable: false, reason: `HTTP 响应失败 (HTTP ${resp.status})`, fields: [], httpCode: resp.status };
      }

      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      if (typeof FormDetector !== 'undefined') {
        const formRes = FormDetector.inspectDOM(doc);
        if (formRes.status === 'commentable' || formRes.status === 'captcha_protected') {
          return { isCommentable: true, reason: formRes.details, fields: formRes.fields, httpCode: resp.status };
        } else {
          return { isCommentable: false, reason: formRes.details || '未找到评论输入框/评论已关闭', fields: [], httpCode: resp.status };
        }
      }

      // 兜底 DOM 匹配：检查 HTML 中是否包含评论关键字或输入框
      const hasTextarea = html.includes('<textarea') || html.includes('name="comment"') || html.includes('id="comment"');
      const hasInputs = (html.includes('name="author"') || html.includes('id="author"')) && (html.includes('name="email"') || html.includes('id="email"'));
      const hasWidget = html.includes('disqus_thread') || html.includes('giscus') || html.includes('utterances');

      if (hasWidget || (hasTextarea && hasInputs)) {
        return { isCommentable: true, reason: '静态解析匹配到开放评论区', fields: ['CommentForm'], httpCode: resp.status };
      }

      return { isCommentable: false, reason: '未检索到开放留言框/静态页面', fields: [], httpCode: resp.status };

    } catch (e) {
      const isAbort = e.name === 'AbortError' || e.message.includes('abort') || e.message.includes('fetch');
      return { isCommentable: false, reason: isAbort ? '目标站响应超时 (海外节点慢/CORS拦截)' : `网络探针失败: ${e.message}`, fields: [], httpCode: 0 };
    }
  }

  /**
   * 批量检测多条日志
   * @param {Array} logEntries 
   * @param {string} userWebsiteUrl 
   * @param {string} userName 
   * @param {Function} [onProgress] - 进度回调 (current, total, currentResult)
   */
  async checkBatch(logEntries, userWebsiteUrl, userName = '', onProgress = null) {
    const results = [];
    const total = logEntries.length;

    for (let i = 0; i < total; i++) {
      const entry = logEntries[i];
      const res = await this.checkLogEntry(entry, userWebsiteUrl, userName);
      results.push({ id: entry.id, result: res });

      if (onProgress) {
        onProgress(i + 1, total, { id: entry.id, result: res });
      }

      // 微小间隔避免频繁请求并发触发风控
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return results;
  }
}

// 导出全局单例
if (typeof window !== 'undefined') {
  window.linkChecker = new LinkChecker();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LinkChecker;
}
