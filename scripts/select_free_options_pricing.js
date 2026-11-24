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

  console.log('Selecting Free Options radio button...');
  const selectRes = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      // 1. If popover is closed, open it
      const openPopover = document.querySelector('[data-state="open"], div[class*="popover"]');
      if (!openPopover) {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('Add pricing') || b.innerText.includes('pricing'))) || document.querySelector('[data-test="readiness-pricing"]');
        if (btn) btn.click();
      }

      // 2. Find radio input for free_options
      const radio = document.querySelector('input[type="radio"][value="free_options"]');
      if (radio) {
        radio.click();
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, method: 'radio-click' };
      }

      // Fallback: click label or container
      const allLabels = Array.from(document.querySelectorAll('label, div, span'));
      const freeOptionsLabel = allLabels.find(el => el.innerText && el.innerText.includes('Free Options') && el.innerText.includes('free trial or version'));
      if (freeOptionsLabel) {
        freeOptionsLabel.click();
        return { success: true, method: 'label-click' };
      }

      return { success: false };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Select result:', selectRes.result.value);

  // Wait for popover to update and autosave
  await new Promise(r => setTimeout(r, 4000));

  // Check state
  const stateCheck = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body.innerText;
      const readyToSchedule = /ready to schedule/i.test(text);
      const draftSaved = /Draft saved/i.test(text);
      
      // Check checklist items
      const pricingItem = document.querySelector('[data-test="readiness-pricing"]');
      const pricingText = pricingItem ? pricingItem.innerText : 'not found';

      // Check pricing button in form
      const pricingBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.toLowerCase().includes('free options') || b.innerText.toLowerCase().includes('pricing')));

      return {
        readyToSchedule,
        draftSaved,
        pricingItemText: pricingText,
        pricingBtnText: pricingBtn ? pricingBtn.innerText : 'none'
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('After state:', JSON.stringify(stateCheck.result.value, null, 2));

  // Capture screenshot of updated draft
  const shot = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  const shotPath = 'C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/ph_pricing_selected_10_of_14.png';
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved screenshot to:', shotPath);

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
