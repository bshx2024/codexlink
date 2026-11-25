const { connectCDP } = require('./cdp_helper');

/**
 * Locate Product Hunt submission/draft page (navigating from www.producthunt.com -> Submit if needed)
 * and inspect readiness checklist, draft status, and key form triggers.
 */
async function main() {
  const { ws, sendCommand, findOrOpenTarget } = await connectCDP();

  const { sessionId, created } = await findOrOpenTarget(
    'producthunt.com/posts/new',
    'https://www.producthunt.com/'
  );

  if (created) {
    console.log('Opened www.producthunt.com; waiting for page load...');
    await new Promise(r => setTimeout(r, 3500));

    const navRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const submitLink = Array.from(document.querySelectorAll('a, button')).find(
          el => el.innerText && el.innerText.trim() === 'Submit'
        );
        if (submitLink) {
          submitLink.click();
          return { clickedSubmit: true };
        }
        return { clickedSubmit: false };
      })()`,
      returnByValue: true
    }, sessionId);
    console.log('Navigation to Submit:', navRes.result.value);
    await new Promise(r => setTimeout(r, 3500));
  }

  const inspection = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const checklist = Array.from(document.querySelectorAll('[data-test^="readiness-"]')).map(el => ({
        dataTest: el.getAttribute('data-test'),
        text: el.innerText.replace(/\\n+/g, ' | ').trim()
      }));

      const draftSaved = /Draft saved/i.test(document.body.innerText);
      const readyToSchedule = /ready to schedule/i.test(document.body.innerText);
      const promoBadge = document.body.innerText.match(/\\$[0-9.]+\\s+Extra\\s+API\\s+Credits/i)?.[0] || null;

      return {
        url: window.location.href,
        title: document.title,
        draftSaved,
        readyToSchedule,
        promoBadge,
        checklist
      };
    })()`,
    returnByValue: true
  }, sessionId);

  console.log('Product Hunt Form Inspection:', JSON.stringify(inspection.result.value, null, 2));
  ws.close();
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
