# CodexLink 🔗

> **最懂极客与研究者的本地优先、大模型解耦型万能网页剪藏器 & AI 网页伴侣。**
> Ultimate Web Clipper & AI Copilot for Obsidian / Logseq / AI Agents.

CodexLink 是一款开源、本地优先（Local-First）的高保真网页剪藏插件与 AI 伴侣工具。它不仅能将网页完美过滤并保存至您的 Obsidian 或 Logseq 本地库，还内置了强大的 WebSocket 中转协议，支持 Cursor, Claude Desktop, Antigravity 等 AI 智能代理（AI Agent）跨进程操控您的真实浏览器。

---

## 🌟 五大核心特色功能 (Key Features)

### 1. 💾 灵活双运行模式 (Dual-Mode Flexibility)
为了同时兼顾“极客开发操控”与“普通用户零门槛剪藏”，CodexLink 首创了双运行模式：
*   **💾 浏览器直写模式 (Standalone Mode)**：**完全脱离对本地 Node.js 服务的依赖**。利用现代浏览器原生的 **File System Access API** 获得用户 Obsidian 库目录的授权，直接由插件将 Markdown 和图片附件离线安全地写入本地磁盘。
*   **🔗 中转桥接模式 (Bridge Mode)**：插件通过 WebSocket 建立与本地 ws://localhost:3010 服务的长连接。此时 **Cursor / Antigravity 等 AI 代理可通过 MCP 协议发送点击、输入、滚动、截图等指令**，实现对用户真实浏览器会话的完全操控。

### 2. 🖼️ 本地图片自动下载重链 (Active-Session Image Localizer)
*   **痛点**：传统剪存器复制网页后容易因为防盗链（如微信、知乎）或原站倒闭而导致笔记中图片全部失效。
*   **解法**：CodexLink 在插件前端利用浏览器的活动 Session（携带 Cookie 与登录状态）自动下载所有网页图片资产，保存至您的 Obsidian ttachments/_assets/ 文件夹下，并将 Markdown 里的外部图片 URL 自动重写为本地相对路径，确保离线资料永久有效。

### 3. 💻 代码块提纯纯净化与语言检测 (Clean Code Blocks)
*   **痛点**：从技术博客剪存代码时，高亮渲染带入的垃圾 HTML <span> 标签会彻底破坏 Markdown 代码块的格式，且经常丢失语言标记。
*   **解法**：内置了代码节点提纯算法，自动剥离所有无用 <span> 格式标签，智能识别父级 CSS 提取编程语言名称（如 javascript、python），生成最干净的 ` 格式块。

### 4. 📝 Logseq 大纲列表一键转换 (Outliner Exporter)
*   **痛点**：Logseq 等大纲软件只支持列表层级结构，直接导入标准 Markdown 标题会导致排版散乱。
*   **解法**：在侧边栏开启“以大纲列表模式导出”后，大纲转换引擎会自动将 H1/H2 标题与正文段落重塑为带嵌套缩进层级的无序列表（- ），完美适配 Logseq / Roam Research 等子弹笔记生态。

### 5. 🧠 大模型解耦与自带 Key 自由 (Model-Agnostic BYOK)
*   **痛点**：市面上的 AI 剪藏插件大多强制收取月度订阅费或绑定单一云端模型。
*   **解法**：CodexLink 彻底解耦 AI 供应锁定。您可以在插件设置面板中自由配置您的 API Base URL、Model Name 和 API Key，直接使用您自己极低成本的 **DeepSeek R1/V3**、**OpenRouter** 密钥或本地运行的免费 **Ollama** 模型。

---

## 🛠️ 快速开始 (Getting Started)

### 📦 方式一：纯插件“单机直写模式” (最简单，零依赖)
1.  在 Chrome 浏览器中加载 extension/ 文件夹（或从官方商店获取）。
2.  打开侧边栏，将顶部运行模式切换为 **“浏览器直写模式”**。
3.  点击 **“📁 选择 Obsidian 库目录”**，选择您本地的 Obsidian 库文件夹并授予读写权限。
4.  在任意网页点击 **“提取并预览网页 Markdown”** -> **“一键剪存至 Obsidian”** 即可。

### 🚀 方式二：双击运行“中转桥接模式” (支持 AI 代理操控)
1.  双击运行根目录下的 codexlink-server.exe 桌面伴侣服务（已编译打包，无需安装 Node.js 与任何依赖）。
2.  在插件顶部运行模式中切换为 **“中转桥接模式”**。
3.  此时，您的本地 Node 服务将在 3010 端口开启 MCP 监听，您可以开始使用 AI Agent 自动操控您的浏览器执行复杂自动化流程。

---

## 📂 项目结构 (Project Structure)

`	ext
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
`

---

## 📄 开源许可证
本项目基于 MIT 许可证开源。数据完全归用户本地所有。
