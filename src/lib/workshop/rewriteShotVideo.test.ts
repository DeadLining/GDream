import test from 'node:test';
import * as actionPlanner from './h3ActionTimeline.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('prompt panel keeps full-field rewrites and generate page uses the video service', () => {
  const prompts = read('../../components/workshop/steps/StepPrompts.tsx');
  const generate = read('../../components/workshop/steps/StepGenerate.tsx');
  assert.match(prompts, /buildShotPromptsPrompt\(/);
  assert.match(prompts, /buildOptimizeShotPrompt\(shot.shotNo/);
  assert.doesNotMatch(prompts, /rewriteWorkshopShotVideo|rewriteRowVideo/);
  assert.match(generate, /rewriteWorkshopShotVideo\(data.projectId, shot.shotNo\)/);
});
test('shared rewrite always uses H3, preserves snapshots and saves video fields', () => {
  const source = read('./rewriteShotVideo.ts');
  assert.match(source, /const model = 'minimax-hailuo-h3'/);
  assert.doesNotMatch(source, /rewriteVideoPrompt|seedance/);
  assert.match(source, /rewriteMiniMaxH3ShotPrompt/);
  assert.match(source, /selectH3TaskReferences\(refs, task\)/);
  assert.match(source, /currentRequest\.guard !== request\.guard/);
  assert.match(source, /pending.get\(key\)/);
  assert.match(source, /universalVideoPrompt: sanitizeMiniMaxH3Prompt/);
  assert.match(source, /commitNow\(\)/);
  assert.doesNotMatch(source, /runGeneration\(|imagePrompt:|startFramePrompt:/);
});

test('workshop removes Seedance reference gates, including H3 ref2va', () => {
  for (const path of ['../../stores/workshopStore.ts', '../../components/workshop/steps/StepGenerate.tsx', '../agent/tools/workshopTools.ts']) {
    assert.doesNotMatch(read(path), /validateSeedancePrompt|formatSeedanceValidation/);
  }
});
test('agent full-field writes split video from image/frame/audio fields', () => {
  const source = read('../agent/tools/workshopTools.ts');
  assert.match(source, /const otherItems: Record<string, unknown>\[\] = \[\]/);
  assert.match(source, /const videoRequests: Array<\{ no: string; item: Record<string, unknown> \}> = \[\]/);
  assert.match(source, /if \(otherItems.length\)/);
  assert.match(source, /await rewriteWorkshopShotVideo\(data.projectId, no\)/);
  assert.match(source, /imagePrompt.*startFramePrompt.*endFramePrompt.*audioPrompts/s);
});

// Execute the production service with fake stores and a fake writer. No network,
// Tauri persistence or paid media requests are involved.
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as rewriteDiagnostic from './promptRewriteDiagnostic.ts';
import * as timingPolicy from './shotTimingPolicy.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function serviceFixture() {
  const shot: Record<string, any> & { characterIds: string[] } = { characterIds: [], id: 's1', shotNo: '01-01', description: 'Canonical action', dialogue: '鲁肃：箭呢？', durationSec: 8, imagePrompt: 'Keep image', videoPath: '/keep.mp4', actionTimeline: { durationSec: 8, summary: '鲁肃抬头寻找箭，镜头保持中景。', segments: [{ startSec: 0, endSec: 3, track: 'body', label: '鲁肃抬头并转向桌面' }, { startSec: 3, endSec: 8, track: 'body', label: '鲁肃寻找目标并停在桌边' }, { startSec: 0, endSec: 8, track: 'camera', label: '中景保持人物与桌面可见' }, { startSec: 0, endSec: 8, track: 'sound', label: '对白与室内环境声' }] } };
  shot.actionTimeline = actionPlanner.certifyActionTimelineReview(shot, { ...shot.actionTimeline, motionReview: { version: 1, mode: 'visible-change', reason: '寻找箭的位置', changes: [{ segmentLabel: '鲁肃抬头并转向桌面', visibleStart: '低头', visibleEnd: '抬头面向桌面' }] } });
  const data: Record<string, any> = { projectId: 'p1', shots: [shot], characters: [], episodes: [], scenes: [], videoModel: 'seedance-2.0' };
  const calls: any[] = [];
  let commits = 0;
  const phases: string[] = [];
  let writer = async (_input: any, _options?: any) => 'English H3 prompt with 鲁肃：箭呢？';
  const store = { data, getH3InputMode: () => data.h3InputMode ?? 'i2va', updateShotById: (_id: string, patch: object) => Object.assign(shot, patch), commitNow: async () => { commits++; } };
  let planner = async (durationSec = 8) => JSON.stringify(timingPolicy.retimeShotTimeline({ durationSec: 8, summary: '规划后的动作', segments: [{ startSec: 0, endSec: 3, track: 'body', label: '鲁肃抬头并转向桌面' }, { startSec: 3, endSec: 6, track: 'gaze', label: '视线沿桌面寻找箭' }, { startSec: 6, endSec: 8, track: 'body', label: '停在桌边' }, { startSec: 0, endSec: 8, track: 'camera', label: '中景' }, { startSec: 0, endSec: 8, track: 'sound', label: '环境声' }], motionReview: { version: 1, mode: 'visible-change', reason: '寻找箭的位置', changes: [{ segmentLabel: '鲁肃抬头并转向桌面', visibleStart: '低头', visibleEnd: '抬头面向桌面' }] } }, durationSec));
  const mocks: Record<string, any> = {
    '@/stores/workshopRewriteStore': { WORKSHOP_REWRITE_OPEN: 'open', useWorkshopRewriteStore: { getState: () => ({ start: () => phases.push('preparing'), update: (_key: string, phase: string) => phases.push(phase) }) } },
    '@/stores/workshopStore': { useWorkshopStore: { getState: () => store } },
    '@/stores/settingsStore': { useSettingsStore: { getState: () => ({ customVideoGenericH3Task: 'i2va' }) } },
    './workshopPrompts': { rewriteMiniMaxH3ShotPrompt: async (input: any, options: any) => { calls.push(input); return writer(input, options); } },
    '../agent/quickChat': { quickChat: (messages: any[]) => planner(Number(messages[1].content.match(/Duration: ([\d.]+) seconds/)[1])) },
    './shotRewriteContext': { buildShotRewriteFacts: () => 'Canonical facts', selectH3TaskReferences: (refs: any[]) => refs.filter((r) => r.runtimeBoundary) },
    './spatialStagingDirective': { inferSpatialStagingFromShotText: () => ({ layers: [{ subject: 'grounded subject', layer: 'ground', support: 'ground' }, { subject: 'aerial subject', layer: 'aerial', support: 'cloud layer', relativeTo: 'above grounded subject' }], viewpoint: 'upward', relation: 'ground below aerial' }) },
    './shotRefs': { buildVideoRefBindings: () => [{ label: 'Asset' }], shotReferenceSignature: () => data.signature || 'refs-1' },
    './inheritedVideoFrame': { acceptedVideoTailPath: () => undefined, canInheritAcceptedVideoTail: () => false, selectVideoStartFrame: () => ({ path: data.framePath || '/start.png' }) },
    './h3PromptContract': { sanitizeMiniMaxH3Prompt: (value: string) => value },
    './narrativeGuard': { dialogueEncodingIssue: (value: string | undefined) => value?.includes('\uFFFD') ? 'corrupted dialogue' : undefined },
    './promptRewriteDiagnostic': rewriteDiagnostic,
    './shotTimingPolicy': timingPolicy,
    './h3ActionTimeline': actionPlanner,
  };
  const compiled = ts.transpileModule(read('./rewriteShotVideo.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(mocks[name], name); return mocks[name]; } });
  return { shot, data, calls, phases, run: exports.rewriteWorkshopShotVideo, setPlanner: (fn: typeof planner) => { planner = fn; }, setWriter: (fn: typeof writer) => { writer = fn; }, commits: () => commits };
}
test('first write from a legacy project uses H3 and preserves image/video media', async () => {
  const f = serviceFixture();
  await f.run('p1', '01-01');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].task, 'i2va');
  assert.equal(f.calls[0].dialogue, '鲁肃：箭呢？');
  assert.equal(f.calls[0].references.length, 1);
  assert.equal(f.calls[0].firstFramePath, '/start.png');
  assert.equal(f.shot.videoModel, 'minimax-hailuo-h3');
  assert.equal(f.shot.videoPromptTemplate, 'universal');
  assert.match(f.shot.universalVideoPrompt, /English H3/);
  assert.equal(f.shot.imagePrompt, 'Keep image');
  assert.equal(f.shot.videoPath, '/keep.mp4');
  assert.equal(f.commits(), 1);
});
test('the canonical facts reach the rewriter exactly once', async () => {
  const f = serviceFixture();
  await f.run('p1', '01-01');
  const input = f.calls[0];
  // `factualContext` is the single carrier of the canonical facts. The legacy
  // prompt slot must not smuggle a second copy of the same bundle, otherwise
  // the writer translates every field as its own beat and the prompt repeats.
  assert.equal(input.factualContext, 'Canonical facts');
  assert.doesNotMatch(input.prompt, /Canonical facts/);
});

test('missing or provisional timeline runs Layer 1 before Layer 2 and persists it first', async () => {
  const f = serviceFixture();
  delete f.shot.actionTimeline;
  await f.run('p1', '01-01');
  assert.equal(f.shot.actionTimeline?.segments.length, 5);
  assert.equal(f.commits(), 2);
  assert.deepEqual(f.phases, ['preparing', 'planning', 'writing', 'saving', 'done']);
  assert.equal(f.calls.length, 1);
});

test('writer failure does not replace content and releases the pending lock', async () => {
  const f = serviceFixture();
  f.shot.universalVideoPrompt = 'old';
  f.setWriter(async () => { throw new Error('offline'); });
  await assert.rejects(f.run('p1', '01-01'), /offline/);
  assert.equal(f.shot.universalVideoPrompt, 'old');
  assert.equal(f.commits(), 0);
  assert.equal(f.shot.promptRewriteDiagnostic, undefined);
  f.setWriter(async () => 'new');
  await f.run('p1', '01-01');
  assert.equal(f.shot.universalVideoPrompt, 'new');
});

test('Ref2VA timing failure is stored without an automatic second model call', async () => {
  const f = serviceFixture();
  f.data.h3InputMode = 'ref2va';
  f.shot.universalVideoPrompt = 'old prompt';
  f.setWriter(async () => {
    throw new Error('参考模式排时未完成：对白无法在 8 秒内自然说完。最小调整方案：将本镜延长至约 12 秒。未覆盖原提示词。');
  });
  await assert.rejects(f.run('p1', '01-01'), /参考模式排时未完成/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.shot.universalVideoPrompt, 'old prompt');
  assert.equal(f.shot.durationSec, 8);
  assert.equal(f.shot.promptRewriteDiagnostic?.kind, 'ref2va_timing');
  assert.equal(f.shot.promptRewriteDiagnostic?.suggestedDurationSec, 12);
  assert.equal(f.commits(), 1);
});

test('the next user-triggered rewrite carries the stored diagnostic and suggested duration', async () => {
  const f = serviceFixture();
  f.data.h3InputMode = 'ref2va';
  f.shot.actionTimeline = { durationSec: 8, summary: 'Original action', segments: [] };
  f.shot.promptRewriteDiagnostic = {
    kind: 'ref2va_timing',
    message: '参考模式排时未完成：对白无法在 8 秒内自然说完。',
    requestedDurationSec: 8,
    suggestedDurationSec: 12,
    createdAt: 1,
  };
  await f.run('p1', '01-01');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].duration, 12);
  assert.match(f.calls[0].factualContext, /PREVIOUS REWRITE FAILURE DIAGNOSTIC/);
  assert.match(f.calls[0].factualContext, /Suggested target duration: 12 seconds/);
  assert.equal(f.shot.durationSec, 12);
  assert.equal(f.shot.actionTimeline?.durationSec, 12);
  assert.equal(f.shot.promptRewriteDiagnostic, undefined);
});

test('preflight failure is stored and carried into the next user-triggered rewrite', async () => {
  const f = serviceFixture();
  f.data.h3InputMode = 'ref2va';
  f.shot.universalVideoPrompt = 'old prompt';
  f.setWriter(async () => {
    throw new Error('参考模式提示词未通过内容预检：有打斗段只写了动作结果或泛化挥砍，没有写攻防连接。未覆盖原提示词。');
  });
  await assert.rejects(f.run('p1', '01-01'), /未通过内容预检/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.shot.universalVideoPrompt, 'old prompt');
  assert.equal(f.shot.promptRewriteDiagnostic?.kind, 'prompt_preflight');
  assert.match(f.shot.promptRewriteDiagnostic?.message ?? '', /没有写攻防连接/);
  assert.equal(f.shot.promptRewriteDiagnostic?.task, 'ref2va');
  assert.equal(f.commits(), 1);

  f.setWriter(async () => 'new prompt');
  await f.run('p1', '01-01');
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].factualContext, /PREVIOUS REWRITE FAILURE DIAGNOSTIC/);
  assert.match(f.calls[1].factualContext, /没有写攻防连接/);
  assert.equal(f.shot.promptRewriteDiagnostic, undefined);
});
test('reference changes during a rewrite prevent stale prompt writes', async () => {
  const f = serviceFixture();
  f.setWriter(async () => { f.data.signature = 'refs-2'; return 'stale'; });
  await assert.rejects(f.run('p1', '01-01'), /未覆盖新内容/);
  assert.equal(f.commits(), 0);
  assert.equal(f.shot.universalVideoPrompt, undefined);
});

test('runtime progress and thumbnail changes do not invalidate a rewrite', async () => {
  const f = serviceFixture();
  f.setWriter(async () => {
    f.shot.genStatus = 'generating';
    f.shot.genProgress = '正在生成视频';
    f.shot.genTaskId = 'task-1';
    f.shot.videoThumbPath = '/thumb.png';
    f.shot.videoCandidates = [{ path: '/candidate.mp4' }];
    return 'new prompt';
  });
  await f.run('p1', '01-01');
  assert.match(f.shot.universalVideoPrompt, /new prompt/);
  assert.equal(f.commits(), 1);
});

test('factual dialogue changes during a rewrite prevent stale prompt writes', async () => {
  const f = serviceFixture();
  f.setWriter(async () => {
    f.shot.dialogue = '鲁肃：已经改过的对白';
    return 'stale prompt';
  });
  await assert.rejects(f.run('p1', '01-01'), /变化项：dialogue/);
  assert.equal(f.commits(), 0);
  assert.equal(f.shot.universalVideoPrompt, undefined);
});

test('duplicate clicks join the in-flight rewrite and save once', async () => {
  const f = serviceFixture();
  let resolve!: (value: string) => void;
  f.setWriter(() => new Promise<string>((done) => { resolve = done; }));
  const first = f.run('p1', '01-01');
  const second = f.run('p1', '01-01');
  await Promise.resolve();
  assert.equal(f.calls.length, 1);
  resolve('One result');
  await Promise.all([first, second]);
  assert.equal(f.commits(), 1);
  assert.deepEqual(f.phases, ['preparing', 'writing', 'saving', 'done']);
});
test('failure appears in progress and can be retried', async () => {
  const f = serviceFixture();
  f.setWriter(async () => { throw new Error('offline'); });
  await assert.rejects(f.run('p1', '01-01'), /offline/);
  assert.deepEqual(f.phases, ['preparing', 'writing', 'failed']);
});
test('direct rewrite progress renders independently of agent streaming', () => {
  const panel = read('../../components/workshop/WorkshopChatPanel.tsx');
  const drawer = read('../../components/chat/AgentDrawer.tsx');
  assert.match(panel, /window.addEventListener\(WORKSHOP_REWRITE_OPEN, showProgress\)/);
  assert.match(panel, /task.projectId === rewriteProjectId/);
  assert.match(panel, /activityContent=\{projectRewrites.length/);
  assert.match(drawer, /!relevantPendingDecision && !activityContent/);
  assert.match(drawer, /\{activityContent\}/);
});

test('changing actual inherited frame while rewriting blocks stale write', async () => {
  const f = serviceFixture();
  f.setWriter(async () => { f.data.framePath = '/new-accepted-tail.png'; return 'stale'; });
  await assert.rejects(f.run('p1', '01-01'), /未覆盖新内容/);
  assert.equal(f.commits(), 0);
});

test('rewrite uses project reference mode rather than global first-frame mode', async () => {
  const f = serviceFixture();
  f.data.h3InputMode = 'ref2va';
  await f.run('p1', '01-01');
  assert.equal(f.calls[0].task, 'ref2va');
  assert.equal(f.shot.h3VideoPromptTask, 'ref2va');
  assert.equal(f.shot.h3VideoPromptModeStale, false);
});

test('changing project mode during rewrite rejects stale response without overwriting', async () => {
  const f = serviceFixture();
  f.setWriter(async () => { f.data.h3InputMode = 'ref2va'; return 'stale response'; });
  await assert.rejects(f.run('p1', '01-01'), /设置已变化/);
  assert.equal(f.shot.universalVideoPrompt, undefined);
  assert.equal(f.commits(), 0);
});

test('default duration is compared with the same override policy after rewrite', async () => {
  const f = serviceFixture();
  delete f.shot.durationSec;
  await f.run('p1', '01-01');
  assert.equal(f.calls[0].duration, 5);
  assert.equal(f.commits(), 2);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});

test('duration normalization does not create a false concurrent edit', async () => {
  const f = serviceFixture();
  f.shot.durationSec = 3;
  await f.run('p1', '01-01');
  assert.equal(f.calls[0].duration, 4);
  assert.equal(f.commits(), 2);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});

test('a real duration edit remains protected even with a diagnostic override', async () => {
  const f = serviceFixture();
  f.data.h3InputMode = 'ref2va';
  f.shot.promptRewriteDiagnostic = {
    kind: 'ref2va_timing', message: 'Timing repair', requestedDurationSec: 8,
    suggestedDurationSec: 12, createdAt: 1,
  };
  f.setWriter(async () => { f.shot.durationSec = 10; return 'stale prompt'; });
  await assert.rejects(f.run('p1', '01-01'), /shotDurationSec/);
  assert.equal(f.shot.durationSec, 10);
  assert.equal(f.shot.universalVideoPrompt, undefined);
  assert.equal(f.commits(), 0);
});

test('speech-first timing extends a short target and replans incomplete timeline lanes', async () => {
  const f = serviceFixture();
  f.shot.durationSec = 5;
  f.shot.dialogue = '鲁肃：我已经把这些材料全部交给你了，请你现在仔细核对。';
  const original = f.shot.dialogue;
  f.shot.actionTimeline = { durationSec: 5, summary: 'Same event', segments: [
    { startSec: 0, endSec: 5, track: 'sound', label: original },
    { startSec: 1, endSec: 4, track: 'body', label: 'Listening' },
  ] };
  await f.run('p1', '01-01');
  assert.ok(f.shot.durationSec > 5);
  assert.equal(f.shot.durationSec, f.calls[0].duration);
  assert.equal(f.shot.dialogue, original);
  assert.equal(f.shot.actionTimeline.segments.find((s: any) => s.track === 'sound').endSec, f.shot.durationSec);
  assert.ok(f.shot.actionTimeline.segments.every((s: any) => s.startSec >= 0 && s.endSec <= f.shot.durationSec));
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
  assert.ok(f.phases.includes('planning'));
  assert.equal(f.shot.videoPath, '/keep.mp4');
});

test('writer-selected final duration and measured audio determine the persisted clip length', async () => {
  const f = serviceFixture();
  f.shot.audioInjected = true;
  f.shot.generatedAudios = [{ characterName: '鲁肃', duration: 9.4 }];
  f.shot.durationSec = 5;
  f.shot.actionTimeline = { durationSec: 5, summary: '', segments: [{ startSec: 0, endSec: 5, track: 'sound', label: 'Speech' }] };
  f.setWriter(async (_input, options) => { options.onDurationResolved(13); return 'Natural speech'; });
  await f.run('p1', '01-01');
  assert.equal(f.calls[0].duration, 11);
  assert.equal(f.calls[0].minimumDurationSec, 10);
  assert.equal(f.shot.durationSec, 13);
  assert.equal(f.shot.actionTimeline.segments.find((s: any) => s.track === 'sound').endSec, 13);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});

test('over-budget speech estimate reaches semantic writer; genuine failure preserves content', async () => {
  const f = serviceFixture();
  f.shot.durationSec = 5;
  f.shot.dialogue = `鲁肃：${'需要完整说完的话'.repeat(12)}。`;
  f.shot.universalVideoPrompt = 'Keep this prompt';
  f.setWriter(async () => { throw new Error('H3_TIMING_UNRESOLVED: 完整对白无法自然演完，请拆镜。'); });
  await assert.rejects(f.run('p1', '01-01'), /H3_TIMING_UNRESOLVED.*拆镜/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].minimumDurationSec, 4);
  assert.equal(f.shot.durationSec, 5);
  assert.equal(f.shot.universalVideoPrompt, 'Keep this prompt');
});

test('old oversized silent shots and their obsolete errors can be replanned shorter', async () => {
  const f = serviceFixture();
  f.shot.durationSec = 17;
  f.shot.dialogue = '';
  f.shot.actionTimeline = { durationSec: 17, summary: 'Opening hold', segments: [{ startSec: 0, endSec: 17, track: 'body', label: 'Remain seated' }] };
  f.shot.promptRewriteDiagnostic = { kind: 'ref2va_timing', message: 'H3_TIMING_UNRESOLVED: 本镜至少需要约 17 秒，超过当前单镜预算 15 秒。', requestedDurationSec: 17, suggestedDurationSec: 12, createdAt: 1 };
  f.setWriter(async (_input, options) => { options.onDurationResolved(5); return 'A short hold'; });
  await f.run('p1', '01-01');
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(f.calls[0].factualContext, /本镜至少需要约|PREVIOUS REWRITE FAILURE DIAGNOSTIC/);
  assert.equal(f.shot.durationSec, 5);
  assert.equal(f.shot.actionTimeline.segments.find((s: any) => s.track === 'sound').endSec, 5);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
  assert.equal(f.shot.promptRewriteDiagnostic, undefined);
  assert.equal(f.shot.videoPath, '/keep.mp4');
});

test('diagnostic duration suggestion is not a hard floor', async () => {
  const f = serviceFixture();
  f.shot.promptRewriteDiagnostic = { kind: 'ref2va_timing', message: 'Timing review', requestedDurationSec: 8, suggestedDurationSec: 12, createdAt: 1 };
  f.setWriter(async (_input, options) => { options.onDurationResolved(5); return 'Naturally replanned'; });
  await f.run('p1', '01-01');
  assert.equal(f.calls[0].duration, 12);
  assert.equal(f.calls[0].minimumDurationSec, 4);
  assert.equal(f.shot.durationSec, 5);
});

test('selected audio uses trimmed file duration, not its longer source duration', async () => {
  const f = serviceFixture();
  f.shot.audioInjected = true;
  f.shot.durationSec = 5;
  f.shot.generatedAudios = [{ characterName: '鲁肃', duration: 17, trimmedPath: '/trimmed.wav', trimmedDuration: 6 }];
  f.setWriter(async (_input, options) => { options.onDurationResolved(6); return 'Full selected audio'; });
  await f.run('p1', '01-01');
  assert.equal(f.calls[0].minimumDurationSec, 6);
  assert.equal(f.shot.durationSec, 6);
  assert.equal(f.shot.generatedAudios[0].duration, 17);
});

test('sequential selected audio exceeding the budget still stops before model work', async () => {
  const f = serviceFixture();
  f.shot.audioInjected = true;
  f.shot.generatedAudios = [{ characterName: '甲', duration: 9, trimmedDuration: 2 }, { characterName: '乙', duration: 8 }];
  await assert.rejects(f.run('p1', '01-01'), /实际注入配音长 17 秒/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.shot.durationSec, 8);
  assert.equal(f.shot.universalVideoPrompt, undefined);
});

test('final durations outside real audio floor or transport budget are rejected', async () => {
  for (const duration of [9, 16, 10.5]) {
    const f = serviceFixture();
    f.shot.audioInjected = true;
    f.shot.generatedAudios = [{ characterName: '甲', duration: 9.4 }];
    f.setWriter(async (_input, options) => { options.onDurationResolved(duration); return 'Invalid timing'; });
    await assert.rejects(f.run('p1', '01-01'), /返回时长须为 10-15 秒整数/);
    assert.equal(f.shot.durationSec, 8);
    assert.equal(f.shot.universalVideoPrompt, undefined);
  }
});

test('failed writer does not persist provisional timing', async () => {
  const f = serviceFixture();
  f.shot.durationSec = 5;
  f.shot.dialogue = '鲁肃：我已经把这些材料全部交给你了，请你现在仔细核对。';
  f.setWriter(async () => { throw new Error('offline'); });
  await assert.rejects(f.run('p1', '01-01'), /offline/);
  assert.equal(f.shot.durationSec, 5);
  assert.equal(f.shot.universalVideoPrompt, undefined);
});

test('authorized timing changes retain the reviewed plan for the next rewrite', async () => {
  const f = serviceFixture();
  f.setWriter(async (_input, options) => { options.onDurationResolved(12); return 'Extended action'; });
  await f.run('p1', '01-01');
  assert.equal(f.shot.durationSec, 12);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
  await f.run('p1', '01-01');
  assert.equal(f.phases.filter((phase) => phase === 'planning').length, 0);
  assert.equal(f.calls.length, 2);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});

test('a saved provisional plan survives a failed writer without changing duration or replaying Layer 1', async () => {
  const f = serviceFixture();
  const template = f.shot.actionTimeline;
  f.shot.durationSec = 5;
  f.shot.dialogue = '鲁肃：我已经把这些材料全部交给你了，请你现在仔细核对。';
  delete f.shot.actionTimeline;
  let plans = 0;
  f.setPlanner(async (duration = 8) => {
    plans++;
    return JSON.stringify(timingPolicy.retimeShotTimeline(template, duration));
  });
  f.setWriter(async () => { throw new Error('offline'); });
  await assert.rejects(f.run('p1', '01-01'), /offline/);
  assert.equal(f.shot.durationSec, 5);
  assert.equal(f.shot.universalVideoPrompt, undefined);
  assert.equal(f.shot.videoPath, '/keep.mp4');
  const plannedDuration = f.shot.actionTimeline.durationSec;
  assert.ok(plannedDuration > 5);
  assert.equal(actionPlanner.isActionTimelineUsableForH3({ ...f.shot, durationSec: plannedDuration }), true);
  f.setWriter(async () => 'Recovered prompt');
  await f.run('p1', '01-01');
  assert.equal(plans, 1);
  assert.equal(f.shot.durationSec, plannedDuration);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});

test('H3 audio candidates are retained by default instead of being cut to a reference duration', () => {
  const source = read('../agent/tools/workshopTools.ts');
  assert.match(source, /const preserveH3Speech = isMiniMaxH3Model\([^\n]+\) && params\.auto_trim !== true/);
  assert.match(source, /total > shotDurationLimit && !preserveH3Speech && params\.auto_trim !== false/);
  assert.match(source, /total > shotDurationLimit && !preserveH3Speech\)/);
  assert.match(source, /完整配音.*已保留/);
});


test('unreviewed stored timeline gets a real motion review before Layer 2', async () => {
  const f = serviceFixture();
  delete f.shot.actionTimeline.motionReview;
  await f.run('p1', '01-01');
  assert.deepEqual(f.phases, ['preparing', 'planning', 'writing', 'saving', 'done']);
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});

test('invalid planning result preserves old timeline and never reaches the writer', async () => {
  const f = serviceFixture();
  delete f.shot.actionTimeline.motionReview;
  const before = JSON.stringify(f.shot.actionTimeline);
  f.setPlanner(async () => JSON.stringify(f.shot.actionTimeline));
  await assert.rejects(f.run('p1', '01-01'), /缺少可见变化依据/);
  assert.equal(JSON.stringify(f.shot.actionTimeline), before);
  assert.equal(f.commits(), 0);
  assert.equal(f.calls.length, 0);
});

test('editing facts during Layer 1 prevents stale timeline persistence', async () => {
  const f = serviceFixture();
  delete f.shot.actionTimeline.motionReview;
  const result = JSON.stringify({ ...f.shot.actionTimeline, motionReview: { version: 1, mode: 'intentional-hold', reason: '演员在回答前停顿', changes: [] } });
  f.setPlanner(async () => { f.shot.dialogue = '用户刚修改的对白'; return result; });
  await assert.rejects(f.run('p1', '01-01'), /规划期间镜头事实或设置已变化/);
  assert.equal(f.commits(), 0);
  assert.equal(f.calls.length, 0);
});

test('a Layer 1 response using canonical Chinese names reaches Layer 2 with stable character IDs', async () => {
  const f = serviceFixture();
  f.shot.characterIds = ['lusu'];
  f.data.characters = [{ id: 'lusu', name: '鲁肃' }];
  delete f.shot.actionTimeline.motionReview;
  f.setPlanner(async () => JSON.stringify({ ...f.shot.actionTimeline,
    segments: f.shot.actionTimeline.segments.map((s: any) => ({ ...s, subject: s.track === 'body' ? '鲁肃' : undefined })),
    motionReview: { version: 1, mode: 'visible-change', reason: '抬头寻找箭', changes: [{ segmentLabel: '鲁肃抬头并转向桌面', visibleStart: '低头', visibleEnd: '抬头面向桌面' }] },
  }));
  await f.run('p1', '01-01');
  assert.equal(f.calls.length, 1);
  assert.ok(f.shot.actionTimeline.segments.filter((s: any) => s.track === 'body').every((s: any) => s.subject === 'lusu'));
  assert.equal(actionPlanner.isActionTimelineUsableForH3(f.shot), true);
});
