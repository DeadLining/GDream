import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pendingDecisionForSession } from './pendingDecision.ts';

test('同一会话从画布切到工坊仍能回答，不受来源页面影响', () => {
  const pending = { id: 'ask-1', sourceSessionId: 's1', sourceView: 'canvas' };
  assert.equal(pendingDecisionForSession(pending, 's1'), pending);
});
test('不展示其他会话的问题，也不把历史记录恢复成授权', () => {
  assert.equal(pendingDecisionForSession({ sourceSessionId: 's2' }, 's1'), null);
  assert.equal(pendingDecisionForSession(null, 's1'), null);
  assert.equal(pendingDecisionForSession({ sourceSessionId: null }, null), null);
});
test('活跃确认独立于历史时间线和执行状态，始终具有单一入口', () => {
 const source = readFileSync(new URL('../../components/chat/AgentDrawer.tsx', import.meta.url), 'utf8');
 assert.match(source, /data-testid="active-decision-panel"/);
 assert.doesNotMatch(source, /pendingDecision\?\.sourceView === activeView/);
 assert.doesNotMatch(source, /pendingDecision && event.run.status/);
});
