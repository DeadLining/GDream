import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { H3_DIALOGUE_STAGING_POLICY } from './h3DirectingPolicy.ts';
import { normalizeMiniMaxH3DialogueEmissions, stripH3AuthoringNotes } from './h3PromptContract.ts';

test('authoring policy binds whole turns and avoids guessed image identities', () => {
  for (const expected of ['ONE chronological ACTION_ENGINE passage', 'Never continue its final clause', 'actual inspected first-frame evidence', 'non-overlapping speech windows', 'A motivated cut', 'final timed paragraph', 'visual group is not automatically a speaking subject', 'detached list']) {
    assert.ok(H3_DIALOGUE_STAGING_POLICY.includes(expected), expected);
  }
});
test('normalizing multiple lines preserves their timeline attribution after offsets shift', () => {
  const a = '工匠能召，材料也能去问。但十万支……我不能凭一句话作保。';
  const b = '那便不造。';
  const text = `Summary: ${a.repeat(5)} ${b}\n[ACTION_ENGINE]\nS2 says <d>[Chinese] ${a}</d>\nS1 says <d>[Chinese] ${b}</d>\n[DIALOGUE]\n${a}\n${b}`;
  const result = normalizeMiniMaxH3DialogueEmissions(text, `鲁肃：${a}\n诸葛亮：${b}`);
  assert.ok(result.includes(`S2 says <d>[Chinese] ${a}</d>`));
  assert.ok(result.includes(`S1 says <d>[Chinese] ${b}</d>`));
  assert.equal(result.split(a).length - 1, 1);
  assert.equal(result.split(b).length - 1, 1);
  assert.doesNotMatch(result, /SPEAKER EXCLUSIVITY LOCK/);
});
test('legacy notes are removed without deleting concrete final composition or dialogue', () => {
  const concrete = 'From 00:11.000 to 00:12.000, Alex and Jordan are visible waist-up beside the table, with the window behind them.';
  const result = stripH3AuthoringNotes(`CONTINUOUS TAKE LOCK: no cuts\n[ACTION_ENGINE]\n${concrete}\nFINAL COMPOSITION: medium framing\n<D>original line</D>`);
  assert.ok(result.includes(concrete));
  assert.ok(result.includes('<D>original line</D>'));
  assert.doesNotMatch(result, /LOCK:|FINAL COMPOSITION:/);
});
test('rewrite uses shared staging policy and does not mechanically replace editorial cuts', () => {
  const source = readFileSync(new URL('./workshopPrompts.ts', import.meta.url), 'utf8');
  assert.match(source, /\$\{H3_DIALOGUE_STAGING_POLICY\}/);
  assert.doesNotMatch(source, /normalizeI2vaContinuousTake|allowsInternalCut/);
  assert.match(source, /const finalPrompt = stripH3AuthoringNotes\(normalizeMiniMaxH3DialogueEmissions\(repaired, input.dialogue\)\)/);
  assert.match(source, /options\.onDurationResolved\?\.\(duration\);\s*return finalPrompt;/);
});
