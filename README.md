# ComLinkAI 🔗

> **最懂极客、研究者与 SEO 站长的本地优先、大模型解耦型 AI 网页伴侣、博客评论反链助手 & 网页剪藏器。**
> Ultimate AI Web Copilot, Blog Comment Backlink Automation & Clipper.

ComLinkAI 是一款开源、本地优先（Local-First）的高保真网页剪藏插件、AI 浏览器自动化中转与博客反链智能助手。它不仅能将网页完美过滤并保存至您的 Obsidian 或 Logseq 本地库，内置了 WebSocket 中转协议支持 AI 智能代理操控真实浏览器，还全新集成了**博客评论反链自动填充与 AI 人工审核提交**功能。

---

## 🌟 核心特色功能 (Key Features)

### 1. 💬 博客评论反链自动填充与 AI 人工审核助手 (Blog Comment Backlink Helper)
这是 ComLinkAI v2.0 的核心亮点功能，专为 SEO 优化、站长外链建设与技术博客互动设计：
*   **智能正文阅读与分析**：一键深入分析当前博客文章的核心论点、亮点与具体讨论点。
*   **高留存率建设性评论**：AI 结合文章细节与您的个人 Profile（姓名、邮箱、目标引流网址、网站定位）撰写 80-160 字极具专业度与深度建设性的见解评论，杜绝干瘪垃圾评论，极易通过博主与 Akismet 审核。
*   **通用表单 DOM 自动感知**：自动探测定位 WordPress、Ghost、Typecho、Hexo 等常见博客系统的 `Name`、`Email`、`Website` 和 `Comment` 字段。
*   **Human-in-the-Loop 人工审核提交**：生成的评论在侧边栏可实时润色修改，提供“仅填入表单”与“一键自动提交”按钮，轻松应对 CAPTCHA 验证码。
*   **反链历史追踪**：自动记录成功发表过的留言、网址与时间戳。

### 2. 🤖 AI Agent 浏览器原生操控桥梁 (AI Browser Automation Bridge)
它充当了 AI 智能代理与您真实浏览器之间的“神经通道”：
*   **指令化操控**：AI 代理（如 Antigravity、Cursor、Claude Desktop 等）可以通过本地桥接服务发送标准化指令，由插件在当前活动网页中静默或模拟执行：
    *   `navigate`：控制浏览器静默跳转至任意 URL。
    *   `getActiveTab`：获取当前网页的结构化 Markdown/DOM 内容。
    *   `click` / `type`：模拟真实用户点击页面元素、输入框文本键入。
    *   `scroll` / `keypress`：控制页面滚动、发送键盘按键事件。
    *   `screenshot`：对当前标签页进行高分辨率无缝截图并返回给 AI。
    *   `waitForElement` / `getElements`：侦测页面动态加载 DOM 节点并提取所有可交互元素。

### 3. 💾 灵活双运行模式 (Dual-Mode Flexibility)
*   **💾 浏览器直写模式 (Standalone Mode)**：利用现代浏览器原生的 **File System Access API** 直接将 Markdown 和图片附件离线安全地写入 Obsidian 本地磁盘。
*   **🔗 中转桥接模式 (Bridge Mode)**：插件通过 WebSocket 建立与本地 `ws://localhost:3010` 服务的长连接，全面激活 AI 浏览器自动化操控能力。

### 4. 🖼️ 本地图片自动下载重链 (Active-Session Image Localizer)
*   在插件前端利用浏览器的活动 Session 自动下载所有网页图片资产，保存至 Obsidian 库，并将外部图片 URL 重写为本地相对路径，确保离线资料永久有效。

### 5. 🧠 大模型解耦与自带 Key 自由 (Model-Agnostic BYOK)
*   您可以在插件设置面板中自由配置您的 `API Base URL`、`Model Name` 和 `API Key`，直接使用您自己极低成本的 **DeepSeek R1/V3**、**OpenRouter** 密钥或本地运行的免费 **Ollama** 模型。

---

## 🔌 官方推荐 API 网关合作伙伴 (Official API Gateway Partner)

本插件与 **[Apivale (apivale.com)](https://apivale.com)** 官方统一 AI API 网关服务深度兼容。为了获得最稳定、低延迟 of AI 网页提炼与分析体验，推荐注册并接入 **Apivale** 服务：

*   **⚡ 统一多模型网关 (Unified AI Gateway)**：Apivale 提供了统一的管理后台与 API 网关服务，仅需一个 API 密钥，即可一站式调用全网最前沿的主流大语言模型（包括 **DeepSeek-R1**、**Claude Opus 4.8**、**ChatGPT-5.6**、**GLM-5.2** 等）。
*   **⚙️ 零配置、无缝兼容**：接口协议完全兼容标准 OpenAI 规范。新用户仅需在设置面板的 `API Base URL` 中填入 `https://apivale.com/v1`，并填入您的 Apivale 密钥即可满血使用。
*   **🌐 专属高并发高可用保障**：针对 CodexLink 侧边栏助手的高频网页提炼、长上下文解析场景进行了专属路由优化，彻底告别直连海外 API 接口时的网络波动与高额账单。

---

## 🚀 安装指南 (Installation Guide)

### 1. 📂 安装 Chrome 浏览器插件 (Frontend Extension)
由于插件以源码包形式发布，您需要通过 Chrome 开发者模式加载它：
1. 下载本项目源码压缩包并解压到您的本地电脑。
2. 打开 Chrome 浏览器，在地址栏输入并访问 `chrome://extensions/`（或者点击右上角菜单 -> **扩展程序** -> **管理扩展程序**）。
3. 在扩展管理页面的右上角，找到并开启 **“开发者模式” (Developer mode)** 开关。
4. 点击页面左上角出现的 **“加载已解压的扩展程序” (Load unpacked)** 按钮。
5. 选择解压出的项目文件夹中的 `extension` 目录。加载成功后即可在浏览器工具栏查看到 CodexLink 插件。

### 2. 💻 运行本地桥接服务 (Backend Server - 仅中转桥接模式需要)
如果您希望使用 AI Agent 功能操控浏览器，需要运行本地后台服务：
*   **直接启动**：双击根目录下的 `codexlink-server.exe` 即可启动中转网关。
*   **开机后台自启（推荐）**：右键点击 `install-startup.ps1`，选择 **“使用 PowerShell 运行”**。该脚本会自动将后台服务配置为 Windows 启动项，在开机时静默后台自启，并在系统右下角托盘提供控制选项。

---

## 🛠️ 快速开始使用 (Quick Start Guide)

### 📦 方式一：纯插件“单机直写模式” (最简单，零依赖)
1. 按照上述指南安装 Chrome 插件。
2. 打开插件侧边栏，将顶部运行模式切换为 **“浏览器直写模式”**。
3. 点击 **“📁 选择 Obsidian 库目录”**，选择您本地的 Obsidian 库文件夹并授予读写权限。
4. 在任意网页点击 **“提取并预览网页 Markdown”** -> **“一键剪存至 Obsidian”** 即可。

### 🚀 方式二：运行“中转桥接模式” (支持 AI 代理操控)
1. 启动 `codexlink-server.exe` 本地服务。
2. 在插件顶部运行模式中切换为 **“中转桥接模式”**。
3. 此时，您的本地 Node 服务将在 `3010` 端口开启 MCP 监听，您可以开始使用 AI Agent 自动操控您的浏览器执行复杂自动化流程。

---

## 📂 项目结构 (Project Structure)

```text
CodexLink/
├── extension/          # Chrome 浏览器扩展插件源码 (纯前端)
│   ├── manifest.json   # 插件配置文件
│   ├── background.js   # 插件后台 Service Worker
│   ├── sidepanel.html  # 侧边栏布局
│   ├── sidepanel.css   # 侧边栏样式
│   └── sidepanel.js    # 侧边栏核心业务逻辑
├── server/             # 极客桥接服务端源码
│   ├── index.js        # Node.js 本地 API & WebSocket 中转服务
│   └── package.json    # 服务端配置文件
├── codexlink-server.exe# 编译打包好的 Windows 单文件免安装服务端 (托盘运行)
├── install-startup.ps1 # 开机自动秒连/后台静默自启一键配置脚本
├── run-server.ps1      # 本地 Node 源码极速启动脚本
└── .gitignore          # 过滤 node_modules 与编译产物的 Git 规则文件
```

---

## 📄 开源许可证
本项目基于 MIT 许可证开源。数据完全归用户本地所有。
