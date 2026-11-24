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

  // 1. Ensure drawer is open
  const isDrawerOpen = await sendCommand('Runtime.evaluate', {
    expression: `!!document.querySelector('[data-test="inline-edit-sheet"]')`,
    returnByValue: true
  }, sessionId);

  if (!isDrawerOpen.result.value) {
    console.log('Opening drawer via button[aria-label="Edit gallery"]...');
    await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('button[aria-label="Edit gallery"]');
        if (btn) btn.click();
      })()`
    }, sessionId);
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log('Drawer is already open.');
  }

  // 2. Remove Image 3, then Remove Image 2
  console.log('Removing bad Image 3 and Image 2...');
  const removeRes = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const removed = [];
      const btn3 = document.querySelector('button[aria-label="Remove image 3"]');
      if (btn3) { btn3.click(); removed.push('Remove image 3'); }
      return removed;
    })()`,
    returnByValue: true
  }, sessionId);
  console.log('Removed 3:', removeRes.result.value);
  await new Promise(r => setTimeout(r, 800));

  const removeRes2 = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const removed = [];
      const btn2 = document.querySelector('button[aria-label="Remove image 2"]');
      if (btn2) { btn2.click(); removed.push('Remove image 2'); }
      return removed;
    })()`,
    returnByValue: true
  }, sessionId);
  console.log('Removed 2:', removeRes2.result.value);
  await new Promise(r => setTimeout(r, 1200));

  // 3. Find #file-input-media and set files
  console.log('Uploading new Image 2 and Image 3...');
  const doc = await sendCommand('DOM.getDocument', {}, sessionId);
  const nodeRes = await sendCommand('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '#file-input-media'
  }, sessionId);

  const filesToUpload = [
    'C:\\Users\\Administrator\\apivale_gallery_2_quickstart.png',
    'C:\\Users\\Administrator\\apivale_gallery_3_pricing.png'
  ];
  console.log('Setting file input files:', filesToUpload);

  await sendCommand('DOM.setFileInputFiles', {
    files: filesToUpload,
    nodeId: nodeRes.nodeId
  }, sessionId);

  // 4. Poll until Save media button is enabled
  console.log('Waiting for uploads to finish and Save media button to become enabled...');
  let saved = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const btnCheck = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
        if (!sheet) return { open: false };
        const btns = Array.from(sheet.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('save media'));
        return {
          open: true,
          saveBtnFound: !!saveBtn,
          saveBtnDisabled: saveBtn ? saveBtn.disabled : null,
          allBtnTexts: btns.map(b => b.innerText.trim()).filter(Boolean)
        };
      })()`,
      returnByValue: true
    }, sessionId);

    console.log(`[Iter ${i}] State:`, JSON.stringify(btnCheck.result.value));

    if (btnCheck.result.value && btnCheck.result.value.saveBtnFound && !btnCheck.result.value.saveBtnDisabled) {
      console.log('Save media button is enabled! Clicking it...');
      await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
          const btns = Array.from(sheet.querySelectorAll('button'));
          const saveBtn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('save media'));
          if (saveBtn) saveBtn.click();
        })()`
      }, sessionId);
      saved = true;
      break;
    }
  }

  if (!saved) {
    console.error('Failed to save media before timeout.');
  } else {
    console.log('Save media clicked! Waiting for draft autosave...');
    await new Promise(r => setTimeout(r, 5000));
  }

  // 5. Verify draft page state and take screenshot
  console.log('Verifying draft state and carousel...');
  const afterState = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body.innerText;
      const draftSaved = /Draft saved/i.test(text);
      const readyToSchedule = /ready to schedule/i.test(text);
      
      // Check carousel pagination dots or slides
      const dots = document.querySelectorAll('button[aria-label*="slide"], div[class*="carousel"] button, div[class*="indicator"]');
      const galleryImgs = Array.from(document.querySelectorAll('img[alt*="Media"], img[alt*="preview"], div[class*="carousel"] img')).map(img => img.src);
      
      return {
        draftSaved,
        readyToSchedule,
        dotsCount: dots.length,
        galleryImgsCount: galleryImgs.length,
        galleryImgs: galleryImgs.slice(0, 5)
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('After state:', JSON.stringify(afterState.result.value, null, 2));

  // Capture verification screenshot
  const shot = await sendCommand('Page.captureScreenshot', { format: 'png' }, sessionId);
  const verifyPath = 'C:/Users/Administrator/.gemini/antigravity/brain/5e519544-0f1c-4f02-b7cd-8b8250d07597/producthunt_draft_gallery_fixed.png';
  fs.writeFileSync(verifyPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved verification screenshot to:', verifyPath);

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
