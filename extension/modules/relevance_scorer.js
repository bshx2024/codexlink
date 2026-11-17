/**
 * ComLinkAI Pro - AI 内容主题契合度分析与评分模块 (Relevance Scorer)
 */

class RelevanceScorer {
  /**
   * 使用大模型进行深度语义契合度分析与打分
   * @param {Object} params 
   * @param {string} params.targetTitle - 目标博客标题
   * @param {string} params.targetContent - 目标博客正文
   * @param {string} params.siteNiche - 用户的目标引流网站定位描述 (例如: APIVALE 大模型 API 与开发者工具)
   * @param {string} params.apiUrl - AI API Base URL
   * @param {string} params.apiKey - AI API Key
   * @param {string} params.modelName - AI Model Name
   * @returns {Promise<{score: number, recommendation: 'deep_link'|'homepage_link'|'skip', reason: string}>}
   */
  static async evaluateRelevanceWithAI({ targetTitle, targetContent, siteNiche, apiUrl, apiKey, modelName }) {
    if (!apiUrl) apiUrl = 'http://localhost:28642/v1';
    if (!apiKey) apiKey = 'placeholder';
    if (!modelName) modelName = 'gpt-4o-mini';

    const prompt = `你是一位严谨的高级 SEO 策略专家。
请评估以下【目标博客文章】与【读者引流网站定位】的主题相关契合度。

---
目标博客标题：${targetTitle}
目标博客正文摘要：
${targetContent.slice(0, 3000)}
---

读者引流网站定位描述：
${siteNiche || 'AI 大模型 API 接口、自动化工具与开发者服务'}

请分析两者主题的拟合程度，并严格输出以下 JSON 格式（不要输出任何额外的 markdown 标签或非 JSON 字符）：
{
  "score": 85,
  "recommendation": "deep_link",
  "reason": "文章深度讨论了 AI Agent 架构，与引流网站的 AI API 业务高度契合，适合放置深度文章外链。"
}

说明：
- score: 0到100的分数（>75分代表高度相关；50-75分代表中等相关；<50分代表无关）
- recommendation 选项说明:
  - "deep_link": 高度相关 (score >= 75)，强烈推荐放置深度文章/博客落地方案外链
  - "homepage_link": 中度相关 (50 <= score < 75)，建议放置官网首页外链
  - "skip": 相关性低 (score < 50)，主题偏离严重，建议跳过不发布
- reason: 用 1-2 句精炼的中文解释评分理由。`;

    try {
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are an expert SEO analyst evaluating content topical relevance. Output strict JSON only.' },
            { role: 'user', content: prompt }
          ],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`AI API HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawText = (data.choices?.[0]?.message?.content || '').trim();
      const cleanedJsonText = rawText.replace(/^```json\s*|\s*```$/gi, '').trim();

      const result = JSON.parse(cleanedJsonText);
      return {
        score: typeof result.score === 'number' ? result.score : 60,
        recommendation: result.recommendation || (result.score >= 75 ? 'deep_link' : 'homepage_link'),
        reason: result.reason || '契合度分析完成'
      };
    } catch (err) {
      console.warn('[RelevanceScorer] AI 契合度评分调用失败，触发启发式兜底计算:', err.message);
      return this.heuristicFallback({ targetTitle, targetContent, siteNiche });
    }
  }

  /**
   * 启发式关键词交叉分析 (离线兜底算法)
   */
  static heuristicFallback({ targetTitle, targetContent, siteNiche }) {
    const defaultKeywords = ['ai', 'api', 'model', 'agent', 'code', 'developer', 'llm', 'gpt', 'deepseek', 'claude', 'qwen', '大模型', '代码', '接口', '开发'];
    const text = `${targetTitle} ${targetContent}`.toLowerCase();
    
    let matchCount = 0;
    for (const kw of defaultKeywords) {
      if (text.includes(kw)) matchCount++;
    }

    let score = Math.min(95, 40 + matchCount * 10);
    let recommendation = 'homepage_link';
    if (score >= 75) recommendation = 'deep_link';
    if (score < 50) recommendation = 'skip';

    return {
      score,
      recommendation,
      reason: `(离线计算) 命中 ${matchCount} 个核心主题关联词，推荐匹配方式: ${recommendation}`
    };
  }
}

if (typeof window !== 'undefined') {
  window.RelevanceScorer = RelevanceScorer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RelevanceScorer;
}
