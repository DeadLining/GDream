import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateH3SectionDialogue } from './h3DialoguePayload.ts';
import { normalizeMiniMaxH3DialogueEmissions } from './h3PromptContract.ts';
import { prepareSglangH3PromptForTask } from '../canvasGen/sglangH3.ts';
const a = '孔明，想清楚���你此刻接下，到期便不能再拿工匠、材料作解释。';
const b = '我知道。你相助，是帮我办事，不是替我担这句话。';
const tag = (line: string) => `<d>[Chinese] ${line}</d>`;
const prompt = `integrated_multimodal_description: [Shot 1] ${tag(a)} ${tag(b)}\n[SUBJECTS]\nS2 and S1\n[ACTION_ENGINE]\n0-4s S2 says ${tag(a)}\n8-15s S1 says ${tag(b)}\n[DIALOGUE]\nMetadata only\n[CAMERA_LOGIC]\nFixed camera`;
for (const dialogue of [undefined, `鲁肃：“${a}”\n诸葛亮：“${b}”`, `鲁肃：${a}\n诸葛亮：${b}`]) {
  test(`duplicate section speech is removed with ${dialogue === undefined ? 'no whitelist' : 'quoted or bare whitelist'}`, () => {
    const result = normalizeMiniMaxH3DialogueEmissions(prompt, dialogue);
    assert.equal((result.match(/<d>/g) ?? []).length, 2);
    assert.ok(result.includes(`S2 says ${tag(a)}`));
    assert.ok(result.includes(`S1 says ${tag(b)}`));
    assert.equal(normalizeMiniMaxH3DialogueEmissions(result, dialogue), result);
  });
}
test('final transport removes duplicated speech from old saved prompts', () => {
  const result = prepareSglangH3PromptForTask(prompt, 'i2va');
  assert.equal((result.match(/<d>/g) ?? []).length, 2);
  assert.ok(result.includes(`S2 says ${tag(a)}`));
});
test('intentional repeated words by two speakers in action timeline are not deleted', () => {
  const source = `[ACTION_ENGINE]\nS1: ${tag('好。')}\nS2: ${tag('好。')}\n[DIALOGUE]`;
  assert.equal((normalizeMiniMaxH3DialogueEmissions(source, '甲：好。\n乙：好。').match(/<d>/g) ?? []).length, 2);
});
test('unique speech and prompts without action sections remain untouched', () => {
  const source = `detailed_description: ${tag(a)} ${tag(a)}`;
  assert.equal(deduplicateH3SectionDialogue(source), source);
  const unique = `[Shot 1] ${tag(b)}\n[ACTION_ENGINE]\n${tag(a)}\n[DIALOGUE]`;
  assert.equal(deduplicateH3SectionDialogue(unique), unique);
});
