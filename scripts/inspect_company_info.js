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

  // Inspect the sheet if open, or open company info
  const sheetInfo = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
      if (!sheet) {
        // try to find company info button
        const btn = document.querySelector('[data-test="readiness-company-details"]');
        if (btn) btn.click();
      }
      return { sheetOpen: !!sheet };
    })()`,
    returnByValue: true
  }, sessionId);

  await new Promise(r => setTimeout(r, 1500));

  const fullDrawer = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
      if (!sheet) return { error: 'No sheet' };
      
      const inputs = Array.from(sheet.querySelectorAll('input, select, textarea, button')).map(el => ({
        tag: el.tagName,
        type: el.type,
        name: el.name,
        placeholder: el.placeholder,
        text: (el.innerText || '').slice(0, 50),
        value: el.value,
        checked: el.checked
      }));

      return {
        text: sheet.innerText,
        inputs
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Full Company Info Drawer:', JSON.stringify(fullDrawer.result.value, null, 2));

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
