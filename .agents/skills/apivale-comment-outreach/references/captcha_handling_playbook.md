# 验证码墙识别与自动化收尾处理战术手册 (Captcha Handling Playbook)

> **参考来源**：吸收 Web.Cafe 哥飞社群《用 AdsPower 的 Local API 和它自带的 2Captcha 插件,把评论外链的验证码站也跑成全自动》（王焱）实战工程经验，针对 ComLinkAI 架构进行原生化升级与适配。

---

## 一、验证码站的业务定位与处理策略

根据 APIVALE 博客外链总体原则与 ROI 核算：
1. **主通道（快速铺量）**：80% 的目标博客属于无验证码或蜜罐防御站，ComLinkAI 原生扩展以 15-20s/篇的速度极速推进，遇到验证码默认先记为 `needs_human:captcha` 或跳过，确保日配额快速完成。
2. **收尾通道（硬骨头攻坚）**：针对高权重（如 DR 60+、相关度 > 90%）但开启了验证码墙的目标站，启动验证码收尾逻辑，通过 2Captcha 或人机协同注入完成提交。

---

## 二、主流验证码墙的 DOM 探测特征

| 验证码类型 | 典型容器选择器 (Container) | 隐式 Token 结果字段 (Response Field) |
| :--- | :--- | :--- |
| **Google reCAPTCHA v2/v3** | `div.g-recaptcha`, `iframe[src*="recaptcha"]` | `textarea[name="g-recaptcha-response"]` |
| **Cloudflare Turnstile** | `div.cf-turnstile`, `iframe[src*="challenges.cloudflare.com"]` | `input[name="cf-turnstile-response"]`, `textarea[name="cf-turnstile-response"]` |
| **hCaptcha** | `div.h-captcha`, `iframe[src*="hcaptcha.com"]` | `textarea[name="h-captcha-response"]` |
| **CleanTalk / Math Anti-Spam** | 算术文本题（如 `3 + 5 = ?`）或隐藏计算哈希 | 通常为前端 JS 动态计算，或简单的计算输入框 |

---

## 三、2Captcha 插件与自动化脚本的三大核心铁律

### 铁律 1：绝对禁止开启全局 `autoSolve`（防烧钱漏洞）
- **痛点**：WordPress 站点常在同一页面挂载多个验证码控件（评论框、侧栏订阅框、页脚联系表单）。插件全局 `autoSolve` 会触发 3~4 次解题扣费，甚至误提交无关表单。
- **最佳实践**：全关插件的自动解题开关。由自动化脚本定位 `#commentform`，从评论表单向上检索其归属的唯一 `.captcha-solver` 按钮定向触发。

```javascript
// 定向寻找评论表单区域的 Solve 按钮
const clicked = await page.evaluate(() => {
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
    return true;
  }
  return false;
});
```

---

### 铁律 2：绝对禁止使用插件自带的 `autoSubmit`（防假成功）
- **痛点**：插件的 `autoSubmit` 直接触发 `form.submit()`，会强行跳过 WordPress 主题或防垃圾插件挂载在 `onsubmit` 上的事件校验与 Ajax 拦截，导致 Token 填了但评论根本未送达后端。
- **最佳实践**：脚本在后台循环轮询 Token 响应字段。一旦检测到 Token 填入，由脚本模拟真人手势点击真正的提交按钮。

```javascript
const tokSel = 'textarea[name="g-recaptcha-response"], textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"], textarea[name="h-captcha-response"]';
let solved = false;
const t0 = Date.now();

// 轮询等待 Token 注入（Token 一般 120 秒有效期）
while (Date.now() - t0 < 120000) {
  solved = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].some((el) => el.value && el.value.length > 20);
  }, tokSel);
  if (solved) break;
  await new Promise(r => setTimeout(r, 2000));
}

// Token 到位后，点击真正的提交按钮
if (solved) {
  await page.evaluate(() => {
    const form = document.querySelector('#commentform, form[action*="comment" i]');
    const submitBtn = form?.querySelector('button[type="submit"], input[type="submit"], #submit, input[name="submit"], button');
    submitBtn?.click();
  });
}
```

---

### 铁律 3：开启 `useProxy` 保持 IP 出口一致
- reCAPTCHA 与 Turnstile 对发起解题的客户端 IP 和最终验证 Token 提交的 IP 强一致性极其敏感。
- 若使用了代理网络，必须在插件配置中开启 `useProxy`，确保解题端走的是与浏览器当前一致的出口节点。

---

## 四、异常熔断与防损守卫 (Guard Rails)

1. **单站自动尝试封顶 1 次**：同一博客累计撞墙超过 3 次直接加入冷却黑名单，不再重试。
2. **双墙站自动熔断**：遇到提交后弹出第二道自定义弹窗题的站点，自动打标 `needs_human:double_wall` 并移出自动队列，由人工介入。
3. **成功判定双重校验**：
   - 评论正文必须真实渲染在页面 DOM 中；
   - 指向 `https://apivale.com/...` 的链接必须确实挂载在当前评论容器内部，且 `rel` 属性剔除无效链接判定。
