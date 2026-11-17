/**
 * ComLinkAI Pro - Semrush 外链 CSV 解析与清洗模块
 */

const SOCIAL_AND_INVALID_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'youtube.com', 'instagram.com',
  'linkedin.com', 'pinterest.com', 'reddit.com', 'github.com', 't.me',
  'telegram.org', 'wikipedia.org', 'google.com', 'baidu.com',
  'bing.com', 'yahoo.com', 'yandex.com', 'yandex.ru', 'duckduckgo.com',
  'so.com', 'sogou.com', '360.cn', 'archive.org', 'web.archive.org'
];

/**
 * 简单的 CSV 解析器（支持处理带双引号、换行与逗号的情况）
 */
function parseCSVText(csvText) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentLine.push(currentField.trim());
      if (currentLine.some(f => f !== '')) lines.push(currentLine);
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some(f => f !== '')) lines.push(currentLine);
  }

  return lines;
}

/**
 * 四分类自动识别引擎与黑帽毒性鉴定
 * @param {string} url 
 * @param {string} title 
 * @param {string} anchor 
 * @returns {'blog_comment'|'directory'|'platform_saas'|'forum_community'|'toxic'}
 */
function classifyBacklink(url = '', title = '', anchor = '') {
  // 1. 优先调用 SafetyGuard 进行毒性/黑帽买链判断
  if (typeof SafetyGuard !== 'undefined') {
    const safetyRes = SafetyGuard.inspectPageContent(title, anchor, url);
    if (!safetyRes.isSafe || safetyRes.riskLevel === 'toxic') {
      return 'toxic';
    }
  }

  const u = (url || '').toLowerCase();
  const t = (title || '').toLowerCase();
  const a = (anchor || '').toLowerCase();
  const text = `${u} ${t} ${a}`;

  // 2. 识别【🚀 平台收录 / SaaS List】特征
  const platformDomains = ['saashub.com', 'alternativeto.net', 'producthunt.com', 'theresanaiforthat.com', 'topai.tools', 'futurepedia.io', 'micro-launch.com', 'softonic.com', 'chromewebstore'];
  if (platformDomains.some(d => u.includes(d)) || u.includes('/submit-tool') || u.includes('/add-product') || u.includes('/listing') || text.includes('submit software') || text.includes('saas directory')) {
    return 'platform_saas';
  }

  // 3. 识别【🧭 目录站 / 网址导航】特征
  const directoryKeywords = ['directory', 'catalog', 'nav', 'listing', 'submit-link', 'add-site', 'suggest-url', 'yellowpages', 'dmoz', 'dirpedia', 'ezilon', 'jasminedirectory', '导航', '目录'];
  if (directoryKeywords.some(kw => u.includes(kw) || t.includes(kw)) || u.includes('/submit.php') || u.includes('/add.php') || u.includes('/submit.html')) {
    return 'directory';
  }

  // 4. 识别【👥 论坛 / 社区】特征
  const forumDomains = ['reddit.com', 'quora.com', 'v2ex.com', 'dev.to', 'indiehackers.com', 'medium.com', 'github.com', 'news.ycombinator.com', 'stackoverlow.com', 'forum', 'community', 'discussion'];
  if (forumDomains.some(d => u.includes(d)) || u.includes('/thread') || u.includes('/topic') || u.includes('/viewtopic')) {
    return 'forum_community';
  }

  // 5. 默认归为【💬 博客评论区】（常见文章路径：/blog/, /post/, /article/, 含有年份/月份等）
  return 'blog_comment';
}

/**
 * 解析并清洗 Semrush / Ahrefs / Similarweb / 百度等导出的外链 2D 行数据或 CSV 内容
 * @param {Array<Array<string>>|string} rowsOrCsv - 行数据数组或 CSV 文本内容
 * @returns {Array<{url: string, domain: string, title?: string, anchor?: string, category: string, isToxic: boolean, toxicReason?: string}>}
 */
function parseAndCleanBacklinkRows(rowsOrCsv) {
  let rows = [];
  if (typeof rowsOrCsv === 'string') {
    rows = parseCSVText(rowsOrCsv);
  } else if (Array.isArray(rowsOrCsv)) {
    rows = rowsOrCsv;
  }
  if (!rows || rows.length < 2) return [];

  // 清理第一行为 String
  const headers = (rows[0] || []).map(h => (h ? String(h).toLowerCase().trim() : ''));

  // 寻找常用列名索引 (包含中英文: Semrush / Ahrefs / Similarweb 等导出模板)
  let urlIdx = headers.findIndex(h => 
    h.includes('source url') || h.includes('page url') || h.includes('referring page') || h === 'url' || h.includes('target url') ||
    h.includes('外链页面') || h.includes('来源页面') || h.includes('来源网址') || h.includes('来源url') || h === '外链' || h.includes('源链接') || h.includes('目标网址')
  );

  let titleIdx = headers.findIndex(h => 
    h.includes('source title') || h.includes('page title') || h === 'title' ||
    h.includes('职称') || h.includes('页面标题') || h.includes('外链标题') || h === '标题' || h.includes('来源标题')
  );

  let anchorIdx = headers.findIndex(h => 
    h.includes('anchor') || h.includes('link text') ||
    h === '锚' || h.includes('锚文本') || h.includes('锚点') || h.includes('锚词')
  );

  // 兜底策略 1：如果包含“外链”或 HTTP 字符的列，优先识别
  if (urlIdx === -1) {
    urlIdx = headers.findIndex(h => h.includes('link') || h.includes('页') || h.includes('地址'));
  }
  // 兜底策略 2：默认首列为 URL
  if (urlIdx === -1) urlIdx = 0;

  const validEntries = [];
  const seenUrls = new Set();
  let socialCount = 0;
  let dedupeCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[urlIdx]) continue;

    let rawUrl = String(row[urlIdx]);
    if (!rawUrl) continue;

    // 清理 URL 字符串
    rawUrl = rawUrl.replace(/^["']|["']$/g, '').trim();
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      if (rawUrl.includes('.') && !rawUrl.includes(' ')) {
        rawUrl = 'https://' + rawUrl;
      } else {
        continue;
      }
    }

    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase();

      // 剔除社交平台、搜索引擎及无效域名
      if (SOCIAL_AND_INVALID_DOMAINS.some(domain => hostname.endsWith(domain))) {
        socialCount++;
        continue;
      }

      if (seenUrls.has(rawUrl)) {
        dedupeCount++;
        continue;
      }
      seenUrls.add(rawUrl);

      const title = titleIdx !== -1 && row[titleIdx] ? String(row[titleIdx]).trim() : '';
      const anchor = anchorIdx !== -1 && row[anchorIdx] ? String(row[anchorIdx]).trim() : '';

      // 四分类与毒性鉴定
      const category = classifyBacklink(rawUrl, title, anchor);
      let isToxic = category === 'toxic';
      let toxicReason = '';

      if (typeof SafetyGuard !== 'undefined') {
        const safetyRes = SafetyGuard.inspectPageContent(title, anchor, rawUrl);
        if (!safetyRes.isSafe) {
          isToxic = true;
          toxicReason = safetyRes.reasons.join('; ');
        }
      }

      validEntries.push({
        url: rawUrl,
        domain: hostname,
        title: title,
        anchor: anchor,
        category: category,
        isToxic: isToxic,
        toxicReason: toxicReason,
        source: 'excel_csv_import',
        importedAt: new Date().toISOString()
      });
    } catch (e) {
      // 忽略非法 URL
    }
  }

  validEntries.stats = {
    totalRaw: rows.length > 0 ? rows.length - 1 : 0,
    socialCount,
    dedupeCount,
    validCount: validEntries.length
  };

  return validEntries;
}

/**
 * 兼容旧接口：解析并清洗 Semrush/Ahrefs 导出的 CSV 外链数据
 */
function parseAndCleanBacklinkCSV(csvContent) {
  return parseAndCleanBacklinkRows(csvContent);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseAndCleanBacklinkCSV, parseAndCleanBacklinkRows, parseCSVText };
}
