import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMiniMaxH3DialogueEmissions, sanitizeMiniMaxH3Prompt, validateMiniMaxH3VideoPrompt } from './h3PromptContract.ts';

test('concise base-mode events need no eight-block template, timing grid or character quota', () => {
  const body = 'integrated_multimodal_description: [Shot 1] A fixed medium shot. The rider rolls through a shallow puddle; water sprays outward and the bicycle continues onto dry pavement.\noverall_soundscape: Tire hiss and receding wheel noise.\nnon_diegetic_music: None.';
  for (const task of ['t2va', 'i2va', 'fl2va'] as const) {
    const alignment = task === 'i2va'
      ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n'
      : task === 'fl2va'
        ? 'How the reference pictures align with the target video: Picture 1 aligns with the 0.00-second mark; Picture 2 aligns with the 5.00-second mark.\n'
        : '';
    assert.deepEqual(validateMiniMaxH3VideoPrompt(alignment + body, 5, undefined, task), []);
  }
});

test('Ref2VA validation requires its envelope while retaining dialogue checks', () => {
  const event = 'A fixed medium shot. <Subject 1> (S1) says <d>[Chinese] 跟我走。</d> The listener nods and follows. Footsteps recede.';
  const prompt = `subject_definitions: <Subject 1> (向导): appearance from <Picture 1>.\nsummary: [reference generation] The guide leads the listener.\nretention_analysis: <Subject 1>: fully_preserved - identity.\ndetailed_description: [Shot 1] ${event}\noverall_soundscape: Footsteps.\nnon_diegetic_music: N/A.`;
  assert.deepEqual(validateMiniMaxH3VideoPrompt(prompt, 5, '向导：跟我走。', 'ref2va'), []);
  assert.ok(validateMiniMaxH3VideoPrompt(event, 5, '向导：跟我走。', 'ref2va').some((issue) => /格式字段/.test(issue)));
  assert.ok(validateMiniMaxH3VideoPrompt(prompt.replace('跟我走。', '快来。'), 5, '向导：跟我走。', 'ref2va').some((issue) => /对白/.test(issue)));
});

test('optional subheadings do not cause normalization to erase repeated scripted turns', () => {
  const event = '<Subject 1> (S1) says <d>[Chinese] 等等。</d> The listener turns. <Subject 1> (S1) repeats <d>[Chinese] 等等。</d>';
  const dialogue = '甲：等等。\n甲：等等。';
  for (const prompt of [event, `integrated_multimodal_description: ${event}\noverall_soundscape: Wind.\nnon_diegetic_music: None.`]) {
    assert.equal((normalizeMiniMaxH3DialogueEmissions(prompt, dialogue).match(/<d>/gu) ?? []).length, 2);
  }
});

test('H3 sanitizer does not silently convert removed Chinese prompt structures', () => {
  const prompt = [
    'How the reference picture aligns with the target video — Picture 1 aligns with the 0.00-second mark.',
    'integrated_multimodal_description: 0.0-1.0s: A detailed action.',
    'overall_soundscape: Quiet room tone.',
    'non_diegetic_music: A restrained low drone.',
    '【受控转场】旧转场说明',
    '【连续性与生成约束】旧约束说明',
  ].join('\n\n');
  const clean = sanitizeMiniMaxH3Prompt(prompt, 'i2va');
  assert.equal(clean.includes('【受控转场】'), true);
  assert.equal(clean.includes('【连续性与生成约束】'), true);
  assert.equal(clean.includes('non_diegetic_music:'), true);
  assert.ok(validateMiniMaxH3VideoPrompt(clean, 5, undefined, 'i2va').some((warning) => warning.includes('旧模板污染')));
});

test('H3 sanitizer leaves removed asset headers visible to validation', () => {
  const prompt = [
    '【素材身份】\n-：场景大厅。\n-：角色江野。',
    'integrated_multimodal_description: 0.0-1.0s: A detailed action.',
    'overall_soundscape: Quiet room tone.',
    'non_diegetic_music: None.',
  ].join('\n\n');
  const clean = sanitizeMiniMaxH3Prompt(prompt, 'i2va');
  assert.equal(clean.includes('【素材身份】'), true);
  assert.equal(clean.includes('角色江野'), true);
  assert.equal(clean.includes('integrated_multimodal_description:'), true);
});

test('ref2va validates its native fields without demanding the boundary-frame contract', () => {
  const description = Array.from({ length: 1000 }, () => 'A ').join('') + '0.0-2.0s the camera moves toward the product.';
  const prompt = [
    'subject_definitions: <Picture 1> office; <Picture 2> workstation.',
    'summary: Product reveal.',
    'retention_analysis: Keep the reference identity.',
    `detailed_description: ${description}`,
    'overall_soundscape: Quiet office room tone.',
    'non_diegetic_music: Restrained corporate bed.',
  ].join('\n\n');
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 7, undefined, 'ref2va');
  assert.equal(warnings.some((warning) => warning.includes('integrated_multimodal_description')), false);
  assert.equal(warnings.some((warning) => warning.includes('首帧对齐')), false);
});

test('H3 dialogue is emitted once in the action timeline instead of being copied into every section', () => {
  const lineOne = '都督既命我相助，不妨先把工匠、材料问清。孔明也好知道从何处着手。';
  const lineTwo = '子敬可以帮他筹备，不能替他应下这三日。';
  const prompt = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    `integrated_multimodal_description: [Shot 1] The speaker says <d>[Chinese] ${lineOne}</d>. [Shot 2] The other speaker says <d>[Chinese] ${lineTwo}</d>.`,
    '',
    '[SUBJECTS]',
    'Lu Su (S1) is the first speaker. Zhou Yu (S2) is the second speaker.',
    '[WORLD_CONTINUITY]',
    'Both subjects keep one established spatial layout.',
    '[OBJECT_CONTINUITY]',
    'The desk remains in one position.',
    '[ACTION_ENGINE]',
    `00:00.000-00:04.000 Lu Su says once: <d>[Chinese] ${lineOne}</d> 00:04.000-00:08.000 Zhou Yu says once: <d>[Chinese] ${lineTwo}</d>`,
    '[DIALOGUE]',
    `Lu Su repeats the first line: <d>[Chinese] ${lineOne}</d>. Zhou Yu repeats the second line: <d>[Chinese] ${lineTwo}</d>.`,
    '[CAMERA_LOGIC]',
    'Use one continuous medium framing.',
    '[STATE_TRANSITION]',
    'Ends on the established framing.',
    '[RESTRICTIONS]',
    'No extra speech.',
    '',
    'overall_soundscape: Room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const dialogue = `鲁肃：${lineOne}\n周瑜：${lineTwo}`;
  const normalized = normalizeMiniMaxH3DialogueEmissions(prompt, dialogue);
  assert.equal(normalized.split(lineOne).length - 1, 1);
  assert.equal(normalized.split(lineTwo).length - 1, 1);
  assert.equal((normalized.match(new RegExp('<d>\\[Chinese\\] ' + lineOne + '<\\/d>', 'g')) ?? []).length, 1);
  assert.match(normalized, /DIALOGUE LEDGER ONLY:/u);
  const warnings = validateMiniMaxH3VideoPrompt(normalized, 8, dialogue, 'i2va');
  assert.ok(!warnings.some((warning) => warning.includes('对白重复发声风险')));
  assert.ok(!warnings.some((warning) => warning.includes('对白不完整')));
});

test('I2VA rejects a final tight shot that leaves off-screen cast visible or does not return to a master', () => {
  const warningPrompt = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Three people stand in a medium shot. [Shot 2] At 00:05.000, the camera cuts to a reaction close-up of Zhou Yu. Zhou Yu answers firmly. Lu Su remains half a step nearer and his brows gather. Zhuge Liang lowers his gaze toward the desktop. The shot ends at 00:08.000 without returning to the wider master.',
    '',
    '[SUBJECTS]',
    'Lu Su (S1) is present. Zhou Yu (S2) is present. Zhuge Liang (S3) is present.',
    '[WORLD_CONTINUITY]',
    'The three people remain in one room.',
    '[OBJECT_CONTINUITY]',
    'The order remains on the desk.',
    '[ACTION_ENGINE]',
    '00:05.000-00:08.000 Zhou Yu answers. Lu Su reacts. Zhuge Liang lowers his gaze.',
    '[DIALOGUE]',
    'Zhou Yu (S2) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut once to a close-up of Zhou Yu and hold it through the end.',
    '[STATE_TRANSITION]',
    'Ends on Zhou Yu.',
    '[RESTRICTIONS]',
    'No extra people.',
    '',
    'overall_soundscape: Room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(warningPrompt, 8, undefined, 'i2va');
  assert.ok(warnings.some((warning) => warning.includes('尾帧继承风险')));
  assert.ok(warnings.some((warning) => warning.includes('紧画幅人物复制风险')));
});

test('I2VA accepts a final medium master after an internal close-up and keeps off-screen cast invisible', () => {
  const goodPrompt = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    '',
    'integrated_multimodal_description: [Shot 1] Three people stand in a medium shot. [Shot 2] At 00:05.000, the camera cuts to a reaction close-up of Zhou Yu and keeps the other two off-screen. Zhou Yu answers firmly. [Shot 3] At 00:07.500, the camera returns to the established medium three-person master as Zhou Yu finishes speaking and the others remain at their world positions.',
    '',
    '[SUBJECTS]',
    'Lu Su (S1) is present. Zhou Yu (S2) is present. Zhuge Liang (S3) is present.',
    '[WORLD_CONTINUITY]',
    'The three people remain in one room.',
    '[OBJECT_CONTINUITY]',
    'The order remains on the desk.',
    '[ACTION_ENGINE]',
    '00:05.000-00:07.500 Zhou Yu answers while the other two remain off-screen. 00:07.500-00:08.000 the medium master resumes.',
    '[DIALOGUE]',
    'Zhou Yu (S2) speaks once.',
    '[CAMERA_LOGIC]',
    'Cut once to a close-up of Zhou Yu, then return to the medium three-person master before the end.',
    '[STATE_TRANSITION]',
    'Ends on the medium master.',
    '[RESTRICTIONS]',
    'No extra people, no duplicated subject, and no off-screen subject recreated in the tight framing.',
    '',
    'overall_soundscape: Room tone.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(goodPrompt, 8, undefined, 'i2va');
  assert.ok(!warnings.some((warning) => warning.includes('尾帧继承风险')));
  assert.ok(!warnings.some((warning) => warning.includes('紧画幅人物复制风险')));
});
