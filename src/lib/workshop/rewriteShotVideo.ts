import { useWorkshopRewriteStore, WORKSHOP_REWRITE_OPEN } from '@/stores/workshopRewriteStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { rewriteMiniMaxH3ShotPrompt } from './workshopPrompts';
import { buildShotRewriteFacts, selectH3TaskReferences } from './shotRewriteContext';
import { inferSpatialStagingFromShotText } from './spatialStagingDirective';
import { shotReferenceSignature, buildVideoRefBindings } from './shotRefs';
import { acceptedVideoTailPath, canInheritAcceptedVideoTail, selectVideoStartFrame } from './inheritedVideoFrame';
import { sanitizeMiniMaxH3Prompt } from './h3PromptContract';
import { dialogueEncodingIssue } from './narrativeGuard';
import { assertShotTimingFits, resolveShotTiming, retimeShotTimeline, SINGLE_TIMELINE_MAX_SEC } from './shotTimingPolicy';
import { buildPromptRewriteDiagnostic, formatPromptRewriteDiagnostic, isObsoleteShotTimingDiagnostic, isRetryablePromptRewriteFailure } from './promptRewriteDiagnostic';
import type { SglangH3Task } from '../canvasGen/sglangH3';
import type { WorkshopData, WsShot } from './types';
import {
  ACTION_TIMELINE_PLANNER_SYSTEM,
  buildActionTimelinePlannerPrompt,
  isActionTimelineUsableForH3,
  parseActionTimelineResponse,
  certifyActionTimelineReview,
  normalizeActionTimelineSubjects,
  actionTimelineValidationIssue,
} from './h3ActionTimeline';

const pending = new Map<string, Promise<void>>();

async function planActionTimelineIfNeeded(
  data: WorkshopData,
  shot: WsShot,
  request: ReturnType<typeof buildRewriteRequest>,
): Promise<WsShot> {
  const plannedShot = { ...shot, durationSec: request.input.duration };
  if (isActionTimelineUsableForH3(shot) || isActionTimelineUsableForH3(plannedShot)) return shot;
  const { quickChat } = await import('../agent/quickChat');
  const durationSec = request.input.duration;
  const result = await quickChat([
    { role: 'system', content: ACTION_TIMELINE_PLANNER_SYSTEM },
    {
      role: 'user',
      content: buildActionTimelinePlannerPrompt({
        shotNo: shot.shotNo,
        durationSec,
        canonicalFacts: `${request.input.factualContext}\n\nSource action for Layer 1 planning: ${shot.sourceExcerpt || shot.description || shot.atomicAction || request.source}`,
      }),
    },
  ], { maxTokens: 6000, continueOnTruncation: false, workspaceScope: 'workshop' });
  const parsed = normalizeActionTimelineSubjects(parseActionTimelineResponse(result, durationSec), data.characters);
  const actionTimeline = certifyActionTimelineReview(plannedShot, parsed);
  const issue = actionTimelineValidationIssue({ ...plannedShot, actionTimeline });
  if (issue) throw new Error(`Layer 1 时间轴校验失败：${issue}，原内容未修改`);
  const store = useWorkshopStore.getState();
  const latest = store.data?.shots.find((candidate) => candidate.id === shot.id);
  if (!latest || store.data?.projectId !== data.projectId) throw new Error('规划动作时间轴期间项目或镜头已变化，未覆盖新内容');
  if (buildRewriteRequest(store.data!, latest, useWorkshopStore.getState().getH3InputMode(), request.durationOverrideSec).guard !== request.guard) throw new Error('规划期间镜头事实或设置已变化，未覆盖新内容');
  // Persist Layer 1, but commit the effective clip duration only with a valid prompt.
  store.updateShotById(shot.id!, { actionTimeline });
  await useWorkshopStore.getState().commitNow();
  const saved = useWorkshopStore.getState().data?.shots.find((candidate) => candidate.id === shot.id);
  if (!saved || !isActionTimelineUsableForH3({ ...saved, durationSec })) throw new Error('Layer 1 动作时间轴保存后校验失败，未进入 H3 提示词生成');
  return saved;
}

/** Same-scene predecessor check for prompt authoring. This intentionally does
 * not require an accepted video tail: the previous prompt/state is useful
 * while planning the next shot, even before either shot has rendered media. */
function hasSameScenePredecessor(shot: WsShot, previous?: WsShot): boolean {
  if (!previous || !shot.sceneId || shot.sceneId !== previous.sceneId) return false;
  const episode = shot.episode || shot.shotNo.match(/^(\d+)-/u)?.[1];
  const previousEpisode = previous.episode || previous.shotNo.match(/^(\d+)-/u)?.[1];
  if (!episode || !previousEpisode) return false;
  if (episode.replace(/^0+(?=\d)/u, '') !== previousEpisode.replace(/^0+(?=\d)/u, '')) return false;
  if (shot.sceneImagePaths !== undefined || previous.sceneImagePaths !== undefined) {
    const currentImages = [...new Set(shot.sceneImagePaths ?? [])].sort();
    const previousImages = [...new Set(previous.sceneImagePaths ?? [])].sort();
    if (JSON.stringify(currentImages) !== JSON.stringify(previousImages)) return false;
  }
  return true;
}

/**
 * Build the exact rewrite request plus a stable guard. The guard intentionally
 * excludes render/runtime fields such as genStatus, genProgress, thumbnails and
 * candidate lists: those may change while the text model is working but cannot
 * make an already generated prompt stale.
 */
function buildRewriteRequest(data: WorkshopData, shot: WsShot, task: SglangH3Task, durationOverrideSec?: number) {
  const source = shot.universalVideoPrompt || shot.description;
  const refs: Array<{ label: string; kind: string; path?: string; continuityReference?: boolean; runtimeBoundary: boolean }> = buildVideoRefBindings(shot, data, {
    includeStoryboardBoards: task !== 'ref2va',
    requireApprovedStoryboardBoards: true,
    includeDirectorConstraintCard: false,
  }).map((r) => ({ label: r.label, kind: '图片', path: r.path, runtimeBoundary: false }));
  const index = data.shots.findIndex((s) => s.id === shot.id);
  const previous = index > 0 ? data.shots[index - 1] : undefined;
  const startFrame = selectVideoStartFrame(shot, previous, task);
  if (startFrame.path) {
    refs.push({ label: '当前镜首帧', kind: '图片', path: startFrame.path, runtimeBoundary: true });
  }
  if (shot.videoEndFramePath) {
    refs.push({ label: '当前镜尾帧', kind: '图片', path: shot.videoEndFramePath, runtimeBoundary: true });
  }
  if (shot.audioInjected && shot.generatedAudios?.length) {
    for (const audio of shot.generatedAudios) {
      refs.push({ label: audio.characterName, kind: '音频', runtimeBoundary: false });
    }
  } else {
    for (const id of shot.voiceCharacterIds ?? []) {
      const character = data.characters.find((c) => c.id === id);
      if (character?.voicePath) refs.push({ label: character.name, kind: '音频', runtimeBoundary: false });
    }
  }
  const sameScenePrevious = hasSameScenePredecessor(shot, previous) ? previous : undefined;
  const scene = (data.scenes ?? []).find((item) => item.id === shot.sceneId);
  const episode = (data.episodes ?? []).find((item) => item.no === shot.episode);
  const previousTail = task === 'ref2va' && canInheritAcceptedVideoTail(shot, previous)
    ? acceptedVideoTailPath(previous) : undefined;
  if (previousTail) refs.push({
    label: shot.usePreviousTailAsFirstFrame
      ? '上一镜已采用视频真实尾帧：本镜明确指定的 0.00 秒首帧（同时保持同一物理人物，不是额外人物）'
      : '上一镜已采用视频真实尾帧：可选的上一镜连续性参考，不强制本镜首帧或尾帧，也不是额外人物',
    kind: '图片', path: previousTail, continuityReference: true, runtimeBoundary: false,
  });
  // Continuity context only. `description` and `atomicAction` restate the same
  // events as `actionTimeline`; including them makes the rewriter translate the
  // same beats twice. Keep the structural state and the finished prompt.
  const previousShotContext = sameScenePrevious
    ? JSON.stringify({
      shotNo: sameScenePrevious.shotNo,
      sceneId: sameScenePrevious.sceneId,
      actionTimeline: sameScenePrevious.actionTimeline,
      entryState: sameScenePrevious.entryState,
      exitState: sameScenePrevious.exitState,
      camera: sameScenePrevious.camera,
      shotType: sameScenePrevious.shotType,
    })
    : undefined;
  const audioDurationSec = shot.audioInjected
    ? shot.generatedAudios?.reduce((sum, audio) => {
        const seconds = audio.trimmedPath ? audio.trimmedDuration : audio.duration;
        // The selected file determines duration; never use the longer source
        // duration for an already-trimmed file. Unknown durations stay unknown.
        return sum + (Number.isFinite(seconds) && (seconds ?? 0) > 0 ? seconds! : 0);
      }, 0)
    : undefined;
  const timing = resolveShotTiming({ durationSec: durationOverrideSec ?? shot.durationSec, dialogue: shot.dialogue, audioDurationSec });
  assertShotTimingFits(timing);
  const retryDuration = timing.effectiveSeconds;
  const durationAdjusted = retryDuration !== (shot.durationSec ?? 5);
  const effectiveShot = durationAdjusted
    ? {
        ...shot,
        durationSec: retryDuration,
        actionTimeline: retimeShotTimeline(shot.actionTimeline, retryDuration),
      }
    : shot;
  const diagnosticContext = formatPromptRewriteDiagnostic(shot.promptRewriteDiagnostic, task);
  const durationContext = durationAdjusted
    ? `PROVISIONAL DURATION ADJUSTMENT: start planning at ${retryDuration} seconds instead of the saved ${shot.durationSec ?? 5} seconds. Preserve all dialogue and events; redistribute flexible action windows for natural speech and reactions. The writer may select a different duration within the feasible range; after success the resolved duration and timeline will be saved together.`
    : '';
  const factualContext = [
    buildShotRewriteFacts(data, effectiveShot, sameScenePrevious),
    diagnosticContext,
    durationContext,
  ].filter(Boolean).join('\n\n');

  const input = {
    // `prompt` is the legacy text only. The canonical facts travel in
    // `factualContext`; embedding them here too would deliver the same facts
    // twice and the rewriter would translate each copy into its own beats.
    rewriteMode: 'reconstruct' as const,
    prompt: source,
    factualContext,
    previousTailReferencePath: previousTail,
    previousTailAsFirstFrame: Boolean(shot.usePreviousTailAsFirstFrame),
    previousShotContext,
    firstFramePath: task === 'i2va' || task === 'fl2va' ? startFrame.path : undefined,
    references: selectH3TaskReferences(refs, task),
    spatialStaging: effectiveShot.spatialStaging ?? inferSpatialStagingFromShotText({
      ...effectiveShot,
      projectGenre: data.creativeSpec?.genre,
      storyTone: data.creativeSpec?.tone,
      synopsis: data.synopsis,
      episodeSynopsis: episode?.synopsis,
      sceneDescription: scene?.description,
    }),
    duration: retryDuration,
    minimumDurationSec: timing.minimumSeconds,
    ratio: shot.videoRatio || data.videoRatio || '16:9',
  };
  const guard = JSON.stringify({
    source, // Still reject concurrent edits even though old prose is not sent to the author.
    input,
    dialogue: shot.dialogue ?? '',
    // Track the saved value separately: a diagnostic override must not mask
    // an actual duration edit made while the writer is running.
    shotDurationSec: shot.durationSec ?? null,
    task,
    shotVideoModel: shot.videoModel ?? '',
    shotPromptTemplate: shot.videoPromptTemplate ?? '',
    projectVideoModel: data.videoModel ?? '',
    projectPromptTemplate: data.videoPromptTemplate ?? '',
  });
  return { source, input, guard, durationOverrideSec, referenceSignature: shotReferenceSignature(shot, data) };
}

/** All workshop video rewrite buttons use this route. Never generates media. */
export async function rewriteWorkshopShotVideo(projectId: string, shotNo: string): Promise<void> {
  const store = useWorkshopStore.getState();
  const data = store.data;
  if (!data || data.projectId !== projectId) throw new Error('项目已切换，停止重写');
  const shot = data.shots.find((s) => s.shotNo === shotNo);
  if (!shot?.id) throw new Error('镜头不存在或缺少稳定 ID');
  const shotId = shot.id;
  const key = `${projectId}:${shotId}`;
  // Opening the progress panel is not an agent prompt and must not start a
  // second LLM run. Every entry point joins the existing in-flight promise.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKSHOP_REWRITE_OPEN));
  const existing = pending.get(key);
  if (existing) return existing;
  const progress = useWorkshopRewriteStore.getState();
  progress.start(key, projectId, shotNo);
  let attemptedTask: SglangH3Task | undefined;
  const operation = Promise.resolve().then(async () => {
    const task = useWorkshopStore.getState().getH3InputMode();
    attemptedTask = task;
    const model = 'minimax-hailuo-h3';
    const savedDuration = shot.durationSec ?? 5;
    const diagnosticDuration = shot.promptRewriteDiagnostic?.kind === 'ref2va_timing'
      && !isObsoleteShotTimingDiagnostic(shot.promptRewriteDiagnostic.message)
      && (!shot.promptRewriteDiagnostic.task || shot.promptRewriteDiagnostic.task === task)
      && shot.promptRewriteDiagnostic.suggestedDurationSec
      && shot.promptRewriteDiagnostic.requestedDurationSec === savedDuration
      ? shot.promptRewriteDiagnostic.suggestedDurationSec
      : undefined;
    let currentShot = useWorkshopStore.getState().data?.shots.find((candidate) => candidate.id === shot.id) ?? shot;
    let request = buildRewriteRequest(data, currentShot, task, diagnosticDuration);
    const dialogueIssue = dialogueEncodingIssue(currentShot.dialogue);
    if (dialogueIssue) throw new Error(dialogueIssue);
    if (!isActionTimelineUsableForH3(currentShot)
      && !isActionTimelineUsableForH3({ ...currentShot, durationSec: request.input.duration })) {
      progress.update(key, 'planning');
      currentShot = await planActionTimelineIfNeeded(data, currentShot, request);
      request = buildRewriteRequest(useWorkshopStore.getState().data!, currentShot, task, diagnosticDuration);
    }
    progress.update(key, 'writing');
    let resolvedDuration = request.input.duration;
    const rewritten = await rewriteMiniMaxH3ShotPrompt({ ...request.input, dialogue: currentShot.dialogue, task }, {
      onDurationResolved: (seconds) => { resolvedDuration = seconds; },
    });
    if (!Number.isInteger(resolvedDuration) || resolvedDuration < request.input.minimumDurationSec || resolvedDuration > SINGLE_TIMELINE_MAX_SEC) {
      throw new Error(`H3_TIMING_UNRESOLVED: 返回时长须为 ${request.input.minimumDurationSec}-${SINGLE_TIMELINE_MAX_SEC} 秒整数，并容纳完整配音。未覆盖原提示词。`);
    }
    const latest = useWorkshopStore.getState();
    const current = latest.data?.shots.find((s) => s.id === shot.id);
    const currentRequest = latest.data && current ? buildRewriteRequest(latest.data, current, task, diagnosticDuration) : undefined;
    if (
      latest.data?.projectId !== projectId
      || !current
      || !currentRequest
      || currentRequest.guard !== request.guard
      || currentRequest.referenceSignature !== request.referenceSignature
      || useWorkshopStore.getState().getH3InputMode() !== task
    ) {
      // Report field names only: never put prompt prose, private paths or dialogue
      // into failure logs. Keep the stale-write gate; do not retry paid work.
      const changed: string[] = [];
      if (latest.data?.projectId !== projectId) changed.push('projectId');
      if (!current) changed.push('shot removed');
      if (useWorkshopStore.getState().getH3InputMode() !== task) changed.push('h3InputMode');
      if (currentRequest) {
        if (currentRequest.referenceSignature !== request.referenceSignature) changed.push('referenceSignature');
        const before = JSON.parse(request.guard) as Record<string, unknown>;
        const after = JSON.parse(currentRequest.guard) as Record<string, unknown>;
        for (const field of Object.keys(before)) {
          if (field === 'input') {
            const a = before.input as Record<string, unknown>;
            const b = after.input as Record<string, unknown>;
            for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
              if (JSON.stringify(a[name]) !== JSON.stringify(b[name])) changed.push(`input.${name}`);
            }
          } else if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changed.push(field);
        }
      }
      throw new Error(`重写期间项目、镜头或模型设置已变化，未覆盖新内容；变化项：${changed.join('、') || 'request unavailable'}`);
    }
    progress.update(key, 'saving');
    const retimed = retimeShotTimeline(current.actionTimeline, resolvedDuration);
    const actionTimeline = retimed && (isActionTimelineUsableForH3(current)
      || isActionTimelineUsableForH3({ ...current, durationSec: request.input.duration }))
      ? certifyActionTimelineReview({ ...current, durationSec: resolvedDuration }, retimed)
      : retimed;
    latest.updateShotById(shotId, {
      universalVideoPrompt: sanitizeMiniMaxH3Prompt(rewritten, task),
      videoPromptTemplate: 'universal',
      videoModel: model,
      promptNeedsRefresh: false,
      h3VideoPromptTask: task,
      h3VideoPromptModeStale: false,
      durationSec: resolvedDuration,
      actionTimeline,
      promptRewriteDiagnostic: undefined,
    });
    await useWorkshopStore.getState().commitNow();
    progress.update(key, 'done');
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (isRetryablePromptRewriteFailure(message)) {
      const latest = useWorkshopStore.getState();
      const current = latest.data?.shots.find((s) => s.id === shot.id);
      if (current) {
        latest.updateShotById(shotId, {
          promptRewriteDiagnostic: buildPromptRewriteDiagnostic(
            message,
            current.durationSec ?? shot.durationSec ?? 5,
            attemptedTask,
            Date.now(),
          ),
        });
        void latest.commitNow();
      }
    }
    progress.update(key, 'failed', message);
    throw error;
  }).finally(() => { pending.delete(key); });
  pending.set(key, operation);
  return operation;
}
