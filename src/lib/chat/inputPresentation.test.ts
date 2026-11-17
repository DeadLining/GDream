import test from 'node:test';
import assert from 'node:assert/strict';
import { presentInput } from './inputPresentation.ts';

test('广告任务上下文进入可折叠上下文，不重复冒充自动任务摘要', () => {
  const input = '[广告任务上下文：当前用户请求决定范围；以下项目资料不扩大本轮授权。]\n'
    + '【广告调研与图片使用】\n- 规则内容\n\n'
    + '【继续一键全流程 · generate】\n只推进生成阶段。';
  const view = presentInput(input);
  assert.equal(view.generated, true);
  assert.equal(view.userText, '【继续一键全流程 · generate】\n只推进生成阶段。');
  assert.match(view.context, /广告任务上下文/);
  assert.match(view.summary, /继续一键全流程 · generate/);
  assert.doesNotMatch(view.summary, /广告调研与图片使用/);
});

test('普通用户文本不被误判为自动任务', () => {
  const view = presentInput('我想做一个广告');
  assert.equal(view.generated, false);
  assert.equal(view.userText, '我想做一个广告');
});
