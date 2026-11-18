# APIVALE Persona 作者与落地页映射全矩阵

为了确保每一条外链在博主和读者眼中都具有最高公信力，评论填写的作者（`Name` 字段）必须与目标落地页的真实作者与职能头衔形成 **100% 对应闭环**。

---

## 一、官方 Persona 团队成员库

| Persona 姓名 | 官方职位 / 头衔 | 擅长领域与负责话题 | 统一联系邮箱 |
| :--- | :--- | :--- | :---: |
| **Kenji Tanaka** | AI Developer Relations Engineer, APIVALE | Claude Fable 5.2 API 速度、价格、成本指南、SDK 接入 | `support@apivale.com` |
| **Sarah Chen** | Principal AI Infrastructure Architect, APIVALE | Claude Fable 5.2 vs Opus 5.5 基准对比、编码能力、多模型混跑 | `support@apivale.com` |
| **Chen Wei** | Senior AI Gateway Architect, APIVALE | Qwen 4 预览、Qwen4-Max API、Token Plan 计费、思考模式 | `support@apivale.com` |
| **Alex Rivera** | Senior Cloud Architect & API Integrations, APIVALE | API 网关基础设施、OpenRouter 替代方案、免 KYC/PayPal 充值 | `support@apivale.com` |
| **Elena Rostova** | Lead AI Performance Engineer, APIVALE | 并发吞吐、延迟优化、Prompt Caching 成本控制、终端降噪 | `support@apivale.com` |

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
  - **唯一指定**：`support@apivale.com`
- **Website 字段**：
  - 必须完整填写带有 `https://` 的内页 URL，不要遗漏结尾斜杠。
