const { connectCDP } = require('./cdp_helper');

/**
 * Configure Product Hunt Pricing ("free_options") and/or Company Info ("Bootstrapped", "1-10")
 * strictly in Draft mode without touching Schedule/Launch buttons.
 *
 * Usage:
 *   node ph_set_pricing_and_company.js [--pricing] [--company] [--x-handle <handle>]
 */
async function main() {
  const args = process.argv.slice(2);
  const doPricing = args.includes('--pricing') || (!args.includes('--company'));
  const doCompany = args.includes('--company');
  const xIdx = args.indexOf('--x-handle');
  const xHandle = xIdx !== -1 ? args[xIdx + 1] : null;

  const { ws, sendCommand, findOrOpenTarget } = await connectCDP();
  const { sessionId } = await findOrOpenTarget(
    'producthunt.com/posts/new',
    'https://www.producthunt.com/posts/new'
  );

  if (doPricing) {
    console.log('Configuring Pricing -> free_options...');
    const res = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          b => b.innerText && b.innerText.includes('Add pricing')
        ) || document.querySelector('[data-test="readiness-pricing"]');
        btn?.click();
        return !!btn;
      })()`,
      returnByValue: true
    }, sessionId);
    await new Promise(r => setTimeout(r, 1000));

    const selectRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const radio = document.querySelector('input[type="radio"][value="free_options"]');
        if (radio) {
          radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      })()`,
      returnByValue: true
    }, sessionId);
    console.log('Pricing open:', res.result.value, '| free_options selected:', selectRes.result.value);
    await new Promise(r => setTimeout(r, 2500));
    await sendCommand('Runtime.evaluate', { expression: 'document.body.click();' }, sessionId);
  }

  if (doCompany) {
    console.log('Configuring Company Info (Bootstrapped)...');
    await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('[data-test="readiness-company-details"]')?.click()`
    }, sessionId);
    await new Promise(r => setTimeout(r, 1200));

    const compRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const sheet = document.querySelector('[data-test="inline-edit-sheet"]');
        if (!sheet) return { ok: false, reason: 'sheet_not_open' };

        // Check Bootstrapped checkbox
        const labels = Array.from(sheet.querySelectorAll('label, div'));
        const bootEl = labels.find(el => el.innerText && el.innerText.includes('Bootstrapped'));
        const bootInput = bootEl?.querySelector('input[type="checkbox"]') ||
          Array.from(sheet.querySelectorAll('input[type="checkbox"]')).find(cb =>
            cb.closest('label, div')?.innerText?.includes('Bootstrapped')
          );
        if (bootInput && !bootInput.checked) {
          bootInput.click();
        }

        // Set X handle if provided
        const xInput = sheet.querySelector('input[placeholder*="@acme"], input[placeholder*="acme"]');
        if (xInput && ${JSON.stringify(xHandle)}) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(xInput, ${JSON.stringify(xHandle)});
          xInput.dispatchEvent(new Event('input', { bubbles: true }));
          xInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        return { ok: true, bootstrappedChecked: bootInput ? bootInput.checked : null };
      })()`,
      returnByValue: true
    }, sessionId);
    console.log('Company info result:', compRes.result.value);
    await new Promise(r => setTimeout(r, 2500));
  }

  ws.close();
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
