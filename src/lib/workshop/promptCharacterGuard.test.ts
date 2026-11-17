import test from 'node:test';
import assert from 'node:assert/strict';
import { promptHasVisibleCharacterMention } from './promptCharacterGuard.ts';

test('future and off-screen name mentions do not count as visible characters', () => {
  const prompt = '远处传来军令，点出二郎神的名字；二郎神随后才赶来。';
  assert.equal(promptHasVisibleCharacterMention(prompt, '二郎神'), false);
});

test('a visible staging claim still requires the character binding', () => {
  const prompt = '哪吒从云层落下，站在花果山山巅，火尖枪指向孙悟空。';
  assert.equal(promptHasVisibleCharacterMention(prompt, '哪吒'), true);
});

test('dialogue mentions do not create an additional visible body', () => {
  const prompt = '孙悟空抬头看向云海。<d>[Chinese] 二郎神要来了。</d>';
  assert.equal(promptHasVisibleCharacterMention(prompt, '二郎神'), false);
});

test('explicit negative staging does not require a reference', () => {
  const prompt = '画面中不得出现二郎神，只保留远处云层和战鼓声。';
  assert.equal(promptHasVisibleCharacterMention(prompt, '二郎神'), false);
});
