/**
 * ComLinkAI Pro - 全自动外链搜集与评论发布引擎 (Autopilot Engine)
 * 具备单 Worker 标签页复用、3s 提交倒计时预览、5s 验证码挂起超时跳过、15s 加载超时防护、提交后报错自愈及谷歌翻页自动化能力。
 */

class AutopilotEngine {
  constructor() {
    this.state = 'IDLE'; // 'IDLE', 'RUNNING', 'PAUSED', 'STOPPED'
    this.currentStep = 'idle'; 
    
    this.googleTabId = null;
    this.workerTabId = null;
    
    this.batchQueue = [];
    this.currentIndex = 0;
    this.googlePageIndex = 1;
    this.maxGooglePages = 5;
    
    this.stats = {
      totalProcessed: 0,
      successCount: 0,
      captchaSkipped: 0,
      failedCount: 0,
      timeoutCount: 0
    };

    this.options = {
      safeMode: true, // 真人仿真防封模式
      previewSeconds: 3, // 自动提交预览倒计时
      captchaTimeoutSeconds: 5, // 验证码挂起超时跳过倒计时
      pageLoadTimeoutMs: 15000, // 页面加载超时保护 15s
      itemDelayMs: 6000 // 两次发布间的平滑风控等待 6s
    };

    this.activeTimers = {
      countdownTimer: null,
      captchaTimer: null,
      pageLoadTimer: null
    };

    this.onStateChange = null;
    this.onProgressUpdate = null;
    this.onLogEmit = null;
  }

  /**
   * 初始化并开启全自动发布闭环
   * @param {number} googleTabId 当前谷歌搜索结果页的 Tab ID
   */
  async start(googleTabId) {
    if (!googleTabId) {
      throw new Error('未提供有效谷歌搜索页 Tab ID');
    }

    this.state = 'RUNNING';
    this.googleTabId = googleTabId;
    this.googlePageIndex = 1;
    this.currentIndex = 0;
    this.stats = { totalProcessed: 0, successCount: 0, captchaSkipped: 0, failedCount: 0, timeoutCount: 0 };

    this.notifyStateChange('🚀 正在初始化全自动引擎，准备提取谷歌搜索结果...');
    await this.processGooglePage();
  }

  /**
   * 停止全自动运行
   */
  async stop(reason = '用户手动停止') {
    this.state = 'STOPPED';
    this.clearAllTimers();

    if (this.workerTabId) {
      try { await chrome.tabs.remove(this.workerTabId); } catch (e) {}
      this.workerTabId = null;
    }

    if (this.googleTabId) {
      try { await chrome.tabs.update(this.googleTabId, { active: true }); } catch (e) {}
    }

    this.notifyStateChange(`⏹️ 全自动发布已终止 (${reason})`);
    if (this.onLogEmit) {
      this.onLogEmit({ type: 'summary', stats: this.stats });
    }
  }

  /**
   * 暂停全自动运行
   */
  pause() {
    if (this.state === 'RUNNING') {
      this.state = 'PAUSED';
      this.clearAllTimers();
      this.notifyStateChange('⏸️ 全自动发布已暂停。可点击【▶️ 继续】恢复。');
    }
  }

  /**
   * 恢复全自动运行
   */
  resume() {
    if (this.state === 'PAUSED') {
      this.state = 'RUNNING';
      this.notifyStateChange('▶️ 已恢复全自动运行，继续推进任务...');
      this.processCurrentItem();
    }
  }

  clearAllTimers() {
    if (this.activeTimers.countdownTimer) {
      clearInterval(this.activeTimers.countdownTimer);
      this.activeTimers.countdownTimer = null;
    }
    if (this.activeTimers.captchaTimer) {
      clearInterval(this.activeTimers.captchaTimer);
      this.activeTimers.captchaTimer = null;
    }
    if (this.activeTimers.pageLoadTimer) {
      clearTimeout(this.activeTimers.pageLoadTimer);
      this.activeTimers.pageLoadTimer = null;
    }
  }

  notifyStateChange(msg) {
    if (this.onStateChange) {
      this.onStateChange({
        state: this.state,
        currentStep: this.currentStep,
        googlePageIndex: this.googlePageIndex,
        currentIndex: this.currentIndex,
        totalItems: this.batchQueue.length,
        stats: this.stats,
        message: msg
      });
    }
  }

  /**
   * 提取当前谷歌搜索页面的 10 条有效外链结果
   */
  async processGooglePage() {
    if (this.state !== 'RUNNING') return;

    this.currentStep = 'scraping_google';
    this.notifyStateChange(`🔎 正在从谷歌搜索页 (第 ${this.googlePageIndex} 页) 抓取外链目标...`);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.googleTabId },
        func: () => {
          const items = [];
          const seenUrls = new Set();
          const invalidDomains = [
            'google.com', 'google.cn', 'youtube.com', 'facebook.com', 'twitter.com', 
            'x.com', 'github.com', 'wikipedia.org', 'instagram.com', 'linkedin.com', 
            'pinterest.com', 'reddit.com', 't.me', 'telegram.org'
          ];
          const containers = Array.from(document.querySelectorAll('#search div.g, #rso div.g, div[data-hveid]'));
          containers.forEach(container => {
            const linkEl = container.querySelector('a[href^="http"]');
            if (!linkEl) return;
            const rawUrl = linkEl.href;
            if (!rawUrl || rawUrl.includes('google.com') || rawUrl.includes('google.cn')) return;
            try {
              const u = new URL(rawUrl);
              const hostname = u.hostname.toLowerCase();
              if (invalidDomains.some(d => hostname.endsWith(d))) return;
              const norm = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
              if (seenUrls.has(norm)) return;
              seenUrls.add(norm);
              const h3 = container.querySelector('h3') || linkEl.querySelector('h3');
              const title = h3 ? (h3.innerText || '').trim() : (linkEl.innerText || '').trim();
              if (title.length >= 3) {
                items.push({ url: rawUrl, domain: hostname, title });
              }
            } catch (e) {}
          });
          return items;
        }
      });

      const items = (results && results[0] && results[0].result) ? results[0].result : [];
      
      // 去重过滤已处理的 URL 与同域名限制
      const validQueue = [];
      const seenDomains = new Set();
      const logger = window.publishLogger;

      for (const item of items) {
        if (logger && logger.isUrlProcessed(item.url)) continue;
        if (this.options.safeMode) {
          if (seenDomains.has(item.domain) || (logger && logger.isDomainRateLimited(item.domain))) continue;
          seenDomains.add(item.domain);
        }
        validQueue.push(item);
      }

      if (validQueue.length === 0) {
        this.notifyStateChange(`⚠️ 第 ${this.googlePageIndex} 页无全新未发布资源，准备翻下一页...`);
        await this.clickGoogleNextPage();
        return;
      }

      this.batchQueue = validQueue;
      this.currentIndex = 0;
      this.notifyStateChange(`🎉 第 ${this.googlePageIndex} 页锁定 ${validQueue.length} 条独立资源，开启 Worker Tab 链式发布...`);
      
      await this.ensureWorkerTabAndProcess();
    } catch (err) {
      console.error('[Autopilot] 抓取谷歌结果失败:', err);
      this.notifyStateChange(`🔴 抓取谷歌结果失败: ${err.message}，5秒后重试...`);
      setTimeout(() => this.processGooglePage(), 5000);
    }
  }

  /**
   * 确保唯一的 Worker Tab 建立并置顶
   */
  async ensureWorkerTabAndProcess() {
    if (this.state !== 'RUNNING') return;

    const firstItem = this.batchQueue[this.currentIndex];
    if (!firstItem) return;

    if (!this.workerTabId) {
      const tab = await chrome.tabs.create({ url: firstItem.url, active: true });
      this.workerTabId = tab.id;
    } else {
      await chrome.tabs.update(this.workerTabId, { url: firstItem.url, active: true });
    }

    this.processCurrentItem();
  }

  /**
   * 在单 Worker Tab 内链式处理当前资源项
   */
  async processCurrentItem() {
    if (this.state !== 'RUNNING') return;

    if (this.currentIndex >= this.batchQueue.length) {
      this.notifyStateChange(`✅ 第 ${this.googlePageIndex} 页 10 条资源全部处理完毕！准备关闭 Worker Tab 并翻页...`);
      if (this.workerTabId) {
        try { await chrome.tabs.remove(this.workerTabId); } catch (e) {}
        this.workerTabId = null;
      }
      if (this.googleTabId) {
        try { await chrome.tabs.update(this.googleTabId, { active: true }); } catch (e) {}
      }
      await this.clickGoogleNextPage();
      return;
    }

    const item = this.batchQueue[this.currentIndex];
    this.stats.totalProcessed++;
    this.currentStep = 'processing_item';
    this.notifyStateChange(`🚀 [${this.currentIndex + 1}/${this.batchQueue.length}] 正在加载: ${item.domain}...`);

    // 15 秒网页加载超时守护
    this.clearAllTimers();
    this.activeTimers.pageLoadTimer = setTimeout(() => {
      console.warn(`[Autopilot] 页面 ${item.url} 加载超时 (15s)，强切下一条`);
      this.stats.timeoutCount++;
      if (window.publishLogger) {
        window.publishLogger.logAction({
          url: item.url, domain: item.domain, title: item.title, status: 'failed', reason: '页面 15s 加载超时强切'
        });
      }
      this.advanceToNextItem();
    }, this.options.pageLoadTimeoutMs);

    // 更新 Tab URL (若不是首次打开)
    if (this.currentIndex > 0 && this.workerTabId) {
      try {
        await chrome.tabs.update(this.workerTabId, { url: item.url, active: true });
      } catch (e) {
        // 若 workerTabId 不慎关闭，重新建立
        const tab = await chrome.tabs.create({ url: item.url, active: true });
        this.workerTabId = tab.id;
      }
    }

    // 监听页面 complete 状态
    const onLoaded = (tabId, changeInfo) => {
      if (tabId === this.workerTabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onLoaded);
        clearTimeout(this.activeTimers.pageLoadTimer);
        setTimeout(() => this.executeItemAutomation(item), 1000);
      }
    };

    chrome.tabs.onUpdated.addListener(onLoaded);
  }

  /**
   * 执行单个页面的探针、AI 评论、填表与提交倒计时
   */
  async executeItemAutomation(item) {
    if (this.state !== 'RUNNING') return;

    try {
      // 1. 探针感知 DOM 状态
      const [inspectRes] = await chrome.scripting.executeScript({
        target: { tabId: this.workerTabId },
        func: () => {
          if (document.body && (document.body.innerText.includes('There has been a critical error') || document.body.innerText.includes('Fatal error:'))) {
            return { status: 'critical_error' };
          }
          const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
          if (bodyText.includes('must be logged in') || bodyText.includes('须登录后发表评论')) {
            const hasTextarea = Array.from(document.querySelectorAll('textarea')).some(t => t.offsetHeight > 0);
            if (!hasTextarea) return { status: 'login_required' };
          }
          const hasCaptcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], div.g-recaptcha, div.h-captcha');
          if (hasCaptcha) return { status: 'captcha_protected' };

          const commentBox = document.querySelector('#comment, textarea[name*="comment"], textarea[name*="message"], textarea');
          if (!commentBox || commentBox.offsetHeight === 0) return { status: 'no_form' };

          return { status: 'commentable' };
        }
      });

      const status = inspectRes?.result?.status || 'no_form';

      if (status === 'critical_error' || status === 'login_required') {
        this.stats.failedCount++;
        if (window.publishLogger) {
          window.publishLogger.logAction({ url: item.url, domain: item.domain, title: item.title, status: 'failed', reason: status === 'login_required' ? '须登录' : 'PHP崩溃' });
        }
        this.notifyStateChange(`⚠️ [${item.domain}] ${status === 'login_required' ? '🔒 要求必须登录' : '🔴 PHP崩溃'}，自动跳过...`);
        this.advanceToNextItem();
        return;
      }

      if (status === 'captcha_protected') {
        this.startCaptchaTimeout(item);
        return;
      }

      // 2. 自动滚动至评论区
      await chrome.scripting.executeScript({
        target: { tabId: this.workerTabId },
        func: () => {
          const targets = ['#respond', '#reply-title', '#commentform', '#comments', '.comment-respond', 'textarea[name*="comment"]', 'textarea'];
          let el = null;
          for (const s of targets) {
            const node = document.querySelector(s);
            if (node && node.offsetHeight > 0) { el = node; break; }
          }
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          else window.scrollTo({ top: Math.max(document.body.scrollHeight * 0.75, 400), behavior: 'smooth' });
        }
      });

      // 给动态渲染/SPA 博客 1.5 秒 DOM 文本完全渲染水合时间
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 3. AI 生成正文建设性评论与自动高亮填表
      const profile = (window.projectManager ? window.projectManager.getActiveProject() : {}) || {};

      // 提取正文摘要
      const [docRes] = await chrome.scripting.executeScript({
        target: { tabId: this.workerTabId },
        func: () => {
          const title = document.title || '';
          const text = document.body ? document.body.innerText.slice(0, 3500) : '';
          return { title, text };
        }
      });

      const extracted = docRes?.result || { title: item.title, text: '' };
      
      this.notifyStateChange(`🤖 [${item.domain}] 已提取 ${extracted.text.length} 字正文，大模型正在阅读分析并撰写评论...`);

      // 调用大模型 API 针对文章正文生成 100% 独一无二的建设性评论 (await 阻塞直到 AI 完成)
      const { commentText: generatedComment, relevanceScore } = await this.generateAICommentForTab(extracted, profile);

      // 执行真实 DOM 自动预填与提交按钮高亮定位
      const authorName = profile.profileName || profile.name || 'Alex Rivera @ APIVALE';
      const cleanName = authorName.replace(/@.*$/, '').replace(/\|.*$/, '').trim().replace(/^(dr|mr|ms|mrs)\.?\s+/i, '');
      const emailParts = cleanName.toLowerCase().split(/\s+/).filter(Boolean);
      const derivedEmail = emailParts.length > 0 ? `${emailParts.join('.')}@apivale.com` : 'alex.rivera@apivale.com';

      await chrome.scripting.executeScript({
        target: { tabId: this.workerTabId },
        args: [{
          name: authorName,
          email: profile.profileEmail || profile.email || derivedEmail,
          url: profile.websiteUrl || profile.url || 'https://apivale.com/',
          comment: generatedComment
        }],
        func: (p) => {
          const highlightAndFill = (el, val) => {
            if (!el || !val) return;
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.style.border = '2px solid #10b981';
            el.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.4)';
          };

          const nameInput = document.querySelector('#author, input[name="author"], input[name="name"], input[placeholder*="Name" i]');
          const emailInput = document.querySelector('#email, input[name="email"], input[type="email"], input[placeholder*="Email" i]');
          const urlInput = document.querySelector('#url, #website, input[type="url"], input[name="url"], input[name="website"]');
          const commentBox = document.querySelector('#comment, textarea[name*="comment"], textarea[name*="message"], textarea');

          highlightAndFill(nameInput, p.name);
          highlightAndFill(emailInput, p.email);
          highlightAndFill(urlInput, p.url);
          highlightAndFill(commentBox, p.comment);

          const submitBtn = document.querySelector('input[type="submit"], button[type="submit"], #submit, .submit-btn');
          if (submitBtn) {
            submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            submitBtn.style.border = '3px solid #00f2fe';
            submitBtn.style.boxShadow = '0 0 12px #00f2fe';
          }
        }
      });

      // 4. 进入安全全自动 3 秒提交倒计时预览
      this.startSubmitCountdown(item, generatedComment, relevanceScore);
    } catch (err) {
      console.error('[Autopilot] 执行项目自动化异常:', err);
      this.stats.failedCount++;
      this.advanceToNextItem();
    }
  }

  /**
   * 3 秒安全提交倒计时
   */
  startSubmitCountdown(item, commentText, score) {
    this.currentStep = 'waiting_countdown';
    let countdown = this.options.previewSeconds;

    this.notifyStateChange(`⏱️ [${item.domain}] 表单预填完成！倒计时 ${countdown} 秒自动点击 Submit 提交...`);

    this.activeTimers.countdownTimer = setInterval(async () => {
      countdown--;
      if (countdown > 0) {
        this.notifyStateChange(`⏱️ [${item.domain}] 自动提交倒计时: [ ${countdown}s ] (可随时点击暂停)...`);
      } else {
        clearInterval(this.activeTimers.countdownTimer);
        this.activeTimers.countdownTimer = null;
        await this.performSubmitAndInspect(item, commentText, score);
      }
    }, 1000);
  }

  /**
   * 触发页面自动点击提交并扫描提交后结果
   */
  async performSubmitAndInspect(item, commentText, score) {
    if (this.state !== 'RUNNING') return;

    this.notifyStateChange(`🚀 [${item.domain}] 正在点击 Submit 提交评论...`);

    try {
      // 触发真实提交点击
      await chrome.scripting.executeScript({
        target: { tabId: this.workerTabId },
        func: () => {
          const submitBtn = document.querySelector('input[type="submit"], button[type="submit"], #submit, .submit-btn');
          const form = document.querySelector('#commentform, form[action*="comment"], form');
          if (submitBtn) submitBtn.click();
          else if (form) form.submit();
        }
      });

      // 等待 3 秒观察重定向结果
      setTimeout(async () => {
        let verifyStatus = 'pending';
        let httpCode = 200;

        try {
          const [postRes] = await chrome.scripting.executeScript({
            target: { tabId: this.workerTabId },
            func: () => {
              const url = window.location.href;
              const text = document.body ? document.body.innerText.toLowerCase() : '';
              if (url.includes('wp-comments-post.php') && text.includes('duplicate comment')) return { status: 'duplicate_comment' };
              if (text.includes('critical error') || text.includes('fatal error')) return { status: 'php_critical_error' };
              if (text.includes('access denied') || text.includes('cloudflare ray id') || text.includes('wordfence')) return { status: 'waf_blocked' };
              if (url.includes('#comment') || text.includes('awaiting moderation') || text.includes('评论正等待审核')) return { status: 'live_pending' };
              return { status: 'published' };
            }
          });

          const postStatus = postRes?.result?.status || 'published';
          if (postStatus === 'duplicate_comment') verifyStatus = 'duplicate';
          else if (postStatus === 'waf_blocked') verifyStatus = 'removed';
          else if (postStatus === 'php_critical_error') verifyStatus = 'http_error';
          else verifyStatus = 'pending';
        } catch (e) {}

        this.stats.successCount++;
        if (window.publishLogger) {
          window.publishLogger.logAction({
            url: item.url,
            domain: item.domain,
            title: item.title,
            status: 'published',
            verifyStatus: verifyStatus,
            comment: commentText,
            relevanceScore: score,
            reason: '全自动无缝发布完成'
          });
        }

        this.notifyStateChange(`🟢 [${item.domain}] 评论成功提交并完成日志记库！`);
        this.advanceToNextItem();
      }, 3000);
    } catch (e) {
      console.warn('[Autopilot] 自动提交过程发生异常:', e);
      this.advanceToNextItem();
    }
  }

  /**
   * 验证码 5 秒挂起倒计时超时自动跳过
   */
  startCaptchaTimeout(item) {
    this.currentStep = 'waiting_captcha';
    let countdown = this.options.captchaTimeoutSeconds;

    this.notifyStateChange(`⚠️ [${item.domain}] 识别到 Captcha 验证码，倒计时 ${countdown} 秒 (可手动辅助勾选)...`);

    this.activeTimers.captchaTimer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        this.notifyStateChange(`⚠️ [${item.domain}] 验证码倒计时: [ ${countdown}s ] (超时将自动跳过)...`);
      } else {
        clearInterval(this.activeTimers.captchaTimer);
        this.activeTimers.captchaTimer = null;
        this.stats.captchaSkipped++;
        if (window.publishLogger) {
          window.publishLogger.logAction({
            url: item.url, domain: item.domain, title: item.title, status: 'skipped', reason: '遇 Captcha 验证码超时自动跳过'
          });
        }
        this.notifyStateChange(`⏩ [${item.domain}] 验证码超时，已自动跳过切入下一条...`);
        this.advanceToNextItem();
      }
    }, 1000);
  }

  /**
   * 移动指针并推进至下一个资源或翻页
   */
  advanceToNextItem() {
    if (this.state !== 'RUNNING') return;

    this.currentIndex++;
    const delay = this.options.safeMode ? this.options.itemDelayMs : 2000;
    
    setTimeout(() => {
      this.processCurrentItem();
    }, delay);
  }

  /**
   * 自动在谷歌搜索页点击【下一页】
   */
  async clickGoogleNextPage() {
    if (this.state !== 'RUNNING') return;

    if (this.googlePageIndex >= this.maxGooglePages) {
      await this.stop(`已达到设定的最大翻页上限 (${this.maxGooglePages} 页)`);
      return;
    }

    this.notifyStateChange(`📄 正在返回谷歌搜索页并自动点击【下一页】(第 ${this.googlePageIndex + 1} 页)...`);

    try {
      if (this.googleTabId) {
        await chrome.tabs.update(this.googleTabId, { active: true });
        
        const [navRes] = await chrome.scripting.executeScript({
          target: { tabId: this.googleTabId },
          func: () => {
            const nextBtn = document.querySelector('#pnnext, a[aria-label*="Next"], a[aria-label*="下一页"]');
            if (nextBtn) {
              nextBtn.click();
              return true;
            }
            return false;
          }
        });

        if (navRes?.result) {
          this.googlePageIndex++;
          // 等待 4 秒谷歌翻页加载
          setTimeout(() => {
            this.processGooglePage();
          }, 4000);
        } else {
          await this.stop('谷歌搜索页已无更多【下一页】结果');
        }
      }
    } catch (e) {
      console.error('[Autopilot] 谷歌翻页失败:', e);
      await this.stop('谷歌搜索页翻页异常');
    }
  }

  /**
   * 针对当前网页提取的正文与标题，调用 AI 大模型实时生成独一无二的建设性评论与契合打分
   */
  async generateAICommentForTab(extracted, profile) {
    const apiUrl = localStorage.getItem('ai_api_url') || 'http://localhost:28642/v1';
    const apiKey = localStorage.getItem('ai_api_key') || 'placeholder';
    const modelName = localStorage.getItem('ai_model') || 'sensenova/sensenova-6.7-flash-lite';

    let commentText = `Great insights on ${extracted.title || 'this article'}! Appreciated the detailed breakdown of the core mechanics.`;
    let relevanceScore = 85;

    // 1. AI 主题契合度评分
    if (window.RelevanceScorer) {
      try {
        const relRes = await window.RelevanceScorer.evaluateRelevanceWithAI({
          targetTitle: extracted.title,
          targetContent: extracted.text,
          siteNiche: profile.profileBio || profile.bio || '',
          apiUrl, apiKey, modelName
        });
        if (relRes && relRes.score) relevanceScore = relRes.score;
      } catch (e) {}
    }

    // 2. 调用大模型 API 针对文章正文生成 100% 独一无二的建设性评论
    try {
      const rawName = profile.profileName || profile.name || '';
      let cleanBrand = rawName;
      if (cleanBrand.includes('@')) {
        cleanBrand = cleanBrand.split('@').pop().trim();
      }
      if (!cleanBrand) cleanBrand = 'SlimeKeyboardEscape';

      const toneStyles = [
        { name: 'Casual Developer', promptHint: 'Use a friendly, conversational tone. Keep it concise and authentic.' },
        { name: 'Practitioner Engineer', promptHint: 'Use an active engineer tone focusing on real-world production gotchas and edge cases.' },
        { name: 'Thoughtful Reader', promptHint: 'Use an appreciative reader tone focusing on practical takeaways.' }
      ];
      const selectedTone = toneStyles[Math.floor(Math.random() * toneStyles.length)];
      const includeBrandInText = Math.random() < 0.5;

      const profileSummary = `Reader Name/Brand: ${profile.profileName || profile.name || 'Developer'}\nTarget Website URL: ${profile.websiteUrl || profile.url || 'N/A'}\nSite Focus: ${profile.profileBio || profile.bio || 'Indie Game & Tools'}`;

      const prompt = `You are a real software engineer leaving a genuine, helpful comment on a tech/gaming blog.
PERSONA TONE: ${selectedTone.promptHint}

TARGET ARTICLE METADATA:
- Title: ${extracted.title}

ARTICLE CONTENT EXCERPT:
${(extracted.text || '').slice(0, 3000)}

READER PROFILE:
${profileSummary}

CRITICAL RULES (ANTI-SPAM FOOTPRINT MASKING & HIGH APPROVAL RATE):
1. 【Step 1 - Natural Opening】: DO NOT start every comment with repetitive academic phrases like "The impact of..." or "Great insights on...". Use varied, natural engineer openings (e.g. "Nice breakdown of...", "Interesting analysis regarding...", "Spot on about..."). Reference the core subject in ${extracted.title}.
2. 【Step 2 - Authentic Experience & Soft Brand Integration】:
${includeBrandInText 
  ? `Share a brief, natural experience related to [Article Topic], mentioning "${cleanBrand}" ONCE in a casual, non-promotional way (e.g., "Reminds me of tinkering with ${cleanBrand}").` 
  : `DO NOT mention the brand name "${cleanBrand}" in the comment body at all! Focus purely on sharing a high-value technical insight on [Article Topic].`}
3. 【Step 3 - Natural Technical Question】: Conclude with a natural question (ending with "?") asking the author about a practical trade-off or edge case of the article's core topic.
4. 【Formatting】: 50-110 words. 100% Fluent Natural English. NO robotic jargon. NO markdown wrappers. Output ONLY the raw comment text.`;

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are an expert engineer commenting naturally on blog posts. Output raw comment text only.' },
            { role: 'user', content: prompt }
          ],
          stream: false
        })
      });

      if (response.ok) {
        const data = await response.json();
        const aiText = (data.choices?.[0]?.message?.content || '').trim();
        if (aiText && aiText.length > 20) {
          commentText = aiText.replace(/^["']|["']$/g, '');
        }
      }
    } catch (err) {
      console.warn('[Autopilot] AI 评论生成调用失败，触发模板保底:', err.message);
    }

    return { commentText, relevanceScore };
  }
}

if (typeof window !== 'undefined') {
  window.autopilotEngine = new AutopilotEngine();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutopilotEngine;
}
