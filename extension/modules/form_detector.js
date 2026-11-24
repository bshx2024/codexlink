/**
 * ComLinkAI Pro - 免登录评论表单感知与状态检测模块 (Form Detector)
 */

class FormDetector {
  /**
   * 分析当前标签页中的 DOM 结构，检测留言评论表单类型与可操作性
   * @param {Document} doc 
   * @returns {{ status: 'commentable'|'login_required'|'captcha_protected'|'no_form', fields: string[], details: string }}
   */
  static inspectDOM(doc = document) {
    // 1. 检查是否存在登录拦截词
    const bodyText = doc.body ? doc.body.innerText.toLowerCase() : '';
    if (bodyText.includes('you must be logged in to post a comment') ||
        bodyText.includes('须登录后发表评论') ||
        bodyText.includes('请先登录再发表评论') ||
        bodyText.includes('log in to reply')) {
      // 检查是否有开放的 textarea
      const textareas = Array.from(doc.querySelectorAll('textarea'));
      const activeTextarea = textareas.find(t => t.offsetHeight > 0 && !t.disabled && t.style.display !== 'none');
      if (!activeTextarea) {
        return {
          status: 'login_required',
          fields: [],
          details: '网页要求必须登录后方可发表评论'
        };
      }
    }

    // 2. 检查强验证码拦截 (reCAPTCHA / hCaptcha / Turnstile)
    const hasCaptcha = !!doc.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], div.g-recaptcha, div.h-captcha');

    // 3. 检查第三方嵌入式评论插件 (Disqus, Utterances, Giscus, Facebook, Commento, Cusdis)
    const hasWidget = !!doc.querySelector('iframe[src*="disqus.com"], iframe[src*="utteranc.es"], iframe[src*="giscus.app"], iframe[src*="facebook.com/plugins/comment"], div#disqus_thread, div.giscus, div.utterances, div#commento, div#cusdis_thread');
    if (hasWidget) {
      return {
        status: 'commentable',
        fields: ['ThirdPartyWidget'],
        details: '检测到嵌入式评论区 (Disqus / Utterances / Giscus / Facebook Comments)'
      };
    }

    // 4. 寻找标准免登录/博客评论输入框与 textarea
    const commentBox = doc.querySelector('#comment, textarea[name*="comment"], textarea[name*="message"], textarea[name*="reply"], textarea');
    const nameInput = doc.querySelector('#author, input[name="author"], input[name="name"], input[id="name"], input[placeholder*="Name" i], input[placeholder*="姓名" i]');
    const emailInput = doc.querySelector('#email, input[name="email"], input[type="email"], input[id="email"], input[placeholder*="Email" i], input[placeholder*="邮箱" i]');
    const urlInput = doc.querySelector('#url, #website, input[type="url"], input[name="url"], input[name="website"], input[placeholder*="Website" i], input[placeholder*="网址" i]');

    const fields = [];
    if (nameInput && nameInput.offsetHeight > 0) fields.push('Name');
    if (emailInput && emailInput.offsetHeight > 0) fields.push('Email');
    if (urlInput && urlInput.offsetHeight > 0) fields.push('Website');
    if (commentBox && commentBox.offsetHeight > 0) fields.push('Comment');

    if (fields.length === 0 || !commentBox || commentBox.offsetHeight === 0) {
      return {
        status: 'no_form',
        fields: [],
        details: '页面检索完成：本页面属于静态 HTML 网页/评论区关闭（无留言发表框）'
      };
    }

    if (hasCaptcha) {
      return {
        status: 'captcha_protected',
        fields,
        details: '识别到评论表单，但受到 Captcha 验证码保护 (需人工辅助划选)'
      };
    }

    return {
      status: 'commentable',
      fields,
      details: `找到开放式评论表单 (${fields.join(', ')})`
    };
  }

  /**
   * 自动感知并匹配目录站 / 平台收录的提交表单控件，自动填入产品 Profile 并进行高亮标注
   * @param {Object} profile 独立站产品档案
   * @param {Document} doc 
   * @returns {Promise<{ filledCount: number, filledFields: string[], details: string }>}
   */
  static async detectAndFillDirectoryForm(profile = {}, doc = document) {
    if (!profile || (!profile.url && !profile.websiteUrl)) {
      return { filledCount: 0, filledFields: [], details: '产品 Profile 未初始化或缺失网址' };
    }

    const targetUrl = (profile.websiteUrl || profile.url || '').trim();
    const brandName = (profile.profileName || profile.name || '').trim();
    const tagline = (profile.tagline || profile.bio || profile.profileBio || '').trim();
    const detailDesc = (profile.detailDescription || profile.bio || profile.profileBio || tagline || '').trim();
    const email = (profile.profileEmail || profile.email || '').trim();
    const tagsVal = Array.isArray(profile.tags) ? profile.tags.join(', ') : (profile.tags || (Array.isArray(profile.keywords) ? profile.keywords.join(', ') : (profile.keywords || 'AI, SaaS, Tools')));
    const faviconUrl = (profile.faviconUrl || profile.logoUrl || '').trim();
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
        el.style.transition = 'all 0.3s ease';
        return true;
      } catch (e) {
        return false;
      }
    };

    // 1. 匹配【网址链接 URL】
    const urlEl = doc.querySelector('input[placeholder*="网址" i], input[placeholder*="链接" i], input[placeholder*="URL" i], input[type="url"], input[name*="url" i], input[name*="website" i], input[name*="link" i], input[name*="site_url" i], input[name*="weburl" i], input[id*="url" i], input[id*="website" i]');
    if (urlEl && highlightAndFill(urlEl, targetUrl)) {
      filledFields.push('网址链接');
    }

    // 2. 匹配【标题 / 网站/产品名称 Title】
    const titleEl = doc.querySelector('input[placeholder*="标题" i], input[placeholder*="名称" i], input[placeholder*="Title" i], input[placeholder*="Name" i], input[name*="title" i], input[name*="site_name" i], input[name*="website_name" i], input[name*="app_name" i], input[name="name" i], input[id*="title" i], input[id*="name" i]');
    if (titleEl && highlightAndFill(titleEl, brandName)) {
      filledFields.push('标题/名称');
    }

    // 3. 匹配【一句话简介 Tagline / Short Summary】
    const taglineEl = doc.querySelector('input[placeholder*="简介" i], input[placeholder*="一句话" i], input[placeholder*="Summary" i], input[placeholder*="tagline" i], input[placeholder*="brief" i], input[name*="tagline" i], input[name*="summary" i], input[name*="short_desc" i], input[name*="brief" i], input[name*="intro" i]');
    if (taglineEl && highlightAndFill(taglineEl, tagline)) {
      filledFields.push('一句话简介');
    }

    // 4. 匹配【详细介绍 Rich Text Editor / Long Textarea】
    const filledRichText = this.fillRichTextEditor(doc, detailDesc);
    if (filledRichText) {
      filledFields.push('详细介绍 (富文本)');
    } else {
      const descEl = doc.querySelector('textarea[placeholder*="详细" i], textarea[placeholder*="介绍" i], textarea[placeholder*="内容" i], textarea[placeholder*="Description" i], textarea[name*="desc" i], textarea[name*="summary" i], textarea[name*="about" i], textarea[name*="info" i], textarea[name*="detail" i], textarea[name*="content" i], textarea[id*="content" i], textarea[id*="desc" i]');
      if (descEl && highlightAndFill(descEl, detailDesc)) {
        filledFields.push('详细介绍');
      }
    }

    // 5. 匹配【标签 / 关键词 Tags】
    const tagEl = doc.querySelector('input[placeholder*="标签" i], input[placeholder*="Tag" i], input[placeholder*="关键词" i], input[placeholder*="keyword" i], input[name*="tag" i], input[name*="keyword" i], input[name*="category_tag" i]');
    if (tagEl && highlightAndFill(tagEl, tagsVal)) {
      filledFields.push('分类标签');
    }

    // 6. 匹配【联系邮箱 Email】
    const emailEl = doc.querySelector('input[placeholder*="邮箱" i], input[placeholder*="Email" i], input[placeholder*="邮件" i], input[type="email"], input[name*="email" i], input[name*="contact_email" i], input[id*="email" i]');
    if (emailEl && highlightAndFill(emailEl, email)) {
      filledFields.push('联系邮箱');
    }

    // 7. 匹配【上传 Favicon 图标】 (input[type="file"])
    const fileInputs = Array.from(doc.querySelectorAll('input[type="file"]'));
    const faviconInput = fileInputs.find(el => {
      const nameOrId = (el.name || '' ) + (el.id || '');
      const parentText = el.closest('div, td, label, section, .form-group, .upload-box')?.innerText || '';
      return nameOrId.match(/favicon|icon|logo/i) || parentText.includes('Favicon') || parentText.includes('图标') || parentText.includes('Logo');
    }) || fileInputs[0];

    if (faviconInput && faviconUrl) {
      const ok = await this.fillFileInputFromUrl(faviconInput, faviconUrl, 'favicon.png');
      if (ok) filledFields.push('Favicon图标');
    }

    // 8. 匹配【上传 网站截图】 (input[type="file"])
    const screenshotInput = fileInputs.find(el => {
      if (el === faviconInput) return false;
      const nameOrId = (el.name || '' ) + (el.id || '');
      const parentText = el.closest('div, td, label, section, .form-group, .upload-box')?.innerText || '';
      return nameOrId.match(/screen|shot|snapshot|banner|img|preview/i) || parentText.includes('截图') || parentText.includes('快照') || parentText.includes('Banner');
    }) || (fileInputs.length > 1 ? fileInputs[1] : null);

    if (screenshotInput && screenshotUrl) {
      const ok = await this.fillFileInputFromUrl(screenshotInput, screenshotUrl, 'screenshot.png');
      if (ok) filledFields.push('网站截图');
    }

    // 9. 智能高亮图形验证码与邮箱验证码区域
    const captchaImg = doc.querySelector('img[src*="captcha" i], img[src*="code" i], canvas[id*="captcha" i], img[alt*="验证码" i]');
    if (captchaImg) {
      captchaImg.style.border = '3px solid #3b82f6';
      captchaImg.style.boxShadow = '0 0 14px rgba(59, 130, 246, 0.6)';
      captchaImg.style.borderRadius = '4px';
    }

    const sendCodeBtn = Array.from(doc.querySelectorAll('button, input[type="button"], a.btn, a.button')).find(el => {
      const text = (el.innerText || el.value || '').trim();
      return (text.includes('获取') && text.includes('验证码')) || text.includes('发送验证码') || text.includes('Send Code');
    });
    if (sendCodeBtn) {
      sendCodeBtn.style.border = '2px solid #00f2fe';
      sendCodeBtn.style.boxShadow = '0 0 12px rgba(0, 242, 254, 0.7)';
      sendCodeBtn.style.fontWeight = 'bold';
    }

    // 10. 高亮验证码输入框并平滑聚焦
    const captchaInput = doc.querySelector('input[placeholder*="验证码" i], input[placeholder*="Code" i], input[name*="captcha" i], input[name*="code" i], input[name*="verify" i], input[id*="captcha" i], input[id*="code" i]');
    if (captchaInput) {
      captchaInput.style.border = '2px solid #fbbf24';
      captchaInput.style.boxShadow = '0 0 10px rgba(251, 191, 36, 0.5)';
      try {
        captchaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        captchaInput.focus({ preventScroll: true });
      } catch (e) {}
    } else {
      // 兜底平滑滚动到表单底部/提交按钮处
      const submitBtn = doc.querySelector('button[type="submit"], input[type="submit"], button.submit, .btn-submit, button');
      if (submitBtn) {
        try { submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
    }

    return {
      filledCount: filledFields.length,
      filledFields,
      details: filledFields.length > 0 ? `已成功为您自动高亮填入 ${filledFields.length} 项信息 (${filledFields.join(', ')})！请人工获取并输入验证码` : '未识别到标准目录/平台提交表单控件'
    };
  }

  /**
   * 自动识别并强力灌入富文本编辑器 (WangEditor, Quill, TinyMCE, Summernote, CKEditor, contenteditable)
   * @param {Document} doc 
   * @param {string} content 
   * @returns {boolean}
   */
  static fillRichTextEditor(doc = document, content = '') {
    if (!content) return false;
    try {
      // 1. WangEditor / Quill / ProseMirror / Summernote / Element Plus RichText / contenteditable
      const editableEl = doc.querySelector('.w-e-text-container [contenteditable="true"], .w-e-text, .ql-editor, .note-editable, .ck-content, div[contenteditable="true"]');
      if (editableEl) {
        editableEl.innerHTML = content.replace(/\n/g, '<br>');
        editableEl.dispatchEvent(new Event('input', { bubbles: true }));
        editableEl.dispatchEvent(new Event('change', { bubbles: true }));
        editableEl.dispatchEvent(new Event('blur', { bubbles: true }));
        editableEl.style.border = '2px solid #10b981';
        editableEl.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';
        
        // 同步尝试更新同表单下的隐藏 textarea
        const form = editableEl.closest('form');
        if (form) {
          const hiddenTextarea = form.querySelector('textarea');
          if (hiddenTextarea) {
            hiddenTextarea.value = content;
            hiddenTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            hiddenTextarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return true;
      }

      // 2. 识别 TinyMCE / CKEditor / UEditor iframe
      const iframes = Array.from(doc.querySelectorAll('iframe'));
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument && iframe.contentDocument.body && (iframe.contentDocument.designMode === 'on' || iframe.contentDocument.body.contentEditable === 'true')) {
            iframe.contentDocument.body.innerHTML = content.replace(/\n/g, '<br>');
            iframe.style.border = '2px solid #10b981';
            iframe.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';
            return true;
          }
        } catch (e) {}
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 将远程图片 URL 转为 File 对象并通过 DataTransfer 注入 input[type="file"] 控件
   * @param {HTMLInputElement} fileInputEl 
   * @param {string} imageUrl 
   * @param {string} fileName 
   * @returns {Promise<boolean>}
   */
  static async fillFileInputFromUrl(fileInputEl, imageUrl, fileName = 'upload.png') {
    if (!fileInputEl || !imageUrl) return false;
    try {
      const resp = await fetch(imageUrl, { mode: 'cors' });
      if (!resp.ok) return false;
      const blob = await resp.blob();
      const file = new File([blob], fileName, { type: blob.type || 'image/png' });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputEl.files = dataTransfer.files;

      fileInputEl.dispatchEvent(new Event('input', { bubbles: true }));
      fileInputEl.dispatchEvent(new Event('change', { bubbles: true }));
      fileInputEl.style.border = '2px solid #10b981';
      fileInputEl.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.45)';

      // 若其外层存在自定义 UI 显示点 (如 label 或 span)，也给予高亮视觉反馈
      const parentBox = fileInputEl.closest('.upload-box, .uploader, label, div, section, .form-group');
      if (parentBox) {
        parentBox.style.border = '2px dashed #10b981';
      }
      return true;
    } catch (err) {
      console.warn('[FormDetector] 填充文件控件失败:', err.message);
      return false;
    }
  }

  // =========================================================================
  // 5大工业级防线：入口嗅探、反蜜罐可见性、免费层级偏置与支付熔断
  // =========================================================================

  /**
   * 防线 2: 真实可见性与反蜜罐过滤 (Anti-Honeypot Visibility Check)
   * 必须确保元素真实渲染在视口中，严禁触发 display:none 或负坐标隐藏蜜罐
   */
  static isHumanVisible(el, doc = document) {
    if (!el) return false;
    try {
      // 1. 基础 DOM 挂载与 offsetParent 检查
      if (el.offsetParent === null && el.tagName !== 'BODY') return false;

      // 2. CSS 计算样式过滤
      const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win && win.getComputedStyle) {
        const style = win.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity || '1') < 0.05) return false;
      }

      // 3. 几何包围盒检查 (排除绝对定位 -9999px 的反爬蜜罐)
      if (el.getBoundingClientRect) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        if (rect.bottom < 0 || rect.top > 12000 || rect.right < 0 || rect.left > 8000) return false;
      }

      return true;
    } catch (e) {
      return true;
    }
  }

  /**
   * 识别当前页面上的表单类型：'directory' (目录站) | 'blog_comment' (博客评论) | 'none'
   */
  static detectFormType(doc = document) {
    // 目录站表单特征：包含标题/名称输入框，且具备网址/简介/富文本/分类/文件上传之一
    const titleInput = doc.querySelector('input[placeholder*="标题" i], input[placeholder*="名称" i], input[placeholder*="Title" i], input[placeholder*="Name" i], input[name*="title" i], input[name*="site_name" i], input[name*="website_name" i], input[name*="app_name" i], input[name="name" i], input[id*="title" i], input[id*="name" i]');
    const urlInput = doc.querySelector('input[type="url"], input[name*="url" i], input[name*="website" i], input[placeholder*="url" i], input[placeholder*="http" i]');
    const fileInput = doc.querySelector('input[type="file"]');
    const richText = doc.querySelector('.w-e-text-container, .ql-editor, .note-editable, .ck-content, div[contenteditable="true"]');
    const taglineInput = doc.querySelector('input[name*="tagline" i], input[name*="summary" i], input[placeholder*="tagline" i], input[placeholder*="简介" i]');

    if (titleInput && this.isHumanVisible(titleInput, doc) && (urlInput || fileInput || richText || taglineInput)) {
      return 'directory';
    }

    // 博客评论特征：包含评论长文本框，且伴随昵称或邮箱输入
    const commentBox = doc.querySelector('#comment, textarea[name*="comment" i], textarea[name*="message" i], textarea[name*="reply" i], textarea');
    if (commentBox && this.isHumanVisible(commentBox, doc)) {
      return 'blog_comment';
    }

    return 'none';
  }

  /**
   * 嗅探提交入口链接与模态弹窗按钮 (智能寻找 Submit / Add Tool / Leave Reply)
   * @param {Document} doc
   * @param {string} currentUrl 当前页面完整 URL (用于同源防护)
   * @returns {Array<{ type: 'navigate'|'modal', targetUrl: string, text: string, score: number, el: HTMLElement }>}
   */
  static sniffSubmissionEntry(doc = document, currentUrl = '') {
    const candidates = [];
    let currentHost = '';
    let rootDomain = '';

    try {
      if (currentUrl) {
        const u = new URL(currentUrl);
        currentHost = u.hostname.toLowerCase();
        const parts = currentHost.split('.');
        rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : currentHost;
      }
    } catch (e) {}

    const SUBMIT_PATTERNS = [
      { regex: /submit[-_ ]?(tool|ai|product|app|website|listing|resource|startup)?/i, score: 10 },
      { regex: /add[-_ ]?(your)?[-_ ]?(tool|ai|product|app|website|listing)?/i, score: 10 },
      { regex: /list[-_ ]?(your)?[-_ ]?(tool|product|app)?/i, score: 9 },
      { regex: /suggest[-_ ]?(a)?[-_ ]?(tool|ai|product)?/i, score: 9 },
      { regex: /post[-_ ]?(a)?[-_ ]?(tool|product)?/i, score: 8 },
      { regex: /leave[-_ ]?(a)?[-_ ]?(reply|comment)?/i, score: 8 },
      { regex: /提交(工具|网站|产品|项目)?/i, score: 10 },
      { regex: /申请收录|免费收录|发布产品/i, score: 10 }
    ];

    const URL_PATH_PATTERNS = [
      { regex: /\/(submit|add-tool|submit-tool|submit-ai|add-product|new-tool|submit-listing)/i, score: 9 },
      { regex: /\/(add|listing|new|submission)/i, score: 6 },
      { regex: /#respond|#comments/i, score: 7 }
    ];

    const EXCLUDE_DOMAINS = [
      'twitter.com', 'x.com', 'github.com', 'facebook.com', 'linkedin.com',
      'instagram.com', 'youtube.com', 'discord.gg', 'discord.com', 'telegram.org',
      't.me', 'stripe.com', 'paypal.com', 'google.com', 'apple.com'
    ];

    // 1. 扫描所有可见 <a> 超链接
    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    for (const a of anchors) {
      if (!this.isHumanVisible(a, doc)) continue;

      const rawHref = a.getAttribute('href') || '';
      const fullHref = a.href || '';
      const text = (a.innerText || a.getAttribute('title') || a.getAttribute('aria-label') || '').trim();

      if (!fullHref.startsWith('http')) continue;

      // 同源检查：严禁跳转到外部社交媒体或广告
      try {
        const parsed = new URL(fullHref);
        const linkHost = parsed.hostname.toLowerCase();
        if (EXCLUDE_DOMAINS.some(ed => linkHost.includes(ed))) continue;
        if (currentHost && rootDomain) {
          if (!linkHost.endsWith(rootDomain) && linkHost !== currentHost) continue;
        }
      } catch (e) {
        continue;
      }

      let score = 0;
      for (const p of SUBMIT_PATTERNS) {
        if (p.regex.test(text)) score = Math.max(score, p.score);
      }
      for (const up of URL_PATH_PATTERNS) {
        if (up.regex.test(rawHref) || up.regex.test(fullHref)) score = Math.max(score, up.score);
      }

      if (score >= 6) {
        candidates.push({
          type: 'navigate',
          targetUrl: fullHref,
          text: text.slice(0, 40),
          score,
          el: a
        });
      }
    }

    // 2. 扫描可能是模态弹窗的可见 <button> 或 [role="button"]
    const buttons = Array.from(doc.querySelectorAll('button, [role="button"], a[href="#"], a[href^="javascript"]'));
    for (const btn of buttons) {
      if (!this.isHumanVisible(btn, doc)) continue;

      const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
      let score = 0;
      for (const p of SUBMIT_PATTERNS) {
        if (p.regex.test(text)) score = Math.max(score, p.score);
      }

      if (score >= 8) {
        candidates.push({
          type: 'modal',
          targetUrl: '',
          text: text.slice(0, 40),
          score: score + 1, // 按钮在现代 SPA 中通常优先级更高
          el: btn
        });
      }
    }

    // 按匹配质量降序排列
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /**
   * 防线 4: 强制免费层级选择与收费墙检测 (Free-Tier Enforcement & Paywall Detection)
   * 自动勾选 Free 选项；若检测到纯收费墙 (必须绑卡付费且无免费选项)，立即熔断
   * @returns {{ isPaywall: boolean, selectedFree: boolean, reason?: string }}
   */
  static enforceFreeTierAndDetectPaywall(doc = document) {
    const bodyText = (doc.body ? doc.body.innerText : '').toLowerCase();

    // 1. 尝试定位并优先勾选免费/标准层级选项 (Free / Standard / Community / $0)
    let selectedFree = false;
    const tierOptions = Array.from(doc.querySelectorAll('input[type="radio"], input[type="checkbox"], .pricing-card, .plan-item, label, button'));
    
    for (const opt of tierOptions) {
      if (!this.isHumanVisible(opt, doc)) continue;
      const text = (opt.innerText || opt.value || opt.closest('label')?.innerText || '').toLowerCase();
      
      const isFree = text.includes('free') || text.includes('standard') || text.includes('basic') || text.includes('$0') || text.includes('免费');
      const isPaid = text.includes('$29') || text.includes('$49') || text.includes('$99') || text.includes('featured') || text.includes('sponsor');

      if (isFree && !isPaid) {
        try {
          if (opt.click) opt.click();
          if (opt.checked !== undefined) opt.checked = true;
          opt.dispatchEvent(new Event('change', { bubbles: true }));
          selectedFree = true;
          break;
        } catch (e) {}
      }
    }

    // 2. 检测纯收费墙 (无免费排队，必须付费)
    const hasStripeOrPaypal = !!doc.querySelector('iframe[src*="stripe.com"], iframe[src*="paypal.com"], .stripe-card, [id*="card-element"]');
    const hasPaidKeywords = (bodyText.includes('$29') || bodyText.includes('$49') || bodyText.includes('$99') || bodyText.includes('credit card')) &&
                            !bodyText.includes('free queue') && !bodyText.includes('free listing') && !bodyText.includes('free submission') && !bodyText.includes('0.00');

    if (hasStripeOrPaypal || (hasPaidKeywords && !selectedFree)) {
      return {
        isPaywall: true,
        selectedFree: false,
        reason: '检测到必须付费入驻 (Stripe/PayPal 收银台)，已执行 0 付费红线熔断'
      };
    }

    return {
      isPaywall: false,
      selectedFree
    };
  }
}

if (typeof window !== 'undefined') {
  window.FormDetector = FormDetector;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FormDetector;
}

