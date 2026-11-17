import test from 'node:test';
import assert from 'node:assert/strict';
import { assertShotTimingFits, estimateDialogueSeconds, readH3TimedPrompt, resolveShotTiming, retimeShotTimeline, shotTimingDirectiveZh } from './shotTimingPolicy.ts';
import { formatPromptRewriteDiagnostic, suggestedRef2vaDurationFromError } from './promptRewriteDiagnostic.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as timingPolicy from './shotTimingPolicy.ts';
import * as promptContract from './h3PromptContract.ts';
import * as shotContract from './h3ShotContract.ts';
import * as writingSkill from './h3PromptWritingSkill.ts';
import * as promptFormat from './h3PromptFormat.ts';

test('speech estimate excludes names and language annotations but includes pauses and handoffs', () => {
  assert.equal(estimateDialogueSeconds(''), 0);
  assert.ok(estimateDialogueSeconds('没有标注说话人的对白也需要自然说完。') > 5);
  assert.equal(estimateDialogueSeconds('甲：你好。'), estimateDialogueSeconds('名字非常长的人（中文）：你好。'));
  assert.ok(estimateDialogueSeconds('甲：你好，等等。') > estimateDialogueSeconds('甲：你好等等'));
  assert.ok(estimateDialogueSeconds('甲：你好。\n乙：等等。') > estimateDialogueSeconds('甲：你好。等等。'));
});

test('Latin speech is counted by words instead of spelling length', () => {
  assert.equal(estimateDialogueSeconds('A: Go now.'), estimateDialogueSeconds('A: Proceed immediately.'));
  assert.ok(estimateDialogueSeconds('A: I want you to check every single page before we leave.') > 5);
});

test('reference and text estimate are proposals, while selected audio determines the hard floor', () => {
  assert.equal(resolveShotTiming({ durationSec: 8, dialogue: '甲：好。' }).effectiveSeconds, 8);
  assert.equal(resolveShotTiming({ durationSec: 5, audioDurationSec: 9.4 }).effectiveSeconds, 11);
  const over = resolveShotTiming({ durationSec: 5, dialogue: `甲：${'请完整说完这句话'.repeat(15)}。` });
  assert.ok(over.estimatedSpeechSeconds > 15);
  assert.equal(over.effectiveSeconds, 15);
  assert.equal(over.minimumSeconds, 4);
  assert.equal(over.needsSplit, false);
  assert.doesNotThrow(() => assertShotTimingFits(over));
  assert.equal(resolveShotTiming({ audioDurationSec: 9.4 }).minimumSeconds, 10);
  const nearLimit = resolveShotTiming({ audioDurationSec: 14.5 });
  assert.equal(nearLimit.effectiveSeconds, 15);
  assert.doesNotThrow(() => assertShotTimingFits(nearLimit));
  assert.throws(() => assertShotTimingFits(resolveShotTiming({ audioDurationSec: 17 })), /实际注入配音长 17 秒/);
  assert.throws(() => assertShotTimingFits(resolveShotTiming({ minimumDurationSec: 17 })), /明确的最低时长为 17 秒/);
  assert.equal(suggestedRef2vaDurationFromError('至少需要 23 秒', 8), undefined);
});

test('oversized saved duration never becomes a minimum', () => {
  for (const durationSec of [13, 17, 60]) {
    const timing = resolveShotTiming({ durationSec });
    assert.equal(timing.requestedSeconds, durationSec);
    assert.equal(timing.minimumSeconds, 4);
    assert.ok(timing.effectiveSeconds <= 15);
    assert.doesNotThrow(() => assertShotTimingFits(timing));
  }
});

test('obsolete deterministic timing errors are not fed back as model constraints', () => {
  assert.equal(formatPromptRewriteDiagnostic({ kind: 'ref2va_timing', message: 'H3_TIMING_UNRESOLVED: 本镜至少需要约 17 秒，超过当前单镜预算 15 秒。', createdAt: 1 }), '');
  assert.match(formatPromptRewriteDiagnostic({ kind: 'ref2va_timing', message: 'H3_TIMING_UNRESOLVED: 实际注入配音长 17 秒，超过当前单镜预算 15 秒。', createdAt: 1 }), /实际注入配音长 17 秒/);
});

test('timeline adjustment preserves order, overlap and subjects without mutating the source', () => {
  const original = { durationSec: 5, summary: 'Same events', segments: [
    { startSec: 0, endSec: 5, track: 'sound' as const, label: 'Speech', subject: 'A' },
    { startSec: 1, endSec: 4, track: 'body' as const, label: 'Listening', subject: 'B' },
  ] };
  const result = retimeShotTimeline(original, 10)!;
  assert.deepEqual(result.segments.map((segment) => [segment.startSec, segment.endSec, segment.subject]), [[0, 10, 'A'], [2, 8, 'B']]);
  assert.equal(original.segments[0].endSec, 5);
});

test('duration metadata is explicit, bounded and removed before prompt storage', () => {
  assert.deepEqual(readH3TimedPrompt('H3_EFFECTIVE_DURATION: 12 seconds\nThe actor speaks.', 5), { prompt: 'The actor speaks.', durationSeconds: 12 });
  assert.equal(readH3TimedPrompt('At 12 seconds, something happens.', 8).durationSeconds, 8);
  assert.throws(() => readH3TimedPrompt('H3_EFFECTIVE_DURATION: 5 seconds\nSpeech', 8, 9), /H3_TIMING_UNRESOLVED/);
  assert.throws(() => readH3TimedPrompt('H3_TIMING_UNRESOLVED: need 22 seconds', 8), /未覆盖原提示词/);
  assert.match(shotTimingDirectiveZh(90), /参考时长约 90 秒，不是硬上限/);
});

function baseWriterFixture(response: string, overrides: Record<string, unknown> = {}) {
  const ts = createRequire(import.meta.url)('typescript');
  const calls: any[] = [];
  const mocks: Record<string, unknown> = {
    './shotTimingPolicy.ts': timingPolicy,
    './h3PromptContract.ts': promptContract,
    './h3ShotContract.ts': shotContract,
    './h3PromptWritingSkill.ts': writingSkill,
    './h3PromptFormat.ts': promptFormat,
    './spatialStagingDirective.ts': { buildSpatialStagingDirective: () => '', directorViewpointExecutionRuleEn: () => '', spatialStagingAuthoringRuleZh: () => '' },
    './h3DirectingPolicy.ts': { h3BoundaryCompositionRuleZh: () => '' },
    '../agent/quickChat': { quickChat: async (messages: unknown[]) => { calls.push(messages); return response; } },
  };
  const source = readFileSync(new URL('./workshopPrompts.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => mocks[name] ?? {} });
  let duration: number | undefined;
  return {
    calls,
    duration: () => duration,
    run: () => exports.rewriteMiniMaxH3ShotPrompt({ task: 't2va', duration: 5, references: [], dialogue: '甲：等等。', prompt: 'Same event', ...overrides }, { onDurationResolved: (seconds: number) => { duration = seconds; } }),
  };
}

test('base writer selects effective timing and does not leak metadata to H3', async () => {
  const prompt = 'integrated_multimodal_description: [Shot 1] (S1) 甲 says <d>[Chinese] 等等。</d> and watches the listener stop.\noverall_soundscape: Room tone.\nnon_diegetic_music: None.';
  const fixture = baseWriterFixture(`H3_EFFECTIVE_DURATION: 12 seconds\n${prompt}`);
  const result = await fixture.run();
  assert.equal(fixture.duration(), 12);
  assert.doesNotMatch(result, /H3_EFFECTIVE_DURATION/);
  assert.match(result, /等等。/);
  assert.equal(fixture.calls.length, 1);
});

test('base writer replans old oversized references instead of rejecting before model work', async () => {
  const prompt = 'integrated_multimodal_description: [Shot 1] The seated actor remains still in the opening composition.\noverall_soundscape: Room tone.\nnon_diegetic_music: None.';
  for (const duration of [13, 17, 60]) {
    const fixture = baseWriterFixture(`H3_EFFECTIVE_DURATION: 5 seconds\n${prompt}`, { duration, dialogue: '' });
    assert.equal(await fixture.run(), prompt);
    assert.equal(fixture.duration(), 5);
    assert.equal(fixture.calls.length, 1);
    assert.match(fixture.calls[0][1].content, /Feasible effective duration: 4-15 seconds/);
  }
});

test('base writer treats text-rate estimate as advisory and preserves a genuine model timing failure', async () => {
  const fixture = baseWriterFixture('H3_TIMING_UNRESOLVED: Complete speech and actions need 24 seconds; split at a complete turn.', { dialogue: `甲：${'完整说完'.repeat(25)}。` });
  await assert.rejects(fixture.run(), /Complete speech and actions need 24 seconds/);
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0][1].content, /advisory, not a measured minimum/);
  assert.equal(fixture.duration(), undefined);
});

test('base writer retains final keyframe alignment after an authorized extension', async () => {
  const prompt = 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the 12.00-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] (S1) 甲 says <d>[Chinese] 等等。</d> then reaches the final frame state.\noverall_soundscape: Room tone.\nnon_diegetic_music: None.';
  const fixture = baseWriterFixture(`H3_EFFECTIVE_DURATION: 12 seconds\n${prompt}`, { task: 'fl2va' });
  assert.match(await fixture.run(), /12.00-second mark/);
  assert.equal(fixture.duration(), 12);
  assert.equal(fixture.calls.length, 1);
});

test('mismatched final keyframe time is rejected instead of saving a different video duration', async () => {
  const prompt = 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the 8.00-second mark of the target video.\n\nintegrated_multimodal_description: Same event.';
  const fixture = baseWriterFixture(`H3_EFFECTIVE_DURATION: 12 seconds\n${prompt}`, { task: 'fl2va' });
  await assert.rejects(fixture.run(), /尾帧对齐时间与有效时长不一致/);
  assert.equal(fixture.duration(), undefined);
  assert.equal(fixture.calls.length, 1);
});
