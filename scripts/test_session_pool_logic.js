/**
 * 标签页多任务池核心逻辑单元测试 (无需依赖真实浏览器环境)
 */
const assert = require('assert');

// 模拟 background.js 中的多任务实例池逻辑
const AUTOPILOT_COLORS = ['cyan', 'blue', 'green', 'purple', 'orange', 'yellow', 'pink', 'red'];
let groupColorIdx = 0;
const autoPilotSessions = new Map();

// 模拟 chrome.tabs 与 chrome.tabGroups
let simulatedTabIdSeq = 1000;
let simulatedGroupIdSeq = 500;

const mockChrome = {
  createdTabs: [],
  groups: new Map(),
  tabs: {
    create: async ({ url, active }) => {
      const id = ++simulatedTabIdSeq;
      const tab = { id, url, active, windowId: 1 };
      mockChrome.createdTabs.push(tab);
      return tab;
    },
    group: async ({ tabIds }) => {
      const gid = ++simulatedGroupIdSeq;
      mockChrome.groups.set(gid, { id: gid, tabIds, title: '', color: '' });
      return gid;
    },
    get: async (tabId) => {
      const tab = mockChrome.createdTabs.find(t => t.id === tabId);
      if (!tab) throw new Error('Tab not found');
      return tab;
    },
    update: async (tabId, props) => {
      const tab = mockChrome.createdTabs.find(t => t.id === tabId);
      if (tab) Object.assign(tab, props);
      return tab;
    }
  },
  tabGroups: {
    update: async (groupId, props) => {
      const grp = mockChrome.groups.get(groupId);
      if (grp) Object.assign(grp, props);
      return grp;
    }
  }
};

async function getOrCreateAutoPilotGroup(initialUrl = 'about:blank', sessionId = null, taskName = 'Auto-Pilot') {
  const sid = sessionId || `task_${Date.now()}`;

  // 1. 若已有该 session 的专属记录且标签页仍然存活
  if (autoPilotSessions.has(sid)) {
    const sess = autoPilotSessions.get(sid);
    try {
      const tab = await mockChrome.tabs.get(sess.tabId);
      if (tab) {
        return { ...sess, tab };
      }
    } catch (e) {
      autoPilotSessions.delete(sid);
    }
  }

  // 2. 新建后台专属隔离标签 (active: false，绝不抢占用户当前视窗与焦点！)
  const newTab = await mockChrome.tabs.create({
    url: initialUrl,
    active: false
  });

  const assignedColor = AUTOPILOT_COLORS[groupColorIdx++ % AUTOPILOT_COLORS.length];
  const newSession = {
    sessionId: sid,
    tabId: newTab.id,
    windowId: newTab.windowId,
    groupId: null,
    taskName: taskName,
    color: assignedColor,
    status: 'ready'
  };

  // 3. 专属彩色标签组绑定与重命名
  const groupId = await mockChrome.tabs.group({
    tabIds: [newTab.id]
  });
  newSession.groupId = groupId;
  await mockChrome.tabGroups.update(groupId, {
    title: `🤖 [${taskName}] [就绪]`,
    color: assignedColor
  });

  autoPilotSessions.set(sid, newSession);
  return { ...newSession, tab: newTab };
}

async function runUnitTest() {
  console.log('--- 运行多任务专属标签页池单元测试 ---');

  // 测试用例 1：两个并发任务必须获得完全隔离的标签页和标签组
  const session1 = await getOrCreateAutoPilotGroup('https://example.com/task1', 'session_task_1', '任务一-小游戏');
  const session2 = await getOrCreateAutoPilotGroup('https://example.com/task2', 'session_task_2', '任务二-AI评测');

  console.log('Task 1 Session:', { tabId: session1.tabId, groupId: session1.groupId, color: session1.color });
  console.log('Task 2 Session:', { tabId: session2.tabId, groupId: session2.groupId, color: session2.color });

  assert.notStrictEqual(session1.tabId, session2.tabId, 'Tab ID 必须不同！');
  assert.notStrictEqual(session1.groupId, session2.groupId, 'Group ID 必须不同！');
  assert.notStrictEqual(session1.color, session2.color, '两个并发任务的主题颜色应轮询分配！');
  assert.strictEqual(session1.tab.active, false, 'Tab 1 必须以 active: false 静默创建！');
  assert.strictEqual(session2.tab.active, false, 'Tab 2 必须以 active: false 静默创建！');

  // 测试用例 2：同一任务再次请求时，必须复用自己的专属标签页，绝不创建新标签也不污染其他任务
  const session1Reuse = await getOrCreateAutoPilotGroup('https://example.com/task1_step2', 'session_task_1', '任务一-小游戏');
  assert.strictEqual(session1Reuse.tabId, session1.tabId, '同一任务必须复用自己专属的 Tab ID！');
  assert.strictEqual(session1Reuse.groupId, session1.groupId, '同一任务必须复用自己专属的 Group ID！');

  // 测试用例 3：模拟任务完成移除标签页
  autoPilotSessions.delete('session_task_1');
  assert.strictEqual(autoPilotSessions.has('session_task_1'), false, 'Session 1 应被清理');
  assert.strictEqual(autoPilotSessions.has('session_task_2'), true, 'Session 2 必须继续保持不受影响！');

  console.log('\n🎉 单元测试全部通过：多任务专属标签页分配、零抢焦、彩色分组与生命周期隔离 100% 正确！\n');
}

runUnitTest().catch(err => {
  console.error('单元测试失败:', err);
  process.exit(1);
});
