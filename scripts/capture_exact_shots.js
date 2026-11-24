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

  const cleanScript = `(() => {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    localStorage.setItem('theme', 'dark');

    // 1. Hide top navigation headers
    document.querySelectorAll('header, nav').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        el.style.display = 'none';
      }
    });

    // 2. Remove bottom floating promo/credit banner & Tawk chat & translation
    Array.from(document.querySelectorAll('*')).forEach(el => {
      const text = el.innerText || '';
      if (text.includes('Credits Never Expire') || text.includes('Special Pack') || text.includes('APIVALE Global Gateway')) {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          el.remove();
        }
      }
      if (el.id === 'tawk-bubble-container' || el.tagName === 'IFRAME') {
        el.remove();
      }
      // Any floating button / circle on the right edge or bottom
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        if (r.right >= window.innerWidth - 45 && r.width <= 70 && r.height <= 70) {
          el.remove();
        }
      }
    });
  })()`;

  // --- 1. Image 2: Quickstart on Home ---
  console.log('Capturing Image 2 (Quickstart on Home)...');
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

    await new Promise(r => setTimeout(r, 4000));
    await sendCommand('Runtime.evaluate', { expression: cleanScript }, sessionId);
    await new Promise(r => setTimeout(r, 500));

    await sendCommand('Runtime.evaluate', { expression: 'window.scrollTo(0, 660);' }, sessionId);
    await new Promise(r => setTimeout(r, 1000));
    await sendCommand('Runtime.evaluate', { expression: cleanScript }, sessionId);
    await new Promise(r => setTimeout(r, 300));

    const shot2 = await sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
    const buf2 = Buffer.from(shot2.data, 'base64');
    fs.writeFileSync(path.join(outDir, 'apivale_gallery_2_quickstart.png'), buf2);
    fs.writeFileSync('C:/Users/Administrator/apivale_gallery_2_quickstart.png', buf2);
    console.log('Saved Image 2: size =', buf2.length);

    await sendCommand('Target.closeTarget', { targetId: target.targetId });
  }

  // --- 2. Image 3: Pricing High-Throughput Flash Trio ---
  console.log('Capturing Image 3 (Pricing Flash Trio)...');
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

    await new Promise(r => setTimeout(r, 4000));
    await sendCommand('Runtime.evaluate', { expression: cleanScript }, sessionId);
    await new Promise(r => setTimeout(r, 500));

    await sendCommand('Runtime.evaluate', { expression: 'window.scrollTo(0, 430);' }, sessionId);
    await new Promise(r => setTimeout(r, 1000));
    await sendCommand('Runtime.evaluate', { expression: cleanScript }, sessionId);
    await new Promise(r => setTimeout(r, 300));

    const shot3 = await sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
    const buf3 = Buffer.from(shot3.data, 'base64');
    fs.writeFileSync(path.join(outDir, 'apivale_gallery_3_pricing.png'), buf3);
    fs.writeFileSync('C:/Users/Administrator/apivale_gallery_3_pricing.png', buf3);
    console.log('Saved Image 3: size =', buf3.length);

    await sendCommand('Target.closeTarget', { targetId: target.targetId });
  }

  ws.close();
  console.log('Done capturing exact shots.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
