import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { H3_OUTPUT_FORMAT, h3FormatAuthoringContract, h3FormatIssues } from './h3PromptFormat.ts';
import { h3OfficialOutputContract } from './h3PromptWritingSkill.ts';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as format from './h3PromptFormat.ts';
import * as promptContract from './h3PromptContract.ts';
import * as shotContract from './h3ShotContract.ts';
import * as timing from './shotTimingPolicy.ts';
import * as skill from './h3PromptWritingSkill.ts';
import * as assetScope from './assetScope.ts';

const base = 'integrated_multimodal_description: [Shot 1] The light turns on.\noverall_soundscape: A switch clicks.\nnon_diegetic_music: N/A';
const reference = 'subject_definitions: <Subject 1> (女子): appearance from <Picture 1>.\nsummary: [reference generation] A recorded message.\nretention_analysis: <Subject 1>: fully_preserved - identity and coat.\ndetailed_description: [Shot 1] She listens.\noverall_soundscape: Room tone.\nnon_diegetic_music: N/A';

test('runtime and standalone validator share the same canonical field source', () => {
  assert.deepEqual(H3_OUTPUT_FORMAT, JSON.parse(readFileSync(new URL('../../../skills/h3-prompt-writing/references/output-format.json', import.meta.url), 'utf8')));
  for (const task of ['t2va', 'i2va', 'fl2va', 'ref2va'] as const) {
    const contract = h3OfficialOutputContract(task, 9);
    assert.ok(contract.includes(h3FormatAuthoringContract(task === 'ref2va')));
  }
});

test('simple silent prompts use one shot and do not need eight ledgers or a word quota', () => {
  assert.deepEqual(h3FormatIssues(base, false), []);
  assert.deepEqual(h3FormatIssues(reference, true), []);
});

test('missing, duplicate, empty, wrong-order and mixed-mode fields are rejected', () => {
  assert.ok(h3FormatIssues(base.replace('non_diegetic_music: N/A', ''), false).some((issue) => /缺少/.test(issue)));
  assert.ok(h3FormatIssues(`${base}\noverall_soundscape: Wind.`, false).some((issue) => /重复/.test(issue)));
  assert.ok(h3FormatIssues(base.replace('overall_soundscape: A switch clicks.', 'overall_soundscape:'), false).some((issue) => /不能为空/.test(issue)));
  assert.ok(h3FormatIssues(base.replace('overall_soundscape: A switch clicks.\nnon_diegetic_music: N/A', 'non_diegetic_music: N/A\noverall_soundscape: A switch clicks.'), false).some((issue) => /顺序/.test(issue)));
  assert.ok(h3FormatIssues(`${base}\nsummary: A shot.`, false).some((issue) => /其它模式/.test(issue)));
  assert.ok(h3FormatIssues(`Preface\n${reference}`, true).some((issue) => /自由段落/.test(issue)));
  assert.ok(h3FormatIssues(`Analysis before the prompt\n${base}`, false).some((issue) => /自由段落/.test(issue)));
  assert.ok(h3FormatIssues(`${base}\n[ACTION_ENGINE]\nDuplicate schedule.`, false).some((issue) => /旧分块台账/.test(issue)));
});

test('shot labels distinguish continuous beats from actual consecutive cuts', () => {
  assert.deepEqual(h3FormatIssues(base.replace('The light turns on.', '00:00.000-00:02.000 The light turns on.\n00:02.000-00:04.000 She looks up.'), false), []);
  assert.deepEqual(h3FormatIssues(base.replace('The light turns on.', 'The light turns on. [Shot 2] At 00:02.000, cut to her face.'), false), []);
  for (const text of [base.replace('[Shot 1]', ''), base.replace('[Shot 1]', '[Shot 2]'), base.replace('The light turns on.', '[Shot 1] Again.'), base.replace('The light turns on.', '[Shot 3] A cut.')]) {
    assert.ok(h3FormatIssues(text, false).some((issue) => /镜头/.test(issue)));
  }
});

test('quoted speech is never mistaken for an envelope field or an extra shot', () => {
  const spoken = base.replace('The light turns on.', '<Subject 1> (S1) says <d>[English] Read this \u{1F4A1}:\noverall_soundscape: [Shot 9]</d> Then she listens.');
  assert.deepEqual(h3FormatIssues(spoken, false), []);
});

// Exercise the production base-mode route with only its transport and unrelated
// planning dependencies replaced. No media, model, or persistence calls occur.
function baseRouteFixture(responses: string[]) {
  const requests: any[][] = [];
  const complete = async (messages: any[]) => {
    requests.push(messages);
    assert.ok(responses.length, 'unexpected extra rewrite request');
    return responses.shift()!;
  };
  const mocks: Record<string, any> = {
    './assetScope.ts': assetScope,
    './characterIdentity.ts': {},
    './h3DirectingPolicy.ts': { h3BoundaryCompositionRuleZh: () => '' },
    './storyDirectorPrompt.ts': {},
    './adSpec.ts': {},
    '../videoPrompt/performance.ts': {},
    './h3PromptContract.ts': promptContract,
    './h3I2vaBoundary.ts': { repairI2vaBoundary: async (prompt: string) => prompt },
    './h3ShotContract.ts': shotContract,
    './h3PromptWritingSkill.ts': skill,
    './h3PromptFormat.ts': format,
    './promptLengthBudget.ts': {},
    './dialoguePolicy.ts': {},
    './spatialStagingDirective.ts': { spatialStagingAuthoringRuleZh: () => '', buildSpatialStagingDirective: () => '', directorViewpointExecutionRuleEn: () => '' },
    './shotTimingPolicy.ts': timing,
    '../agent/quickChat': { quickChat: complete },
    './firstFrameRewriteChat': { createFirstFrameRewriteChat: async () => complete },
  };
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const source = readFileSync(new URL('./workshopPrompts.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(mocks[name], name); return mocks[name]; } });
  return { requests, run: (task = 't2va', firstFramePath?: string) => exports.rewriteMiniMaxH3ShotPrompt({ task, firstFramePath, prompt: 'The light turns on.', references: [], duration: 5, ratio: '16:9' }) };
}

test('base writer repairs missing format once and rejects a second malformed envelope', async () => {
  const repaired = baseRouteFixture(['The light turns on.', base]);
  assert.equal(await repaired.run(), base);
  assert.equal(repaired.requests.length, 2);
  assert.match(repaired.requests[1][0].content, /CANONICAL H3 OUTPUT FORMAT/);
  const invalid = baseRouteFixture(['The light turns on.', 'Still no fields.']);
  await assert.rejects(invalid.run(), /定向修复未通过.*未覆盖原提示词/s);
  assert.equal(invalid.requests.length, 2);
});

test('first-frame binding failures do not become format guesses, but format omissions can be repaired', async () => {
  const alignment = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n';
  const repaired = baseRouteFixture(['The light turns on.', alignment + base]);
  assert.equal(await repaired.run('i2va', '/start.png'), alignment + base);
  assert.equal(repaired.requests.length, 2);
  const unresolved = baseRouteFixture(['FRAME_BINDING_UNRESOLVED: Unknown person.']);
  await assert.rejects(unresolved.run('i2va', '/start.png'), /首帧人物对应尚未确认/);
  assert.equal(unresolved.requests.length, 1);
});
