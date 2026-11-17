# ComLinkAI 大模型网关 (APIVALE / One API / New API) 接入排查与优化记录

## 1. 问题背景
在开发与配置 Chrome 扩展 **ComLinkAI** 的“网页伴侣 AI”大模型接口时：
- 目标网关：`https://apivale.com/v1`（基于 One API / New API 架构的聚合分发网关）。
- 模型名称：`sensenova/deepseek-v4-flash`。
- 现象：在 APIVALE 管理后台测试渠道连接显示 `Success`，但在插件端点击“测试连通性”或在“网页伴侣”聊天中发送消息时，相继出现 `HTTP 502 (Bad Gateway)`、`HTTP 503 (无可用渠道/All upstream accounts are inactive)`、`接口请求超时 (超过 35s)` 以及对话报错等问题。

---

## 2. 根因剖析与诊断细节

| 阶段 / 报错现象 | 根本原因 (Root Cause) |
| :--- | :--- |
| **现象 1: HTTP 502 (Bad Gateway)** | 1. 早期测试请求携带了 `max_tokens: 5` 等字段，部分上游网关不接受该限制导致代理异常。<br>2. 对话请求中携带了非必填参数（如 `temperature: 0.7`）或缺少显式 `stream: false`，导致网关反向代理挂起并返回 502。 |
| **现象 2: HTTP 503 (分组 default 下模型 deepseek-v4-flash 无可用渠道)** | 客户端自动 fallback 机制将 `sensenova/deepseek-v4-flash` 剥离前缀为 `deepseek-v4-flash`，而 APIVALE 的 `default` 分组中只注册了带命名空间的完整 Model ID `sensenova/deepseek-v4-flash`。 |
| **现象 3: HTTP 503 (all upstream accounts are inactive)** | 在网关多次遇到错误请求或探测失败后，APIVALE 自动将上游渠道状态标记为了 Inactive（临时熔断保护）。在管理后台重新开启启用（Active）后解除。 |
| **现象 4: 请求超时 (超过 35s 未响应)** | 免费/共享大模型服务在高峰期存在排队与冷启动，生成首字需要 20~45s。客户端早期 30s/35s 超时阈值过短，过早抛出 Timeout 中断。 |
| **现象 5: HTTP 403 (Insufficient account balance)** | 测试其他付费/非免费模型（如 `infer/glm-5.2`）时，上游服务商账号余额为 0 导致鉴权拒绝。确认 `sensenova/deepseek-v4-flash` 为免费渠道。 |

---

## 3. 代码架构修复与关键改动

### (1) 纯净请求体与显式 `stream: false`
- 在 `sidepanel.js` 的 `btnTestAiConnection`（握手测试）与 `handleSendMessage`（对话交互）中，统一使用高兼容的 OpenAI 纯净请求载荷：
```javascript
const resp = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: targetModel,
    messages: messages,
    stream: false // 关键：显式声明非流式，防止反向代理挂起
  }),
  signal: AbortSignal.timeout(60000) // 延长至 60 秒适配慢速/排队模型
});
```

### (2) URL 端点自适应解析规范
无论用户在 Base URL 输入框中填写的是 `https://apivale.com`、`https://apivale.com/v1` 还是完整带 `/chat/completions` 的路径，均自动标准化：
```javascript
let cleanBase = rawUrl.replace(/\/+$/, '');
let endpoint = '';
if (cleanBase.endsWith('/chat/completions')) {
  endpoint = cleanBase;
} else if (cleanBase.endsWith('/v1')) {
  endpoint = `${cleanBase}/chat/completions`;
} else {
  endpoint = `${cleanBase}/v1/chat/completions`;
}
```

### (3) 新旧模块存储 Key 双向同步兼容
在保存大模型配置时，同时将配置同步写入新旧两套 LocalStorage 与 `chrome.storage.local` 键中，保证网页伴侣、自动评论引擎（`autopilot_engine.js`）以及契合度评分器（`relevance_scorer.js`）全平台无缝联动：
```javascript
localStorage.setItem('ai_provider_preset', preset);
localStorage.setItem('ai_base_url', url);
localStorage.setItem('ai_api_key', key);
localStorage.setItem('ai_model_name', model);
// 兼容旧模块
localStorage.setItem('ai_api_url', url);
localStorage.setItem('ai_model', model);
```

### (4) 错误信息透明化透传
优化了错误信息解析逻辑，避免固定文案误导，直接提取服务端返回的 `error.message`、`detail` 或 HTTP 状态码渲染到界面。

---

## 4. 后续配置与排查指南 (Cheat Sheet)

1. **APIVALE 配置规范**：
   - **Base URL**：`https://apivale.com/v1`
   - **API Key**：填入在 APIVALE【令牌(Tokens)】中生成的 `sk-xxxxxxxx`。
   - **Model Name**：严格填写渠道中注册的完整名字，例如 `sensenova/deepseek-v4-flash`。
2. **测试不通时的 3 步排错法**：
   - **看报错码**：
     - `401`：Key 错误或有多余首尾空格。
     - `403 Insufficient balance`：上游账号欠费。
     - `503 All upstream inactive`：去 APIVALE 控制台【渠道】中把被熔断禁用的渠道重新打开为【已启用】。
     - `503 无可用渠道`：检查 Model Name 是否与 APIVALE 令牌授权分组下的渠道模型全名一致。
   - **保存配置**：测试成功后务必点击一次【💾 保存配置】，即可固化到对话与工作流引擎中。
