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

  // 1. Scroll to top to view gallery carousel
  console.log('Scrolling to top to view gallery carousel...');
  await sendCommand('Runtime.evaluate', { expression: 'window.scrollTo(0, 200);' }, sessionId);
  await new Promise(r => setTimeout(r, 1000));

  // Capture slide 1
  const s1 = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/ph_carousel_slide_1.png', Buffer.from(s1.data, 'base64'));

  // 2. Click next arrow or 2nd dot
  console.log('Clicking 2nd indicator dot...');
  const dotRes = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      // Find indicators / dots or next button
      const allBtns = Array.from(document.querySelectorAll('button'));
      const nextBtn = allBtns.find(b => b.querySelector('svg') && (b.className.includes('right') || b.getAttribute('aria-label') === 'Next'));
      
      // Look for dots
      const dots = Array.from(document.querySelectorAll('button')).filter(b => {
        const cls = b.className || '';
        return cls.includes('rounded-full') && b.getBoundingClientRect().height < 20 && b.getBoundingClientRect().width < 20;
      });

      if (dots.length >= 2) {
        dots[1].click();
        return { clicked: 'dot 2', dotsCount: dots.length };
      } else if (nextBtn) {
        nextBtn.click();
        return { clicked: 'nextBtn' };
      }
      return { clicked: false, dotsFound: dots.length };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Dot click res:', dotRes.result.value);
  await new Promise(r => setTimeout(r, 1500));

  // Capture slide 2
  const s2 = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/ph_carousel_slide_2.png', Buffer.from(s2.data, 'base64'));

  // 3. Click 3rd indicator dot
  console.log('Clicking 3rd indicator dot...');
  await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const dots = Array.from(document.querySelectorAll('button')).filter(b => {
        const cls = b.className || '';
        return cls.includes('rounded-full') && b.getBoundingClientRect().height < 20 && b.getBoundingClientRect().width < 20;
      });
      if (dots.length >= 3) {
        dots[2].click();
      }
    })()`
  }, sessionId);
  await new Promise(r => setTimeout(r, 1500));

  // Capture slide 3
  const s3 = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/ph_carousel_slide_3.png', Buffer.from(s3.data, 'base64'));

  console.log('All 3 slides captured.');
  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
