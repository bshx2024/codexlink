/**
 * ComLinkAI - 优质外链目标推荐库模块
 * 提供精选、经过验证的优质博客与社区外链目标，支持分类检索与一键直达。
 */

const PRESET_CATEGORIES = [
  { id: 'all', name: '🌐 全部分类', icon: 'globe' },
  { id: 'ai_dev', name: '🤖 AI & 极客开发', icon: 'cpu' },
  { id: 'seo_marketing', name: '📈 SEO & 数字营销', icon: 'trending-up' },
  { id: 'indie_hacker', name: '🚀 独立开发与创业', icon: 'rocket' },
  { id: 'tech_blog', name: '📝 优质技术博客', icon: 'file-text' }
];

const PRESET_TARGETS = [
  {
    id: 'target_1',
    title: 'Apivale Blog & AI Gateway',
    url: 'https://apivale.com/docs',
    domain: 'apivale.com',
    category: 'ai_dev',
    cms: 'WordPress',
    authority: 'DR 75',
    dofollow: true,
    commentType: '博主手工审核 (轻松通过)',
    tags: ['AI 网关', 'DeepSeek', 'LLM', 'API'],
    desc: '专注大模型 API 网关与 AI 基础设施，对大语言模型与开发工具讨论极其友好。'
  },
  {
    id: 'target_2',
    title: 'Open Source AI Developer Log',
    url: 'https://dev.to/t/ai',
    domain: 'dev.to',
    category: 'ai_dev',
    cms: 'DEV Community',
    authority: 'DR 90',
    dofollow: true,
    commentType: '即时公开 (需登录)',
    tags: ['Dev.to', 'AI', '开源', 'Python'],
    desc: '全球最大的开发者社区之一，文章下方支持Markdown留言，权重极高。'
  },
  {
    id: 'target_3',
    title: 'Indie Hackers Growth Discussions',
    url: 'https://www.indiehackers.com',
    domain: 'indiehackers.com',
    category: 'indie_hacker',
    cms: 'Custom',
    authority: 'DR 86',
    dofollow: true,
    commentType: '社区公开回复',
    tags: ['独立开发', 'SaaS', '出海', '增长'],
    desc: '独立开发者出海与流量增长大本营，支持插入产品网址与建设性交流。'
  },
  {
    id: 'target_4',
    title: 'SEO & Growth Hacking Journal',
    url: 'https://searchengineland.com',
    domain: 'searchengineland.com',
    category: 'seo_marketing',
    cms: 'WordPress',
    authority: 'DR 91',
    dofollow: false,
    commentType: '博主手工审核',
    tags: ['SEO', 'Google算法', '外链建设'],
    desc: '权威 SEO 资讯博客，评论区聚集顶级 SEO 专家，极具品牌暴露价值。'
  },
  {
    id: 'target_5',
    title: 'V2EX 程序员与外链交流站',
    url: 'https://v2ex.com/go/create',
    domain: 'v2ex.com',
    category: 'tech_blog',
    cms: 'V2EX Custom',
    authority: 'DR 78',
    dofollow: true,
    commentType: '即时公开 (注册账号)',
    tags: ['极客', '节点', '分享', '独立站'],
    desc: '国内优质极客与独立站长社区，在“酷工作”或“分享创造”节点互动频繁。'
  },
  {
    id: 'target_6',
    title: 'Web.Cafe 独立站与工具研讨',
    url: 'https://new.web.cafe/all',
    domain: 'new.web.cafe',
    category: 'indie_hacker',
    cms: 'Next.js',
    authority: 'DR 68',
    dofollow: true,
    commentType: '社区公开回复',
    tags: ['AI工具', 'SEO外链', '独立站'],
    desc: '专注 AI 工具与独立站运营的优质讨论社区，对开发者自建工具极其包容。'
  },
  {
    id: 'target_7',
    title: 'Geek Tech & React Ecosystem Blog',
    url: 'https://overreacted.io',
    domain: 'overreacted.io',
    category: 'tech_blog',
    cms: 'Gatsby/Hexo',
    authority: 'DR 82',
    dofollow: true,
    commentType: 'GitHub Issues/Discussions',
    tags: ['React', '前端', 'JavaScript'],
    desc: '知名技术博客，底层支持 GitHub Discussions 格式互动，极具技术权威度。'
  },
  {
    id: 'target_8',
    title: 'Hacker News Show HN',
    url: 'https://news.ycombinator.com/show',
    domain: 'news.ycombinator.com',
    category: 'indie_hacker',
    cms: 'HN Custom',
    authority: 'DR 93',
    dofollow: false,
    commentType: '即时回复',
    tags: ['Y Combinator', 'Show HN', '产品发布'],
    desc: '全球顶级极客与创投论坛，适合在 Show HN 帖子下进行深度产品反馈。'
  }
];

class LinkDirectory {
  constructor() {
    this.categories = PRESET_CATEGORIES;
    this.presetTargets = PRESET_TARGETS;
    this.customTargets = this._loadCustomTargets();
  }

  _loadCustomTargets() {
    try {
      const data = localStorage.getItem('comlinkai_custom_targets');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('[LinkDirectory] 读取自定义目标失败:', e);
      return [];
    }
  }

  _saveCustomTargets() {
    try {
      localStorage.setItem('comlinkai_custom_targets', JSON.stringify(this.customTargets));
    } catch (e) {
      console.warn('[LinkDirectory] 保存自定义目标失败:', e);
    }
  }

  getCategories() {
    return this.categories;
  }

  /**
   * 获取外链目标列表（结合预置库与自定义库）
   */
  getTargets(categoryId = 'all', searchQuery = '') {
    let all = [...this.presetTargets, ...this.customTargets];

    if (categoryId && categoryId !== 'all') {
      all = all.filter(t => t.category === categoryId);
    }

    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      all = all.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.domain && t.domain.toLowerCase().includes(q)) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q))) ||
        (t.desc && t.desc.toLowerCase().includes(q))
      );
    }

    return all;
  }

  /**
   * 添加自定义外链目标
   */
  addCustomTarget(target) {
    if (!target || !target.url) return null;
    const cleanUrl = target.url.split('#')[0].replace(/\/$/, '');
    const domain = target.domain || new URL(cleanUrl).hostname;
    
    const newTarget = {
      id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title: target.title || domain,
      url: cleanUrl,
      domain: domain,
      category: target.category || 'tech_blog',
      cms: target.cms || 'Custom',
      authority: target.authority || 'Custom DA',
      dofollow: target.dofollow !== undefined ? target.dofollow : true,
      commentType: target.commentType || '自定义站点',
      tags: target.tags || ['Custom'],
      desc: target.desc || '用户自定义添加的目标外链网站',
      isCustom: true
    };

    this.customTargets.unshift(newTarget);
    this._saveCustomTargets();
    return newTarget;
  }

  /**
   * 删除自定义外链目标
   */
  removeCustomTarget(id) {
    this.customTargets = this.customTargets.filter(t => t.id !== id);
    this._saveCustomTargets();
  }
}

// 导出全局单例
if (typeof window !== 'undefined') {
  window.linkDirectory = new LinkDirectory();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LinkDirectory;
}
