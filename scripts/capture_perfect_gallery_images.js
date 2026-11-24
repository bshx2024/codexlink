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

  const outDir = 'C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597';

  // Helper to clean page overlays
  const cleanOverlaysExpr = `(() => {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');

    // Remove third party widgets and bottom fixed banners
    const selectors = [
      '#tawk-bubble-container',
      'iframe',
      'div[class*="tawk"]',
      'div[class*="translate"]',
      'button[aria-label*="translate"]',
      'button[aria-label*="chat"]',
      'div[id*="goog-gt"]',
      '.skiptranslate'
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Remove any floating circular buttons on bottom right (like the pink translate icon)
    Array.from(document.querySelectorAll('div, button, a')).forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' && (rect.bottom > window.innerHeight - 100 && rect.right > window.innerWidth - 100)) {
        el.remove();
      }
      if (style.position === 'fixed' && rect.bottom >= window.innerHeight - 10 && rect.width > 300) {
        // Bottom cookie/credit banner
        el.remove();
      }
    });

    // Hide top fixed header to avoid obscuring cards
    document.querySelectorAll('header, nav').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        el.style.display = 'none';
      }
    });
  })()`;

  // 1. Capture Gallery 2: Quickstart Code & Features
  console.log('Capturing Gallery Image 2 (Quickstart & Integration)...');
  {
    const target = await sendCommand('Target.createTarget', { url: 'https://apivale.com/' });
    const attachRes = await sendCommand('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attachRes.sessionId;
    await sendCommand('Page.enable', {}, sessionId);
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1270,
      height: 760,
      deviceScaleFactor: 2,
      mobile: false
    }, sessionId);

    await new Promise(r => setTimeout(r, 4500));

    await sendCommand('Runtime.evaluate', { expression: cleanOverlaysExpr }, sessionId);

    const scrollRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        // Find innermost element containing '10s Quickstart'
        const all = Array.from(document.querySelectorAll('*'));
        const qsEl = all.find(el => el.children.length === 0 && el.innerText && el.innerText.includes('10s Quickstart'));
        if (qsEl) {
          qsEl.scrollIntoView({ block: 'center' });
          // Scroll up slightly so the 3 top feature cards are also visible above it
          window.scrollBy(0, -180);
          return { found: true, scrollY: window.scrollY };
        }
        return { found: false };
      })()`,
      returnByValue: true
    }, sessionId);

    console.log('Scroll res 2:', scrollRes.result.value);
    await new Promise(r => setTimeout(r, 1200));

    const shot2 = await sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    }, sessionId);

    const buf2 = Buffer.from(shot2.data, 'base64');
    fs.writeFileSync(path.join(outDir, 'apivale_gallery_2_quickstart.png'), buf2);
    fs.writeFileSync('C:/Users/Administrator/apivale_gallery_2_quickstart.png', buf2);
    console.log('Saved apivale_gallery_2_quickstart.png (size:', buf2.length, ')');

    await sendCommand('Target.closeTarget', { targetId: target.targetId });
  }

  // 2. Capture Gallery 3: High-Throughput Flash Trio Pricing & Model Matrix
  console.log('Capturing Gallery Image 3 (Pricing & Model Matrix)...');
  {
    const target = await sendCommand('Target.createTarget', { url: 'https://apivale.com/pricing' });
    const attachRes = await sendCommand('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attachRes.sessionId;
    await sendCommand('Page.enable', {}, sessionId);
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1270,
      height: 760,
      deviceScaleFactor: 2,
      mobile: false
    }, sessionId);

    await new Promise(r => setTimeout(r, 4500));

    await sendCommand('Runtime.evaluate', { expression: cleanOverlaysExpr }, sessionId);

    const scrollRes3 = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const trioEl = all.find(el => el.children.length === 0 && el.innerText && el.innerText.includes('High-Throughput Flash Trio'));
        if (trioEl) {
          trioEl.scrollIntoView({ block: 'start' });
          // Adjust scroll down slightly so header padding is balanced
          window.scrollBy(0, -35);
          return { found: true, scrollY: window.scrollY };
        }
        return { found: false };
      })()`,
      returnByValue: true
    }, sessionId);

    console.log('Scroll res 3:', scrollRes3.result.value);
    await new Promise(r => setTimeout(r, 1200));

    const shot3 = await sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    }, sessionId);

    const buf3 = Buffer.from(shot3.data, 'base64');
    fs.writeFileSync(path.join(outDir, 'apivale_gallery_3_pricing.png'), buf3);
    fs.writeFileSync('C:/Users/Administrator/apivale_gallery_3_pricing.png', buf3);
    console.log('Saved apivale_gallery_3_pricing.png (size:', buf3.length, ')');

    await sendCommand('Target.closeTarget', { targetId: target.targetId });
  }

  ws.close();
  console.log('Finished capturing gallery images successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
