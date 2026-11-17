# APIVALE 博客评论外链发布总原则与执行标准 (SOP)

> 本规范定义了 `https://apivale.com` 在执行高质量博文评论外链（Blog Comment Outreach）时的战略原则、落地页匹配规则、锚文本规范及节奏把控标准。

---

## 一、 按评论话题定页面，不要按「想推哪篇」定

发布外链的核心是**“超高上下文相关性”**，切忌生硬推销不相关的文章。根据目标博文的具体内容主题，严格按下表匹配落地的目标 URL：

| 评论所在文章的话题分类 | 目标留哪个页面 (Target URL) | 典型示例 |
| :--- | :--- | :--- |
| **某个具体模型**<br>(Qwen 4 / GLM-5.3 / Kimi K3 / DeepSeek V4 / Gemini 4 / Claude 等) | **该模型对应的高质量专题文章** | `/blog/qwen-4-max-api-benchmarks-guide/`<br>`/blog/deepseek-v4-api-pricing-comparison/` |
| **开发工具配置与客户端接入**<br>(Claude Code / Cursor / Codex CLI / OpenCode / Cline 等) | **对应的 Setup 教程与接口接入文章** | `/blog/how-to-connect-kimi-k3-to-codex-cli/`<br>`/blog/claude-code-third-party-api-setup/` |
| **API 中转服务、支付与服务替代**<br>(API 网关、免 KYC、PayPal 充值、OpenRouter 替代) | **站级横评文章或专题指南** | `/blog/openrouter-alternatives/`<br>`/blog/opencode-paypal-billing-api-proxy-guide/`<br>或首页 `https://apivale.com/` |
| **泛科技、泛讨论或对不上任何专栏** | **留网站首页，或者坚决不发** | `https://apivale.com/`<br>*(宁缺毋滥，拒绝在低相关博文硬塞)* |

> [!IMPORTANT]
> **外链首要原则：宁缺毋滥**
> 如果目标博客文章与 APIVALE 任何现有内页或主站核心业务都不契合，坚决跳过不发，不浪费权重预算，保护域名声誉。

---

## 二、 挑哪几篇先发：基于 GSC (Google Search Console) 数据定优先级

1. **核心优先级：已收录 + 有曝光 + 排名在 10 名开外的内页**
   - 处于第 11~30 名的页面，说明谷歌算法已认可其内容主题，但处于“第二页/权重不足”状态。此时高质量外链注入权重的边际效应最大，最容易将其推入第 1 页（Top 10）。
2. **未收录页面先抓内容与内链**
   - 没收录的内页，优先在站内解决问题（增加内链、优化正文深度与原创度、提交 Sitemap）。
   - 外链能加快爬虫抓取，但替代不了页面自身的内容质量（*“没收录，那是网页质量不行”*）。

---

## 三、 锚文本自然差异化 (Anchor Text Scattering)

1. **富文本/自定锚文本场景**：
   - 提取内页 `Title` 或 `H1` 里的**核心长尾词**作为链接文本（如 `Qwen 4 Max API pricing`、`connect Kimi K3 to Codex CLI`）。
   - **严禁全站统一锚文本**：切忌 100 条外链清一色写 `apivale` 或 `AI API`，高度单一的商用锚文本极易触发谷歌防外链操纵算法。
2. **纯 URL / 昵称展示场景 (WordPress / Webmention / Ghost)**：
   - 链接只能挂在昵称（Name）或原生 Website 字段时，挑选**相关度极高**的博客精准发布，依靠博文正文语义与出站上下文建立相关性。

---

## 四、 控节奏、严筛博客生态

1. **单一域名防过度集中**：
   - 同一个独立博客，绝不在多篇文章的评论区连续发布同一个域名。
   - 单博客 24 小时频控限制，全站总引用不超过 2~3 条高价值深度评论。
2. **博客质量人机合审**：
   - 发之前必看：该博客是否有真实读者互动、博主是否有活跃回复。
   - 评论区若充斥大量 Casino/Crypto/SEO 垃圾农场广告，立即标记 `toxic` 废弃。
3. **发布时间平滑分散**：
   - 批次发布严禁在几天内给几十个不同内页突击上链，遵循自然增长曲线。

---

## 五、 闭环追踪与 30 天验收机制

1. **30 天数据复盘**：
   - 记录发布日期后，满一个月在 Google Search Console (GSC) 中按具体 Page URL 筛选：
     - **曝光量 (Impressions)** 是否有显著抬头？
     - **平均排名 (Average Position)** 是否向前突破？
2. **预算与策略动态调整**：
   - 获得正向排名的内页：继续补充 1~2 条高权威链接巩固排位。
   - 曝光与排名完全停滞的页面：说明瓶颈在文章内容深度、竞争对手过强或搜索意图不匹配，立即暂停外链预算，转入文章内容重构。
