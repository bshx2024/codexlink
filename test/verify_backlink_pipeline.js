/**
 * Automated Verification Script for Backlink Pipeline 6-Table Architecture
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const testDbDir = path.join(__dirname, '..', 'data', 'test_backlink_db');
if (fs.existsSync(testDbDir)) {
  fs.rmSync(testDbDir, { recursive: true, force: true });
}

// 动态创建测试实例
const BacklinkDatabase = require('../server/modules/backlink_db').constructor;
const testDb = new BacklinkDatabase(testDbDir);

console.log('🧪 开始执行 6-Table 外链架构自动化验证套件...\n');

try {
  // Test 1: 初始化
  testDb.init();
  const initStats = testDb.getStats();
  assert.strictEqual(initStats.outbound_links, 0, '初始出站链接应为 0');
  assert.strictEqual(initStats.tool_seeds, 0, '初始种子数应为 0');
  assert.strictEqual(initStats.targets.total, 0, '初始待发任务应为 0');
  console.log('✅ Test 1 Passed: 6-Table 初始空库加载正常');

  // Test 2: 文章出站链接入库与排重
  const streamResult = testDb.addOutboundLinks([
    { article_id: 101, outbound_url: 'https://competitor-a.ai/tool', domain: 'competitor-a.ai', link_text: 'Comp A' },
    { article_id: 101, outbound_url: 'https://competitor-a.ai/tool', domain: 'competitor-a.ai', link_text: 'Comp A duplicate' },
    { article_id: 102, outbound_url: 'https://competitor-b.ai/app', domain: 'competitor-b.ai', link_text: 'Comp B' }
  ]);
  assert.strictEqual(streamResult.added, 2, '出站流水排重应只入库 2 条');
  console.log('✅ Test 2 Passed: devto_outbound_links 排重与流水写入正常');

  // Test 3: 种子库提纯
  const seedResult = testDb.addToolSeeds([
    { domain: 'competitor-a.ai', site_name: 'Comp A', url: 'https://competitor-a.ai' },
    { domain: 'competitor-a.ai', site_name: 'Comp A duplicate', url: 'https://competitor-a.ai' },
    { domain: 'competitor-b.ai', site_name: 'Comp B', url: 'https://competitor-b.ai' }
  ]);
  assert.strictEqual(seedResult.added, 2, '种子清单唯一域排重后应为 2 个');
  console.log('✅ Test 3 Passed: ai_tool_sites 种子提纯与去重正常');

  // Test 4: 待发队列注入
  const targetResult = testDb.addReferrerTargets([
    { target_domain: 'topai.tools', source_site: 'DataForSEO Intersection', link_page_url: 'https://topai.tools/submit' },
    { target_domain: 'aitoolhunt.com', source_site: 'DataForSEO Intersection', link_page_url: 'https://aitoolhunt.com/add' }
  ]);
  assert.strictEqual(targetResult.added, 2, '待发表应成功入库 2 条');
  console.log('✅ Test 4 Passed: referrer_targets 队列注入正常');

  // Test 5: 原子领单排它锁 (Claim)
  const claimed = testDb.claimNextTargets(1, 'worker-tab-1');
  assert.strictEqual(claimed.length, 1, '应成功领取 1 个任务');
  assert.strictEqual(claimed[0].status, 'sending', '状态应被原子标记为 sending');
  assert.strictEqual(claimed[0].claimed_by, 'worker-tab-1', 'claimed_by 应正确绑定');
  console.log('✅ Test 5 Passed: 任务原子领单与并发锁验证通过');

  // Test 6: 成功提交归档 (Success Record)
  const successRec = testDb.recordSuccess(claimed[0].id, {
    submit_entry_url: claimed[0].link_page_url,
    evidence_path: 'screenshots/topai_tools_receipt.png',
    notes: '自动填表并获得审核中回执'
  });
  assert.strictEqual(successRec.target_domain, 'topai.tools');
  assert.strictEqual(successRec.listed_status, 'pending_review');
  const afterSuccessStats = testDb.getStats();
  assert.strictEqual(afterSuccessStats.targets.sent, 1, '原任务状态应流转为 sent');
  assert.strictEqual(afterSuccessStats.success_total, 1, '成功库条数应为 1');
  console.log('✅ Test 6 Passed: referrer_success 长期收录与证据归档正常');

  // Test 7: 探针复检池流转 (Probe Resilience Pool)
  const claimed2 = testDb.claimNextTargets(1, 'worker-tab-2');
  const probeRec = testDb.recordProbe(claimed2[0].id, {
    skip_reason: '遇 Captcha 验证码超时',
    probe_mode: 'captcha',
    has_captcha: true,
    has_form: true,
    recheck_notes: '留待人工或强模型二轮破解'
  });
  assert.strictEqual(probeRec.target_domain, 'aitoolhunt.com');
  assert.strictEqual(probeRec.probe_mode, 'captcha');
  const afterProbeStats = testDb.getStats();
  assert.strictEqual(afterProbeStats.targets.skipped, 1, '原任务状态应流转为 skipped');
  assert.strictEqual(afterProbeStats.probes_total, 1, '探针池条数应为 1');
  console.log('✅ Test 7 Passed: referrer_probes 探针池精细分流正常');

  // Test 8: 产品物料资产库 (Site Knowledge)
  testDb.saveKnowledge({
    kind: 'screenshot',
    category: 'desktop',
    item_key: 'home_hero',
    page_url: 'https://apivale.com/',
    file_path: 'screenshots/hero_1200x737.png',
    width: 1200,
    height: 737,
    notes: '标准桌面版 Hero 首屏实拍截图'
  });
  const heroAsset = testDb.getKnowledge('screenshot', 'home_hero');
  assert.strictEqual(heroAsset.width, 1200);
  assert.strictEqual(heroAsset.height, 737);
  console.log('✅ Test 8 Passed: site_knowledge 产品资产与实拍截图入库正常');

  // 清理临时测试库
  fs.rmSync(testDbDir, { recursive: true, force: true });

  console.log('\n🎉 ==============================================');
  console.log('🎉 全部 8 项 6-Table 架构自动化验证测试 100% 通过！');
  console.log('🎉 ==============================================\n');
} catch (err) {
  console.error('❌ 测试验证失败:', err);
  process.exit(1);
}

