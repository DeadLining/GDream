import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  findVisibleOffscreenSentences,
  tightShotFocalNames,
} from './h3PromptContract.ts';
import {
  applyI2vaBoundaryFallback,
  buildI2vaBoundaryRepairInstruction,
  getI2vaBoundaryRisks,
  repairI2vaBoundary,
} from './h3I2vaBoundary.ts';

function genericBadPrompt(): string {
  return [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Alex and Jordan remain in a medium two-shot inside the established cafe, with the counter and entrance visible. [Shot 2] At 00:05.000, the camera cuts to a tight shot of Alex at the counter and holds through 00:08.000 without returning to the master. Jordan remains at the entrance and watches the reaction.',
    '',
    '[SUBJECTS]',
    'Alex (S1) is a barista. Jordan (S2) is a customer.',
    '[WORLD_CONTINUITY]',
    'The counter and entrance keep their established positions.',
    '[OBJECT_CONTINUITY]',
    'The cup remains on the counter.',
    '[ACTION_ENGINE]',
    '00:00.000-00:05.000 Alex serves the cup while Jordan waits. 00:05.000-00:08.000 Alex reacts in the tight shot.',
    '[DIALOGUE]',
    'Alex (S1) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut to a tight shot of Alex and hold it through the end.',
    '[STATE_TRANSITION]',
    'Ends on Alex at the counter.',
    '[RESTRICTIONS]',
    'No extra people.',
    '',
    'overall_soundscape: Cafe room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
}

function genericGoodPrompt(): string {
  return [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Alex and Jordan remain in a medium two-shot inside the established cafe, with the counter and entrance visible. [Shot 2] At 00:05.000, the camera cuts to a tight shot of Alex at the counter while Jordan stays off-screen. [Shot 3] At 00:07.200, the camera returns to the established medium two-shot before the final frame, keeping both people in their world positions and the cafe background legible.',
    '',
    '[SUBJECTS]',
    'Alex (S1) is a barista. Jordan (S2) is a customer.',
    '[WORLD_CONTINUITY]',
    'The counter and entrance keep their established positions.',
    '[OBJECT_CONTINUITY]',
    'The cup remains on the counter.',
    '[ACTION_ENGINE]',
    '00:00.000-00:05.000 Alex serves the cup while Jordan waits. 00:05.000-00:07.200 Alex reacts in the tight shot while Jordan remains off-screen. 00:07.200-00:08.000 the medium two-shot resumes.',
    '[DIALOGUE]',
    'Alex (S1) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut to a tight shot of Alex, then return to the medium two-shot before the end.',
    '[STATE_TRANSITION]',
    'Ends on the medium two-shot.',
    '[RESTRICTIONS]',
    'No extra people and no duplicated subject.',
    '',
    'overall_soundscape: Cafe room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
}

test('generic I2VA risk detection catches a final prop-only or tight-shot boundary', () => {
  const bad = genericBadPrompt();
  const risks = getI2vaBoundaryRisks(bad, 8, undefined);
  assert.ok(risks.some((risk) => risk.includes('尾帧继承风险')));
  assert.ok(risks.some((risk) => risk.includes('紧画幅人物复制风险')));
  assert.deepEqual(getI2vaBoundaryRisks(genericGoodPrompt(), 8, undefined), []);
});

test('tight-shot focal names come from the framing clause, not the subject list order', () => {
  const tightText = 'At 00:09.000, the camera cuts to a reaction close-up of Zhou Yu from the same side of the desk axis, isolating his firm response while preserving his facing and eyeline toward Lu Su.';
  assert.deepEqual(tightShotFocalNames(tightText, ['Zhuge Liang', 'Lu Su', 'Zhou Yu']), ['Zhou Yu']);
});

test('off-screen pronoun behaviour stays risky until the focal subject is named again', () => {
  const tightText = 'At 00:09.000, the camera cuts to a reaction close-up of Zhou Yu. Lu Su remains planted beside the desk: his brows draw together. A brief interruption in his breathing settles. Zhou Yu answers in a tight shot.';
  const risky = findVisibleOffscreenSentences(tightText, ['Zhou Yu'], ['Lu Su']);
  assert.ok(risky.some((sentence) => sentence.includes('brows draw together')));
  assert.ok(risky.some((sentence) => sentence.includes('interruption in his breathing')));
});

test('targeted I2VA repair preserves a complete prompt that now returns to a master', async () => {
  let calls = 0;
  const result = await repairI2vaBoundary(genericBadPrompt(), {
    duration: 8,
    factualContext: 'Alex and Jordan are the only physical cast.',
    quickChat: async () => {
      calls += 1;
      return genericGoodPrompt();
    },
  });
  assert.equal(calls, 1);
  assert.match(result, /returns to the established medium two-shot/);
  assert.deepEqual(getI2vaBoundaryRisks(result, 8, undefined), []);
});

test('repair failure falls back to a generic inheritability instruction without looping', async () => {
  let calls = 0;
  const result = await repairI2vaBoundary(genericBadPrompt(), {
    duration: 8,
    factualContext: 'Alex and Jordan are the only physical cast.',
    quickChat: async () => {
      calls += 1;
      throw new Error('offline');
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(getI2vaBoundaryRisks(result, 8, undefined), []);
  assert.match(result, /established medium framing or spatial master/);
  assert.match(result, /recognizable background/);
  assert.doesNotMatch(result, /周瑜|诸葛亮|鲁肃|军令|桌沿/);
});

test('fallback is composition-only and adapts to a different duration', () => {
  const result = applyI2vaBoundaryFallback(genericBadPrompt(), 6.5);
  assert.match(result, /00:06\.500/);
  assert.match(result, /Do not end on an isolated hand, eye, partial face, small prop detail, or ambiguous crop/);
  assert.match(result, /FINAL ACTION RETURN/);
  assert.match(result, /FINAL INHERITANCE BOUNDARY/);
  assert.deepEqual(getI2vaBoundaryRisks(result, 6.5, undefined), []);
});

test('repair instruction is genre-neutral and preserves canonical facts', () => {
  const instruction = buildI2vaBoundaryRepairInstruction(['tail risk']);
  assert.match(instruction, /Preserve every established identity, relationship, dialogue line, prop, location fact/);
  assert.match(instruction, /medium framing or the established spatial master/);
  assert.doesNotMatch(instruction, /cafe|barista|周瑜|诸葛亮|军令/);
});

test('out-of-order shot blocks are treated as an I2VA repair risk', () => {
  const outOfOrder = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Alex and Jordan are in a medium two-shot. [Shot 3] The camera returns to the medium two-shot. [Shot 2] At 00:05.000, the camera cuts to a tight shot of Alex while Jordan watches from the entrance.',
    '',
    '[SUBJECTS]',
    'Alex (S1) speaks. Jordan (S2) watches.',
    '[WORLD_CONTINUITY]',
    'The cafe layout is unchanged.',
    '[OBJECT_CONTINUITY]',
    'The cup stays on the counter.',
    '[ACTION_ENGINE]',
    '00:00.000-00:05.000 Alex works. 00:05.000-00:08.000 Alex reacts.',
    '[DIALOGUE]',
    'Alex (S1) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut to a tight shot of Alex, then return to the medium two-shot before the end.',
    '[STATE_TRANSITION]',
    'Ends on the medium two-shot.',
    '[RESTRICTIONS]',
    'No extra people.',
    '',
    'overall_soundscape: Cafe room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const risks = getI2vaBoundaryRisks(outOfOrder, 8, undefined);
  assert.ok(risks.some((risk) => risk.includes('镜头块顺序风险')));
  assert.ok(risks.some((risk) => risk.includes('紧画幅人物复制风险')));
});

test('tight-shot prose must omit off-screen subjects even when it names a pull-out later', () => {
  const risky = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Alex and Jordan are in a medium two-shot. [Shot 2] At 00:05.000, the camera cuts to a reaction close-up of Alex. Jordan remains at the entrance, his brows drawing together and his shoulders shifting while Alex answers. At 00:07.000, the camera pulls out to the medium two-shot.',
    '',
    '[SUBJECTS]',
    'Alex (S1) speaks. Jordan (S2) listens.',
    '[WORLD_CONTINUITY]',
    'The cafe layout is unchanged.',
    '[OBJECT_CONTINUITY]',
    'The cup stays on the counter.',
    '[ACTION_ENGINE]',
    '00:05.000-00:07.000 Alex answers while Jordan waits. 00:07.000-00:08.000 the medium two-shot returns.',
    '[DIALOGUE]',
    'Alex (S1) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut to a close-up of Alex, then pull out to the medium two-shot before the end.',
    '[STATE_TRANSITION]',
    'Ends on the medium two-shot.',
    '[RESTRICTIONS]',
    'No extra people.',
    '',
    'overall_soundscape: Cafe room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const risks = getI2vaBoundaryRisks(risky, 8, undefined);
  assert.ok(risks.some((risk) => risk.includes('紧画幅人物复制风险')));
});

test('fallback does not inject an out-of-order shot block', () => {
  const once = applyI2vaBoundaryFallback(genericBadPrompt(), 8);
  const twice = applyI2vaBoundaryFallback(once, 8);
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
  assert.equal(normalize(twice), normalize(once));
  assert.deepEqual(getI2vaBoundaryRisks(once, 8, undefined), []);
  assert.deepEqual(getI2vaBoundaryRisks(twice, 8, undefined), []);
});


test('fallback removes re-instantiation wording from a pull-out and keeps one subject ledger', () => {
  const prompt = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Alex and Jordan begin in the established medium two-shot. [Shot 2] At 00:04.000, cut to a close-up of Alex; Jordan stays outside this crop. At 00:06.000, pull out to the medium two-shot, revealing the same Jordan and Alex again at their positions.',
    '',
    '[SUBJECTS]',
    'Alex (S1) is the speaker. Jordan (S2) is the listener.',
    '[WORLD_CONTINUITY]',
    'Alex and Jordan occupy one fixed spatial layout and keep their world positions.',
    '[OBJECT_CONTINUITY]',
    'The table remains in one physical position.',
    '[ACTION_ENGINE]',
    '00:00.000-00:04.000 Alex speaks. 00:04.000-00:06.000 Alex continues in close-up. 00:06.000-00:08.000 the medium framing resumes.',
    '[DIALOGUE]',
    'Alex (S1) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut to the close-up, then pull out to the medium framing before the end.',
    '[STATE_TRANSITION]',
    'Ends on the medium framing.',
    '[RESTRICTIONS]',
    'No duplicate subjects.',
    '',
    'overall_soundscape: Room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const repaired = applyI2vaBoundaryFallback(prompt, 8);
  assert.doesNotMatch(repaired, /revealing the same Jordan and Alex again/u);
  assert.match(repaired, /expand the existing framing to the already-established composition/u);
  assert.match(repaired, /CUT CONTINUITY LOCK:/u);
  assert.deepEqual(getI2vaBoundaryRisks(repaired, 8, undefined), []);
});

test('direct rewrite routes generated I2VA prompts through the boundary repair', () => {
  const source = readFileSync(new URL('./workshopPrompts.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*repairI2vaBoundary[^}]*\} from '\.\/h3I2vaBoundary\.ts'/);
  assert.match(source, /if \(task !== 'i2va'\) \{[\s\S]*?h3FormatIssues\(rewritten, false\)[\s\S]*?options\.onDurationResolved\?\.\(duration\);\s*return rewritten;/);
  assert.match(source, /await repairI2vaBoundary\(rewritten,/);
});

test('real workshop prompt fallback removes the premature return and preserves both dialogue lines', () => {
  const prompt = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Zhou Yu, Zhuge Liang, and Lu Su remain in a medium three-person framing inside the command tent. [Shot 3] During the final action beat before 00:15.000, the camera returns from any internal close-up or insert to the established medium framing or spatial master.',
    '',
    '[SUBJECTS]',
    'Zhuge Liang (S1), addressed as Kongming, is the silent man. Lu Su (S2), addressed as Zijing, is the earnest man. Zhou Yu (S3), addressed as Commander, is the commander.',
    '[WORLD_CONTINUITY]',
    'All three occupy their established world positions around the desk.',
    '[OBJECT_CONTINUITY]',
    'The military order remains beneath Zhou Yu’s fingers.',
    '[ACTION_ENGINE]',
    'From 00:00.000 to 00:09.000, Lu Su (S2) says: <d>[Chinese] 都督既命我相助，不妨先把工匠、材料问清。孔明也好知道从何处着手。</d>',
    '[Shot 2] At 00:09.000, the camera cuts to a reaction close-up of Zhou Yu from the same side of the desk axis, isolating his firm response while preserving his facing and eyeline toward Lu Su.',
    'From 00:09.000 to 00:14.500, Zhou Yu (S3) says: <d>[Chinese] 子敬可以帮他筹备，不能替他应下这三日。</d>',
    'At the refusal, Lu Su remains planted beside the desk: his brows draw together and his lips press closed.',
    'A brief interruption in his breathing settles into a restrained exhale; he keeps looking toward Zhou Yu.',
    'Zhuge Liang listens from the same position before the desk, shoulders quiet and mouth closed.',
    'From 00:12.500 to 00:14.500, the camera pulls out smoothly to an inheritable medium relationship framing.',
    '[DIALOGUE]',
    'Lu Su (S2) delivers the first quoted line. Zhou Yu (S3) delivers the second quoted line. Zhuge Liang (S1) remains silent.',
    '[CAMERA_LOGIC]',
    'Cut to Zhou Yu’s close-up at 00:09.000, then pull out to the medium relationship framing before the end.',
    '[STATE_TRANSITION]',
    'Ends on the medium framing with all three at their established world positions.',
    '[RESTRICTIONS]',
    'No extra people, no duplicate subjects, and no additional dialogue.',
    '',
    'overall_soundscape: Water and quiet fabric sounds continue.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const dialogue = [
    '都督既命我相助，不妨先把工匠、材料问清。孔明也好知道从何处着手。',
    '子敬可以帮他筹备，不能替他应下这三日。',
  ].join('\n');
  const repaired = applyI2vaBoundaryFallback(prompt, 15);
  assert.deepEqual(getI2vaBoundaryRisks(repaired, 15, dialogue), []);
  const integrated = repaired.split('integrated_multimodal_description:')[1]!.split('overall_soundscape:')[0]!;
  assert.deepEqual([...integrated.matchAll(/\[Shot\s+(\d+)\]/gu)].map((match) => match[1]), ['1', '2']);
  assert.match(repaired, /都督既命我相助，不妨先把工匠、材料问清。孔明也好知道从何处着手。/u);
  assert.match(repaired, /子敬可以帮他筹备，不能替他应下这三日。/u);
  assert.match(repaired, /CUT CONTINUITY LOCK:/u);
});
