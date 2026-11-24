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

  async function inspectPage(url) {
    const target = await sendCommand('Target.createTarget', { url });
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

    const info = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        const codeBlocks = Array.from(document.querySelectorAll('pre, code')).map(c => c.innerText.slice(0, 100));
        const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.innerText.replace(/\\n/g, ' '));
        return {
          title: document.title,
          headings,
          hasQuickstart: /quickstart|change 1 line|base_url/i.test(text),
          hasPricing: /flash trio|deepseek-v4|pricing/i.test(text),
          codeSnippetCount: codeBlocks.length,
          sampleCode: codeBlocks.slice(0, 3)
        };
      })()`,
      returnByValue: true
    }, sessionId);

    console.log('Result for ' + url + ':', JSON.stringify(info.result.value, null, 2));
    await sendCommand('Target.closeTarget', { targetId: target.targetId });
  }

  console.log('Checking /pricing and /docs ...');
  await inspectPage('https://apivale.com/pricing');
  await inspectPage('https://apivale.com/docs');
  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
