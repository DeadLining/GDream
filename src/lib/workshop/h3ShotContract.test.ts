import test from 'node:test';
import assert from 'node:assert/strict';
import { auditH3ShotContract, h3ShotBlocks, h3TimelineSection } from './h3ShotContract.ts';

const refPrompt = (timeline: string, definitions = '<Subject 1> is the courier from <Picture 1>. <Subject 2> is the clerk at the counter.') =>
  `subject_definitions:\n${definitions}\nsummary: The exchange continues.\nretention_analysis: Retain identity.\ndetailed_description:\n${timeline}\noverall_soundscape: Room tone.\nnon_diegetic_music: None.`;

const speakerDefinitions = '<Subject 1> is the guide from <Picture 1>. (S1) is the speaker voice of <Subject 1>. <Subject 2> is the traveller.';

test('camera choices are editorial and do not block a save', () => {
  const block = '[Shot 1] At 00:01 the camera pushes in on <Subject 1>. At 00:04 the camera pulls back into a final wide view that holds both people.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(block), durationSeconds: 5 }), []);
  const silentWide = '[Shot 1] At 00:01 the camera pushes in on <Subject 1>. The final wide view holds both people at the counter.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(silentWide), durationSeconds: 5 }), []);
  const cut = '[Shot 1] The camera pushes in on <Subject 1>. [Shot 2] A wide view shows both people at the counter.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(cut), durationSeconds: 5 }), []);
});

test('camera spine audit understands generic cuts and blocks without false positives', () => {
  const timeline = '[Shot 1] Camera rises slowly.\n[Shot 2] Cut to a closer view of the guide.';
  assert.equal(h3ShotBlocks(h3TimelineSection(refPrompt(timeline))).length, 2);
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(timeline), durationSeconds: 6 }), []);
  const propOnly = '[Shot 1] The tool remains across his shoulders while he turns.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(propOnly), durationSeconds: 6 }), []);
});

test('repeated carried-pose wording is editorial and does not block a save', () => {
  const locked = '[Shot 1] At 00:01 the tool stays across his shoulders as he speaks.\n\n[Shot 2] At 00:03 the tool remains across his shoulders while he turns.\n\n[Shot 3] At 00:05 the tool is still across his shoulders.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(locked), durationSeconds: 6 }), []);
  const opening = '[Shot 1] At 00:00 the tool rests across his shoulders. He lowers it by 00:02 and carries it at his side.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(opening), durationSeconds: 6 }), []);
});

test('only speaking subjects receive a voice id', () => {
  const definitions = '<Subject 1> is the guide from <Picture 1>. (S1) is the speaker voice of <Subject 1>. <Subject 3> is a guard formation with no spoken lines.';
  const timeline = '[Shot 1] <Subject 1> (S1) says <d>[Chinese] 跟我走。</d> The formation holds position behind the guide.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(timeline, definitions), durationSeconds: 5, dialogue: '向导：跟我走。' }), []);
  const bad = `${definitions} <Subject 3> is a guard formation with no spoken lines and (S2) marks it as present on stage.`;
  assert.ok(auditH3ShotContract({ prompt: refPrompt(timeline, bad), durationSeconds: 5, dialogue: '向导：跟我走。' }).some((issue) => issue.includes('无口播')));
});

test('a declared voice id must actually be bound to a line', () => {
  const definitions = '<Subject 1> is the guide from <Picture 1>. (S1) is the speaker voice of <Subject 1>.';
  const noLine = '[Shot 1] <Subject 1> crosses the path and looks back.';
  assert.ok(auditH3ShotContract({ prompt: refPrompt(noLine, definitions), durationSeconds: 5 }).some((issue) => issue.includes('没有绑定')));
  const line = '[Shot 1] <Subject 1> (S1) says <d>[Chinese] 跟我走。</d> then waits.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(line, definitions), durationSeconds: 5, dialogue: '向导：跟我走。' }), []);
});

test('ordinary prose about an unnamed background figure is not a save-blocking fact conflict', () => {
  const background = '[Shot 1] A small monkey runs out from behind a rock and points at the sky.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(background), durationSeconds: 5 }), []);
  const possessive = "[Shot 1] A soldier's banner lifts in the wind.";
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(possessive), durationSeconds: 5 }), []);
});

test('final utterance timing is editorial and does not block a save', () => {
  const endsAtDuration = '[Shot 1] From 00:01 to 00:09 <Subject 1> says <d>[Chinese] 跟我走。</d> His command finishes by 00:09.000.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(endsAtDuration, speakerDefinitions), durationSeconds: 9, dialogue: '向导：跟我走。' }), []);
  const leavesWindow = '[Shot 1] From 00:01 to 00:08 <Subject 1> says <d>[Chinese] 跟我走。</d> His line finishes by 00:08.300; the traveller visibly reacts through 00:09.000.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(leavesWindow, speakerDefinitions), durationSeconds: 9, dialogue: '向导：跟我走。' }), []);
});

test('contract audit covers first-frame H3 shapes, not only Ref2VA', () => {
  const prompt = `integrated_multimodal_description:\n[SUBJECTS]\n<Subject 1> is the courier. (S1) is the speaker voice of <Subject 1>.\n[WORLD_CONTINUITY]\nCounter interior.\n[OBJECT_CONTINUITY]\nParcel.\n[ACTION_ENGINE]\nFrom 00:01 to 00:08 <Subject 1> (S1) says <d>[Chinese] 请收好。</d> The line finishes by 00:08.300 and the clerk nods through 00:09.000.\n[DIALOGUE]\nS1: 00:01-00:08.\n[CAMERA_LOGIC]\nA steady medium shot at counter height.\n[STATE_TRANSITION]\nParcel changes hands.\n[RESTRICTIONS]\nNo extra dialogue.\n\noverall_soundscape: Room tone.\nnon_diegetic_music: None.`;
  assert.equal(h3TimelineSection(prompt).includes('[RESTRICTIONS]'), false);
  assert.deepEqual(auditH3ShotContract({ prompt, durationSeconds: 9, dialogue: '快递员：请收好。' }), []);
});

test('combat pacing is editorial and does not block a save', () => {
  const broad = '[Shot 1] At 00:02 to 00:04 <Subject 1> swings the polearm while <Subject 2> evades and the blade breaks. At 00:08 to 00:12 <Subject 1> retreats and the formation follows into the passage.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(broad), durationSeconds: 12 }), []);
  const stalled = '[Shot 1] At 00:01 <Subject 1> sweeps the polearm and <Subject 2> dodges. At 00:04 the passage narrows. At 00:08 <Subject 1> stops giving ground and the formation comes to a halt, then surrounds him by 00:10.';
  assert.deepEqual(auditH3ShotContract({ prompt: refPrompt(stalled), durationSeconds: 10 }), []);
});

test('contract audit stays quiet on a clean simple shot', () => {
  const clean = refPrompt('[Shot 1] <Subject 1> crosses the room and hands over the parcel. <Subject 2> takes it. No one speaks.');
  assert.deepEqual(auditH3ShotContract({ prompt: clean, durationSeconds: 5 }), []);
});
