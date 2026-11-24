/**
 * Unit Test Suite for 5-Layer Submission Sniffer & Dual-Track Form Adapter
 */

const assert = require('assert');
const FormDetector = require('../extension/modules/form_detector');

console.log('🧪 开始运行 5 大工业级防线与入口嗅探自动化测试套件...\n');

try {
  // -------------------------------------------------------------
  // Test 1: 防线 2 - 可见性与反蜜罐过滤测试 (Anti-Honeypot Visibility)
  // -------------------------------------------------------------
  const mockDoc = {
    defaultView: {
      getComputedStyle: (el) => ({
        display: el.style?.display || 'block',
        visibility: el.style?.visibility || 'visible',
        opacity: el.style?.opacity !== undefined ? el.style.opacity : '1'
      })
    }
  };

  const hiddenEl1 = { offsetParent: null, tagName: 'DIV' };
  assert.strictEqual(FormDetector.isHumanVisible(hiddenEl1, mockDoc), false, 'offsetParent 为空的隐藏元素应被过滤');

  const honeypotEl = {
    offsetParent: {},
    tagName: 'A',
    style: { display: 'none' },
    getBoundingClientRect: () => ({ width: 100, height: 20, top: 10, bottom: 30, left: 10, right: 110 })
  };
  assert.strictEqual(FormDetector.isHumanVisible(honeypotEl, mockDoc), false, 'display:none 蜜罐应被过滤');

  const offscreenEl = {
    offsetParent: {},
    tagName: 'A',
    style: { display: 'block' },
    getBoundingClientRect: () => ({ width: 100, height: 20, top: -9999, bottom: -9979, left: -9999, right: -9899 })
  };
  assert.strictEqual(FormDetector.isHumanVisible(offscreenEl, mockDoc), false, '负坐标屏幕外蜜罐应被过滤');

  const visibleEl = {
    offsetParent: {},
    tagName: 'A',
    style: { display: 'block', visibility: 'visible', opacity: '1' },
    getBoundingClientRect: () => ({ width: 120, height: 35, top: 50, bottom: 85, left: 20, right: 140 })
  };
  assert.strictEqual(FormDetector.isHumanVisible(visibleEl, mockDoc), true, '标准可见元素应通过校验');
  console.log('✅ Test 1 Passed: 防线 2 真实可见性与反蜜罐过滤验证通过');

  // -------------------------------------------------------------
  // Test 2: 防线 3 - 智能提交入口嗅探 (Submission Sniffer)
  // -------------------------------------------------------------
  const mockPageDoc = {
    ...mockDoc,
    querySelectorAll: (selector) => {
      if (selector === 'a[href]') {
        return [
          {
            offsetParent: {},
            tagName: 'A',
            href: 'https://topai.tools/submit-tool',
            getAttribute: (attr) => attr === 'href' ? '/submit-tool' : '',
            innerText: 'Submit AI Tool',
            getBoundingClientRect: () => ({ width: 100, height: 30, top: 20, bottom: 50, left: 10, right: 110 })
          },
          {
            offsetParent: {},
            tagName: 'A',
            href: 'https://twitter.com/topaitools',
            getAttribute: (attr) => attr === 'href' ? 'https://twitter.com/topaitools' : '',
            innerText: 'Twitter',
            getBoundingClientRect: () => ({ width: 80, height: 20, top: 20, bottom: 40, left: 10, right: 90 })
          },
          {
            offsetParent: {},
            tagName: 'A',
            href: 'https://topai.tools/privacy',
            getAttribute: (attr) => attr === 'href' ? '/privacy' : '',
            innerText: 'Privacy Policy',
            getBoundingClientRect: () => ({ width: 80, height: 20, top: 20, bottom: 40, left: 10, right: 90 })
          }
        ];
      }
      return [];
    }
  };

  const sniffResult = FormDetector.sniffSubmissionEntry(mockPageDoc, 'https://topai.tools/');
  assert.strictEqual(sniffResult.length, 1, '应精准命中 1 个有效入口');
  assert.strictEqual(sniffResult[0].targetUrl, 'https://topai.tools/submit-tool', '目标 URL 应为 /submit-tool');
  assert.strictEqual(sniffResult[0].score >= 9, true, '高可信入口评分应 >= 9');
  console.log('✅ Test 2 Passed: 提交入口智能语义嗅探与同源隔离验证通过');

  // -------------------------------------------------------------
  // Test 3: 防线 4 - 免费层级优先选择 (Free-Tier Enforcement)
  // -------------------------------------------------------------
  let clickedFree = false;
  const mockPricingDoc = {
    ...mockDoc,
    body: { innerText: 'Choose your plan: Featured Listing ($49) or Free Standard Submission ($0)' },
    querySelectorAll: (selector) => {
      return [
        {
          offsetParent: {},
          value: 'paid_49',
          innerText: '$49 Featured Fast Track',
          click: () => {},
          getBoundingClientRect: () => ({ width: 100, height: 30, top: 10, bottom: 40, left: 10, right: 110 })
        },
        {
          offsetParent: {},
          value: 'free',
          innerText: 'Free Standard (Free Review)',
          click: () => { clickedFree = true; },
          dispatchEvent: () => {},
          getBoundingClientRect: () => ({ width: 100, height: 30, top: 50, bottom: 80, left: 10, right: 110 })
        }
      ];
    },
    querySelector: () => null
  };

  const tierRes = FormDetector.enforceFreeTierAndDetectPaywall(mockPricingDoc);
  assert.strictEqual(tierRes.isPaywall, false, '有免费选项时不应触发收费熔断');
  assert.strictEqual(tierRes.selectedFree, true, '系统应自动识别并勾选免费档');
  assert.strictEqual(clickedFree, true, '免费选项应成功触发点击');
  console.log('✅ Test 3 Passed: 防线 4 免费层级偏置选择验证通过');

  // -------------------------------------------------------------
  // Test 4: 防线 4 - 纯收费墙极速熔断 (Checkout Breaker)
  // -------------------------------------------------------------
  const mockPaywallDoc = {
    ...mockDoc,
    body: { innerText: 'Instant Submission ($49 one-time fee via Stripe). Credit Card Required.' },
    querySelectorAll: () => [],
    querySelector: (selector) => selector.includes('stripe') ? { tagName: 'IFRAME' } : null
  };

  const paywallRes = FormDetector.enforceFreeTierAndDetectPaywall(mockPaywallDoc);
  assert.strictEqual(paywallRes.isPaywall, true, '纯收费站应精准触发收费墙熔断');
  console.log('✅ Test 4 Passed: 防线 4 纯收费墙极速熔断验证通过');

  // -------------------------------------------------------------
  // Test 5: 双轨表单自适应感知 (Dual-Track Form Detection)
  // -------------------------------------------------------------
  const mockDirDoc = {
    ...mockDoc,
    querySelector: (sel) => {
      if (sel.includes('title') || sel.includes('name')) return { offsetParent: {}, getBoundingClientRect: () => ({ width: 200, height: 30, top: 10, bottom: 40, left: 10, right: 210 }) };
      if (sel.includes('url')) return { offsetParent: {} };
      return null;
    }
  };
  assert.strictEqual(FormDetector.detectFormType(mockDirDoc), 'directory', '具备产品名与URL输入框应识别为目录站表单');

  const mockBlogDoc = {
    ...mockDoc,
    querySelector: (sel) => {
      if (sel.includes('comment')) return { offsetParent: {}, getBoundingClientRect: () => ({ width: 300, height: 100, top: 10, bottom: 110, left: 10, right: 310 }) };
      return null;
    }
  };
  assert.strictEqual(FormDetector.detectFormType(mockBlogDoc), 'blog_comment', '包含独立评论框应识别为博客评论表单');
  console.log('✅ Test 5 Passed: 双轨表单类型感知自适应验证通过');

  console.log('\n🎉 ==============================================');
  console.log('🎉 全部 5 大防线单元测试与自适应感知 100% 通过！');
  console.log('🎉 ==============================================\n');
} catch (err) {
  console.error('❌ 测试验证失败:', err);
  process.exit(1);
}
