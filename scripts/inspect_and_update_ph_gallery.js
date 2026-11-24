const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../server/node_modules/ws'));

async function main() {
  const devtoolsPortFile = fs.readFileSync('C:/Users/Administrator/AppData/Local/Google/Chrome/User Data/DevToolsActivePort', 'utf8').trim().split('\n');
  const port = devtoolsPortFile[0].trim();
  const browserPath = devtoolsPortFile[1].trim();
  const ws = new WebSocket('ws://127.0.0.1:' + port + browserPath);

  let nextId = 1;
  const pending = new Map();
  function sendCommand(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
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

  await new Promise(r => ws.on('open', r));

  const targetList = await sendCommand('Target.getTargets');
  const phTarget = targetList.targetInfos.find(t => t.url && t.url.includes('producthunt.com/posts/new'));
  const attachRes = await sendCommand('Target.attachToTarget', { targetId: phTarget.targetId, flatten: true });
  const sessionId = attachRes.sessionId;

  await sendCommand('DOM.enable', {}, sessionId);
  await sendCommand('Page.enable', {}, sessionId);

  console.log('Clicking button[aria-label="Edit gallery"]...');
  await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('button[aria-label="Edit gallery"]');
      if (btn) btn.click();
      return !!btn;
    })()`
  }, sessionId);

  await new Promise(r => setTimeout(r, 2000));

  const drawerState = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
      if (!sheet) return { open: false };
      
      const images = Array.from(sheet.querySelectorAll('img')).map((img, i) => ({
        i,
        src: img.src.slice(0, 100),
        alt: img.alt
      }));

      const buttons = Array.from(sheet.querySelectorAll('button')).map((b, i) => ({
        i,
        text: b.innerText.trim(),
        aria: b.getAttribute('aria-label'),
        title: b.title,
        className: b.className
      }));

      const inputs = Array.from(sheet.querySelectorAll('input')).map(inp => ({
        id: inp.id,
        type: inp.type,
        accept: inp.accept
      }));

      return {
        open: true,
        images,
        buttons,
        inputs
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Drawer State:', JSON.stringify(drawerState.result.value, null, 2));

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
