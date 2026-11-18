/**
 * ComLinkAI - 验证码识别与 Token 注入监听工具
 * 吸收 Web.Cafe 实战经验：
 * 1. 杜绝全局 autoSolve 乱扣费：只在评论表单内部/附近触发 Solve 按钮
 * 2. 杜绝 form.submit 假提交：轮询等待 Token 注入后，点击真实提交按钮
 */

const http = require('http');

function callAction(action, data = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3010,
      path: '/api/action',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ action, data }));
    req.end();
  });
}

/**
 * 监听并处理当前激活标签页的验证码墙
 * @param {Object} options 
 * @param {number} options.timeoutMs 最长等待 Token 时间（默认 90 秒）
 * @returns {Promise<{ success: boolean, tokenFound: boolean, type: string }>}
 */
async function handleCaptchaOnActiveTab({ timeoutMs = 90000 } = {}) {
  console.log('[Captcha Worker] 开始探测当前标签页验证码控件...');

  // 1. 尝试定向触发 2Captcha 插件注入的 Solve 按钮
  const triggerRes = await callAction('eval', {
    script: `(() => {
      const form = document.querySelector('#commentform, form[action*="comment" i]');
      let scope = form, btn = null;
      for (let i = 0; i < 6 && scope && !btn; i++) {
        btn = scope.querySelector('.captcha-solver[data-state="ready"]') || scope.querySelector('.captcha-solver');
        scope = scope.parentElement;
      }
      if (!btn) {
        const all = [...document.querySelectorAll('.captcha-solver')];
        if (all.length === 1) btn = all[0];
      }
      if (btn && btn.dataset.state !== 'solving' && btn.dataset.state !== 'solved') {
        btn.click();
        return { clicked: true, state: btn.dataset.state || 'triggered' };
      }
      return { clicked: false, state: btn ? btn.dataset.state : 'not_found' };
    })()`
  });

  console.log('[Captcha Worker] 定向触发结果:', JSON.stringify(triggerRes));

  // 2. 轮询监听 Token 注入
  const tokSel = 'textarea[name="g-recaptcha-response"], textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"], textarea[name="h-captcha-response"]';
  const t0 = Date.now();
  let solved = false;
  let detectedType = 'unknown';

  while (Date.now() - t0 < timeoutMs) {
    const checkRes = await callAction('eval', {
      script: `(() => {
        const sel = '${tokSel}';
        const els = [...document.querySelectorAll(sel)];
        for (const el of els) {
          if (el.value && el.value.length > 20) {
            return { solved: true, name: el.name, valLen: el.value.length };
          }
        }
        return { solved: false };
      })()`
    });

    if (checkRes.data && checkRes.data.solved) {
      solved = true;
      detectedType = checkRes.data.name;
      console.log(`[Captcha Worker] ✅ 检测到 Token 注入成功! (类型: ${detectedType}, 长度: ${checkRes.data.valLen})`);
      break;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  if (!solved) {
    console.warn('[Captcha Worker] ⚠️ 等待 Token 超时，未能成功解题。');
    return { success: false, tokenFound: false, type: 'timeout' };
  }

  // 3. Token 就绪，点击真正的原生提交按钮
  console.log('[Captcha Worker] 正在点击真实表单提交按钮...');
  const submitRes = await callAction('eval', {
    script: `(() => {
      const form = document.querySelector('#commentform, form[action*="comment" i]');
      const btn = form?.querySelector('button[type="submit"], input[type="submit"], #submit, input[name="submit"], button');
      if (btn) {
        btn.click();
        return { submitted: true, btnText: btn.innerText || btn.value || 'submit' };
      }
      return { submitted: false };
    })()`
  });

  console.log('[Captcha Worker] 提交点击结果:', JSON.stringify(submitRes));
  return { success: true, tokenFound: true, type: detectedType };
}

module.exports = {
  handleCaptchaOnActiveTab
};

if (require.main === module) {
  handleCaptchaOnActiveTab().then(res => console.log('Final Result:', res));
}
