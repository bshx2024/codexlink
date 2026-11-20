const http = require('http');
const { WebSocketServer } = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置常量
const PORT = 3010;

// 全局状态
let isWorkerMode = false;
let activeExtensionWs = null;
const pendingRequests = new Map();
let httpActionQueue = [];
let lastHttpPollTime = 0;

// 辅助函数：向 Master 进程发送 HTTP 请求
function requestMaster(pathName, method = 'GET', postData = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk.toString());
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('解析 Master 响应失败: ' + e.message));
          }
        } else {
          try {
            const errJson = JSON.parse(body);
            reject(new Error(errJson.error || `HTTP ${res.statusCode}`));
          } catch (e) {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('连接 Master 失败: ' + err.message));
    });

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

// 日志记录函数 - 所有非协议输出必须写入 stderr，以防破坏 MCP 的 stdout 协议流
function log(msg, ...args) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [ComLinkAI] ${msg}`, ...args);
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

  // 1.2 健康检查路由
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  // 1.3 获取 Codex 配置的 REST API
  if (req.url === '/api/codex-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getCodexConfig()));
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
        const { title, url, content, summary, images } = JSON.parse(body);
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

        // 处理图片保存与链接重链接逻辑
        let updatedContent = content;
        if (images && images.length > 0) {
          const attachmentsDir = path.join(saveDir, 'attachments', `${safeTitle}_assets`);
          if (!fs.existsSync(attachmentsDir)) {
            fs.mkdirSync(attachmentsDir, { recursive: true });
          }

          images.forEach(img => {
            try {
              const imgPath = path.join(attachmentsDir, img.filename);
              const buffer = Buffer.from(img.base64Data, 'base64');
              fs.writeFileSync(imgPath, buffer);
              log(`成功下载并保存本地图片: ${imgPath}`);

              // 相对路径转换
              const relativePath = `attachments/${safeTitle}_assets/${img.filename}`;
              const escapedUrl = img.originalUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
              const urlRegex = new RegExp(`\\(${escapedUrl}\\)`, 'g');
              updatedContent = updatedContent.replace(urlRegex, `(${relativePath})`);
            } catch (e) {
              log(`写入图片 ${img.filename} 失败:`, e.message);
            }
          });
        }

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

        fileContent += `## 📄 网页排版正文\n\n${updatedContent.trim()}\n`;

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

  // 1.5 转发操作到浏览器插件的 REST API
  if (req.url === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      let actionName = 'unknown';
      try {
        const { action, data } = JSON.parse(body);
        actionName = action || 'unknown';
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '缺少操作名称 (action)' }));
          return;
        }

        log(`[Master] 收到 REST API 转发操作 [${action}] 请求...`);
        const result = await callExtensionAction(action, data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (err) {
        log(`[Master] 转发操作 [${actionName}] 失败:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 1.6 HTTP 轮询接口 (当 WebSocket 在指纹浏览器/代理环境中被阻断时的备用双通道)
  if (req.url === '/api/poll' && req.method === 'GET') {
    const now = Date.now();
    if (!lastHttpPollTime || (now - lastHttpPollTime > 10000)) {
      log('🚀 浏览器扩展已通过 HTTP 双通道成功建立连接！');
    }
    lastHttpPollTime = now;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (httpActionQueue.length > 0) {
      const nextTask = httpActionQueue.shift();
      res.end(JSON.stringify(nextTask));
    } else {
      res.end(JSON.stringify({ action: 'noop' }));
    }
    return;
  }

  if (req.url === '/api/poll-response' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { id, data, error } = JSON.parse(body);
        if (id && pendingRequests.has(id)) {
          const { resolve, reject, timeout } = pendingRequests.get(id);
          clearTimeout(timeout);
          pendingRequests.delete(id);
          if (error) {
            reject(new Error(error));
          } else {
            resolve(data);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
      if (payload && payload.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

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
      } else if (payload.type !== 'pong') {
        log('收到未匹配或主动推送的消息:', payload);
      }
    } catch (err) {
      log('解析浏览器扩展消息时出错:', err.message);
    }
  });

  ws.onclose = () => {
    log('浏览器扩展 WebSocket 连接已断开。');
    if (activeExtensionWs === ws) {
      activeExtensionWs = null;
    }
  };

  ws.onerror = (err) => {
    log('WebSocket 发生错误:', err.message);
  };
});

// ==========================================
// 3. 通信桥梁：向浏览器插件发起请求
// ==========================================
function callExtensionAction(action, data = {}) {
  return new Promise((resolve, reject) => {
    if (isWorkerMode) {
      log(`[Worker] 正在转发操作 [${action}] 给 Master...`);
      requestMaster('/api/action', 'POST', { action, data })
        .then(res => {
          if (res.success) {
            resolve(res.data);
          } else {
            reject(new Error(res.error || '执行操作失败'));
          }
        })
        .catch(err => reject(err));
      return;
    }

    const hasWs = activeExtensionWs && activeExtensionWs.readyState === 1;
    const hasHttpPoll = (Date.now() - lastHttpPollTime) < 10000;

    if (!hasWs && !hasHttpPoll) {
      return reject(new Error('浏览器插件未连接，请先在 Chrome 中激活 CodexLink 插件并打开侧边栏！'));
    }

    const requestId = Math.random().toString(36).substring(2, 11);
    
    // 动态超时：耗时业务操作 (评论生成/Google抓取/AutoPilot) 给予 45 秒，常规操作 25 秒
    const timeoutMs = (data && data.timeout) ? data.timeout : (['process_active_tab_comment', 'collect_google_results', 'autopilot_start'].includes(action) ? 45000 : 25000);
    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`向浏览器插件请求 [${action}] 超时（${Math.round(timeoutMs / 1000)}秒内未响应）。`));
      }
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    const requestPayload = {
      id: requestId,
      action: action,
      data: data
    };

    if (hasWs) {
      activeExtensionWs.send(JSON.stringify(requestPayload));
    } else {
      httpActionQueue.push(requestPayload);
    }
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
        tools: {},
        resources: {}
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
          name: 'browser_navigate',
          description: '将当前活跃标签页导航到指定的 URL。',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '目标 URL，如 "https://www.baidu.com"' }
            },
            required: ['url']
          }
        },
        {
          name: 'get_active_tab_content',
          description: '读取用户当前在浏览器中处于活跃状态的标签页内容。可以无视登录状态和严格反爬，返回标题、URL 和排版工整的 Markdown 格式网页正文。',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'browser_get_elements',
          description: '获取当前页面中所有可见的交互元素（按钮、输入框、链接等），返回标签类型、文本、选择器等，以便进行后续操控。',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'browser_click',
          description: '在当前页面模拟真实鼠标点击指定选择器对应的元素。',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: '目标元素的 CSS 选择器，如 "#submit-btn" 或 "button.login"' }
            },
            required: ['selector']
          }
        },
        {
          name: 'browser_type',
          description: '在当前页面的指定输入框中输入文本，并触发 input/change 事件以保证状态同步。',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: '目标输入框的 CSS 选择器，如 "input[type=\'text\']" 或 "#search"' },
              text: { type: 'string', description: '要输入的文本内容' }
            },
            required: ['selector', 'text']
          }
        },
        {
          name: 'browser_scroll',
          description: '模拟页面滚动，支持 up/down/left/right 滚动指定像素。',
          inputSchema: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: '滚动方向' },
              amount: { type: 'number', description: '滚动像素值，默认 400' }
            },
            required: ['direction']
          }
        },
        {
          name: 'browser_screenshot',
          description: '截取当前活跃标签页可见区域截图，返回 base64 PNG，供 AI 获取操作后的页面视觉反馈。',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'browser_keypress',
          description: '在当前页面模拟键盘按键，支持 Enter、Tab、Escape、Space、Backspace、Delete、方向键，以及 Control+a、Shift+Tab 等组合键。',
          inputSchema: {
            type: 'object',
            properties: {
              key: { type: 'string', description: '键名，如 "Enter"、"Tab"、"Escape"、"ArrowDown"、"Control+a"' },
              selector: { type: 'string', description: '可选 CSS 选择器，省略时作用于当前焦点元素' }
            },
            required: ['key']
          }
        },
        {
          name: 'browser_wait',
          description: '等待页面加载完成 (mode="load") 或等待指定 CSS 元素出现 (mode="element")。每次 browser_navigate 后务必调用。',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['load', 'element'], description: '"load" 等待页面加载完成；"element" 等待元素出现' },
              selector: { type: 'string', description: 'mode=element 时必填' },
              timeout: { type: 'number', description: '最大等待毫秒数，默认 10000' }
            },
            required: ['mode']
          }
        },
        {
          name: 'sidepanel_collect_google_results',
          description: '自动在当前活跃的 Google 搜索结果页面中嗅探并提取前 10 条高权重外链，并载入 ComLinkAI 侧边栏批量发布队列。',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'sidepanel_process_comment',
          description: '触发 ComLinkAI 侧边栏原生战略性评论发布流水线：提取当前博文、嗅探表单、基于 3-Step 公式生成专业见解评论、通过原生 Name/Website 软广字段填表提交、在侧边栏队列打删除线并记入 PublishLogger 审计日志与 Google Sheets。',
          inputSchema: {
            type: 'object',
            properties: {
              comment: { type: 'string', description: '可选，若不传则由 ComLinkAI 根据博文内容与 Profile 自动构思生成' }
            }
          }
        },
        {
          name: 'sidepanel_get_queue',
          description: '获取 ComLinkAI 侧边栏当前批次外链队列详情及发布进度统计。',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'sidepanel_autopilot_control',
          description: '控制 ComLinkAI Auto-Pilot 全自动挂机引擎 (start/pause/stop/status)。',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['start', 'pause', 'stop', 'status'], description: '挂机操作指令' }
            },
            required: ['action']
          }
        }
      ]
    });
    return;
  }

  // 4.4 tools/call - 调用指定工具
  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'browser_navigate') {
      handleBrowserNavigateTool(id, args.url);
    } else if (toolName === 'get_active_tab_content') {
      handleGetActiveTabTool(id);
    } else if (toolName === 'browser_get_elements') {
      handleBrowserGetElementsTool(id);
    } else if (toolName === 'browser_click') {
      handleBrowserClickTool(id, args.selector);
    } else if (toolName === 'browser_type') {
      handleBrowserTypeTool(id, args.selector, args.text);
    } else if (toolName === 'browser_scroll') {
      handleBrowserScrollTool(id, args.direction, args.amount);
    } else if (toolName === 'browser_screenshot') {
      handleBrowserScreenshotTool(id);
    } else if (toolName === 'browser_keypress') {
      handleBrowserKeypressTool(id, args.key, args.selector);
    } else if (toolName === 'browser_wait') {
      handleBrowserWaitTool(id, args.mode, args.selector, args.timeout);
    } else if (toolName === 'sidepanel_collect_google_results') {
      handleCollectGoogleResultsTool(id);
    } else if (toolName === 'sidepanel_process_comment') {
      handleSidepanelProcessCommentTool(id, args.comment);
    } else if (toolName === 'sidepanel_get_queue') {
      handleSidepanelGetQueueTool(id);
    } else if (toolName === 'sidepanel_autopilot_control') {
      handleSidepanelAutoPilotControlTool(id, args.action);
    } else {
      sendMcpError(id, -32601, `Method not found: ${toolName}`);
    }
    return;
  }

  // 4.4.1 resources/list - 声明可用资源列表
  if (method === 'resources/list') {
    callExtensionAction('listTabs')
      .then(tabs => {
        const resources = [
          {
            uri: 'codex-link://tabs',
            name: '浏览器打开的标签页列表',
            description: '当前浏览器中所有打开的标签页（包括标题与 URL）',
            mimeType: 'text/markdown'
          }
        ];
        if (Array.isArray(tabs)) {
          tabs.forEach(t => {
            if (t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:')) {
              resources.push({
                uri: `codex-link://tabs/${t.id}`,
                name: t.title || '无标题网页',
                description: `网页内容: ${t.url}`,
                mimeType: 'text/markdown'
              });
            }
          });
        }
        sendMcpResponse(id, { resources });
      })
      .catch(err => {
        sendMcpResponse(id, {
          resources: [
            {
              uri: 'codex-link://tabs',
              name: '浏览器打开的标签页列表',
              description: '当前浏览器中所有打开的标签页（包括标题与 URL）',
              mimeType: 'text/markdown'
            }
          ]
        });
      });
    return;
  }

  // 4.4.2 resources/read - 读取指定资源
  if (method === 'resources/read') {
    const uri = params?.uri;
    if (uri === 'codex-link://tabs') {
      callExtensionAction('listTabs')
        .then(tabs => {
          let text = '# 浏览器打开的标签页列表\n\n';
          if (Array.isArray(tabs) && tabs.length > 0) {
            text += '| 标签页 ID | 标题 | URL | 状态 |\n';
            text += '| --- | --- | --- | --- |\n';
            tabs.forEach(t => {
              text += `| ${t.id} | ${t.title || '无标题'} | ${t.url || ''} | ${t.active ? '当前活动' : '后台'} |\n`;
            });
          } else {
            text += '当前没有打开的标签页，或者插件未连接。';
          }
          sendMcpResponse(id, {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text
              }
            ]
          });
        })
        .catch(err => {
          sendMcpError(id, -32603, `读取标签页列表失败: ${err.message}`);
        });
    } else if (uri && uri.startsWith('codex-link://tabs/')) {
      const tabIdStr = uri.replace('codex-link://tabs/', '');
      const tabId = parseInt(tabIdStr, 10);
      if (isNaN(tabId)) {
        sendMcpError(id, -32602, `无效的标签页 ID: ${tabIdStr}`);
        return;
      }
      callExtensionAction('getTabContent', { tabId })
        .then(pageData => {
          const markdownContent = `
# 标题: ${pageData.title}
URL: ${pageData.url}
字数估算: ${pageData.length || 0} 字

---
${pageData.content}
`;
          sendMcpResponse(id, {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: markdownContent.trim()
              }
            ]
          });
        })
        .catch(err => {
          sendMcpError(id, -32603, `读取标签页内容失败: ${err.message}`);
        });
    } else {
      sendMcpError(id, -32602, `Unknown resource URI: ${uri}`);
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

// Stdio MCP 工具调用处理器
async function handleBrowserNavigateTool(requestId, url) {
  try {
    log(`收到 MCP 工具调用 browser_navigate, url: ${url}...`);
    const res = await callExtensionAction('navigate', { url });
    if (res && res.success === false) throw new Error(res.error || '导航失败');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[成功]: 浏览器已成功导航至 ${url}` }],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 导航失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleGetActiveTabTool(requestId) {
  try {
    log('收到 MCP 工具调用 get_active_tab_content...');
    const pageData = await callExtensionAction('getActiveTab');
    
    const markdownContent = `
# 标题: ${pageData.title}
URL: ${pageData.url}
字数估算: ${pageData.length || 0} 字

---
${pageData.content}
`;
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: markdownContent.trim() }],
      isError: false
    });
    log('成功返回网页 Markdown 内容给 AI 客户端！');
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 读取浏览器网页失败。原因：${err.message}\n请确保已打开 Chrome 并激活了 CodexLink 侧边栏插件，且当前正停留在一个正常的网页上。` }],
      isError: true
    });
  }
}

async function handleBrowserGetElementsTool(requestId) {
  try {
    log('收到 MCP 工具调用 browser_get_elements...');
    const elements = await callExtensionAction('getElements');
    const responseText = elements.length > 0 
      ? JSON.stringify(elements, null, 2)
      : '未在页面上找到可见的交互元素。';
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: responseText }],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 获取交互元素失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleBrowserClickTool(requestId, selector) {
  try {
    log(`收到 MCP 工具调用 browser_click, selector: ${selector}...`);
    const res = await callExtensionAction('click', { selector });
    if (res && res.success === false) throw new Error(res.error || '点击失败');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[成功]: 已成功模拟点击元素: ${selector}` }],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 点击失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleBrowserTypeTool(requestId, selector, text) {
  try {
    log(`收到 MCP 工具调用 browser_type, selector: ${selector}, text: ${text}...`);
    const res = await callExtensionAction('type', { selector, text });
    if (res && res.success === false) throw new Error(res.error || '输入失败');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[成功]: 已成功在元素 ${selector} 中输入文本` }],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 输入失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleBrowserScrollTool(requestId, direction, amount = 400) {
  try {
    log(`收到 MCP 工具调用 browser_scroll, direction: ${direction}, amount: ${amount}...`);
    const res = await callExtensionAction('scroll', { direction, amount: amount || 400 });
    if (res && res.success === false) throw new Error(res.error || '滚动失败');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[成功]: 滚动操作已完成。当前 scrollTop: ${res.scrollTop}, scrollLeft: ${res.scrollLeft}` }],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 滚动失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleBrowserScreenshotTool(requestId) {
  try {
    log('收到 MCP 工具调用 browser_screenshot (CDP 原生硬件加速缩放)...');
    const res = await callExtensionAction('screenshot');
    if (!res || !res.dataUrl) throw new Error('截图数据为空');
    
    // 动态提取正确的 MIME 类型与纯 base64 数据
    const match = res.dataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
    const mimeType = match ? match[1] : 'image/jpeg';
    const b64 = match ? match[2] : res.dataUrl.replace(/^data:[^;]+;base64,/, '');

    sendMcpResponse(requestId, {
      content: [
        { type: 'image', data: b64, mimeType: mimeType },
        { type: 'text', text: `[截图成功]: 已通过 CDP DevTools 协议获取按比例硬件缩放截图 (${res.width || '自适应'}x${res.height || '自适应'})。` }
      ],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 截图失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleBrowserKeypressTool(requestId, key, selector) {
  try {
    log(`收到 MCP 工具调用 browser_keypress, key: ${key}, selector: ${selector}...`);
    const res = await callExtensionAction('keypress', { key, selector: selector || null });
    if (res && res.success === false) throw new Error(res.error || '按键失败');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[成功]: 已模拟按键 [${key}]` + (selector ? ` 在元素 ${selector}` : '') }],
      isError: false
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 按键失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleBrowserWaitTool(requestId, mode, selector, timeout) {
  try {
    log(`收到 MCP 工具调用 browser_wait, mode: ${mode}, selector: ${selector}, timeout: ${timeout}...`);
    if (mode === 'element' && !selector) throw new Error('mode=element 时 selector 必填');
    const tms = Math.min(timeout || 10000, 10000);
    let res, msg, isOk;
    if (mode === 'load') {
      res = await callExtensionAction('waitForLoad', { timeout: tms });
      isOk = res && res.loaded;
      msg = isOk ? `[成功]: 页面已加载，耗时 ${res.elapsed}ms。`
                 : `[超时]: 页面在 ${tms}ms 内未完成加载。`;
    } else {
      res = await callExtensionAction('waitForElement', { selector, timeout: tms });
      isOk = res && res.found;
      msg = isOk ? `[成功]: 元素 ${selector} 已出现，耗时 ${res.elapsed}ms。`
                 : `[超时]: 在 ${tms}ms 内未找到元素 ${selector}。`;
    }
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: msg }],
      isError: !isOk
    });
  } catch (err) {
    log('工具执行失败:', err.message);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 等待失败。原因：${err.message}` }],
      isError: true
    });
  }
}

async function handleCollectGoogleResultsTool(requestId) {
  try {
    const res = await callExtensionAction('collect_google_results');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `Google 搜索结果抓取成功！新增抓取：${res.addedCount || 0} 条，当前侧边栏批次总数：${res.totalQueue || 0} 条。` }],
      isError: false
    });
  } catch (err) {
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 抓取 Google 结果失败: ${err.message}` }],
      isError: true
    });
  }
}

async function handleSidepanelProcessCommentTool(requestId, comment) {
  try {
    const res = await callExtensionAction('process_active_tab_comment', { comment });
    if (res.skipped) {
      sendMcpResponse(requestId, {
        content: [{ type: 'text', text: `[已安全跳过]: ${res.reason}` }],
        isError: false
      });
      return;
    }
    const msg = `已顺利完成博客留言外链建设！\n目标: ${res.title} (${res.url})\n评论内容: ${res.comment}\n侧边栏删除线状态: ${res.queueMarkedDone ? '已标记完成(已划线)' : '队列未包含'}\n已记录审计日志: ${res.logged}\nGoogle Sheets 云端同步: ${res.gsheetSynced ? '成功' : '离线重试/未配置'}`;
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: msg }],
      isError: false
    });
  } catch (err) {
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 处理评论发布失败: ${err.message}` }],
      isError: true
    });
  }
}

async function handleSidepanelGetQueueTool(requestId) {
  try {
    const res = await callExtensionAction('get_queue');
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      isError: false
    });
  } catch (err) {
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: 获取侧边栏队列失败: ${err.message}` }],
      isError: true
    });
  }
}

async function handleSidepanelAutoPilotControlTool(requestId, action) {
  try {
    const map = {
      start: 'autopilot_start',
      pause: 'autopilot_pause',
      stop: 'autopilot_stop',
      status: 'autopilot_status'
    };
    const actName = map[action] || 'autopilot_status';
    const res = await callExtensionAction(actName);
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      isError: false
    });
  } catch (err) {
    sendMcpResponse(requestId, {
      content: [{ type: 'text', text: `[错误]: Auto-Pilot 指令 [${action}] 执行失败: ${err.message}` }],
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

// ==========================================
// 5. 端口检测与进程自适应启动逻辑 (Bootstrap)
// ==========================================

// 端口占用检测函数
function checkMasterRunning() {
  const net = require('net');
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true); // 端口被占用，Master 正在运行
        } else {
          resolve(false);
        }
      })
      .once('listening', () => {
        tester.once('close', () => resolve(false))
          .close();
      })
      .listen(PORT);
  });
}

function startMasterServer() {
  // 绑定 HTTP 的升级请求转发给 WebSocketServer
  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // 启动端口监听
  httpServer.listen(PORT, '0.0.0.0', () => {
    log(`HTTP 和 WebSocket 服务正在端口 ${PORT} (0.0.0.0) 监听中...`);
  });
}

async function bootstrap() {
  const masterRunning = await checkMasterRunning();
  if (masterRunning) {
    isWorkerMode = true;
    log(`检测到端口 ${PORT} 已被占用，当前进程以 MCP Worker 模式运行。`);
  } else {
    isWorkerMode = false;
    log(`端口 ${PORT} 空闲，当前进程以 Master 模式运行，正在初始化服务...`);
    startMasterServer();
  }
}

bootstrap();