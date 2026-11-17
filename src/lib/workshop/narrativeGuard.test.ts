import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWorkshopEditScope,
  findUnsupportedPromptDialogue,
  findUnsupportedRelationshipClaims,
  validateAudioPromptsAgainstShot,
  dialogueEncodingIssue,
} from './narrativeGuard.ts';

test('prompt edits do not acquire story-edit permission from negated wording', () => {
  assert.equal(classifyWorkshopEditScope('帮我优化视频提示词，不要改剧本和台词'), 'prompts');
});

test('explicit script and dialogue requests acquire story-edit permission', () => {
  assert.equal(classifyWorkshopEditScope('修改剧本，把巫史的台词改成今晚出发'), 'story');
  assert.equal(classifyWorkshopEditScope('让姮氏回答“我明白了”'), 'story');
});

test('shot restructuring is separate from story editing', () => {
  assert.equal(classifyWorkshopEditScope('重新调整分镜结构，把第 3 镜拆成两镜'), 'shots');
});

test('breakdown work has an explicit scope separate from story editing', () => {
  assert.equal(classifyWorkshopEditScope('重新拆解一下剧本'), 'breakdown');
  assert.equal(classifyWorkshopEditScope('修复第二步的阻塞问题'), 'breakdown');
  assert.equal(classifyWorkshopEditScope('继续补齐缺少的原子分镜'), 'breakdown');
});

test('breakdown instructions do not acquire story permission from guard wording', () => {
  assert.equal(
    classifyWorkshopEditScope('重新拆解剧本，不要修改剧情和对白'),
    'breakdown',
  );
  assert.equal(
    classifyWorkshopEditScope('修复第二步。只有用户明确要求修改剧本时，才能改变剧情事实。'),
    'breakdown',
  );
  assert.equal(
    classifyWorkshopEditScope('优化提示词；如果要修改剧本，必须先得到用户授权。'),
    'prompts',
  );
  assert.equal(
    classifyWorkshopEditScope('请执行剧本拆解。只有用户本轮明确要求改剧本、改剧情、改对白或增删人物时，才允许创作性改写；优化提示词不等于改剧本。'),
    'breakdown',
  );
});

test('prompt dialogue must be supported by the canonical shot dialogue', () => {
  assert.deepEqual(findUnsupportedPromptDialogue({
    videoPrompt: '巫史低声说：“今晚出发。”',
    canonicalDialogue: '今晚出发。',
  }), []);

  assert.deepEqual(findUnsupportedPromptDialogue({
    videoPrompt: '巫史低声说：“明天攻城。”',
    canonicalDialogue: '今晚出发。',
  }), ['明天攻城。']);
});

test('audio prompt dialogue is checked against the same canonical evidence', () => {
  assert.deepEqual(findUnsupportedPromptDialogue({
    audioPrompts: [{ prompt: '沉稳男声念出：“不要回头。”' }],
    canonicalDialogue: '继续向前。',
  }), ['不要回头。']);
});

test('cinematic detail may expand while unsupported relationships are blocked', () => {
  assert.deepEqual(findUnsupportedRelationshipClaims({
    prompts: ['暖色侧光下，两人隔桌对视，父亲缓慢收紧手指。'],
    canonicalFacts: '巫史与姮氏隔桌对视。',
  }), ['父亲']);
  assert.deepEqual(findUnsupportedRelationshipClaims({
    prompts: ['暖色侧光下，父亲缓慢收紧手指。'],
    canonicalFacts: '父亲坐在桌边。',
  }), []);
});

test('audio prompts must use canonical dialogue and linked characters', () => {
  assert.deepEqual(validateAudioPromptsAgainstShot({
    dialogue: '陈默说：“今晚出发。”',
    characterIds: ['chenmo'],
    audioPrompts: [{ characterId: 'chenmo', prompt: '克制地说：“今晚出发。”' }],
  }), []);

  assert.deepEqual(validateAudioPromptsAgainstShot({
    dialogue: '陈默说：“今晚出发。”',
    characterIds: ['chenmo'],
    audioPrompts: [{ characterId: 'chenmo', prompt: '激动地说：“明天出发。”' }],
  }).length > 0, true);

  assert.match(validateAudioPromptsAgainstShot({
    dialogue: '陈默说：“今晚出发。”',
    characterIds: ['chenmo'],
    audioPrompts: [{ characterId: 'other', prompt: '克制地说：“今晚出发。”' }],
  })[0], /未关联/);
});

test('audio prompts are rejected when the shot has no dialogue', () => {
  assert.match(validateAudioPromptsAgainstShot({
    dialogue: '',
    characterIds: ['chenmo'],
    audioPrompts: [{ characterId: 'chenmo', prompt: '低声说：“不要回头。”' }],
  })[0], /没有剧本对白/);
});


test('continuing decomposition without changing dialogue never grants story-edit scope', () => {
  assert.equal(classifyWorkshopEditScope('请继续拆解第2集并增量写入分镜，不改写剧本对白'), 'breakdown');
  assert.equal(classifyWorkshopEditScope('优化视频提示词，不修改台词'), 'prompts');
});


test('corrupted screenplay dialogue is blocked before prompt generation', () => {
  assert.equal(dialogueEncodingIssue('旁白：���从写作到表格分析。')?.includes('对白已损坏'), true);
  assert.equal(dialogueEncodingIssue('旁白：从写作到表格分析。'), undefined);
});
