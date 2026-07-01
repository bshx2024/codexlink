const http = require('http');
const { WebSocketServer } = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置常量
const PORT = 3010;

// 全局状态
let activeExtensionWs = null;
const pendingRequests = new Map();

// 日志记录函数 - 所有非协议输出必须写入 stderr，以防破坏 MCP 的 stdout 协议流
function log(msg, ...args) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [CodexLink] ${msg}`, ...args);
}

// 动态读取并解析 Codex 配置文件 (.codex/config.toml) 与密钥 (.codex/auth.json)
function getCodexConfig() {
  const defaultConf = {
    baseUrl: 'http://127.0.0.1:28642/v1',
    model: 'gpt-5.5',
    apiKey: ''
  };

  let apiKey = '';
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (fs.existsSync(authPath)) {
      const authContent = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (authContent.OPENAI_API_KEY) {
        apiKey = authContent.OPENAI_API_KEY;
      }
    }
  } catch (err) {
    log('读取 auth.json 密钥失败:', err.message);
  }

  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    if (!fs.existsSync(configPath)) {
      log('Codex 配置文件不存在:', configPath);
      return { ...defaultConf, apiKey };
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split(/\r?\n/);
    
    let model = '';
    let baseUrl = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 提取 root 级别的 model = "..."
      if (trimmed.startsWith('model =') || trimmed.startsWith('model=')) {
        const match = trimmed.match(/model\s*=\s*["']([^"']+)["']/);
        if (match && !model) {
          model = match[1];
        }
      }

      // 提取 base_url = "..."
      if (trimmed.startsWith('base_url =') || trimmed.startsWith('base_url=')) {
        const match = trimmed.match(/base_url\s*=\s*["']([^"']+)["']/);
        if (match && !baseUrl) {
          baseUrl = match[1];
        }
      }
    }

    const result = {
      baseUrl: baseUrl || defaultConf.baseUrl,
      model: model || defaultConf.model,
      apiKey: apiKey || defaultConf.apiKey
    };
    log('成功从 config.toml 和 auth.json 解析到 Codex 配置与密钥:', JSON.stringify({ ...result, apiKey: result.apiKey ? '***' : '' }));
    return result;
  } catch (err) {
    log('读取/解析 Codex 配置文件出错，使用默认配置:', err.message);
    return { ...defaultConf, apiKey };
  }
}
// 动态检测 Obsidian 知识库路径，优先读取 Obsidian 系统全局 Session 以自适应匹配当前正处于打开状态或最新活跃的库，其次通过 config.toml 动态识别，兜底为 E:\obsidianfiles
function getObsidianPath() {
  const defaultPath = 'E:\\obsidianfiles';
  try {
    const appData = process.env.APPDATA || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming') : '');
    if (appData) {
      const obsJsonPath = path.join(appData, 'obsidian', 'obsidian.json');
      if (fs.existsSync(obsJsonPath)) {
        const obsConf = JSON.parse(fs.readFileSync(obsJsonPath, 'utf8'));
        if (obsConf && obsConf.vaults) {
          let activeVaultPath = null;
          let maxTs = 0;
          
          for (const key in obsConf.vaults) {
            const vault = obsConf.vaults[key];
            if (vault && vault.path) {
              // 1. 优先匹配当前正处于打开/挂载状态的库
              if (vault.open === true) {
                log('从 obsidian.json 智能检测到当前活动库路径:', vault.path);
                return vault.path;
              }
              // 2. 其次匹配最新访问过的活跃库
              if (vault.ts && vault.ts > maxTs) {
                maxTs = vault.ts;
                activeVaultPath = vault.path;
              }
            }
          }
          if (activeVaultPath) {
            log('从 obsidian.json 智能匹配到最新活跃库路径:', activeVaultPath);
            return activeVaultPath;
          }
        }
      }
    }
  } catch (err) {
    log('读取 obsidian.json 自动探测当前活动库出错:', err.message);
  }

  // 兜底一：优先检查磁盘上是否存在的最常用 Obsidian 库路径
  const candidatePaths = [
    'E:\\obsidianfiles',
    'E:\\kaifa\\obsidianfiles'
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      log('智能探测并匹配到本地存在的 Obsidian 库路径:', p);
      return p;
    }
  }

  // 兜底二：从 config.toml 中动态识别
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const matches = content.match(/\[projects\.'([^']+)'\]/g);
      if (matches) {
        for (const m of matches) {
          const pathMatch = m.match(/\[projects\.'([^']+)'\]/);
          if (pathMatch && pathMatch[1]) {
            const projectPath = pathMatch[1];
            if (projectPath.toLowerCase().includes('obsidian') && fs.existsSync(projectPath)) {
              log('从 config.toml 智能自动匹配到本地存在的 Obsidian 库绝对路径:', projectPath);
              return projectPath;
            }
          }
        }
      }
    }
  } catch (err) {
    log('从 config.toml 探测路径出错:', err.message);
  }
  return defaultPath;
}


// ==========================================
// 1. HTTP 状态服务与 REST API 接口
// ==========================================
const httpServer = http.createServer(async (req, res) => {
  // 设置 CORS 跨域头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1.4 一键剪存网页至 Obsidian 的 REST API 接口
  if (req.url === '/api/save-to-obsidian' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { title, url, content, summary } = JSON.parse(body);
        if (!title || !content) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '缺少标题 (title) 或正文内容 (content)' }));
          return;
        }

        const obsidianPath = getObsidianPath();
        const saveDir = path.join(obsidianPath, 'CodexLink');
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }

        const safeTitle = title.replace(/[\\\/:\*\?"<>\|]/g, '_').trim();
        const filename = `${safeTitle}.md`;
        const filePath = path.join(saveDir, filename);

        const currentDate = new Date().toLocaleString('zh-CN', { hour12: false });
        let fileContent = `---
title: "${title.replace(/"/g, '\\"')}"
url: ${url || ''}
clipped_at: ${currentDate}
tags:
  - clipped
  - web
---

`;

        if (summary && summary.trim()) {
          fileContent += `## 💡 AI 核心摘要\n\n${summary.trim()}\n\n---\n\n`;
        }

        fileContent += `## 📄 网页排版正文\n\n${content.trim()}\n`;

        fs.writeFileSync(filePath, fileContent, 'utf8');
        log(`网页剪存成功！已写入本地 Obsidian 文件: ${filePath}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ 
          success: true, 
          filePath: filePath, 
          obsidianPath: obsidianPath,
          filename: filename 
        }));
      } catch (err) {
        log('剪存至 Obsidian 时出错:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '保存文件失败: ' + err.message }));
      }
    });
    return;
  }

  // 1.1 获取活跃标签页内容的 REST API
  if (req.url === '/api/active-tab' && req.method === 'GET') {
    if (!activeExtensionWs || activeExtensionWs.readyState !== 1 /* OPEN */) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '浏览器插件未连接。请先打开 Chrome 并启用 CodexLink 插件。' }));
      return;
    }

    try {
      log('收到 REST API 请求，正在抓取活跃标签页内容...');
      const pageData = await getActiveTabContentFromExtension();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, ...pageData }));
    } catch (err) {
      log('REST API 抓取失败:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 1.2 服务运行状态页面
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const connectionStatus = activeExtensionWs && activeExtensionWs.readyState === 1
      ? '<span style="color: #4ade80;">● 已连接</span>'
      : '<span style="color: #f87171;">○ 未连接</span>';
    
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>CodexLink Local Bridge</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; max-width: 600px; margin: 0 auto; line-height: 1.6; }
          .card { background: #1e293b; padding: 1.5rem; border-radius: 12px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
          h1 { color: #f8fafc; font-size: 1.5rem; margin-top: 0; }
          .status { font-weight: bold; font-size: 1.1rem; margin: 1rem 0; }
          code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; color: #38bdf8; }
          .footer { font-size: 0.8rem; color: #64748b; margin-top: 2rem; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🔗 CodexLink Local Bridge</h1>
          <p>本地中转服务正正常运行在端口 <code>${PORT}</code>。</p>
          <div class="status">浏览器插件状态: ${connectionStatus}</div>
          <p>您可以通过以下方式联动 AI 助手：</p>
          <ul>
            <li><strong>MCP 协议</strong>：配置您的 AI 客户端运行此本地服务作为标准 MCP 工具。</li>
            <li><strong>REST API</strong>：向 <code>http://localhost:${PORT}/api/active-tab</code> 发送 GET 请求直接获取页面内容。</li>
          </ul>
        </div>
        <div class="footer">CodexLink Server v1.0.0</div>
      </body>
      </html>
    `);
    return;
  }

  // 1.3 获取 Codex 配置的 REST API
  if (req.url === '/api/codex-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getCodexConfig()));
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

// ==========================================
// 2. WebSocket 服务 - 与浏览器扩展通信
// ==========================================
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request) => {
  log('浏览器扩展已建立 WebSocket 连接。');
  activeExtensionWs = ws;

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message.toString());
      const { id, type, data, error } = payload;

      // 匹配之前发送的异步请求
      if (id && pendingRequests.has(id)) {
        const { resolve, reject, timeout } = pendingRequests.get(id);
        clearTimeout(timeout);
        pendingRequests.delete(id);

        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      } else {
        log('收到未匹配或主动推送的消息:', payload);
      }
    } catch (err) {
      log('解析浏览器扩展消息时出错:', err.message);
    }
  });

  ws.on('close', () => {
    log('浏览器扩展 WebSocket 连接已断开。');
    if (activeExtensionWs === ws) {
      activeExtensionWs = null;
    }
  });

  ws.on('error', (err) => {
    log('WebSocket 发生错误:', err.message);
  });
});

// 将 HTTP 的升级请求转发给 WebSocketServer
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// 启动端口监听
httpServer.listen(PORT, () => {
  log(`HTTP 和 WebSocket 服务正在端口 ${PORT} 监听中...`);
});

// ==========================================
// 3. 通信桥梁：向浏览器插件请求数据
// ==========================================
function getActiveTabContentFromExtension() {
  return new Promise((resolve, reject) => {
    if (!activeExtensionWs || activeExtensionWs.readyState !== 1) {
      return reject(new Error('浏览器插件未连接，请先在 Chrome 中激活 CodexLink 插件！'));
    }

    const requestId = Math.random().toString(36).substring(2, 11);
    
    // 设置 10 秒超时
    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('向浏览器插件请求页面内容超时（10秒内未响应）。'));
      }
    }, 10000);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    const requestPayload = {
      id: requestId,
      action: 'getActiveTab'
    };

    activeExtensionWs.send(JSON.stringify(requestPayload));
  });
}

// ==========================================
// 4. MCP (Model Context Protocol) 协议实现 (Stdio 传输方式)
// ==========================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    handleMcpRequest(request);
  } catch (err) {
    sendMcpError(null, -32700, 'Parse error: ' + err.message);
  }
});

function handleMcpRequest(req) {
  const { id, method, params } = req;

  // 4.1 initialize - 初始化握手
  if (method === 'initialize') {
    sendMcpResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'codex-link-server',
        version: '1.0.0'
      }
    });
    return;
  }

  // 4.2 initialized - 初始化确认通知 (不需要回复)
  if (method === 'notifications/initialized') {
    log('MCP 初始化成功！已与 AI 客户端握手。');
    return;
  }

  // 4.3 tools/list - 声明可用工具列表
  if (method === 'tools/list') {
    sendMcpResponse(id, {
      tools: [
        {
          name: 'get_active_tab_content',
          description: '读取用户当前在浏览器中处于活跃状态的标签页内容。可以无视登录状态和严格反爬，返回标题、URL 和排版工整的 Markdown 格式网页正文。',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    });
    return;
  }

  // 4.4 tools/call - 调用指定工具
  if (method === 'tools/call') {
    const toolName = params?.name;
    if (toolName === 'get_active_tab_content') {
      handleGetActiveTabTool(id);
    } else {
      sendMcpError(id, -32601, `Method not found: ${toolName}`);
    }
    return;
  }

  // 4.5 ping - 客户端保活
  if (method === 'ping') {
    sendMcpResponse(id, {});
    return;
  }

  // 其他未实现方法
  if (id !== undefined) {
    sendMcpError(id, -32601, `Method not found: ${method}`);
  }
}

// 处理 get_active_tab_content 工具调用
async function handleGetActiveTabTool(requestId) {
  try {
    log('收到 MCP 工具调用 get_active_tab_content...');
    const pageData = await getActiveTabContentFromExtension();
    
    const markdownContent = `
# 标题: ${pageData.title}
URL: ${pageData.url}
字数估算: ${pageData.length || 0} 字

---
${pageData.content}
`;

    sendMcpResponse(requestId, {
      content: [
        {
          type: 'text',
          text: markdownContent.trim()
        }
      ],
      isError: false
    });
    log('成功返回网页 Markdown 内容给 AI 客户端！');
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [
        {
          type: 'text',
          text: `[错误]: 读取浏览器网页失败。原因：${err.message}\n请确保已打开 Chrome 并激活了 CodexLink 侧边栏插件，且当前正停留在一个正常的网页上。`
        }
      ],
      isError: true
    });
  }
}

// 辅助函数：向 stdout 发送 MCP 响应
function sendMcpResponse(id, result) {
  const response = {
    jsonrpc: '2.0',
    id,
    result
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

// 辅助函数：向 stdout 发送 MCP 错误响应
function sendMcpError(id, code, message) {
  const response = {
    jsonrpc: '2.0',
    id: id || null,
    error: {
      code,
      message
    }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

// 优雅关闭
process.on('SIGTERM', () => {
  log('收到终止信号，正在关闭服务...');
  httpServer.close(() => {
    process.exit(0);
  });
});
