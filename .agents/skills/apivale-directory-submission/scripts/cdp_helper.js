const fs = require('fs');
const path = require('path');

// Resolve ws from workspace server/node_modules or local node_modules
function loadWebSocket() {
  const candidates = [
    path.resolve(__dirname, '../../../../server/node_modules/ws'),
    path.resolve(__dirname, '../node_modules/ws'),
    'ws'
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (_) {}
  }
  throw new Error('Could not locate "ws" package. Ensure server/node_modules/ws exists.');
}

/**
 * Connect to the local Chrome DevTools Protocol endpoint via DevToolsActivePort.
 * Includes a command timeout so callers never hang if Chrome shows a native approval modal.
 */
async function connectCDP(timeoutMs = 15000) {
  const WebSocket = loadWebSocket();
  const activePortPath = path.join(
    process.env.LOCALAPPDATA || 'C:/Users/Administrator/AppData/Local',
    'Google/Chrome/User Data/DevToolsActivePort'
  );
  if (!fs.existsSync(activePortPath)) {
    throw new Error(`DevToolsActivePort not found at ${activePortPath}. Start Chrome with --remote-debugging-port=9222.`);
  }

  const lines = fs.readFileSync(activePortPath, 'utf8').trim().split('\n');
  const port = lines[0].trim();
  const browserPath = lines[1].trim();
  const ws = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);

  let nextId = 1;
  const pending = new Map();

  function sendCommand(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP command "${method}" timed out after ${timeoutMs}ms (check if Chrome is waiting on an "Allow remote debugging?" dialog).`));
        }
      }, timeoutMs);

      pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket open timeout')), timeoutMs);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (err) => { clearTimeout(t); reject(err); });
  });

  async function findOrOpenTarget(urlMatch, fallbackUrl) {
    const { targetInfos } = await sendCommand('Target.getTargets');
    let target = targetInfos.find(t => t.url && t.url.includes(urlMatch));
    let created = false;
    if (!target) {
      const res = await sendCommand('Target.createTarget', { url: fallbackUrl });
      target = { targetId: res.targetId, url: fallbackUrl };
      created = true;
    }
    const { sessionId } = await sendCommand('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });
    await sendCommand('DOM.enable', {}, sessionId);
    await sendCommand('Page.enable', {}, sessionId);
    return { targetId: target.targetId, sessionId, created };
  }

  return { ws, sendCommand, findOrOpenTarget };
}

module.exports = { connectCDP };
