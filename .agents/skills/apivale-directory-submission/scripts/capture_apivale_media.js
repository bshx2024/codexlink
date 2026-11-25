const fs = require('fs');
const path = require('path');
const { connectCDP } = require('./cdp_helper');

/**
 * Capture clean 1270x760 dark-mode gallery screenshots from apivale.com
 * and write to ASCII-safe output paths for reliable S3/Product Hunt upload.
 */
async function main() {
  const outDir = process.argv[2] || 'C:/Users/Administrator';
  const { ws, sendCommand } = await connectCDP();

  const cleanOverlaysScript = `(() => {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    localStorage.setItem('theme', 'dark');

    document.querySelectorAll('header, nav').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        el.style.display = 'none';
      }
    });

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
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'absolute') &&
          r.right >= window.innerWidth - 45 && r.width <= 70 && r.height <= 70) {
        el.remove();
      }
    });
  })()`;

  const targets = [
    {
      name: 'apivale_gallery_2_quickstart.png',
      url: 'https://apivale.com/',
      scrollY: 660
    },
    {
      name: 'apivale_gallery_3_pricing.png',
      url: 'https://apivale.com/pricing',
      scrollY: 430
    }
  ];

  for (const item of targets) {
    console.log(`Capturing ${item.name} from ${item.url}...`);
    const { targetId } = await sendCommand('Target.createTarget', { url: item.url });
    const { sessionId } = await sendCommand('Target.attachToTarget', { targetId, flatten: true });

    await sendCommand('Page.enable', {}, sessionId);
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1270,
      height: 760,
      deviceScaleFactor: 2,
      mobile: false
    }, sessionId);

    await new Promise(r => setTimeout(r, 4000));
    await sendCommand('Runtime.evaluate', { expression: cleanOverlaysScript }, sessionId);
    await new Promise(r => setTimeout(r, 500));

    await sendCommand('Runtime.evaluate', { expression: `window.scrollTo(0, ${item.scrollY});` }, sessionId);
    await new Promise(r => setTimeout(r, 1000));
    await sendCommand('Runtime.evaluate', { expression: cleanOverlaysScript }, sessionId);
    await new Promise(r => setTimeout(r, 300));

    const { data } = await sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
    const dest = path.join(outDir, item.name);
    const buf = Buffer.from(data, 'base64');
    fs.writeFileSync(dest, buf);
    console.log(`Saved ${dest} (${buf.length} bytes)`);

    await sendCommand('Target.closeTarget', { targetId });
  }

  ws.close();
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
