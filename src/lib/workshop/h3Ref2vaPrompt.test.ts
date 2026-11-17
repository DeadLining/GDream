import * as refAuthoring from './ref2vaAuthoring.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditRef2vaPrompt, bindRef2vaVoiceIds, canonicalizeRef2vaSpeakerBindings, canonicalRef2vaDialogueLines, ensureRef2vaDialogueTags, foldRef2vaAuxiliaryLabels, ref2vaDialogueLedger, ref2vaPreviousShotReferenceInstruction, ref2vaStructureIssues, H3_REF2VA_SKILL, normalizeRef2vaDialogue, validateRef2vaStructure } from './h3Ref2vaPrompt.ts';
import { h3PromptWritingSkillForTask } from './h3PromptWritingSkill.ts';
import * as timingPolicy from './shotTimingPolicy.ts';
import { REF2VA_GUIDE } from './h3Ref2vaSkillContent.ts';
import { ref2vaOpeningFrameInstruction } from './h3Ref2vaPrompt.ts';

const wrapTimeline = (text: string) => `subject_definitions:\nsummary:\nretention_analysis:\ndetailed_description:\n${text}\noverall_soundscape:\nnon_diegetic_music:`;

test('Ref2VA uses the persisted two-stage action plan before six-section formatting', () => {
  assert.match(REF2VA_SKILL, /Two-stage execution/);
  assert.match(REF2VA_SKILL, /persist.*Layer 1 action timeline/i);
  assert.match(REF2VA_SKILL, /3–5 meaningful beats/i);
  assert.match(REF2VA_SKILL, /whole-shot fallback/i);
});
test('reference skill is independent and does not replace the I2VA skill', () => {
  assert.equal(h3PromptWritingSkillForTask('ref2va'), H3_REF2VA_SKILL);
  const original = h3PromptWritingSkillForTask('i2va');
  assert.doesNotMatch(original, /Independent adaptation/);
  assert.match(original, /I2VA INHERITANCE BOUNDARY/);
  assert.match(H3_REF2VA_SKILL, /# H3 Prompt Writing/);
  assert.match(H3_REF2VA_SKILL, /## Full-Reference Mode/);
  assert.match(H3_REF2VA_SKILL, /Complete Reference Mode Guide/);
});
test('six section dialogue normalizer preserves intended turns only in timeline', () => {
  const line = '<d>[Chinese] 我知道。</d>';
  const prompt = `subject_definitions: Two speakers.\nsummary: ${line}\nretention_analysis: Preserve identities.\ndetailed_description: [Shot 1] S1 ${line} S2 ${line}\noverall_soundscape: N/A\nnon_diegetic_music: N/A`;
  const result = normalizeRef2vaDialogue(prompt);
  assert.equal((result.match(/<d>/g) ?? []).length, 2);
  assert.equal(validateRef2vaStructure(result), true);
  assert.equal(normalizeRef2vaDialogue(result), result);
  assert.equal(validateRef2vaStructure(result + '\n[ACTION_ENGINE]'), false);
});

test('ref2va parses speaker language annotations, quotes and localizes exact turns', () => {
  const source = '佐助（日语）：「ここはどこだ。てめえは誰だ。」\n二郎神（上古神言）：「放下兵器，退出界外。」';
  assert.deepEqual(canonicalRef2vaDialogueLines(source), ['ここはどこだ。てめえは誰だ。', '放下兵器，退出界外。']);
  const ledger = ref2vaDialogueLedger(source);
  assert.match(ledger, /"speaker":"佐助"/);
  assert.match(ledger, /"language":"Japanese"/);
  assert.match(ledger, /"requiredDialogueTag":"<d>\[Japanese\] ここはどこだ。てめえは誰だ。<\/d>"/);
  assert.match(ledger, /"requiredDialogueTag":"<d>\[Chinese\] 放下兵器，退出界外。<\/d>"/);
  assert.match(ledger, /"speaker":"佐助","speakerId":"S1"/);
  assert.match(ledger, /"speaker":"二郎神","speakerId":"S2"/);
});

test('subject numbering is aligned with vocal order so all three cues agree', async () => {
  const { alignRef2vaSubjectNumbering, bindRef2vaVoiceIds, canonicalizeRef2vaSpeakerBindings, ensureRef2vaDialogueTags } = await import('./h3Ref2vaPrompt.ts');
  // The shot opens on the second reference character and the first-listed
  // subject is the one who answers. The draft also swapped the speakers.
  const dialogue = '佐助（日语）：「ここはどこだ。てめえは誰だ。」\n二郎神（上古神言）：「放下兵器，退出界外。」';
  const draft = `subject_definitions:
<Subject 1> (二郎神 / Erlang Shen): Based on <Picture 2>.
<Subject 2> (宇智波佐助 / Sasuke): Based on <Picture 3>.
<Subject 3> (裂谷荒原): Based on <Picture 1>.
summary:
retention_analysis:
detailed_description:
[Shot 1] <Subject 1> says <d>[Japanese] ここはどこだ。てめえは誰だ。</d> Then <Subject 2> says <d>[Chinese] 放下兵器，退出界外。</d>
overall_soundscape:
non_diegetic_music:`;
  const cleaned = bindRef2vaVoiceIds(alignRef2vaSubjectNumbering(canonicalizeRef2vaSpeakerBindings(ensureRef2vaDialogueTags(draft, dialogue), dialogue), dialogue));
  // Speaker, subject number and vocal order now describe one and the same order.
  assert.match(cleaned, /<Subject 1> \(宇智波佐助 \/ Sasuke\)/);
  assert.match(cleaned, /<Subject 2> \(二郎神 \/ Erlang Shen\)/);
  assert.match(cleaned, /<Subject 1>[^<]*\(S1\) <d>\[Japanese\]/);
  assert.match(cleaned, /<Subject 2>[^<]*\(S2\) <d>\[Chinese\]/);
  // The non-speaking subject keeps a stable label and does not collide.
  assert.match(cleaned, /<Subject 3> \(裂谷荒原\)/);
});

test('subject definition lines are listed in ascending subject order', async () => {
  const { sortRef2vaSubjectDefinitions } = await import('./h3Ref2vaPrompt.ts');
  // The definition block is read top to bottom. A subject on the first line is
  // understood as the first one in the shot, so the lines and their numbers must
  // agree — renumbering without reordering left the first speaker on line two.
  const draft = `subject_definitions:
<Subject 2> (二郎神 / Erlang Shen): Based on <Picture 2>.
<Subject 1> (宇智波佐助 / Sasuke): Based on <Picture 3>.
<Subject 3> (裂谷荒原): Based on <Picture 1>.
summary:
retention_analysis:
detailed_description:
[Shot 1] <Subject 1> (S1) says <d>[Japanese] ここはどこだ。</d> Then <Subject 2> (S2) replies <d>[Chinese] 放下兵器，退出界外。</d>
overall_soundscape:
non_diegetic_music:`;
  const sorted = sortRef2vaSubjectDefinitions(draft);
  const lines = sorted.split('subject_definitions:')[1].split('summary:')[0].trim().split('\n');
  assert.match(lines[0], /^<Subject 1> \(宇智波佐助/);
  assert.match(lines[1], /^<Subject 2> \(二郎神/);
  assert.match(lines[2], /^<Subject 3>/);
  // Text is preserved, only the line order changed.
  assert.match(sorted, /<Subject 1> \(S1\) says <d>\[Japanese\]/);
  assert.equal(sortRef2vaSubjectDefinitions(sorted), sorted);
});

test('a shot without dialogue keeps its existing subject numbering', async () => {
  const { alignRef2vaSubjectNumbering } = await import('./h3Ref2vaPrompt.ts');
  const draft = `subject_definitions:
<Subject 1> (二郎神): Based on <Picture 2>.
<Subject 2> (宇智波佐助): Based on <Picture 3>.
summary:
retention_analysis:
detailed_description:
[Shot 1] They face each other in silence.
overall_soundscape:
non_diegetic_music:`;
  assert.equal(alignRef2vaSubjectNumbering(draft, ''), draft);
  assert.equal(alignRef2vaSubjectNumbering(draft, undefined), draft);
});

test('voice ids follow vocal order, not the subject asset index', () => {
  // <Subject 2> speaks first and <Subject 1> answers. Numbering by subject index
  // would label the opening speaker (S2) and the reply (S1), contradicting the
  // guide's "order of actual vocal events" and making the model rebind voices.
  const draft = wrapTimeline('[Shot 1] <Subject 2> says <d>[Japanese] ここはどこだ。てめえは誰だ。</d> Then <Subject 1> replies <d>[Chinese] 放下兵器，退出界外。</d>');
  const bound = bindRef2vaVoiceIds(draft);
  assert.match(bound, /<Subject 2> says \(S1\) <d>\[Japanese\]/);
  assert.match(bound, /<Subject 1> replies \(S2\) <d>\[Chinese\]/);
});

test('voice numbering is reassigned over a stale subject-index draft', () => {
  const draft = wrapTimeline('[Shot 1] <Subject 2> (S2) says <d>[Japanese] ここはどこだ。てめえは誰だ。</d> Then <Subject 1> (S1) replies <d>[Chinese] 放下兵器，退出界外。</d>');
  const bound = bindRef2vaVoiceIds(draft);
  assert.match(bound, /<Subject 2> says \(S1\) <d>\[Japanese\]/);
  assert.match(bound, /<Subject 1> replies \(S2\) <d>\[Chinese\]/);
  // The stale subject-index ids do not survive anywhere in the timeline.
  assert.doesNotMatch(bound, /<Subject 2> \(S2\)/);
  assert.doesNotMatch(bound, /<Subject 1> \(S1\)/);
});

test('all timeline voice marker variants are reassigned while literal spoken markers remain intact', () => {
  const draft = wrapTimeline('[Shot 1] <Subject 2> [S2] says in a quiet voice. (S2) After a pause she says <d>[Chinese] 知道了。</d> <Subject 1> (S1; speaker) replies <d>[English] The code is (S9).</d>');
  const bound = bindRef2vaVoiceIds(draft);
  assert.doesNotMatch(bound, /\[S2\]|\(S1; speaker\)/);
  assert.match(bound, /she says \(S1\) <d>/);
  assert.match(bound, /<Subject 1> replies \(S2\) <d>/);
  assert.match(bound, /<d>\[English\] The code is \(S9\)\.<\/d>/);
});

test('voice cleanup synchronizes definitions so long delivery prose passes final preflight', async () => {
  const { auditH3ShotContract } = await import('./h3ShotContract.ts');
  const draft = wrapTimeline(`[Shot 1] <Subject 2> looks down at the recorder. ${'She steadies her hand and takes a breath. '.repeat(5)} She says <d>[Chinese] 知道了。</d>`)
    .replace('subject_definitions:', 'subject_definitions:\n<Subject 1> is the silent clerk.\n<Subject 2> is the young woman from <Picture 2>.');
  const bound = bindRef2vaVoiceIds(draft);
  assert.match(bound, /<Subject 2> speaker voice \(S1\)\./);
  assert.deepEqual(auditH3ShotContract({ prompt: bound }), []);
  assert.equal(bindRef2vaVoiceIds(bound), bound);
});

test('definition voice descriptions follow reassigned vocal order without giving listeners a voice', async () => {
  const { auditH3ShotContract } = await import('./h3ShotContract.ts');
  const draft = wrapTimeline('[Shot 1] <Subject 2> (S2) says <d>[Chinese] 还在吗？</d> <Subject 1> (S1) replies <d>[Chinese] 还在。</d>')
    .replace('subject_definitions:', 'subject_definitions:\n<Subject 1> is the clerk. (S1) is his low speaker voice.\n<Subject 2> is the woman. (S2) is her soft speaker voice.\n<Subject 3> is a silent listener.');
  const bound = bindRef2vaVoiceIds(draft);
  assert.match(bound, /\(S2\) is his low speaker voice/);
  assert.match(bound, /\(S1\) is her soft speaker voice/);
  assert.doesNotMatch(bound, /<Subject 3> speaker voice/);
  assert.deepEqual(auditH3ShotContract({ prompt: bound }), []);
  assert.deepEqual(auditRef2vaPrompt(bound, '女子：还在吗？\n店员：还在。'), []);
});

test('synchronized voice declarations do not replace character names on a subsequent cleanup', async () => {
  const { alignRef2vaSubjectNumbering } = await import('./h3Ref2vaPrompt.ts');
  const draft = wrapTimeline('[Shot 1] <Subject 2> says <d>[Chinese] 还在吗？</d> <Subject 1> replies <d>[Chinese] 还在。</d>')
    .replace('subject_definitions:', 'subject_definitions:\n<Subject 1> (店员): clerk from <Picture 1>.\n<Subject 2> (女子): woman from <Picture 2>.');
  const aligned = alignRef2vaSubjectNumbering(bindRef2vaVoiceIds(draft), '女子：还在吗？\n店员：还在。');
  assert.match(aligned, /<Subject 1> \(女子\)/);
  assert.match(aligned, /<Subject 2> \(店员\)/);
});

test('overlapping questions and replies retain intentional repetitions and detect real extra replies', () => {
  const dialogue = '女子：还在吗？\n店员：还在。\n女子：还在吗？\n店员：还在。';
  const draft = wrapTimeline('[Shot 1] <Subject 1> (S1) says <d>[Chinese] 还在吗？</d> <Subject 2> (S2) replies <d>[Chinese] 还在。</d> <Subject 1> (S1) says <d>[Chinese] 还在吗？</d> <Subject 2> (S2) replies <d>[Chinese] 还在。</d>');
  assert.deepEqual(auditRef2vaPrompt(draft, dialogue), []);
  assert.ok(auditRef2vaPrompt(draft.replace('overall_soundscape:', '<Subject 2> (S2) says <d>[Chinese] 还在。</d>\noverall_soundscape:'), dialogue).some((issue) => /重复出现.*应有 2 次，实际 3 次/u.test(issue)));
  assert.ok(auditRef2vaPrompt(draft.replace('<d>[Chinese] 还在。</d>', '<d>[Chinese] 好的。</d>'), dialogue).some((issue) => /缺少原文对白/u.test(issue)));
});

test('ref2va formatting repairs only supplied dialogue already present in the timeline', () => {
  const source = '佐助（日语）：「ここはどこだ。てめえは誰だ。」\n二郎神（上古神言）：「放下兵器，退出界外。」';
  const draft = wrapTimeline('[Shot 1] <Subject 2> shouts in Japanese: 佐助（日语）：「ここはどこだ。てめえは誰だ。」. [Shot 2] <Subject 1> commands: 二郎神（上古神言）：「放下兵器，退出界外。」.');
  const repaired = bindRef2vaVoiceIds(ensureRef2vaDialogueTags(draft, source));
  assert.match(repaired, /<d>\[Japanese\] ここはどこだ。てめえは誰だ。<\/d>/);
  assert.match(repaired, /<d>\[Chinese\] 放下兵器，退出界外。<\/d>/);
  assert.deepEqual(auditRef2vaPrompt(repaired, source), []);
  assert.equal(ensureRef2vaDialogueTags(wrapTimeline('[Shot 1] <Subject 2> raises his blade.'), source).includes('<d>'), false);
});
test('ref2va route bypasses first-frame common instructions', () => {
  const source = readFileSync(new URL('./workshopPrompts.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(String\(input.task\) === 'ref2va'\) return .*rewriteRef2vaPrompt\(\{ \.\.\.input, spatialStagingDirective \}, options\)/);
  const route = readFileSync(new URL('./rewriteRef2vaPrompt.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /repairI2vaBoundary\(|H3_DIRECTING_POLICY/);
});

test('ordinary profile framing of an established body is not a duplicate-position hazard', () => {
  const prompt = `subject_definitions:
summary:
retention_analysis:
detailed_description:
[Shot 1] <Subject 2> stands behind the desk. <Subject 2> remains at the frame edge in profile. <Subject 2> (S1) says <d>[Chinese] 接令。</d>
overall_soundscape:
non_diegetic_music:`;
  const issues = auditRef2vaPrompt(prompt, '周瑜：接令。');
  assert.deepEqual(issues, []);
});

test('speaker visibility staging is guidance and does not block the save', () => {
  const hidden = wrapTimeline('[Shot 1] The camera looks past <Subject 2> from behind; only the back of his head is visible. <Subject 2> (S1) says <d>[Chinese] 跟我走。</d>');
  assert.deepEqual(auditRef2vaPrompt(hidden, '向导：跟我走。'), []);
  const revealed = wrapTimeline('[Shot 1] <Subject 2> starts in a rear view, face hidden. He turns into a three-quarter view; his face and mouth are visible. <Subject 2> (S1) says <d>[Chinese] 跟我走。</d>');
  assert.deepEqual(auditRef2vaPrompt(revealed, '向导：跟我走。'), []);
});

const wholeLine = '这是我的山，也是你们的命。守住它，不是站在这里等死。';
test('regression: full canonical line survives typography, multiple mentions, background listeners and motion', () => {
  const result = wrapTimeline(`[Shot 1] <Subject 2> stands on the left. <Subject 3> sits in the background. <Subject 2> (S1) says <d>[Chinese] 这是我的山, 也是你们的命。\n守住它，不是站在这里等死！</d> <Subject 2> walks toward the camera, shown in profile. <Subject 3> stays behind him.`);
  assert.deepEqual(auditRef2vaPrompt(result, `孙悟空：${wholeLine}`), []);
});
test('same-speaker sequential chunks are complete; different speakers cannot jointly satisfy one line', () => {
  const chunks = (second: number) => wrapTimeline(`[Shot 1] <Subject 2> (S1) says <d>[Chinese] 这是我的山，也是你们的命。</d> [Shot 2] <Subject ${second}> continues <d>[Chinese] 守住它，不是站在这里等死。</d>`);
  assert.deepEqual(auditRef2vaPrompt(chunks(2), `孙悟空：${wholeLine}`), []);
  assert.ok(auditRef2vaPrompt(chunks(3), `孙悟空：${wholeLine}`).some((s) => s.includes('缺少原文对白')));
});
test('real omission and unintended repetition still fail, intentional repeated turns remain allowed', () => {
  const short = wrapTimeline('[Shot 1] <Subject 2> says <d>[Chinese] 这是我的山，也是你们的命。</d>');
  assert.ok(auditRef2vaPrompt(short, `孙悟空：${wholeLine}`).some((s) => s.includes('缺少原文对白')));
  const repeated = wrapTimeline('[Shot 1] <Subject 2> says <d>[Chinese] 接令。</d> <Subject 3> says <d>[Chinese] 接令。</d>');
  assert.ok(auditRef2vaPrompt(repeated, '甲：接令。').some((s) => s.includes('重复出现')));
  assert.deepEqual(auditRef2vaPrompt(repeated, '甲：接令。\n乙：接令。'), []);
});
test('explicit physical duplicate assertions fail, but negations and spoken words are not body placement', () => {
  assert.ok(auditRef2vaPrompt(wrapTimeline('[Shot 1] A second body of <Subject 2> stands beside him.')).some((s) => s.includes('多个身体')));
  assert.deepEqual(auditRef2vaPrompt(wrapTimeline('[Shot 1] No second body of <Subject 2> appears. <Subject 2> turns in profile.')), []);
  assert.deepEqual(auditRef2vaPrompt(wrapTimeline('[Shot 1] <Subject 2> says <d>[English] A second body of <Subject 3>.</d>')), []);
});
test('route provides exact full-turn ledger for initial generation and targeted repair', () => {
  const source = readFileSync(new URL('./rewriteRef2vaPrompt.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/ref2vaDialogueLedger\(input.dialogue\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /establish one visible position for each physical Subject/);
  assert.match(source, /resolveShotTiming\(/);
  assert.match(source, /readH3TimedPrompt\(/);
  assert.doesNotMatch(source, /Math.min\(30,/);
});

test('canonical fields, content and shot order are required; unresolved references still fail', async () => {
  const { ref2vaStructureIssues } = await import('./h3Ref2vaPrompt.ts');
  assert.ok(ref2vaStructureIssues('A locked shot holds on the empty street. Rain taps the pavement.').some((issue) => /缺少.*字段/.test(issue)));
  assert.deepEqual(ref2vaStructureIssues(''), ['缺少视频提示词']);
  assert.deepEqual(ref2vaStructureIssues('REFERENCE_BINDING_UNRESOLVED'), ['参考对应无法确认（REFERENCE_BINDING_UNRESOLVED），请核对参考图片与主体身份']);
  const valid = 'subject_definitions: A street from <Picture 1>.\nsummary: [reference generation] An empty street.\nretention_analysis: Preserve the layout.\ndetailed_description: [Shot 1] Rain falls.\noverall_soundscape: Rain.\nnon_diegetic_music: N/A';
  assert.deepEqual(ref2vaStructureIssues(valid), []);
  assert.ok(ref2vaStructureIssues(valid.replace('subject_definitions: A street from <Picture 1>.\nsummary: [reference generation] An empty street.', 'summary: An empty street.\nsubject_definitions: A street from <Picture 1>.')).some((issue) => /顺序/.test(issue)));
  assert.ok(ref2vaStructureIssues(valid.replace('non_diegetic_music: N/A', 'non_diegetic_music:')).some((issue) => /不能为空/.test(issue)));
  assert.ok(ref2vaStructureIssues(valid + '\n[ACTION_ENGINE]').some((issue) => /旧分块台账/.test(issue)));
});

test('an explicit per-shot choice promotes the previous tail to the authored first frame', () => {
  const refs = [{ path: '/actor.png' }, { path: '/tail.png' }];
  const instruction = ref2vaPreviousShotReferenceInstruction(
    refs,
    '/tail.png',
    JSON.stringify({ exitState: { characters: 'Sasuke is on one knee with Kusanagi already in his right hand.' } }),
    true,
  );
  assert.match(instruction, /FIRST-FRAME ANCHOR \(EXPLICIT USER REQUEST\): <Picture 2>/);
  assert.match(instruction, /required visual starting frame at 00:00\.000/);
  assert.match(instruction, /matching that Picture and describe its actual visible composition/);
  assert.match(instruction, /on one knee with Kusanagi already in his right hand/);
  assert.match(instruction, /does not force the current shot's ending composition/);
  assert.doesNotMatch(instruction, /OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE/);
});

test('same-scene tail aligns to its actual Picture index without forcing a boundary frame', () => {
  const refs = [{ path: '/scene.png' }, { kind: '音频', path: '/voice.wav' }, { path: '/actor.png' }, { path: '/tail.png' }];
  const instruction = ref2vaPreviousShotReferenceInstruction(refs, '/tail.png');
  assert.match(instruction, /OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE: <Picture 3>/);
  assert.match(instruction, /not a required first frame, keyframe, or last frame/);
  assert.match(instruction, /may choose its own opening composition/);
  assert.doesNotMatch(ref2vaPreviousShotReferenceInstruction(refs), /OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE/);
  assert.throws(() => ref2vaPreviousShotReferenceInstruction(refs, '/missing.png'), /未包含/);
});

test('accepted tail is optional continuity rather than a forced opening or ending', () => {
  const source = '佐助（日语）：「ここはどこだ。てめえは誰だ。」';
  const freeOpening = wrapTimeline('[Shot 1] The camera opens on a low side angle as <Subject 2> turns toward the splintered ridge. <Picture 7> is available only as continuity context for costume and prop state. <Subject 2> (S2) <d>[Japanese] ここはどこだ。てめえは誰だ。</d>');
  assert.deepEqual(auditRef2vaPrompt(freeOpening, source, '/tail.png'), []);
  const endingOnDetail = wrapTimeline('[Shot 1] <Subject 2> drives forward and the action ends on his hand tightening around the hilt; <Picture 7> is not treated as the final composition. <Subject 2> (S2) <d>[Japanese] ここはどこだ。てめえは誰だ。</d>');
  assert.deepEqual(auditRef2vaPrompt(endingOnDetail, source, '/tail.png'), []);
});




test('dialogue speaker binding follows the script instead of the draft', () => {
  const dialogue = '佐助（日语）：「ここはどこだ。てめえは誰だ。」\n二郎神（上古神言）：「放下兵器，退出界外。」';
  const draft = `subject_definitions:
<Subject 1> (二郎神): Based on <Picture 2>.
<Subject 2> (佐助): Based on <Picture 3>.
summary:
retention_analysis:
detailed_description:
[Shot 1] <Subject 1> says <d>[Japanese] ここはどこだ。てめえは誰だ。</d> Then <Subject 2> says <d>[Chinese] 放下兵器，退出界外。</d>
overall_soundscape:
non_diegetic_music:`;
  const fixed = canonicalizeRef2vaSpeakerBindings(draft, dialogue);
  // The draft swapped the speakers; the script reassigns each line to its own
  // subject. Voice ids are a separate, order-derived concern.
  assert.match(fixed, /<Subject 2>[^\n]*<d>\[Japanese\]/);
  assert.match(fixed, /<Subject 1>[^\n]*<d>\[Chinese\]/);
  assert.doesNotMatch(fixed, /<Subject 1>[^\n]*<d>\[Japanese\]/);
  const numbered = bindRef2vaVoiceIds(fixed);
  assert.match(numbered, /<Subject 2>[^<]*\(S1\) <d>\[Japanese\]/);
  assert.match(numbered, /<Subject 1>[^<]*\(S2\) <d>\[Chinese\]/);
  assert.deepEqual(auditRef2vaPrompt(numbered, dialogue), []);
});

test('a line split across an in-shot cut keeps its original speaker', () => {
  const dialogue = '朱元璋：「按轮值上！补给别断！」';
  const draft = `subject_definitions:
<Subject 1> (朱元璋): Based on <Picture 1>.
<Subject 2> (守卫): Based on <Picture 2>.
summary:
retention_analysis:
detailed_description:
[Shot 1] <Subject 1> turns toward the defenders and says <d>[Chinese] 按轮值上！</d>
[Shot 2] At 00:02.000, the camera cuts to a close-up of <Subject 2> listening. The same order continues without interruption: <d>[Chinese] 补给别断！</d>
overall_soundscape:
non_diegetic_music:`;
  const fixed = canonicalizeRef2vaSpeakerBindings(draft, dialogue);
  const continuation = fixed.slice(fixed.indexOf('[Shot 2]'));
  const atLine = continuation.indexOf('<d>[Chinese] 补给别断！</d>');
  const subjectsBeforeLine = [...continuation.slice(0, atLine).matchAll(/<Subject\s+(\d+)>/gu)];
  assert.equal(subjectsBeforeLine[subjectsBeforeLine.length - 1]?.[1], '1');
  const numbered = bindRef2vaVoiceIds(fixed);
  const numberedContinuation = numbered.slice(numbered.indexOf('[Shot 2]'));
  assert.match(numberedContinuation, /\(S1\) <d>\[Chinese\] 补给别断！<\/d>/);
  assert.deepEqual(auditRef2vaPrompt(numbered, dialogue), []);
});

test('an explicit wrong speaker after a cut is replaced, not duplicated', () => {
  const dialogue = '朱元璋：「按轮值上！补给别断！」';
  const draft = `subject_definitions:
<Subject 1> (朱元璋): Based on <Picture 1>.
<Subject 2> (守卫): Based on <Picture 2>.
summary:
retention_analysis:
detailed_description:
[Shot 1] <Subject 1> begins <d>[Chinese] 按轮值上！</d>
[Shot 2] At 00:02.000, the camera cuts to <Subject 2>. <Subject 2> (S2) continues <d>[Chinese] 补给别断！</d>
overall_soundscape:
non_diegetic_music:`;
  const fixed = canonicalizeRef2vaSpeakerBindings(draft, dialogue);
  const continuation = fixed.slice(fixed.indexOf('[Shot 2]'));
  const atLine = continuation.indexOf('<d>[Chinese] 补给别断！</d>');
  const subjectsBeforeLine = [...continuation.slice(0, atLine).matchAll(/<Subject\s+(\d+)>/gu)];
  assert.equal(subjectsBeforeLine[subjectsBeforeLine.length - 1]?.[1], '1');
  assert.equal(subjectsBeforeLine.filter((match) => match[1] === '2').length, 1);
});

test('spatial staging choices are guidance and do not block a factual prompt', () => {
  const level = wrapTimeline('The camera is level. Sun Wukong and the army are both visible in the frame.');
  assert.deepEqual(auditRef2vaPrompt(level), []);
  const layered = wrapTimeline('The camera looks upward from the ground. Sun Wukong anchors the lower foreground while the cloud-borne army occupies the upper frame above him.');
  assert.deepEqual(auditRef2vaPrompt(layered), []);
});

test('reference policy leaves camera and spatial choices to the shot', () => {
  assert.match(H3_REF2VA_SKILL, /camera placement, movement/i);
  assert.doesNotMatch(H3_REF2VA_SKILL, /must use an upward or low-to-high shared frame/i);
});

test('reference roles distinguish appearance from on-screen scale and mutable prop state', () => {
  assert.match(H3_REF2VA_SKILL, /subject_definitions/);
  assert.match(H3_REF2VA_SKILL, /retention_analysis/);
  assert.match(H3_REF2VA_SKILL, /Bind actual sources once/);
  assert.match(H3_REF2VA_SKILL, /not a model quality\s+requirement/);
});

test('reference writer injects the opening alignment instruction into generation and repair context', () => {
  const route = readFileSync(new URL('./rewriteRef2vaPrompt.ts', import.meta.url), 'utf8');
  assert.match(route, /ref2vaPreviousShotReferenceInstruction\(input.references, input.previousTailReferencePath, input.previousShotContext, input.previousTailAsFirstFrame\)/);
  assert.match(route, /\.\.\.messages/);
  assert.doesNotMatch(route, /FIRST-FRAME CONTINUITY ANCHOR/);
  assert.doesNotMatch(route, /OPENING FRAME CONTINUITY/);
  assert.doesNotMatch(H3_REF2VA_SKILL, /not a mandatory opening or ending keyframe/);
});

// Exercise the actual request route, with only the chat transport replaced.
// This verifies runtime skill/context delivery, not model or video quality.
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as refContract from './h3Ref2vaPrompt.ts';
import * as shotContract from './h3ShotContract.ts';
import { REF2VA_SKILL } from './h3Ref2vaSkillContent.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');

test('bundled reference policy matches both edited source files', () => {
  assert.equal(REF2VA_SKILL, readFileSync(new URL('../../../skills/h3-ref2va-prompt-writing/SKILL.md', import.meta.url), 'utf8'));
});

test('reference rewrite and one targeted repair retain actual images, facts, turns and action-led skill', async () => {
  const requests: any[] = [];
  let receivedImages: string[] = [];
  const output = (line: string) => `subject_definitions: <Subject 1> is the courier from <Picture 1>.
summary: The courier hands over a parcel.
retention_analysis: Retain the courier and the opening from <Picture 2>.
detailed_description: [Shot 1] At 00:00.000, start from the visible composition of <Picture 2>, preserving its shot size, camera height, screen positions and subject scale. <Subject 1> holds the parcel beside the counter and says (S1) <d>[Chinese] ${line}</d> She extends it across the counter, releasing it when the recipient takes its weight.
overall_soundscape: Paper rustles.
non_diegetic_music: None.`;
  const mocks: Record<string, any> = {
    './ref2vaAuthoring': refAuthoring,
    './h3Ref2vaPrompt': refContract,
    './h3ShotContract': shotContract,
    './shotTimingPolicy': timingPolicy,
    './spatialStagingDirective': { directorViewpointExecutionRuleEn: () => 'VIEWPOINT LOGIC' },
    './firstFrameRewriteChat': { createReferenceRewriteChat: async (paths: string[]) => {
      receivedImages = paths;
      return async (messages: any[]) => { requests.push(messages); return output(requests.length === 1 ? '请收好。' : '请收好。这是您的包裹。'); };
    } },
  };
  const source = readFileSync(new URL('./rewriteRef2vaPrompt.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(mocks[name], name); return mocks[name]; } });
  const facts = 'Courier passes parcel to the recipient; both remain at the counter.';
  const dialogue = '快递员：请收好。这是您的包裹。';
  const result = await exports.rewriteRef2vaPrompt({
    references: [{ label: '快递员', path: '/courier.png' }, { label: '上一镜尾帧', path: '/tail.png' }],
    previousTailReferencePath: '/tail.png', previousShotContext: 'Courier arrived at the counter.',
    duration: 8, ratio: '16:9', dialogue, factualContext: facts, prompt: 'Legacy staging',
  });
  assert.deepEqual(Array.from(receivedImages), ['/courier.png', '/tail.png']);
  assert.equal(requests.length, 2);
  assert.equal(requests[0][0].content, requests[1][0].content);
  assert.ok(requests[0][0].content.includes(REF2VA_SKILL));
  assert.ok(requests[0][1].content.includes(facts));
  assert.ok(requests[0][1].content.includes(dialogue));
  assert.ok(requests[0][1].content.includes('Courier arrived at the counter.'));
  assert.ok(requests[0][1].content.includes('OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE: <Picture 2>'));
  assert.ok(requests[0][1].content.includes('REFERENCE ROLES:'));
  assert.ok(requests[0][1].content.includes('CAMERA AND SPACE:'));
  assert.ok(requests[1][2].content.includes('请收好。这是您的包裹。'));
  assert.deepEqual(auditRef2vaPrompt(result, dialogue), []);
  assert.equal(result, bindRef2vaVoiceIds(output('请收好。这是您的包裹。')));
});

function timingRouteFixture(responses: string[], overrides: Record<string, unknown> = {}) {
  const calls: any[] = [];
  const mocks: Record<string, any> = {
    './ref2vaAuthoring': refAuthoring,
    './h3Ref2vaPrompt': refContract,
    './h3ShotContract': shotContract,
    './shotTimingPolicy': timingPolicy,
    './spatialStagingDirective': { directorViewpointExecutionRuleEn: () => 'VIEWPOINT LOGIC' },
    './firstFrameRewriteChat': { createReferenceRewriteChat: async () => async (messages: any[]) => {
      calls.push(messages);
      assert.ok(calls.length <= responses.length, 'unexpected automatic retry');
      return responses[calls.length - 1];
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./rewriteRef2vaPrompt.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(mocks[name], name); return mocks[name]; } });
  const input = { references: [{ label: '角色', path: '/actor.png' }], duration: 9, dialogue: '向导：跟我走。', prompt: 'Old prompt', ...overrides };
  let resolvedDuration: number | undefined;
  return { calls, run: () => exports.rewriteRef2vaPrompt(input, { onDurationResolved: (seconds: number) => { resolvedDuration = seconds; } }), duration: () => resolvedDuration };
}
const cleanTimingPrompt = `subject_definitions: <Subject 1> is the guide from <Picture 1>.
<Subject 1> speaker voice (S1).
summary: The guide leads the group.
retention_analysis: Retain the guide's appearance.
detailed_description: [Shot 1] At 00:01–00:03, <Subject 1> turns toward the path and says (S1) <d>[Chinese] 跟我走。</d> The group follows. By 00:09 the guide is beside the gate, with the group and path visible behind.
overall_soundscape: Footsteps and wind.
non_diegetic_music: None.`;

test('reference writer resolves natural duration and strips internal timing metadata', async () => {
  const draft = cleanTimingPrompt.replace('00:09', '00:12');
  const fixture = timingRouteFixture([`H3_EFFECTIVE_DURATION: 12 seconds\n${draft}`], { duration: 5 });
  assert.equal(await fixture.run(), draft);
  assert.equal(fixture.duration(), 12);
  assert.match(fixture.calls[0][1].content, /planning references/);
  assert.match(fixture.calls[0][1].content, /natural pace/);
  assert.equal(fixture.calls.length, 1);
});

test('reference writer refuses an out-of-budget duration without retry', async () => {
  const fixture = timingRouteFixture([`H3_EFFECTIVE_DURATION: 20 seconds\n${cleanTimingPrompt}`]);
  await assert.rejects(fixture.run(), /H3_TIMING_UNRESOLVED/);
  assert.equal(fixture.duration(), undefined);
  assert.equal(fixture.calls.length, 1);
});

test('reference writer shortens oversized saved references without a false pre-model veto', async () => {
  const draft = cleanTimingPrompt.replace('00:09', '00:05');
  for (const duration of [13, 17, 60]) {
    const fixture = timingRouteFixture([`H3_EFFECTIVE_DURATION: 5 seconds\n${draft}`], { duration });
    assert.equal(await fixture.run(), draft);
    assert.equal(fixture.duration(), 5);
    assert.equal(fixture.calls.length, 1);
    assert.match(fixture.calls[0][1].content, /Feasible effective duration: 4-15 seconds/);
  }
});

test('leaked timing diagnosis is rescheduled through one repair, not silently stripped', async () => {
  const bad = cleanTimingPrompt.replace('The guide leads the group.', 'DURATION_CONFLICT: speech timing remains unresolved.');
  const fixture = timingRouteFixture([bad, cleanTimingPrompt]);
  assert.equal(await fixture.run(), cleanTimingPrompt);
  assert.equal(fixture.calls.length, 2);
  assert.ok(fixture.calls[1][2].content.includes('不要只删除诊断文字'));
  assert.ok(fixture.calls[1][2].content.includes(bad));
});

test('genuine timing failure is surfaced separately on initial or repair response', async () => {
  const failure = 'REF2VA_TIMING_UNRESOLVED: Dialogue must start at 8s and end at 9s, but contains three full sentences.';
  for (const responses of [[failure], [cleanTimingPrompt.replace('The guide leads the group.', 'DURATION_CONFLICT'), failure]]) {
    const fixture = timingRouteFixture(responses);
    await assert.rejects(fixture.run(), /参考模式排时未完成.*未覆盖原提示词/s);
    assert.equal(fixture.calls.length, responses.length);
  }
});

test('persistent diagnostic leakage stops after the existing single repair', async () => {
  const bad = cleanTimingPrompt.replace('The guide leads the group.', 'DURATION_CONFLICT');
  const fixture = timingRouteFixture([bad, bad]);
  await assert.rejects(fixture.run(), /未通过内容预检/);
  assert.equal(fixture.calls.length, 2);
});

test('timing check leaves scripted diagnostic words and ordinary fast speech untouched', () => {
  const spoken = cleanTimingPrompt.replace('跟我走。', 'DURATION_CONFLICT');
  assert.deepEqual(auditRef2vaPrompt(spoken, '向导：DURATION_CONFLICT'), []);
  assert.deepEqual(auditRef2vaPrompt(cleanTimingPrompt.replace('00:01–00:03', '00:01–00:01.2'), '向导：跟我走。'), []);
});

test('summary shot wording is editorial and does not block a rewrite', async () => {
  const multi = cleanTimingPrompt
    .replace('The guide leads the group.', 'A single 9-second shot follows the guide and the group.')
    .replace('The group follows.', '\n[Shot 2] At 00:03.000, the group follows.');
  const fixture = timingRouteFixture([multi]);
  assert.equal(await fixture.run(), multi);
  assert.equal(fixture.calls.length, 1);
});

test('accepted preceding tail is stated as optional continuity context', () => {
  const instruction = ref2vaPreviousShotReferenceInstruction([{ path: '/tail.png' }], '/tail.png');
  assert.match(instruction, /OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE: <Picture 1>/);
  assert.match(instruction, /not a required first frame, keyframe, or last frame/);
});


test('authoring guidance stays positive and out of the finished prompt', () => {
  const route = readFileSync(new URL('./rewriteRef2vaPrompt.ts', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('./h3ShotContract.ts', import.meta.url), 'utf8');
  assert.match(contract, /never copy these notes into the prompt/i);
  assert.match(route, /not a compliance checklist/i);
  assert.match(route, /Preserve explicit user constraints concisely/i);
  assert.doesNotMatch(route, /Never write "No dialogue" or omit a supplied turn/);
});

test('auxiliary labels are removed without deleting their camera content', () => {
  const prompt = `subject_definitions:\n<Subject 1> is the guide.\nsummary: A shot.\nretention_analysis: Retain the guide.\ndetailed_description:\n[Shot 1] <Subject 1> crosses the path.\nCAMERA: Low angle, slow push in, then a tilt up to the tower.\nCONTINUITY: He keeps his footing.\noverall_soundscape: Wind.\nnon_diegetic_music: None.`;
  const folded = foldRef2vaAuxiliaryLabels(prompt);
  assert.doesNotMatch(folded, /^CAMERA:|^CONTINUITY:/m);
  // Camera movement is real shot design; dropping the label must not drop it.
  assert.match(folded, /slow push in, then a tilt up to the tower/);
  assert.match(folded, /keeps his footing/);
  assert.match(folded, /crosses the path/);
  assert.deepEqual(ref2vaStructureIssues(folded), []);
});

test('reference mode does not impose a medium ending', () => {
  assert.doesNotMatch(H3_REF2VA_SKILL, /final timed beat.*medium-distance composition/);
  assert.doesNotMatch(H3_REF2VA_SKILL, /Do not.*end on an isolated detail/);
  assert.match(ref2vaPreviousShotReferenceInstruction([{ path: '/closeup-tail.png' }], '/closeup-tail.png'), /OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE: <Picture 1>/);
  // First-frame mode's independent policy is deliberately unchanged.
  assert.match(h3PromptWritingSkillForTask('i2va'), /I2VA INHERITANCE BOUNDARY/);
});

test('reference route accepts a detail ending without adding a medium return', async () => {
  const detail = cleanTimingPrompt.replace('By 00:09 the guide is beside the gate, with the group and path visible behind.', 'By 00:09 the camera closes on the guide’s hand releasing the gate latch.');
  const fixture = timingRouteFixture([detail]);
  assert.equal(await fixture.run(), detail);
  assert.equal(fixture.calls.length, 1);
});

test('merged route repairs a partial envelope once using the canonical headings', async () => {
  const fixture = timingRouteFixture(['summary: incomplete draft', cleanTimingPrompt]);
  assert.equal(await fixture.run(), cleanTimingPrompt);
  assert.equal(fixture.calls.length, 2);
  assert.match(fixture.calls[1][2].content, /缺少 H3 统一格式字段/);
  assert.match(fixture.calls[1][2].content, /canonical six-field format/);
});

test('merged route never retries unresolved identity as a formatting issue', async () => {
  const fixture = timingRouteFixture(['REFERENCE_BINDING_UNRESOLVED']);
  await assert.rejects(fixture.run(), /参考对应无法确认.*未覆盖原提示词/s);
  assert.equal(fixture.calls.length, 1);
});

test('reference route repairs free-form and partial drafts into the canonical envelope once', async () => {
  const binding = '<Subject 1> (向导): face and coat from <Picture 1>.';
  const event = '<Subject 1> (S1) says <d>[Chinese] 跟我走。</d> The listener nods; the guide steps toward the gate. Footsteps recede.';
  for (const draft of [
    `${binding}\nA held eye-level two-shot. ${event}`,
    `${binding}\n0-3s: ${event}\n3-9s: The camera tracks toward the gate and settles beside the guide.`,
    `subject_definitions:\n${binding}\ndetailed_description:\n${event}`,
    `${binding}\nintegrated_multimodal_description: ${event}\noverall_soundscape: Footsteps.`,
  ]) {
    const fixture = timingRouteFixture([draft, cleanTimingPrompt]);
    const result = await fixture.run();
    assert.equal(fixture.calls.length, 2, 'format repair is bounded to one text request');
    assert.equal((result.match(/<d>/gu) ?? []).length, 1);
    assert.deepEqual(auditRef2vaPrompt(result, '向导：跟我走。'), []);
    assert.deepEqual(shotContract.auditH3ShotContract({ prompt: result }), []);
    assert.deepEqual(ref2vaStructureIssues(result), []);
  }
});

test('headerless dialogue still aligns canonical speakers, voice identities and repeated turns', () => {
  const dialogue = '阿甲：等等。\n阿乙：怎么了？\n阿甲：等等。';
  const draft = `<Subject 1> (阿乙): appearance from <Picture 1>.
<Subject 2> (阿甲): appearance from <Picture 2>.
A steady two-shot. <Subject 1> says <d>[Chinese] 等等。</d>
<Subject 2> replies <d>[Chinese] 怎么了？</d>
<Subject 1> repeats <d>[Chinese] 等等。</d> The other person stops.`;
  const cleaned = bindRef2vaVoiceIds(refContract.alignRef2vaSubjectNumbering(canonicalizeRef2vaSpeakerBindings(draft, dialogue), dialogue));
  assert.match(cleaned, /<Subject 1> \(阿甲\)/);
  assert.match(cleaned, /<Subject 2> \(阿乙\)/);
  assert.equal((cleaned.match(/\(S1\) <d>\[Chinese\] 等等。/gu) ?? []).length, 2);
  assert.match(cleaned, /\(S2\) <d>\[Chinese\] 怎么了？/u);
  assert.deepEqual(auditRef2vaPrompt(cleaned, dialogue), []);
  assert.match(auditRef2vaPrompt(cleaned.replace('怎么了？', '怎么？'), dialogue).join(';'), /缺少原文对白/);
  assert.match(auditRef2vaPrompt(`${cleaned}\n<Subject 1> (S1) <d>[Chinese] 等等。</d>`, dialogue).join(';'), /重复出现/);
});

test('short silent reference shots keep a concise envelope without invented speech or padding', async () => {
  for (const draft of [
    'The headset follows <Picture 1>. A lateral macro track reveals the woven ear pad, then holds the approved final view. A faint motor hum fades. No score.',
    'The rainy street follows <Picture 1>. A fixed consumer-video shot holds on the bus shelter as rain strikes the roof. Slight exposure drift and tape hiss follow the recording style.',
  ]) {
    const canonical = `subject_definitions: The visible content follows <Picture 1>.\nsummary: [reference generation] A silent reference shot.\nretention_analysis: <Picture 1>: fully_preserved - appearance and style.\ndetailed_description: [Shot 1] ${draft}\noverall_soundscape: Physical sound from the event.\nnon_diegetic_music: N/A`;
    const fixture = timingRouteFixture([canonical], { dialogue: '' });
    assert.equal(await fixture.run(), canonical);
    assert.equal(fixture.calls.length, 1);
    assert.equal(canonical.includes('<d>'), false);
  }
});

test('a second malformed response is rejected rather than saved or retried again', async () => {
  const fixture = timingRouteFixture(['summary: first draft', 'summary: second draft']);
  await assert.rejects(fixture.run(), /定向修复未通过.*未覆盖原提示词/s);
  assert.equal(fixture.calls.length, 2);
});

test('opening continuity skill preserves visible object states rather than silently resetting them', () => {
  for (const text of [REF2VA_SKILL, REF2VA_GUIDE]) {
    assert.match(text, /closed laptop stays closed/i);
    assert.match(text, /unobserved state/i);
    assert.match(text, /asset references.*appearance/i);
  }
  const instruction = ref2vaOpeningFrameInstruction([{ path: '/tail.png' }], '/tail.png');
  assert.match(instruction, /closed laptop stays closed/i);
});

test('video submission validates without injecting authoring instructions', () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  assert.match(source, /validateRef2vaSubmission\(finalPrompt, refs, runtimePreviousTailPath\)/);
  assert.doesNotMatch(source, /finalPrompt = `subject_definitions:/);
  assert.doesNotMatch(source, /This is a reference image, not a required keyframe or ending/);
});


test('submission blocks contradictory legacy opening text and missing tail references', async () => {
  const { validateRef2vaSubmission } = await import('./h3Ref2vaPrompt.ts');
  const prompt = 'subject_definitions:\n<Picture 2> is the required opening. The laptop stays closed.';
  const refs = ['/scene.png', '/tail.png'];
  assert.doesNotThrow(() => validateRef2vaSubmission(prompt, refs, '/tail.png'));
  assert.equal(prompt, 'subject_definitions:\n<Picture 2> is the required opening. The laptop stays closed.');
  assert.deepEqual(refs, ['/scene.png', '/tail.png']);
  assert.throws(() => validateRef2vaSubmission(prompt + '\nThis is a reference image, not a required keyframe or ending.', refs, '/tail.png'), /旧版.*未提交/);
  assert.throws(() => validateRef2vaSubmission(prompt, ['/scene.png'], '/tail.png'), /尾帧.*未提交/);
  assert.doesNotThrow(() => validateRef2vaSubmission('A new scene.', ['/scene.png']));
});

test('Ref2VA skill turns the director process into cross-shot continuity and product-safe staging', () => {
  assert.match(H3_REF2VA_SKILL, /Director Process Layer/);
  assert.ok(H3_REF2VA_SKILL.includes("The previous shot's ending state is continuity input"));
  assert.ok(H3_REF2VA_SKILL.includes('Every camera move must answer what the viewer needs to see'));
  assert.match(H3_REF2VA_SKILL, /product|brand/i);
  assert.match(H3_REF2VA_SKILL, /music is optional|Do not default to music/i);
});

test('Ref2VA final output compresses internal continuity reasoning', () => {
  assert.match(H3_REF2VA_SKILL, /Keep the director process internal/);
  assert.match(H3_REF2VA_SKILL, /Do not repeat stable identity or global style in every beat/);
  assert.match(H3_REF2VA_SKILL, /summary.*1-2 sentences|one or two sentences/i);
});

test('compact Ref2VA output limits repetition by section responsibility', () => {
  assert.match(H3_REF2VA_SKILL, /300-700 words|compact production brief/i);
  assert.match(H3_REF2VA_SKILL, /one canonical mention|one concise mention/i);
  assert.match(H3_REF2VA_SKILL, /Do not copy the state ledger into the final prompt/i);
});

test('Ref2VA skill models dialogue and staging as visible interaction chains', () => {
  assert.match(H3_REF2VA_SKILL, /initiative.*target cue.*response.*consequence/i);
  assert.match(H3_REF2VA_SKILL, /Do not describe relationship with adjectives alone/i);
  assert.match(H3_REF2VA_SKILL, /speaker.*listener.*visible response/i);
});

test('Ref2VA skill defines priority over verbose reference and style prose', () => {
  assert.match(H3_REF2VA_SKILL, /Prompt Priority Order/);
  assert.match(H3_REF2VA_SKILL, /approved facts.*dialogue.*continuity/i);
  assert.match(H3_REF2VA_SKILL, /action and interaction/i);
  assert.match(H3_REF2VA_SKILL, /style adjectives.*lowest/i);
});

test('Ref2VA final prompts make accepted-tail continuity mandatory and declarative', () => {
  assert.match(H3_REF2VA_SKILL, /continuity.*declarative|declarative.*continuity/i);
  assert.match(H3_REF2VA_SKILL, /Do not use.*may|can reference|if available|尽量|可能/iu);
  assert.match(H3_REF2VA_SKILL, /opening state.*must|must begin/i);
});

test('Ref2VA skill keeps natural action prose inside the required six-section wrapper', () => {
  assert.match(H3_REF2VA_SKILL, /Creative Core.*Interface Wrapper/i);
  assert.match(H3_REF2VA_SKILL, /write the action prose first/i);
  assert.match(H3_REF2VA_SKILL, /Do not put analysis.*final prompt|Do not put.*analysis.*prompt/i);
  assert.match(H3_REF2VA_SKILL, /show the result through visible action/i);
});

test('structured rewrite excludes old prose on every real authoring and editorial repair request', async () => {
  const long = cleanTimingPrompt.replace('summary:', 'summary: ' + 'unchanged room furniture costume '.repeat(260));
  const f = timingRouteFixture([long, cleanTimingPrompt], {
    prompt: 'OBSOLETE_DRAFT_MUST_NOT_LEAK', factualContext: 'CANONICAL_SAVED_TIMELINE', rewriteMode: 'reconstruct',
  });
  assert.equal(await f.run(), cleanTimingPrompt);
  assert.equal(f.calls.length, 2);
  for (const messages of f.calls) {
    const payload = JSON.stringify(messages);
    assert.doesNotMatch(payload, /OBSOLETE_DRAFT_MUST_NOT_LEAK/);
    assert.match(payload, /CANONICAL_SAVED_TIMELINE/);
  }
  assert.match(f.calls[1][2].content, /EDITORIAL COMPACTION/);
});
test('editorial compaction is bounded to one pass even if the second draft is still long', async () => {
  const long = cleanTimingPrompt.replace('summary:', 'summary: ' + 'unchanged room furniture costume '.repeat(260));
  const f = timingRouteFixture([long, long]);
  assert.equal(await f.run(), long);
  assert.equal(f.calls.length, 2);
});
