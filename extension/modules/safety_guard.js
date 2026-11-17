/**
 * ComLinkAI Pro - 垃圾网站与违规内容安全审计模块 (Safety Guard)
 */

const TOXIC_KEYWORDS = {
  gambling: ['casino', 'gambling', 'slot', 'poker', 'betting', 'baccarat', 'lottery', '博彩', '赌博', '彩票', '投注', '棋牌', '威尼斯人', '百家乐', '开奖结果'],
  adult: ['porn', 'adult', 'sex', 'hentai', 'xvideo', 'pornhub', '色情', '成人', '约炮', '看片', '黄色网站', '直播源码'],
  scam_phishing: ['scam', 'crack', 'keygen', 'phishing', 'make money fast', '刷单', '兼职日赚', '外挂', '私服', '代刷', '花呗套现', '资金盘'],
  illegal_pharma: ['viagra', 'cialis', 'pharmacy', 'xanax', 'steroids', '网售处方药'],
  paid_links: ['buy backlinks', 'buy links', 'sponsored post', 'paid article', 'submit link $', 'fiverr link', 'guest post $', 'paid review', 'fiverr backlink', 'buy guest post', 'pricing for links', 'paypal link', '代刷外链', '买外链', '付费外链', '购买外链', '买外链网']
};

class SafetyGuard {
  /**
   * 检查网页文本是否包含黑灰产/黑帽买链/垃圾敏感词或毒性特征
   * @param {string} title 网页标题
   * @param {string} content 网页正文或 HTML 文本
   * @param {string} url 目标 URL
   * @returns {{ isSafe: boolean, riskLevel: 'safe'|'warning'|'toxic', score: number, reasons: string[] }}
   */
  static inspectPageContent(title = '', content = '', url = '') {
    const textToScan = `${url} ${title} ${content}`.toLowerCase();
    const hitReasons = [];
    let riskPoints = 0;

    for (const [category, keywords] of Object.entries(TOXIC_KEYWORDS)) {
      const hits = [];
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        const isAsciiWord = /^[a-z0-9_ -]+$/i.test(kwLower);

        let isHit = false;
        if (isAsciiWord && !kwLower.includes(' ')) {
          // 对英文单敏感词使用词界 (\b) 匹配
          const escaped = kwLower.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, 'i');
          isHit = regex.test(textToScan);
        } else {
          isHit = textToScan.includes(kwLower);
        }

        if (isHit) {
          hits.push(kw);
        }
      }

      if (hits.length > 0) {
        const categoryWeight = category === 'paid_links' ? 35 : 25;
        riskPoints += hits.length * categoryWeight;
        const categoryName = category === 'paid_links' ? '黑帽买链/交易交易性' : category;
        hitReasons.push(`命中${categoryName}敏感特征: ${hits.slice(0, 3).join(', ')}`);
      }
    }

    // 检查 PBN 堆砌特征（如正文中外部 http(s) 链接密度过大）
    const linkMatches = content.match(/https?:\/\//g);
    if (linkMatches && linkMatches.length > 30 && content.length < 3000) {
      riskPoints += 40;
      hitReasons.push('检测到密集外链堆砌 (疑为 PBN 垃圾外链农场)');
    }

    // 检查是否有全局 noindex 屏蔽标示
    if (textToScan.includes('content="noindex"') || textToScan.includes('content="noindex, nofollow"')) {
      riskPoints += 30;
      hitReasons.push('检测到网页设置了 noindex 标示 (无 SEO 权重传导价值)');
    }

    let riskLevel = 'safe';
    let isSafe = true;

    if (riskPoints >= 35) {
      riskLevel = 'toxic';
      isSafe = false;
    } else if (riskPoints >= 15) {
      riskLevel = 'warning';
      isSafe = true;
    }

    return {
      isSafe,
      riskLevel,
      score: Math.max(0, 100 - riskPoints),
      reasons: hitReasons.length > 0 ? hitReasons : ['页面内容未发现黑灰产与垃圾黑帽风险']
    };
  }
}

if (typeof window !== 'undefined') {
  window.SafetyGuard = SafetyGuard;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SafetyGuard;
}
