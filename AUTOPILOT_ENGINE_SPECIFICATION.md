# ComLinkAI Pro - Auto-Pilot 全自动无人值守反链引擎架构规范

本文档为 **ComLinkAI Pro** 扩展程序的【Auto-Pilot 全自动无人值守反链引擎】设计规范文档。在完成半自动（Human-in-the-Loop）流程验证与卡点优化后，可依此规范全量落地全自动化。

---

## 目录
- [1. 架构目标与模式设计](#1-架构目标与模式设计)
- [2. 全自动 4 阶段流水线流程](#2-全自动-4-阶段流水线流程)
- [3. 风控防封与随机延迟机制](#3-风控防封与随机延迟机制)
- [4. 挂机监控控制台与日志终端](#4-挂机监控控制台与日志终端)
- [5. 5 重防空转与看门狗超时恢复](#5-5-重防空转与看门狗超时恢复)
- [6. 断点续接与状态持久化规范](#6-断点续接与状态持久化规范)
- [7. 阶段推进 roadmap](#7-阶段推进-roadmap)

---

## 1. 架构目标与模式设计

### 1.1 核心目标
实现从 Google/竞品外链搜索、数据提取排重、网页导航、AI 正文阅读、3-Step 高价值评论生成、表单自动填充提交到断点恢复的全链条无人值守自动化。

### 1.2 双运行模式支持
1. **半自动模式 (Review-First Mode / 当前阶段)**：
   - 用户点击 `🚀 跳转并处理`；
   - 用户手动点击 `✨ 自动阅读正文并生成建设性评论`；
   - 审核生成的 3-Step 评论后点击 `🚀 填入并提交`；
   - 系统自动标打删除线 (`strikethrough`) 并记录日志。
2. **全自动挂机模式 (Auto-Pilot Mode / 下一阶段)**：
   - 一键开启 `▶ 启动挂机`；
   - 系统自动顺序轮询队列，全自动完成从导航到提交划线的闭环；
   - 提供 `⏸ 暂停` 和 `🛑 紧急停止`。

---

## 2. 全自动 4 阶段流水线流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 阶段 1: 搜索抓取 │ ──> │ 阶段 2: 导航读取 │ ──> │ 阶段 3: AI 生成 │ ──> │ 阶段 4: 填表提交 │
│  (Google Dork)  │     │ (DOM/Markdown)  │     │ (3-Step Prompt) │     │ (Strikethrough) │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **阶段 1：自动搜寻与清洗入库**
   - 自动在 Google 搜索追加 `&num=100`；
   - 抓取全部第三方博文，经 `normalizeUrl` 规范化排重入库；
   - 渲染至【收集】与【发布】队列。

2. **阶段 2：全自动导航与 DOM 正文提取**
   - 调度器更新当前 Tab URL 至目标博客；
   - 等待 DOM 加载完成 (`status === 'complete'`)；
   - 调用 `convertDomToMarkdownInTab()` 提取结构化 Markdown。

3. **阶段 3：全自动 AI 3-Step 生成**
   - 读取反链 Profile 资料（如 `Alex @ APIVALE`）；
   - 调用本地 AI 代理生成包含细节锚定、经验分享与 Hook 问句的评论文案。

4. **阶段 4：自动填表、提交与推进**
   - 自动定位 `Name` / `Email` / `Website` / `Comment` 字段；
   - 触发 `Form.submit()` 或提交按钮点击；
   - 自动在队列中应用删除线 (`strikethrough`) 与 55% 遮罩；
   - 开启随机防封等待，时间结束后自动进入下一条。

---

## 3. 风控防封与随机延迟机制

- **随机冷却间隔 (Random Delay)**：每完成一条博客评论提交后，自动开启 **15 秒 ~ 30 秒的随机倒计时**。
- **人声/打字模拟**：模拟真实用户的浏览与读文时间，彻底规避 Akismet、Cloudflare 或博客防火墙对频率过高请求的判定。

---

## 4. 挂机监控控制台与日志终端

### 4.1 可视化控制台设计
- **发光进度条**：显示 `已完成 / 总计 (百分比)`。
- **步骤指示灯**：
  - `📍 [1/5] 正在导航载入: domain.com`
  - `📍 [2/5] 正在提取正文 Markdown...`
  - `📍 [3/5] AI 正在生成 3-Step 评论...`
  - `📍 [4/5] 正在自动填表并提交...`
  - `📍 [5/5] 成功提交！倒计时 20s 进入下一条...`
- **防封倒计时**：`⏳ 距离下一个发布还剩: 18 秒`。

### 4.2 终端日志流 (Console Stream Log)
提供展开式 Log 区域，时间戳记录全部操作、跳过原因及错误提醒。

---

## 5. 5 重防空转与看门狗超时恢复

1. **单步 30 秒硬超时看门狗 (Step Watchdog)**：若某步骤在 30 秒内卡死，看门狗强制中断并标记 `⚠️ 超时跳过`，主循环绝不挂起。
2. **无表单/评论关闭 1 秒极速熔断 (No-Form Fast Abort)**：若 `FormDetector` 识别到 `Comments are closed` 或无 `textarea`，不发起 AI 请求，1 秒跳过。
3. **连续失败断路器 (Circuit Breaker)**：连续 5 条遇死链/网络错误时，自动强行暂停挂机并提醒用户检查网络。
4. **合法 URL 校验 (Bouncer)**：屏蔽 `chrome://`、`google.com/search` 等系统/搜索内部页。
5. **DOM 存活监测 (Tab Alive Checker)**：若标签页被手动关闭，自动恢复活动标签。

---

## 6. 断点续接与状态持久化规范

- **状态秒级写入**：每次状态变化（`done`、`skipped`、`toxic`）秒级写回 `localStorage.setItem('comlinkai_batch_queue', ...)`。
- **指针持久化**：记录当前游标 `auto_pilot_current_idx`。
- **重启一键恢复**：检测到上一次中断任务时，显示 **`▶ 恢复续接挂机 (从第 N 条继续)`** 按钮。
- **幂等性防护**：对比 `publishLogger`，已完成的网址自动跳过，绝不重复留言。

---

## 7. 阶段推进 Roadmap (已达成 ✅)

```
[Phase 1: 半自动验证] ➔ 运行半自动模式，优化表单识别、AI 生成质量与删除线 UI。(已完成)
[Phase 2: 方案对齐] ➔ 沉淀全自动化架构规范文档。(已完成)
[Phase 3: 代码全量落地] ➔ 借鉴 browser-hands 引入 Chrome 标签组隔离并发与 CDP DevTools 原生截屏硬件缩放，Auto-Pilot 挂机引擎全量落地！(v2.1 已完成)
```

---

## 8. v2.1 架构升维：借鉴 browser-hands 核心底座

### 8.1 Chrome 标签组（Tab Groups）隔离机制
* **痛点**：传统挂机脚本频繁切换或刷新当前活动标签页，极易抢夺用户视窗、干扰正常工作（如用户正在编码或浏览资料）。
* **解决方案**：引入 `chrome.tabGroups` 专属隔离组 `🤖 ComLinkAI Auto-Pilot`。挂机任务在后台独立标签组内静默轮询，标签组状态随任务实时响应（`[载入]` / `[AI 构思中]` / `[冷却 18s]` / `[需验证码]` / `[全部完成]`），彻底避免串页与误触。

### 8.2 CDP (Chrome DevTools Protocol) 原生截屏硬件缩放
* **痛点**：大量网页截图在前端注入 canvas 重新编码，导致 CPU 占用超过 100%、电脑发热、高分辨率图片极大消耗大模型 Token。
* **解决方案**：采用 DevTools 协议 `Page.captureScreenshot`，在底层利用 Chromium C++ 渲染管线按 `clip.scale` 自动硬件缩放至最佳长宽比，出图直接交付紧凑 Base64，实现近乎零 CPU 开销与极轻 Token 传输。

### 8.3 侧边栏原生业务网关 (Sidepanel Native Workflow Gateway)
* **痛点**：外部 AI Agent 容易通过低级别原子指令（`navigate` / `click` / `type`）绕过插件侧边栏的既有状态机，导致侧边栏待发布任务未打删除线、`PublishLogger` 未审计归档、Google Sheets 未自动实时同步。
* **解决方案**：在 `handleRemoteAgentAction` 中暴露业务级原生动作接口，外部 Agent、MCP 工具与本地中转服务均可直接触发完整的插件工作流：
  - `collect_google_results`：一键抓取 Google 搜索结果入库并刷新侧边栏；
  - `process_active_tab_comment`：全流程执行博文提取、表单探测、3-Step 战略性评论构思、填表提交、侧边栏划线与 Google Sheets 同步；
  - `get_queue`：获取侧边栏队列状态与进度统计；
  - `autopilot_start` / `autopilot_pause` / `autopilot_stop` / `autopilot_status`：完全程控 Auto-Pilot 挂机引擎。

### 8.4 Google Sheets 离线重试韧性队列 (Offline Resilience Queue)
* **痛点**：跨境网络波动或 Google Apps Script 偶发并发限流可能导致发布审计日志在推送云端表格时丢失。
* **解决方案**：在 `GoogleSheetsSync` 模块内引入本地持久化离线重试队列（`comlinkai_gsheet_retry_queue`）：
  - 遇到网络异常或服务端报错时，数据自动入库持久化；
  - 下一次成功请求或空闲时，自动启动带有 400ms 限流保护的渐进式补发机制，保障 100% 零数据丢失。

---

## 9. v2.5 工业级升维：6-Table 架构、dev.to + DataForSEO 交叉反查与探针复检池 (Probe Resilience Pool)

借鉴刘小排（Raphael AI 200 万月访问量实战）的核心方法论，ComLinkAI 在 v2.5 实现了底层外链架构的工业级重构：

### 9.1 三角色架构解耦 (Role-based Separation)
* **外链总管 (Orchestrator)**：驻留在本地 Bridge 服务 (`server/index.js`)，管理任务状态机、并发锁与调度对账，对外暴露 REST 接口 (`/api/backlink/*`)。
* **外链收集者 (Collector)**：通过 `scripts/collector_devto_dataforseo.js` 异步执行 dev.to 深度爬取与 DataForSEO 多维交叉反查，持续向任务队列补弹。
* **外链执行者 (Sender / Extension)**：`AutopilotEngine` 专注无痕后台执行，原子领单（`claimed_by`）、表单探测、CDP 硬件缩放截屏留证，并向成果库与探针池分流回写。

### 9.2 6 张核心共享表规范 (6-Table Architecture)
1. **`devto_outbound_links`**：文章原始出站链接流水总表，标记 `is_social`、`is_directory` 与候选标记。
2. **`ai_tool_sites`**：启发式清洗后的独立 AI & SaaS 种子清单（排重唯一根域名，作为交叉反查公约数）。
3. **`referrer_targets`**：外链任务主队列（状态机：`pending` $\rightarrow$ `sending` $\rightarrow$ `sent` / `failed` / `skipped`，具备 `claimed_by` 排它锁与防重复机制）。
4. **`referrer_success`**：长期收录成果库（记录 `listed_status` 审核跟踪、证据回执截图路径 `evidence_path`，供 7~14 天后自动巡检收录）。
5. **`referrer_probes`**：探针复检池（集中管理跳过的站点，分类记录 `probe_mode`、`skip_reason`、`has_form`、`has_captcha`，留待二轮强模型攻坚）。
6. **`site_knowledge`**：产品资产知识库（严格按 `profile` / `screenshot` / `submit_kit` 归档，存放 1200×737 官网各路由实拍整屏图与多语言文案）。

### 9.3 dev.to + DataForSEO 交叉反查策略 (Domain Intersection)
* **核心公约数算法**：若单一平台同时给 3 家以上互不相属的独立 AI 工具站提供入站外链（$\text{Citation Count} \ge 3$），该平台 100% 具备开放提交、行业工具目录或允许评论的通道。
* **执行命令**：
  ```powershell
  # 运行收集流水线 (支持 --pages 指定抓取深度)
  node scripts/collector_devto_dataforseo.js --pages 3
  ```

### 9.4 探针复检池 (Probe Resilience Pool) 闭环消费机制
* 遇到验证码超时（`captcha_protected`）、必须登录（`login_required`）、页面无表单（`no_form`）或 WAF 拦截时，引擎不再粗暴判定为整体失败，而是自动将上下文注入 `referrer_probes` 表；
* 探针池保留了原始落地页与特征信息，既保证主循环 24 小时丝滑无人值守，又为后续换用多模态大模型攻坚或人工集中批量处理沉淀了高价值资产。

---

## 10. v2.6 工业级防线：提交入口深度嗅探 (Two-Hop Sniffer)、反蜜罐与收费墙熔断

针对外链目标站（尤其是目录站与技术博客）首页或主落地页往往不直接裸露表单、或夹杂防爬虫陷阱与高额付费套餐的问题，引擎在 `FormDetector` 与 `AutopilotEngine` 中构建了 5 大工业级防线：

### 10.1 防线 1: Two-Hop 深度探索 (Two-Hop Navigation)
* **严控跃迁深度**：单站探索深度严格限制为 1 次（`Max-Hop = 1`），严禁递归跳转导致陷入死循环或耗尽内存；
* **跨域安全隔离**：嗅探出的入口超链接必须通过同源检查（严格限定同二级根域名，剔除 Twitter/Discord/GitHub 等外部出站外链）。

### 10.2 防线 2: 真实可见性与反蜜罐过滤 (Anti-Honeypot Visibility Check)
* **DOM 与几何双重校检**：`isHumanVisible(el)` 综合计算 `offsetParent`、`getBoundingClientRect()` 尺寸（宽高 $\ge 4\text{px}$、坐标在有效视口内）、CSS `display` / `visibility` 与 `opacity`；
* **蜜罐粉碎**：彻底过滤负坐标绝对定位（如 `left: -9999px`）或隐藏容器中的假输入框与假按钮，杜绝触发 Cloudflare/WAF 封禁黑名单。

### 10.3 防线 3: 模态弹窗与隐藏表单唤起 (Modal Trigger Detection)
* **语义识别**：智能匹配页面顶部或悬浮导航栏中的可见按钮（如 `Submit Tool`、`Add Product`、`List Your AI`、`Leave Reply`）；
* **主动唤醒**：优先尝试模拟点击触发模态弹窗，等待 1.5 秒后二次复检 DOM，成功捕获现代 SPA 常见弹窗表单。

### 10.4 防线 4: 强制免费层级偏置与收费墙熔断 (Free-Tier Bias & Paywall Breaker)
* **优先免费**：`enforceFreeTierAndDetectPaywall` 自动定位并勾选包含 `Free`、`Standard`、`Basic`、`$0`、`免费` 的套餐卡片或单选框；
* **零成本红线熔断**：若页面或跳转后检测到强制绑定信用卡或 Stripe/PayPal 收银台（如 `$29/mo`、`$49 featured`），立即终止填表并标记 `paid_redirect`，坚守 0 成本白帽外链底线。

### 10.5 防线 5: 探针池候选链接沉淀 (Probe Link Archiving)
* 若多轮探索后仍未定位到可交互表单，嗅探到的高分候选链接（如 `/pricing`、`/sponsor`、`/login`）将结构化归档至 `referrer_probes` 表的 `submit_links` 字段，为后续高级攻坚积累精准特征。
