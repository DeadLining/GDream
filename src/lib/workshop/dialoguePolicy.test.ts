import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShotPromptsPrompt } from './workshopPrompts.ts';
import { characterNamingDirective, dialoguePolicyDirective, resolveDialoguePolicy } from './dialoguePolicy.ts';

test('detects empty dialogue fields without proving source silence', () => {
  const policy = resolveDialoguePolicy([
    { shotNo: '01-01', dialogue: '' },
    { shotNo: '01-02', dialogue: undefined },
    { shotNo: '01-03', dialogue: '   ' },
  ]);
  assert.equal(policy.isDialogueFree, true);
  assert.equal(policy.hasAnyDialogue, false);
});

test('detects a project that does have dialogue', () => {
  const policy = resolveDialoguePolicy([
    { shotNo: '01-01', dialogue: '' },
    { shotNo: '01-02', dialogue: '再放一次。' },
  ]);
  assert.equal(policy.isDialogueFree, false);
  assert.deepEqual(policy.dialogueShotNos, ['01-02']);
});

test('dialogue-free directive forbids invented lines and is empty otherwise', () => {
  const free = resolveDialoguePolicy([{ shotNo: '01-01', dialogue: '' }]);
  const directive = dialoguePolicyDirective(free);
  assert.match(directive, /不能据此断言本片无对白/);
  assert.match(directive, /不能排除拆解漏填/);
  assert.doesNotMatch(directive, /这是一个.*无对白剧本|不是遗漏或漏填/);
  assert.match(directive, /绝对禁止：人物台词、对话、VO/);
  assert.match(directive, /环境声与动作拟音/);

  const withDialogue = resolveDialoguePolicy([{ shotNo: '01-01', dialogue: '走。' }]);
  assert.equal(dialoguePolicyDirective(withDialogue), '');
});

test('character naming directive restricts names to this shot characterIds', () => {
  const directive = characterNamingDirective();
  assert.match(directive, /只有本镜 characterIds 中列出的角色/);
  assert.match(directive, /不得写出其姓名/);
});

test('shot prompt embeds the no-dialogue lock for a dialogue-free project', () => {
  const shots = [
    { shotNo: '01-01', dialogue: '' },
    { shotNo: '01-02', dialogue: '' },
  ];
  const prompt = buildShotPromptsPrompt('', 'legacy', undefined, undefined, shots);
  assert.match(prompt, /当前分镜对白字段为空/);
  assert.match(prompt, /角色具名规则/);
  // The old self-contradicting encouragement must be gone.
  assert.doesNotMatch(prompt, /台词写在对应镜头行的 \{\} 内。\n/);
  assert.match(prompt, /dialogue 为空的镜头禁止生成任何台词/);
});

test('shot prompt omits the no-dialogue lock when dialogue exists', () => {
  const prompt = buildShotPromptsPrompt('', 'legacy', undefined, undefined, [
    { shotNo: '01-01', dialogue: '再放一次。' },
  ]);
  assert.doesNotMatch(prompt, /当前分镜对白字段为空/);
  // Naming rule is still useful for every project.
  assert.match(prompt, /角色具名规则/);
});

test('empty fields require source verification, not silent reenactment or automatic invented dialogue', () => {
  const directive = dialoguePolicyDirective(resolveDialoguePolicy([{ shotNo: '01-03', dialogue: '' }]));
  assert.match(directive, /先按事实修复流程补齐 dialogue/);
  assert.match(directive, /没有修复权限时明确指出阻塞/);
  assert.match(directive, /来源不足则报告尚未核验/);
  assert.match(directive, /不能擅自在提示词中加入/);
  assert.doesNotMatch(directive, /这是一个.*无对白剧本|不是遗漏或漏填/);
  assert.doesNotMatch(directive, /屏幕\/告示等画面内文字信息/);
});
