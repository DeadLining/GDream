import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SURFACE_VISIBLE_ROLES,
  isSurfaceVisible,
  surfaceMessageKind,
  surfaceMessages,
} from './conversationSurface.ts';

const readSource = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

type M = { id: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp: number };
const msg = (id: string, role: M['role'], content: string): M =>
  ({ id, role, content, timestamp: Number(id.replace(/\D/g, '')) || 1 });

test('系统提示对用户可见——否则失败/降级说明在五个抽屉里全都消失', () => {
  // 回归锁：曾经 AgentDrawer 只放行 user|assistant，
  // 于是「一键全流程已中止」「所选渠道没配 Key，本次改用…」这些提示
  // 在工坊/画布/剪辑/文案/导演台全部不可见。
  assert.equal(isSurfaceVisible('system'), true);
  assert.deepEqual([...SURFACE_VISIBLE_ROLES].sort(), ['assistant', 'system', 'user']);
});

test('三种角色的版式各不相同', () => {
  assert.equal(surfaceMessageKind('user'), 'user');
  assert.equal(surfaceMessageKind('assistant'), 'assistant');
  assert.equal(surfaceMessageKind('system'), 'notice');
});

test('未知角色按提示条渲染，而不是被静默丢弃', () => {
  assert.equal(surfaceMessageKind('tool'), 'notice');
  assert.equal(isSurfaceVisible('tool'), false, '未知角色不进对话流，但分类函数不能抛错');
});

test('surfaceMessages 保留空正文消息——产物卡片挂在无正文的助手消息上', () => {
  const messages = [
    msg('1', 'user', '你好'),
    msg('2', 'assistant', ''),          // 只挂产物，必须保留
    msg('3', 'system', '已中止'),
  ] as unknown as Parameters<typeof surfaceMessages>[0];
  assert.deepEqual(surfaceMessages(messages).map((m) => m.id), ['1', '2', '3']);
});

test('surfaceMessages 过滤未知角色', () => {
  const messages = [
    msg('1', 'user', 'a'),
    { id: '2', role: 'tool', content: 'x', timestamp: 2 },
    msg('3', 'system', 'b'),
  ] as unknown as Parameters<typeof surfaceMessages>[0];
  assert.deepEqual(surfaceMessages(messages).map((m) => m.id), ['1', '3']);
});

test('回归锁：AgentDrawer 必须经由本模块过滤，不得再内联 user|assistant', () => {
  const drawer = readSource('../../components/chat/AgentDrawer.tsx');
  assert.doesNotMatch(
    drawer,
    /role === 'user' \|\| message\.role === 'assistant'/,
    'AgentDrawer 不得再内联 user|assistant 过滤，必须调用 surfaceMessages()',
  );
  assert.match(drawer, /surfaceMessages\(/, 'AgentDrawer 必须复用统一显示策略');
  assert.match(drawer, /surfaceMessageKind\(/, 'AgentDrawer 必须按统一分类渲染版式');
});

test('回归锁：所有抽屉共用的壳决定了修复面，禁止再出现第二处内联角色白名单', () => {
  // 抽屉壳是唯一入口；wrapper（工坊/画布/剪辑/文案/导演台）都不该自己再筛角色。
  for (const wrapper of [
    '../../components/workshop/WorkshopChatPanel.tsx',
    '../../components/canvas/CanvasChatBubble.tsx',
    '../../components/editor/EditorChatPanel.tsx',
  ]) {
    const source = readSource(wrapper);
    assert.doesNotMatch(
      source,
      /role === 'user' \|\| .*role === 'assistant'/,
      `${wrapper} 不应自己过滤角色，交给 AgentDrawer`,
    );
  }
});
