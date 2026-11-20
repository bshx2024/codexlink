# APIVALE Persona 作者与落地页映射全矩阵

为了确保每一条外链在博主和读者眼中都具有最高公信力，评论填写的作者（`Name` 字段）必须与目标落地页的真实作者与职能头衔形成 **100% 对应闭环**。

---

## 一、官方 Persona 团队成员库

| Persona 姓名 | 官方职位 / 头衔 | 擅长领域与负责话题 | 专家专属联系邮箱 (防垃圾轰炸) |
| :--- | :--- | :--- | :---: |
| **Kenji Tanaka** | AI Developer Relations Engineer, APIVALE | Claude Fable 5.2 API 速度、价格、成本指南、SDK 接入 | `kenji.tanaka@apivale.com` |
| **Sarah Chen** | Principal AI Infrastructure Architect, APIVALE | Claude Fable 5.2 vs Opus 5.5 基准对比、编码能力、多模型混跑 | `sarah.chen@apivale.com` |
| **Chen Wei** | Senior AI Gateway Architect, APIVALE | Qwen 4 预览、Qwen4-Max API、Token Plan 计费、思考模式 | `chen.wei@apivale.com` |
| **Alex Rivera** | Senior Cloud Architect & API Integrations, APIVALE | API 网关基础设施、OpenRouter 替代方案、免 KYC/PayPal 充值 | `alex.rivera@apivale.com` |
| **Elena Rostova** | Lead AI Performance Engineer, APIVALE | 并发吞吐、延迟优化、Prompt Caching 成本控制、终端降噪 | `elena.rostova@apivale.com` |
| **Sofia Costa** | Lead LLM Performance & Inference Architect, APIVALE | Sol 6.1 vs 6.2 速度与基准评测、长上下文缓存套利、高并发推理架构 | `sofia.costa@apivale.com` |

---

## 二、话题 ➔ 落地内页 ➔ 作者精准映射表

```
apivale.com
├── /blog/claude-fable-5-2-api-pricing-guide/
│   ├── 主题: Claude Fable 5.2 API 速度、价格、成本指南
│   └── 对应作者: Kenji Tanaka @ APIVALE (或 Alex Rivera @ APIVALE)
│
├── /blog/claude-fable-5-2-vs-opus-5-5-coding-benchmarks-agent-cost-guide/
│   ├── 主题: Claude Fable 5.2 vs Opus 5.5 编程基准评测
│   └── 对应作者: Sarah Chen @ APIVALE
│
├── /blog/qwen-4-preview-api-token-plan-guide/
│   ├── 主题: Qwen 4 Preview、Qwen4-Max API、Token 方案
│   └── 对应作者: Chen Wei @ APIVALE
│
├── /blog/qwen-4-max-api-benchmarks-guide/
│   ├── 主题: Qwen 4 Max API 基准评测、27B 路线图与定价
│   └── 对应作者: Chen Wei @ APIVALE
│
├── /blog/how-to-connect-kimi-k3-to-codex-cli/
│   ├── 主题: Kimi K3 接入 OpenAI Codex CLI 与 VS Code
│   └── 对应作者: Alex Rivera @ APIVALE
│
├── /blog/how-to-connect-kimi-k3-to-claude-code-cli/
│   ├── 主题: Kimi K3 接入 Claude Code CLI 与 Cursor IDE
│   └── 对应作者: Alex Rivera @ APIVALE
│
├── /blog/how-to-connect-claude-opus-5-to-claude-code-cli/
│   ├── 主题: Claude Opus 5 接入 Claude Code CLI 配置
│   └── 对应作者: Alex Rivera @ APIVALE
│
├── /blog/openrouter-alternatives/
│   ├── 主题: OpenRouter 最佳替代品横评、免 KYC API 网关
│   └── 对应作者: Alex Rivera @ APIVALE
│
├── /blog/sol-6-1-vs-6-2-pricing-benchmarks-guide/
│   ├── 主题: Sol 6.1 vs 6.2 速度、定价基准与多上游网关迁移指南
│   └── 对应作者: Sofia Costa @ APIVALE
│
├── /blog/gemini-4-neon-api-pricing-benchmarks-guide/
│   ├── 主题: Gemini 4 Neon API 定价、1M 上下文与网关路由指南
│   └── 对应作者: Elena Rostova @ APIVALE
│
└── /blog/llm-cost-optimization-guide/
    ├── 主题: 大模型成本优化、提示词缓存、混合路由
    └── 对应作者: Elena Rostova @ APIVALE
```

---

## 三、表单填写格式规范

- **Name 字段**：
  - 标准推荐格式：`[姓名] @ APIVALE`（如 `Kenji Tanaka @ APIVALE` 或 `Sarah Chen @ APIVALE`）
  - 备选专业格式：`[姓名] | APIVALE Infra` 或 `[姓名] | AI Gateway Lead`
- **Email 字段**：
  - **必须填写专家个人专属企业邮箱**：采用 `[名].[姓]@apivale.com` 格式（如 `elena.rostova@apivale.com`、`sofia.costa@apivale.com`、`alex.rivera@apivale.com`）。
  - **严禁使用官方客服邮箱**：坚决避免使用通用邮箱 `support@apivale.com`，防范博客评论系统及外部抓取爬虫邮件轰炸企业主客服邮箱，同时达成评论作者与邮箱前缀 100% 信任对齐。
- **Website 字段**：
  - 必须完整填写带有 `https://` 的内页 URL，不要遗漏结尾斜杠。

