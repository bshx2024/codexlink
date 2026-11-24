const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../server/node_modules/ws'));

async function inspectLinkStructure() {
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

  // 1. Check if drawer is already open; if not open it
  const isSheetOpen = await sendCommand('Runtime.evaluate', {
    expression: `!!document.querySelector('[data-test="inline-edit-sheet"]')`,
    returnByValue: true
  }, sessionId);

  if (!isSheetOpen.result.value) {
    console.log('Opening links sheet...');
    await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('[data-test="composer-links"]');
        if (btn) btn.click();
      })()`
    }, sessionId);
    await new Promise(r => setTimeout(r, 1500));
  }

  // 2. Find the "+ Add link" button
  const addBtnInfo = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
      if (!sheet) return { error: 'no sheet found' };
      const btns = Array.from(sheet.querySelectorAll('button'));
      const addLinkBtn = btns.find(b => b.innerText && b.innerText.trim().includes('Add link') && !b.innerText.includes('MCP'));
      if (!addLinkBtn) return { error: 'Add link button not found', allBtns: btns.map(b => b.innerText) };
      return {
        text: addLinkBtn.innerText,
        html: addLinkBtn.outerHTML
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Add link button info:', JSON.stringify(addBtnInfo.result.value, null, 2));

  // 3. Click "+ Add link"
  await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
      const btns = Array.from(sheet.querySelectorAll('button'));
      const addLinkBtn = btns.find(b => b.innerText && b.innerText.trim().includes('Add link') && !b.innerText.includes('MCP'));
      if (addLinkBtn) addLinkBtn.click();
    })()`
  }, sessionId);

  await new Promise(r => setTimeout(r, 1500));

  // 4. Inspect what elements appeared inside the sheet
  const sheetContent = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
      if (!sheet) return { error: 'no sheet' };
      const inputs = Array.from(sheet.querySelectorAll('input, select, textarea')).map(i => ({
        tag: i.tagName,
        type: i.type,
        placeholder: i.placeholder,
        name: i.name,
        value: i.value,
        className: i.className,
        id: i.id
      }));
      const btns = Array.from(sheet.querySelectorAll('button')).map(b => b.innerText.trim());
      return {
        text: sheet.innerText,
        inputs,
        btns
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Sheet content after click:', JSON.stringify(sheetContent.result.value, null, 2));

  // Take a screenshot of the sheet
  const screenshot = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  const buf = Buffer.from(screenshot.data, 'base64');
  fs.writeFileSync('C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/sheet_after_add_link.png', buf);
  console.log('Saved screenshot to sheet_after_add_link.png');

  ws.close();
}

inspectLinkStructure().catch(console.error);
