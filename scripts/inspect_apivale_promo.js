const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../server/node_modules/ws'));

async function inspectApivalePromo() {
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

  console.log('Opening apivale.com tab in background to inspect referral/promo...');
  const newTarget = await sendCommand('Target.createTarget', { url: 'https://apivale.com/' });
  const attachRes = await sendCommand('Target.attachToTarget', { targetId: newTarget.targetId, flatten: true });
  const sessionId = attachRes.sessionId;

  await sendCommand('Page.enable', {}, sessionId);
  await new Promise(r => setTimeout(r, 3000));

  const pageInfo = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body.innerText;
      // Search for words like referral, promo, code, coupon, rebate, bonus, discount, invite
      const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
      const matches = lines.filter(l => 
        /referral|promo|coupon|discount|rebate|bonus|invite|code|gift|credit|top-up|裂变|优惠/i.test(l)
      );
      return {
        title: document.title,
        matches
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Apivale Promo Matches:', JSON.stringify(pageInfo.result.value, null, 2));

  await sendCommand('Target.closeTarget', { targetId: newTarget.targetId });

  // Now also inspect what Product Hunt's "+ Add promo code" button does!
  const targetList = await sendCommand('Target.getTargets');
  const phTarget = targetList.targetInfos.find(t => t.url && t.url.includes('producthunt.com/posts/new'));
  const attachPH = await sendCommand('Target.attachToTarget', { targetId: phTarget.targetId, flatten: true });
  const phSessionId = attachPH.sessionId;

  await sendCommand('DOM.enable', {}, phSessionId);
  await sendCommand('Page.enable', {}, phSessionId);

  // Click "+ Add promo code" button on Product Hunt
  const clickPromo = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const promoBtn = btns.find(b => b.innerText && b.innerText.includes('Add promo code'));
      if (promoBtn) {
        promoBtn.click();
        return 'clicked promo button';
      }
      return 'not found';
    })()`,
    returnByValue: true
  }, phSessionId);

  console.log('Click PH Promo Button:', clickPromo.result.value);

  await new Promise(r => setTimeout(r, 1500));

  // Inspect the promo code modal/sheet
  const promoModal = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const sheet = document.querySelector('[data-test="inline-edit-sheet"], [role="dialog"], [data-state="open"]');
      if (!sheet) {
        return {
          found: false,
          bodySnippet: document.body.innerText.substring(0, 300)
        };
      }
      return {
        found: true,
        text: sheet.innerText,
        inputs: Array.from(sheet.querySelectorAll('input, select, textarea')).map(i => ({
          type: i.type,
          placeholder: i.placeholder,
          name: i.name,
          id: i.id,
          value: i.value
        }))
      };
    })()`,
    returnByValue: true
  }, phSessionId);

  console.log('Promo modal info:', JSON.stringify(promoModal.result.value, null, 2));

  // Take screenshot of PH promo modal
  const screenshot = await sendCommand('Page.captureScreenshot', { format: 'png' }, phSessionId);
  const buf = Buffer.from(screenshot.data, 'base64');
  fs.writeFileSync('C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/ph_promo_modal.png', buf);

  ws.close();
}

inspectApivalePromo().catch(console.error);
