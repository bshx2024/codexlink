# 🛡️ APIVALE 外链发布规范与 Persona 人设矩阵 (Outreach Principles & Personas)

> 本文档规范 APIVALE 项目所有外链发布动作的准入标准、作者身份分配与违规红线。

---

## 一、 5 大核心原则执行细则 (The 5 Golden Rules)

1. **专家专属邮箱原则 (防垃圾轰炸与权威对齐)**：
   - 规定值：必须填写对应技术专家的专属企业邮箱 `专家姓名小写点分@apivale.com`（如 `elena.rostova@apivale.com`、`sofia.costa@apivale.com`、`alex.rivera@apivale.com` 等）。
   - 禁止行为：坚决避免使用通用官方邮箱 `support@apivale.com` 发送博客评论（防止外部评论通知与恶意爬虫轰炸企业主客服邮箱）；同时严禁使用个人 Gmail、QQ 邮箱或临时接码邮箱。
2. **内页专属引流（严禁无脑退回首页）**：
   - 必须按评论文章的主题，精准对应 APIVALE 官方博客的具体技术指南。
   - 只有软件目录（如 AlternativeTo）或综合性 SaaS 平台提报时才使用主域名 `https://apivale.com/`。
3. **Persona 与内页原作者 100% 绑定**：
   - 评论时填写的姓名必须严格采用目标落地页的真实作者姓名，并在后面附带 `@ APIVALE` 组织后缀。
4. **正文白帽零外链与反直觉避坑钩子（通过率与转化之钥）**：
   - 评论正文只讨论架构、代码、实操避坑与微观成本，**100% 不留任何裸链、超链接或自报家门式软广**。外链完全由博客原生的 `Website` 字段生成，既能取得博主最大信任，又具最高白帽权威度。
   - **反直觉结论法则（Counter-Intuitive Hook）**：严禁单向灌输顺理成章的已知正面跑分（如单纯说速度快、价格便宜），必须抛出具备认知冲突的实测反差（如“表面更快但小改动增量 Diff 下反而由于缓存未命中导致单任务总成本高出 20%”），制造强烈的避坑好奇心，自然驱动读者主动点击评论者 Native URL 深入求证。
5. **排重与 24 小时频控**：
   - 严禁在同一域名下密集发帖，全量发布记录必须实时打点至 Google Sheets `APIVALE` 工作表与本地主日志。

---

## 二、 落地页原生 Persona 人设矩阵 (Persona Mapping Matrix)

| Persona 姓名 | 职位头衔 / 专业背景 | 绑定的落地内页 Landing Page | 专长领域与评论语言风格 |
| :--- | :--- | :--- | :--- |
| **Sofia Costa @ APIVALE** | Lead LLM Performance & Inference Architect | `/blog/sol-6-1-vs-6-2-pricing-benchmarks-guide/` | 深入 Sol 6.1 vs 6.2 速度与基准评测、长上下文缓存套利、任务级高频 Diff 循环避坑与高并发推理网关。实战、犀利、极重微观计费。 |
| **Alex Rivera @ APIVALE** | Senior Cloud Architect & Protocol Engineer | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 深入大模型网关协议、Prompt 缓存复用、多级容灾与 OpenAI SDK 兼容实现。严谨、偏向生产级系统架构。 |
| **Elena Rostova @ APIVALE** | Lead AI Performance Engineer | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 专精稀疏 MoE 路由效率、Top-8 专家门控机制、MLE-bench 科学竞赛基准与端云算力卸载。数据驱动、学术严谨。 |
| **Sarah Chen @ APIVALE** | Principal AI Infrastructure Architect | `/blog/claude-fable-5-2-vs-opus-5-5-coding-benchmarks-agent-cost-guide/` | 专注智能体编程评测（SWE-bench Verified）、代码仓库多文件长程依赖、长循环成本控制。注重实战落地。 |
| **Kenji Tanaka @ APIVALE** | AI Developer Relations Engineer | `/blog/claude-fable-5-2-api-pricing-guide/` | 擅长 Cursor IDE、Cline、Claude Code CLI 开发者工具接入、自定义端点配置与免海外信用卡支付实操。亲和、极客向。 |
| **Chen Wei @ APIVALE** | Senior AI Gateway Architect | `/blog/qwen-4-preview-api-token-plan-guide/` | 专长开源大模型生态（Qwen/DeepSeek）、亚太与全球开发者多币种结算、高性价比 Token 套利网关。行业视野开阔。 |

