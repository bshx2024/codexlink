/**
 * ComLinkAI - 多项目/多站点工作区隔离管理引擎
 * 支持多独立站项目独立保存 Profile 资料、发布日志、存活看板及 Google Sheets 配置。
 */

const STORAGE_PROJECTS_KEY = 'comlinkai_projects_v1';
const STORAGE_ACTIVE_PROJ_KEY = 'comlinkai_active_project_id';

// ⚠️ APIVALE 独立站专属的 Google Sheet Webhook URL (仅属于 APIVALE 项目，严禁作为全局默认配置污染其他项目)
const APIVALE_DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec';

class ProjectManager {
  constructor() {
    this.projects = this.loadProjects();
    this.activeProjectId = this.loadActiveProjectId();
    this.ensureDefaultProject();
  }

  /**
   * 严格判定项目是否属于 APIVALE
   */
  isApivaleProject(p) {
    if (!p) return false;
    const name = (p.name || '').toLowerCase();
    const url = (p.websiteUrl || '').toLowerCase();
    const pName = (p.profileName || '').toLowerCase();
    const id = p.id || '';
    return name.includes('apivale') || url.includes('apivale') || pName.includes('apivale') || id === 'proj_default';
  }

  loadProjects() {
    try {
      const data = localStorage.getItem(STORAGE_PROJECTS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('[ProjectManager] 读取项目列表失败:', e);
      return [];
    }
  }

  saveProjects() {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(this.projects));
    } catch (e) {
      console.warn('[ProjectManager] 保存项目列表失败:', e);
    }
  }

  loadActiveProjectId() {
    return localStorage.getItem(STORAGE_ACTIVE_PROJ_KEY) || null;
  }

  setActiveProjectId(id) {
    this.activeProjectId = id;
    localStorage.setItem(STORAGE_ACTIVE_PROJ_KEY, id);
  }

  /**
   * 确保至少存在一个默认工作区项目
   */
  ensureDefaultProject() {
    if (this.projects.length === 0) {
      // 尝试继承历史存留的单 Profile
      let legacyProfile = {};
      try {
        legacyProfile = JSON.parse(localStorage.getItem('comlinkai_profile') || '{}');
      } catch (e) {}

      let defaultName = 'APIVALE 默认独立站';
      if (legacyProfile.url) {
        try {
          defaultName = new URL(legacyProfile.url.startsWith('http') ? legacyProfile.url : `https://${legacyProfile.url}`).hostname;
        } catch (e) {
          defaultName = legacyProfile.url;
        }
      }

      const defaultProject = {
        id: 'proj_default',
        name: defaultName,
        websiteUrl: legacyProfile.url || 'https://apivale.com/',
        profileName: legacyProfile.name || 'Alex @ APIVALE',
        profileEmail: legacyProfile.email || 'support@apivale.com',
        profileBio: legacyProfile.bio || '专注 AI 工具与大模型 API 网关的开发者平台',
        tagline: legacyProfile.tagline || '一站式 AI 大模型 API 聚合与转接平台',
        detailDescription: legacyProfile.detailDescription || 'APIVALE 致力于提供稳定、高速、低延迟的 AI 大模型 API 网关服务，支持 OpenAI、Claude、DeepSeek、Gemini 等主流大模型统一分发，为开发者与企业提供一站式接口解决方案。',
        tags: legacyProfile.tags || 'AI, 大模型, API, 开发工具',
        pricingType: legacyProfile.pricingType || 'Freemium',
        faviconUrl: legacyProfile.faviconUrl || 'https://apivale.com/favicon.ico',
        screenshotUrl: legacyProfile.screenshotUrl || 'https://apivale.com/logo.png',
        gsheetWebhook: APIVALE_DEFAULT_WEBHOOK,
        gsheetAutoSync: true,
        createdAt: new Date().toISOString()
      };

      this.projects.push(defaultProject);
      this.saveProjects();
      this.setActiveProjectId('proj_default');
    } else {
      let modified = false;
      this.projects.forEach(p => {
        if (this.isApivaleProject(p)) {
          // 仅给 APIVALE 专属项目默认绑定其专属 Webhook URL
          if (!p.gsheetWebhook || !p.gsheetWebhook.startsWith('https://script.google.com')) {
            p.gsheetWebhook = APIVALE_DEFAULT_WEBHOOK;
            p.gsheetAutoSync = true;
            modified = true;
          }
        } else {
          // ⚠️ 非 APIVALE 项目 (如 Slime Keyboard Escape、用户自建独立站等)：
          // 严禁继承或保留 APIVALE 的 Webhook URL！若之前被全局逻辑误填入，立即执行净化隔离与解绑！
          if (p.gsheetWebhook === APIVALE_DEFAULT_WEBHOOK) {
            p.gsheetWebhook = '';
            p.gsheetAutoSync = false;
            modified = true;
            console.log(`[ProjectManager] 成功净化非 APIVALE 项目 [${p.name}]，已解绑清除误继承的 APIVALE Webhook！`);
          }
        }
      });
      if (modified) this.saveProjects();

      if (!this.activeProjectId || !this.projects.find(p => p.id === this.activeProjectId)) {
        this.setActiveProjectId(this.projects[0].id);
      }
    }
  }

  getProjects() {
    return this.projects;
  }

  getActiveProject() {
    return this.projects.find(p => p.id === this.activeProjectId) || this.projects[0];
  }

  /**
   * 切换当前活跃项目
   */
  switchProject(projectId) {
    const target = this.projects.find(p => p.id === projectId);
    if (!target) return null;

    this.setActiveProjectId(projectId);

    // 同步把项目特定的 Profile 刷新到 localStorage 全局单例兼容点
    const legacyProfile = {
      name: target.profileName || '',
      email: target.profileEmail || '',
      url: target.websiteUrl || '',
      bio: target.profileBio || '',
      tagline: target.tagline || '',
      detailDescription: target.detailDescription || '',
      tags: target.tags || '',
      pricingType: target.pricingType || 'Freemium',
      faviconUrl: target.faviconUrl || '',
      screenshotUrl: target.screenshotUrl || ''
    };
    localStorage.setItem('comlinkai_profile', JSON.stringify(legacyProfile));

    return target;
  }

  /**
   * 创建新的独立站项目
   */
  createProject(name, websiteUrl, profileName = '', profileEmail = '', profileBio = '', tagline = '', detailDescription = '', tags = '', pricingType = 'Freemium', faviconUrl = '', screenshotUrl = '') {
    if (!name || !name.trim()) return null;

    let cleanUrl = (websiteUrl || '').trim();
    if (cleanUrl && !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const newProj = {
      id: 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name.trim(),
      websiteUrl: cleanUrl,
      profileName: profileName || name,
      profileEmail: profileEmail || '',
      profileBio: profileBio || '',
      tagline: tagline || '',
      detailDescription: detailDescription || '',
      tags: tags || '',
      pricingType: pricingType || 'Freemium',
      faviconUrl: faviconUrl || '',
      screenshotUrl: screenshotUrl || '',
      gsheetWebhook: '',
      gsheetAutoSync: false,
      createdAt: new Date().toISOString()
    };

    this.projects.push(newProj);
    this.saveProjects();
    this.switchProject(newProj.id);
    return newProj;
  }

  /**
   * 更新当前项目的 Profile 与配置
   */
  updateActiveProject(data) {
    const active = this.getActiveProject();
    if (!active) return null;

    if (data.name !== undefined) active.name = data.name;
    if (data.websiteUrl !== undefined) active.websiteUrl = data.websiteUrl;
    if (data.profileName !== undefined) active.profileName = data.profileName;
    if (data.profileEmail !== undefined) active.profileEmail = data.profileEmail;
    if (data.profileBio !== undefined) active.profileBio = data.profileBio;
    if (data.tagline !== undefined) active.tagline = data.tagline;
    if (data.detailDescription !== undefined) active.detailDescription = data.detailDescription;
    if (data.tags !== undefined) active.tags = data.tags;
    if (data.pricingType !== undefined) active.pricingType = data.pricingType;
    if (data.faviconUrl !== undefined) active.faviconUrl = data.faviconUrl;
    if (data.screenshotUrl !== undefined) active.screenshotUrl = data.screenshotUrl;
    if (data.gsheetWebhook !== undefined) active.gsheetWebhook = data.gsheetWebhook;
    if (data.gsheetAutoSync !== undefined) active.gsheetAutoSync = data.gsheetAutoSync;

    this.saveProjects();
    this.switchProject(active.id); // 刷新全局缓存
    return active;
  }

  /**
   * 删除项目
   */
  deleteProject(projectId) {
    if (this.projects.length <= 1) {
      throw new Error('至少需要保留一个独立站项目！');
    }

    this.projects = this.projects.filter(p => p.id !== projectId);
    this.saveProjects();

    if (this.activeProjectId === projectId) {
      this.switchProject(this.projects[0].id);
    }
  }

  /**
   * 获取针对当前项目隔离的 Storage Key
   */
  getScopedKey(baseKey) {
    const active = this.getActiveProject();
    const projId = active ? active.id : 'proj_default';
    return `${baseKey}_${projId}`;
  }

  /**
   * 自动抓取产品主页并提取 7 大 Profile 字段信息
   * @param {string} targetUrl 
   * @returns {Promise<{name: string, websiteUrl: string, profileName: string, profileEmail: string, profileBio: string, tagline: string, keywords: string[], logoUrl: string}>}
   */
  async fetchAndExtractProfile(targetUrl) {
    if (!targetUrl) throw new Error('请输入目标产品主页 URL');
    let cleanUrl = targetUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const resp = await fetch(cleanUrl, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const htmlText = await resp.text();
      return this.extractProfileFromHomepageHTML(htmlText, cleanUrl);
    } catch (err) {
      console.warn('[ProjectManager] 跨域直接 Fetch 失败，尝试返回通用规范分析结果:', err.message);
      // 离线/跨域兜底解析
      const parsedUrl = new URL(cleanUrl);
      const hostNameParts = parsedUrl.hostname.split('.');
      const brandName = hostNameParts.length > 1 ? hostNameParts[hostNameParts.length - 2].toUpperCase() : parsedUrl.hostname;
      return {
        name: brandName,
        websiteUrl: cleanUrl,
        profileName: `${brandName} Official`,
        profileEmail: `support@${parsedUrl.hostname.replace(/^www\./, '')}`,
        profileBio: `${brandName} is a high-performance web product and service platform.`,
        tagline: `${brandName} - Modern Web Solution`,
        keywords: [brandName, 'Web App', 'SaaS', 'Tools'],
        logoUrl: `${parsedUrl.origin}/favicon.ico`
      };
    }
  }

  /**
   * 从 HTML 源码中解析提取 7 大核心字段
   */
  extractProfileFromHomepageHTML(htmlText, targetUrl) {
    const parsedUrl = new URL(targetUrl);
    const origin = parsedUrl.origin;
    const hostname = parsedUrl.hostname.replace(/^www\./, '');

    // 辅助正则提取 meta
    const getMetaContent = (nameOrProperty) => {
      const regex = new RegExp(`<meta\\s+(?:name|property)=["']${nameOrProperty}["']\\s+content=["']([^"']+)["']`, 'i');
      const match = htmlText.match(regex);
      if (match) return match[1].trim();
      const regexAlt = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:name|property)=["']${nameOrProperty}["']`, 'i');
      const matchAlt = htmlText.match(regexAlt);
      return matchAlt ? matchAlt[1].trim() : '';
    };

    // 1. Title / Name & Brand Name Cleaning
    let rawTitle = getMetaContent('og:site_name') || getMetaContent('og:title');
    if (!rawTitle) {
      const titleMatch = htmlText.match(/<title[^>]*>(.*?)<\/title>/i);
      rawTitle = titleMatch ? titleMatch[1].trim() : '';
    }

    let brandName = rawTitle;
    const titleSeparators = ['|', ' - ', ' – ', ' — ', ' : ', '⚡', '★', '•'];
    for (const sep of titleSeparators) {
      if (brandName.includes(sep)) {
        brandName = brandName.split(sep)[0].trim();
      }
    }
    // 移除常见的独立后缀修饰词 (如 Online, Unblocked 等)
    brandName = brandName.replace(/\s+(Online|Unblocked|Free|Official Site)$/i, '').trim();

    if (!brandName) {
      const hostParts = hostname.split('.');
      brandName = hostParts[0].toUpperCase();
    }
    if (!rawTitle) rawTitle = brandName;

    // 2. Tagline / Short Desc
    let tagline = getMetaContent('description') || getMetaContent('og:description') || getMetaContent('twitter:description');
    if (!tagline) tagline = `${brandName} - Innovative Web Product & SaaS Platform.`;

    // 3. Keywords
    let keywordsStr = getMetaContent('keywords');
    let keywords = keywordsStr ? keywordsStr.split(/[,，]/).map(k => k.trim()).filter(Boolean) : [];
    if (keywords.length === 0) {
      keywords = [brandName, 'SaaS', 'Web App', 'Software', 'AI Tools'];
    }

    // 4. Contact Email
    let contactEmail = '';
    const mailtoMatch = htmlText.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (mailtoMatch) {
      contactEmail = mailtoMatch[1];
    } else {
      const emailMatch = htmlText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
      contactEmail = emailMatch ? emailMatch[0] : `contact@${hostname}`;
    }

    // 5. Favicon 图标提取 (高分辨率优先)
    let faviconUrl = '';
    const iconMatch = htmlText.match(/<link\s+rel=["'](?:shortcut icon|icon|apple-touch-icon)["']\s+href=["']([^"']+)["']/i);
    if (iconMatch) faviconUrl = iconMatch[1];
    if (faviconUrl && !faviconUrl.startsWith('http')) {
      faviconUrl = new URL(faviconUrl, origin).href;
    }
    if (!faviconUrl) {
      faviconUrl = `${origin}/favicon.ico`;
    }

    // 6. 网站截图 / OG 封面提取
    let screenshotUrl = getMetaContent('og:image') || getMetaContent('twitter:image') || getMetaContent('twitter:image:src');
    if (screenshotUrl && !screenshotUrl.startsWith('http')) {
      screenshotUrl = new URL(screenshotUrl, origin).href;
    }
    if (!screenshotUrl) {
      screenshotUrl = `${origin}/og-image.png`;
    }

    return {
      name: brandName || rawTitle,
      websiteUrl: targetUrl,
      profileName: brandName,
      profileEmail: contactEmail,
      profileBio: tagline,
      tagline: tagline.slice(0, 80),
      keywords: keywords.slice(0, 5),
      logoUrl: faviconUrl,
      faviconUrl: faviconUrl,
      screenshotUrl: screenshotUrl
    };
  }
}

// 导出全局单例模式
if (typeof window !== 'undefined') {
  window.projectManager = new ProjectManager();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProjectManager;
}
