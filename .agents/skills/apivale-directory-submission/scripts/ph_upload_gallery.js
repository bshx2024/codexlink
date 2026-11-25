const { connectCDP } = require('./cdp_helper');

/**
 * Open Product Hunt's Edit gallery drawer, optionally remove bad slide indices (1-based),
 * upload new ASCII-path images via #file-input-media, wait for S3 upload, and click Save media.
 *
 * Usage:
 *   node ph_upload_gallery.js [--remove 3,2] <file1> [<file2> ...]
 */
async function main() {
  const args = process.argv.slice(2);
  let removeIndices = [];
  const files = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remove' && args[i + 1]) {
      removeIndices = args[i + 1].split(',').map(n => parseInt(n.trim(), 10)).filter(Boolean);
      i++;
    } else {
      files.push(args[i]);
    }
  }

  if (files.length === 0 && removeIndices.length === 0) {
    console.error('Usage: node ph_upload_gallery.js [--remove 3,2] <file1> [<file2> ...]');
    process.exit(1);
  }

  const { ws, sendCommand, findOrOpenTarget } = await connectCDP();
  const { sessionId } = await findOrOpenTarget(
    'producthunt.com/posts/new',
    'https://www.producthunt.com/posts/new'
  );

  // 1. Ensure Media drawer is open
  const isOpen = await sendCommand('Runtime.evaluate', {
    expression: `!!document.querySelector('[data-test="inline-edit-sheet"]')`,
    returnByValue: true
  }, sessionId);

  if (!isOpen.result.value) {
    await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('button[aria-label="Edit gallery"]')?.click()`
    }, sessionId);
    await new Promise(r => setTimeout(r, 1800));
  }

  // 2. Remove specified 1-based image indices (remove highest index first to avoid shifting)
  const sortedRemove = [...removeIndices].sort((a, b) => b - a);
  for (const idx of sortedRemove) {
    const res = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('button[aria-label="Remove image ${idx}"]');
        if (btn) { btn.click(); return true; }
        return false;
      })()`,
      returnByValue: true
    }, sessionId);
    console.log(`Remove image ${idx}:`, res.result.value);
    await new Promise(r => setTimeout(r, 800));
  }

  // 3. Upload new files
  if (files.length > 0) {
    const doc = await sendCommand('DOM.getDocument', {}, sessionId);
    const nodeRes = await sendCommand('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#file-input-media'
    }, sessionId);

    await sendCommand('DOM.setFileInputFiles', {
      files,
      nodeId: nodeRes.nodeId
    }, sessionId);
    console.log('Queued files for upload:', files);
  }

  // 4. Wait for Save media button to enable and click
  let saved = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const check = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
        if (!sheet) return { open: false };
        const saveBtn = Array.from(sheet.querySelectorAll('button')).find(
          b => b.innerText && b.innerText.toLowerCase().includes('save media')
        );
        return { open: true, found: !!saveBtn, disabled: saveBtn ? saveBtn.disabled : true };
      })()`,
      returnByValue: true
    }, sessionId);

    if (check.result.value.found && !check.result.value.disabled) {
      await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
          const saveBtn = Array.from(sheet.querySelectorAll('button')).find(
            b => b.innerText && b.innerText.toLowerCase().includes('save media')
          );
          saveBtn?.click();
        })()`
      }, sessionId);
      saved = true;
      break;
    }
  }

  if (!saved) throw new Error('Timed out waiting for Save media button.');
  await new Promise(r => setTimeout(r, 4000));
  console.log('Gallery media saved successfully.');
  ws.close();
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
