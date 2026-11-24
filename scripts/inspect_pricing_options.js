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

  // Click "+ Add pricing"
  console.log('Clicking + Add pricing button...');
  const clickRes = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Add pricing')) || document.querySelector('[data-test="readiness-pricing"]');
      if (btn) {
        btn.click();
        return { clicked: true, text: btn.innerText };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  }, sessionId);
  console.log('Click result:', clickRes.result.value);

  await new Promise(r => setTimeout(r, 1200));

  // Inspect popovers, dialogs, radio buttons or options
  const inspectRes = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      // Look for open popovers, dropdowns or radios
      const openEls = Array.from(document.querySelectorAll('[data-state="open"], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], div[class*="popover"]'));
      const options = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="option"], label')).map(el => ({
        tag: el.tagName,
        type: el.type,
        text: (el.innerText || el.value || '').trim(),
        checked: el.checked
      })).filter(x => x.text.length > 0 && x.text.length < 50);

      return {
        openContainers: openEls.map(el => el.innerText),
        options: options.slice(0, 15)
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Pricing options found:', JSON.stringify(inspectRes.result.value, null, 2));

  // Screenshot the page/popover
  const shot = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  const shotPath = 'C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/ph_pricing_popover.png';
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved screenshot to:', shotPath);

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
