import assert from 'node:assert/strict';
import test from 'node:test';
import { planDialogueSync } from './dialogueSync.ts';
const source = '甲：“新台词。”\n乙：“保留这句。”';
test('fill and replacement coexist without a second authorization', () => {
  assert.equal(planDialogueSync('', '甲：“新台词。”', source).kind, 'fill');
  const result = planDialogueSync('甲：“过期台词。”', '甲：“新台词。”', source);
  assert.equal(result.kind, 'replace');
  assert.equal(result.error, undefined);
});
test('valid old lines survive mixed-version repair and invented lines are rejected', () => {
  assert.ok(planDialogueSync('甲：“过期台词。”\n乙：“保留这句。”', '甲：“新台词。”', source).error);
  assert.equal(planDialogueSync('甲：“过期台词。”\n乙：“保留这句。”', source, source).error, undefined);
  assert.ok(planDialogueSync('', '甲：“瞎编。”', source).error);
  assert.equal(planDialogueSync(source, source, source).kind, 'unchanged');
});
test('键入文字不能改成口播，错误须给出非对白修复路径', () => {
  const script = '苏禾敲下一行字：「这份合同的违约金条款，和去年那版差在哪？」';
  const result = planDialogueSync('', '苏禾：这份合同的违约金条款，和去年那版差在哪？', script);
  assert.match(result.error!, /键入|屏幕/);
  assert.match(result.error!, /description/);
  assert.match(result.error!, /不要.*重复/);
});
