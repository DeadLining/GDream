import type { ShotActionTimeline, ShotTimelineTrack, WsShot } from './types.ts';

const TRACKS: readonly ShotTimelineTrack[] = [
  'body', 'left-hand', 'right-hand', 'prop', 'gaze', 'emotion', 'camera', 'sound',
];
const TRACK_SET = new Set<ShotTimelineTrack>(TRACKS);

export interface ActionTimelinePlannerInput {
  shotNo: string;
  durationSec: number;
  canonicalFacts: string;
}

/**
 * Layer 1 is deliberately small. It determines executable beats and state
 * changes; it does not write H3 prose or invent coverage language.
 */
export const ACTION_TIMELINE_PLANNER_SYSTEM = `You are the Layer 1 action planner for a MiniMax H3 shot.
Return JSON only, with this exact shape:
{"durationSec": number, "summary": string, "segments": [{"startSec": number, "endSec": number, "track": "body|left-hand|right-hand|prop|gaze|emotion|camera|sound", "label": string, "subject": string}], "motionReview": {"version": 1, "mode": "visible-change|intentional-hold", "reason": string, "changes": [{"segmentLabel": string, "visibleStart": string, "visibleEnd": string}]}}
Use 3-5 primary action beats when the shot needs them; use fewer for a genuinely simple shot. Do not create equal time bins and do not split every second. Each consequential beat must make this chain explicit in its label: cause -> physical action -> contact or path -> visible result -> resulting state. Preserve only canonical people, props, dialogue, camera decisions, duration, entry state and exit state. Do not add story events, dialogue, people, props or scene changes. Give every physical character at least one body, gaze, emotion or dialogue-related segment with its exact canonical character id in subject (not a translated name, Subject number or description). Include body, camera and sound tracks. Add hand or prop segments only when the facts support them. Camera and sound segments may span larger windows. The final segment must land on the canonical exit state. This is planning data, not the final video prompt.
Before reusing an existing plan, assess what the viewer can actually see change at the intended framing. A quiet mood, seated people, a fixed camera, preserved identity or unchanged layout does not mean frozen actors. Describe a meaningful supported gesture, attention shift, contact or reaction with a visible start and result; camera-only changes qualify only when they reveal story information, not an arbitrary few-centimetre drift. Sound alone is not visible action. Do not add an event merely to satisfy a motion quota or borrow the next shot's action.
Return motionReview: visible-change names exact segment labels and distinct observable start/end states, with a reason explaining their narrative purpose. For a deliberately held tableau, freeze frame, still life or sustained pause, use intentional-hold with an empty changes array and a reason grounded in the shot's creative purpose and duration. An establishing-shot label or a legacy instruction that nobody moves is not by itself a creative justification. Review existing timelines as drafts, even if legacy context calls them authoritative. If canonical facts explicitly prohibit all suitable changes without a justified intentional hold, return {"planningIssue":"explain the conflicting facts and the smallest upstream correction"}; do not silently invent motion or certify a frozen plan.`;

export function buildActionTimelinePlannerPrompt(input: ActionTimelinePlannerInput): string {
  const duration = normalizeDuration(input.durationSec);
  return `Plan Layer 1 for shot ${input.shotNo}.
Duration: ${duration} seconds.

Canonical shot facts (the only source of truth):
${input.canonicalFacts}

Return one JSON object only. Keep the number of primary physical beats small and meaningful. Use exact timing within 0-${duration} seconds, with no gaps in the main action spine and no overlap that makes a physical handoff impossible.`;
}

function extractJsonObject(text: string): string {
  const cleaned = text.trim().replace(/^```(?:json|text)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Layer 1 没有返回 JSON 时间轴');
  return cleaned.slice(start, end + 1);
}

function normalizeDuration(value: unknown): number {
  const number = Number(value);
  return Math.max(4, Math.min(30, Number.isFinite(number) ? number : 5));
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Layer 1 时间轴字段 ${label} 不是数字`);
  return number;
}

export function parseActionTimelineResponse(
  text: string,
  expectedDurationSec: number,
): ShotActionTimeline {
  let raw: any;
  try {
    raw = JSON.parse(extractJsonObject(text));
  } catch (error) {
    throw new Error(`Layer 1 时间轴 JSON 无效：${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw?.planningIssue) throw new Error(`Layer 1 动作规划需修正：${String(raw.planningIssue)}`);
  const durationSec = normalizeDuration(expectedDurationSec);
  const returnedDuration = finiteNumber(raw?.durationSec, 'durationSec');
  if (Math.abs(returnedDuration - durationSec) > 0.05) {
    throw new Error(`Layer 1 时间轴时长 ${returnedDuration} 与镜头时长 ${durationSec} 不一致`);
  }
  if (typeof raw?.summary !== 'string' || !raw.summary.trim()) {
    throw new Error('Layer 1 时间轴缺少 summary');
  }
  if (!Array.isArray(raw?.segments) || raw.segments.length === 0) {
    throw new Error('Layer 1 时间轴缺少 segments');
  }
  const segments = raw.segments.map((segment: any, index: number) => {
    const startSec = finiteNumber(segment?.startSec, `segments[${index}].startSec`);
    const endSec = finiteNumber(segment?.endSec, `segments[${index}].endSec`);
    const track = String(segment?.track ?? '').trim() as ShotTimelineTrack;
    const label = String(segment?.label ?? '').trim();
    if (!(startSec >= 0 && endSec > startSec && endSec <= durationSec + 0.05)) {
      throw new Error(`Layer 1 时间轴第 ${index + 1} 段超出时长或区间无效`);
    }
    if (!TRACK_SET.has(track)) throw new Error(`Layer 1 时间轴使用了不支持的轨道 ${track}`);
    if (!label) throw new Error(`Layer 1 时间轴第 ${index + 1} 段缺少 label`);
    return {
      startSec: Math.max(0, startSec),
      endSec: Math.min(durationSec, endSec),
      track,
      label,
      ...(String(segment?.subject ?? '').trim() ? { subject: String(segment.subject).trim() } : {}),
    };
  }).sort((a: ShotActionTimeline['segments'][number], b: ShotActionTimeline['segments'][number]) => a.startSec - b.startSec || a.endSec - b.endSec);
  const tracks = new Set(segments.map((segment: ShotActionTimeline['segments'][number]) => segment.track));
  for (const required of ['body', 'camera', 'sound'] as const) {
    if (!tracks.has(required)) throw new Error(`Layer 1 时间轴缺少 ${required} 轨道`);
  }
  if (!segments.some((segment: ShotActionTimeline['segments'][number]) => !['camera', 'sound'].includes(segment.track))) {
    throw new Error('Layer 1 时间轴没有可执行动作轨道');
  }
  return { durationSec, summary: raw.summary.trim(), segments, ...(raw.motionReview ? { motionReview: raw.motionReview } : {}) };
}

function looksLikeFallbackTimeline(timeline: ShotActionTimeline, shot: WsShot): boolean {
  const action = timeline.segments.filter((segment) => segment.track !== 'camera' && segment.track !== 'sound');
  const onlyFullShotAction = action.length === 1
    && action[0].startSec <= 0.05
    && action[0].endSec >= timeline.durationSec - 0.05;
  if (!onlyFullShotAction || timeline.segments.length > 4) return false;
  const labels = [shot.atomicAction, shot.description, '连续完成本镜既定动作']
    .map((value) => value?.trim())
    .filter(Boolean) as string[];
  return labels.some((label) => action[0].label.trim() === label || timeline.summary.trim() === label);
}

type MotionShot = Pick<WsShot, 'durationSec' | 'characterIds'> & Partial<WsShot>;

export function actionTimelineReviewBasis(shot: MotionShot, timeline: ShotActionTimeline): string {
  const source = JSON.stringify({
    durationSec: shot.durationSec, characterIds: shot.characterIds, sceneId: shot.sceneId,
    propIds: shot.propIds, description: shot.description, atomicAction: shot.atomicAction,
    dialogue: shot.dialogue, camera: shot.camera, shotType: shot.shotType,
    entryState: shot.entryState, exitState: shot.exitState,
    sourceExcerpt: shot.sourceExcerpt, sourceScriptRevisionId: shot.sourceScriptRevisionId,
    spatialStaging: shot.spatialStaging, continuityMode: shot.continuityMode,
    timeline: { durationSec: timeline.durationSec, summary: timeline.summary, segments: timeline.segments },
  });
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `motion-v1-${(hash >>> 0).toString(16)}-${source.length}`;
}

function hasMotionReviewEvidence(timeline: ShotActionTimeline): boolean {
  const review = timeline.motionReview;
  if (!review || review.version !== 1 || typeof review.reason !== 'string' || !review.reason.trim() || !Array.isArray(review.changes)) return false;
  if (review.mode === 'intentional-hold') return review.changes.length === 0;
  if (review.mode !== 'visible-change' || review.changes.length === 0) return false;
  return review.changes.every((change) => change
    && typeof change.visibleStart === 'string' && change.visibleStart.trim()
    && typeof change.visibleEnd === 'string' && change.visibleEnd.trim()
    && change.visibleStart.trim() !== change.visibleEnd.trim()
    && timeline.segments.some((segment) => segment.track !== 'sound' && segment.label === change.segmentLabel));
}

/** Only stamps a planner's grounded assessment. Does not claim visual acceptance. */
export function certifyActionTimelineReview(shot: MotionShot, timeline: ShotActionTimeline): ShotActionTimeline {
  if (!hasMotionReviewEvidence(timeline)) throw new Error('Layer 1 缺少可见变化依据或有意静止的创作理由，未保存时间轴');
  return { ...timeline, motionReview: { ...timeline.motionReview!, basis: actionTimelineReviewBasis(shot, timeline) } };
}

/** Resolve only exact, unambiguous aliases from the current project's cast.
 * Never infer identity from action prose or substring matches (chen != chenyu).
 */
export function normalizeActionTimelineSubjects(
  timeline: ShotActionTimeline,
  characters: ReadonlyArray<{ id: string; name: string }>,
): ShotActionTimeline {
  const key = (value: string) => value.trim().toLowerCase();
  const aliases = new Map<string, Set<string>>();
  for (const character of characters) {
    for (const alias of [character.id, character.name]) {
      if (!alias?.trim()) continue;
      const ids = aliases.get(key(alias)) ?? new Set<string>();
      ids.add(character.id);
      aliases.set(key(alias), ids);
    }
  }
  return { ...timeline, segments: timeline.segments.map((segment) => {
    if (segment.track === 'camera' || segment.track === 'sound') return segment;
    const ids = aliases.get(key(segment.subject ?? ''));
    if (!ids?.size) return segment;
    if (ids.size !== 1) throw new Error(`Layer 1 人物名称“${segment.subject}”对应多个角色，请使用明确的角色 ID`);
    return { ...segment, subject: [...ids][0] };
  }) };
}

/** Specific diagnostics shared by saving and reuse checks. */
export function actionTimelineValidationIssue(shot: MotionShot): string | undefined {
  const timeline = shot.actionTimeline;
  if (!timeline?.segments?.length) return '缺少动作时间轴';
  if (!hasMotionReviewEvidence(timeline)) return '缺少可见变化依据或有意静止的创作理由';
  if (timeline.motionReview?.basis !== actionTimelineReviewBasis(shot, timeline)) return '动作审查已过期：镜头事实或时间轴已变化';
  const duration = normalizeDuration(shot.durationSec ?? 5);
  if (Math.abs(Number(timeline.durationSec) - duration) > 0.05) return `时间轴时长与本镜 ${duration} 秒不一致`;
  const tracks = new Set(timeline.segments.map((segment) => segment.track));
  const missingTracks = (['body', 'camera', 'sound'] as const).filter((track) => !tracks.has(track));
  if (missingTracks.length) return `缺少轨道：${missingTracks.join('、')}`;
  const invalidIndex = timeline.segments.findIndex((segment) => !Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec) || !segment.label?.trim() || segment.startSec < 0 || segment.endSec <= segment.startSec || segment.endSec > duration + 0.05 || !TRACK_SET.has(segment.track));
  if (invalidIndex >= 0) return `第 ${invalidIndex + 1} 段时间范围、轨道或说明无效`;
  if (timeline.motionReview?.mode !== 'intentional-hold' && looksLikeFallbackTimeline(timeline, shot as WsShot)) return '仍是整镜占位动作，缺少可执行拆分';
  const subjects = new Set(timeline.segments
    .filter((segment) => !['camera', 'sound', 'prop'].includes(segment.track))
    .map((segment) => String(segment.subject ?? '').trim().toLowerCase()));
  const missing = (shot.characterIds ?? []).filter((id) => !subjects.has(id.trim().toLowerCase()));
  if (missing.length) return `缺少角色动作：${missing.join('、')}；人物 subject 必须绑定角色 ID`;
  return undefined;
}

/** True when the stored plan can be safely consumed by Layer 2. */
export function isActionTimelineUsableForH3(shot: MotionShot): boolean {
  return actionTimelineValidationIssue(shot) === undefined;
}
