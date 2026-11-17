import type { WorkshopData, WsNarrativeBeat, WsShot } from './types.ts';

export type BreakdownWriteMode = 'merge' | 'replace';

type IdentifiedRecord = { id: string };
type ShotPatch = Partial<WsShot> & Pick<WsShot, 'shotNo'>;
type ShotTimelineSegmentLike = NonNullable<WsShot['actionTimeline']>['segments'][number];

export function resolveBreakdownWriteMode(
  hasExistingBreakdown: boolean,
  requestedMode: unknown,
): BreakdownWriteMode {
  if (!hasExistingBreakdown) return 'replace';
  return requestedMode === 'replace' ? 'replace' : 'merge';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
  ) as T;
}

/**
 * Merge a JSON-shaped patch without erasing nested fields that the caller did
 * not submit. Arrays are intentional values and therefore replace old arrays.
 */
function mergePatch<T>(existing: T | undefined, incoming: Partial<T>): T {
  if (!isPlainObject(existing)) return cloneValue(incoming) as T;
  const result: Record<string, unknown> = cloneValue(existing);
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const previous = result[key];
    result[key] = isPlainObject(previous) && isPlainObject(value)
      ? mergePatch(previous, value)
      : cloneValue(value);
  }
  return result as T;
}

/**
 * Stable ID-based collection write. Merge keeps records omitted from the
 * patch; replace drops them. In both modes, a matching record retains fields
 * omitted by the patch, including generated asset bindings and candidates.
 */
export function mergeBreakdownRecords<T extends IdentifiedRecord>(
  existing: readonly T[] | undefined,
  incoming: readonly (Partial<T> & IdentifiedRecord)[],
  mode: BreakdownWriteMode = 'merge',
): T[] {
  const previous = existing ?? [];
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const incomingById = new Map<string, Partial<T> & IdentifiedRecord>();
  const incomingOrder: string[] = [];

  for (const item of incoming) {
    if (!incomingById.has(item.id)) incomingOrder.push(item.id);
    const accumulated = incomingById.get(item.id);
    incomingById.set(item.id, accumulated
      ? mergePatch(accumulated, item)
      : cloneValue(item));
  }

  if (mode === 'replace') {
    return incomingOrder.map((id) => mergePatch(previousById.get(id), incomingById.get(id)!));
  }

  const result: T[] = [];
  const emitted = new Set<string>();
  for (const item of previous) {
    result.push(incomingById.has(item.id)
      ? mergePatch(item, incomingById.get(item.id)!)
      : cloneValue(item));
    emitted.add(item.id);
  }
  for (const id of incomingOrder) {
    if (emitted.has(id)) continue;
    result.push(mergePatch<T>(undefined, incomingById.get(id)!));
  }
  return result;
}

/** Narrative Beats use the same stable write semantics as other records. */
export function mergeNarrativeBeats(
  existing: readonly WsNarrativeBeat[] | undefined,
  incoming: readonly (Partial<WsNarrativeBeat> & Pick<WsNarrativeBeat, 'id'>)[],
  mode: BreakdownWriteMode = 'merge',
): WsNarrativeBeat[] {
  return mergeBreakdownRecords(existing, incoming, mode);
}

const BEAT_ID_TAIL = /-beat-(\d+)$/u;
const SCENE_ID_TAIL = /^scene-(\d+)$/u;

/**
 * Canonical Beat order: Scene order first, Beat ordinal inside the Scene.
 *
 * A merge restores missing Beats by appending them, so a partial repair would
 * otherwise leave Beat 3.1 sitting after Beat 4.2 and the "Beat → Atomic Shot"
 * panel would read out of order. Scenes keep the authored order of the Scene
 * list; inside a Scene, only reorder when every Beat carries a numeric
 * `-beat-NN` suffix, so custom id schemes keep their insertion order.
 */
export function sortNarrativeBeats<T extends Pick<WsNarrativeBeat, 'id' | 'sceneId'>>(
  beats: readonly T[],
  sceneOrder: readonly string[] = [],
): T[] {
  if (beats.length < 2) return [...beats];
  const sceneRank = new Map<string, number>();
  sceneOrder.forEach((sceneId, index) => sceneRank.set(sceneId, index));
  const fallbackRank = (sceneId: string): number => {
    const numeric = SCENE_ID_TAIL.exec(sceneId);
    return numeric ? 10_000 + Number(numeric[1]) : Number.MAX_SAFE_INTEGER;
  };

  const groups = new Map<string, T[]>();
  for (const beat of beats) {
    const group = groups.get(beat.sceneId);
    if (group) group.push(beat);
    else groups.set(beat.sceneId, [beat]);
  }

  const orderedSceneIds = [...groups.keys()].sort((left, right) => {
    const leftRank = sceneRank.get(left) ?? fallbackRank(left);
    const rightRank = sceneRank.get(right) ?? fallbackRank(right);
    return leftRank - rightRank;
  });

  const result: T[] = [];
  for (const sceneId of orderedSceneIds) {
    const group = groups.get(sceneId)!;
    const withOrdinals = group.map((beat) => ({ beat, match: BEAT_ID_TAIL.exec(beat.id) }));
    if (withOrdinals.every((entry) => entry.match)) {
      result.push(...withOrdinals
        .map((entry, index) => ({ beat: entry.beat, ordinal: Number(entry.match![1]), index }))
        .sort((left, right) => left.ordinal - right.ordinal || left.index - right.index)
        .map((entry) => entry.beat));
    } else {
      result.push(...group);
    }
  }
  return result;
}

/**
 * Validate that every submitted shot points to an existing Beat in the same
 * Scene. Both the durable Beat ID and its exact title are accepted.
 */
export function validateNarrativeBeatRefs(
  shots: readonly Partial<WsShot>[],
  beats: readonly WsNarrativeBeat[] | undefined,
): string[] {
  const refsByScene = new Map<string, Set<string>>();
  for (const beat of beats ?? []) {
    const sceneId = beat.sceneId.trim();
    const refs = refsByScene.get(sceneId) ?? new Set<string>();
    refs.add(beat.id.trim());
    refs.add(beat.title.trim());
    refsByScene.set(sceneId, refs);
  }

  const errors: string[] = [];
  for (const shot of shots) {
    const reference = shot.narrativeBeat?.trim();
    if (!reference) continue;
    const shotNo = shot.shotNo?.trim() || '未知镜号';
    const sceneId = shot.sceneId?.trim();
    if (!sceneId) {
      errors.push(`${shotNo}: narrativeBeat "${reference}" 无法校验，因为镜头缺少 sceneId`);
      continue;
    }
    if (!refsByScene.get(sceneId)?.has(reference)) {
      errors.push(`${shotNo}: sceneId "${sceneId}" 中不存在 narrativeBeat "${reference}"；请填写该 Scene 下已有 Beat 的 id 或精确 title`);
    }
  }
  return errors;
}

/**
 * Rebuild Beat -> shot links from the current shots. Unknown references are
 * deliberately ignored; validation reports them and this function never
 * invents a Beat to make invalid input appear valid.
 */
export function compileNarrativeBeatShotNos(
  beats: readonly WsNarrativeBeat[] | undefined,
  shots: readonly WsShot[],
): WsNarrativeBeat[] {
  const compiled = (beats ?? []).map((beat) => ({ ...cloneValue(beat), shotNos: [] as string[] }));
  const byReference = new Map<string, WsNarrativeBeat>();
  for (const beat of compiled) {
    const sceneId = beat.sceneId.trim();
    byReference.set(`${sceneId}\u0000${beat.id.trim()}`, beat);
    byReference.set(`${sceneId}\u0000${beat.title.trim()}`, beat);
  }

  for (const shot of shots) {
    const sceneId = shot.sceneId?.trim();
    const reference = shot.narrativeBeat?.trim();
    if (!sceneId || !reference || !shot.shotNo?.trim()) continue;
    const beat = byReference.get(`${sceneId}\u0000${reference}`);
    if (beat && !beat.shotNos?.includes(shot.shotNo)) beat.shotNos!.push(shot.shotNo);
  }
  return compiled;
}

/** Build the complete shot list that should be validated before persistence. */
export function buildProspectiveShots(
  existing: readonly WsShot[],
  incoming: readonly ShotPatch[],
  mode: BreakdownWriteMode = 'merge',
): WsShot[] {
  const existingByNo = new Map(existing.map((shot) => [shot.shotNo, shot]));
  const incomingByNo = new Map<string, ShotPatch>();
  const incomingOrder: string[] = [];
  for (const shot of incoming) {
    if (!incomingByNo.has(shot.shotNo)) incomingOrder.push(shot.shotNo);
    const accumulated = incomingByNo.get(shot.shotNo);
    incomingByNo.set(shot.shotNo, accumulated
      ? mergePatch(accumulated, shot)
      : cloneValue(shot));
  }

  if (mode === 'replace') {
    return incomingOrder.map((shotNo) => mergePatch(existingByNo.get(shotNo), incomingByNo.get(shotNo)!));
  }

  const result: WsShot[] = [];
  const emitted = new Set<string>();
  for (const shot of existing) {
    result.push(incomingByNo.has(shot.shotNo)
      ? mergePatch(shot, incomingByNo.get(shot.shotNo)!)
      : cloneValue(shot));
    emitted.add(shot.shotNo);
  }
  for (const shotNo of incomingOrder) {
    if (emitted.has(shotNo)) continue;
    result.push(mergePatch<WsShot>(undefined, incomingByNo.get(shotNo)!));
  }
  // Standard numeric shot numbers express authored playback order. Restoring a
  // missing shot through merge must insert it between its neighbours, or the
  // continuity pass would inherit state from the wrong previous shot. Preserve
  // insertion order for custom/non-numeric numbering schemes.
  if (result.length > 1 && result.every((shot) => /^\d+(?:-\d+)+$/.test(shot.shotNo))) {
    return result.sort((left, right) => left.shotNo.localeCompare(right.shotNo, 'zh-CN', { numeric: true }));
  }
  return result;
}

interface CharacterLike { id: string; name?: string }

function characterTokens(name: string): string[] {
  const raw = name.split(/[（(、，,；;\/]/u).map((part) => part.replace(/[）)]/gu, '').trim()).filter(Boolean);
  const aliases = raw.flatMap((part) => part.split(/(?:化名|别名|又名)[:：]?/u).map((item) => item.trim()).filter(Boolean));
  return [...new Set([...raw, ...aliases])];
}

const MEDIA_NAME_BEFORE_RE = /(?:电视(?:机)?|手机|电脑|显示器|屏幕|照片|海报|镜面|监控|广播|视频|投影|新闻)(?:的)?(?:画面|影像|照片)?(?:中|内|里|上)[^，。；\n]{0,20}$/u;
const MEDIA_NAME_AFTER_RE = /^(?:[^，。；\n]{0,16})?(?:只|仅)?(?:出现|存在|显示|呈现|映出|播放)(?:在|于)?(?:电视(?:机)?|手机|电脑|显示器|屏幕|照片|海报|镜面|监控|广播|视频|投影|新闻)(?:的)?(?:画面|影像|照片)?(?:中|内|里|上)/u;

function hasPhysicalMention(text: string, token: string): boolean {
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(token, offset);
    if (index < 0) return false;
    const before = text.slice(Math.max(0, index - 42), index);
    const after = text.slice(index + token.length, index + token.length + 42);
    if (!MEDIA_NAME_BEFORE_RE.test(before) && !MEDIA_NAME_AFTER_RE.test(after)) return true;
    offset = index + token.length;
  }
  return false;
}

/** Infer physical people only; identities confined to a screen/photo stay media. */
export function inferPhysicalOpeningCharacterIds(
  charactersState: string | undefined,
  characters: readonly CharacterLike[],
): string[] {
  const text = charactersState?.trim() ?? '';
  if (!text) return [];
  return characters
    .filter((character) => characterTokens(character.name ?? '')
      .some((token) => token.length >= 2 && hasPhysicalMention(text, token)))
    .map((character) => character.id);
}

const SPATIAL_BLOCKING_RE = /(?:位于|处于|站(?:在|于)|坐(?:在|于)|蹲(?:在|于)|跪(?:在|于)|躺(?:在|于)|倚(?:在|靠)|靠(?:在|近)|停(?:在|于)|立(?:在|于)|守在|落座于|左侧|右侧|左边|右边|前方|后方|身前|身后|面前|背后|对面|身旁|旁边|门口|门边|窗边|窗旁|窗前|桌前|桌后|台前|台后|床边|床沿|墙边|墙角|角落|中央|中间|室内|室外|房间内|画面外|前景|中景|后景|相距|距离|隔着|之间|面向|朝向|背对|侧对|正对|转向|视线(?:落在|投向|移向)|目光(?:落在|投向|移向|锁定)|看向|望向|盯着|凝视|从.{0,32}(?:走|跑|移|退|绕|穿过|靠近|起身).{0,32}(?:到|至|向|前|后|旁|边)|(?:走|跑|移|退|绕|穿过|靠近|来到|回到|进入|离开|转身走)(?:到|至|向|进|出|过))/u;

/** True when description or structured character states establish blocking. */
export function hasShotSpatialBlocking(shot: Partial<WsShot>): boolean {
  const text = [
    shot.description,
    shot.entryState?.characters,
    shot.exitState?.characters,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
  return SPATIAL_BLOCKING_RE.test(text);
}

export interface ShotIdManifest {
  characters: ReadonlyArray<{ id: string; name?: string }>;
  scenes: ReadonlyArray<{ id: string; name?: string }>;
  props: ReadonlyArray<{ id: string; name?: string }>;
}

/** Compact "id=name" listing used inside validation errors so the model can copy real ids. */
export function formatIdManifest(items: ReadonlyArray<{ id: string; name?: string }>): string {
  return items.map((item) => `${item.id}=${item.name ?? item.id}`).join('、');
}

/**
 * Validate that a shot only references real entity ids. Returns actionable
 * messages that name the unknown ids and the exact set of legal ids, so a
 * failed batch can be repaired field-by-field instead of regenerated.
 */
export function validateShotEntityIds(shot: Partial<WsShot>, manifest: ShotIdManifest): string[] {
  const errors: string[] = [];
  const knownCharacters = new Set(manifest.characters.map((item) => item.id));
  const knownScenes = new Set(manifest.scenes.map((item) => item.id));
  const knownProps = new Set(manifest.props.map((item) => item.id));
  const shotNo = shot.shotNo?.trim() || '未知镜号';

  const unknownCharacters = (shot.characterIds ?? []).filter((id) => !knownCharacters.has(id));
  if (unknownCharacters.length > 0) {
    errors.push(`${shotNo}: characterIds 包含不存在的角色 ID：${unknownCharacters.join('、')}。只能使用以下真实 ID：${formatIdManifest(manifest.characters) || '（当前无角色，需先用 workshop_set_breakdown 补入）'}。禁止自造 ID 或删除真实出场人物。`);
  }
  if (shot.sceneId && !knownScenes.has(shot.sceneId)) {
    errors.push(`${shotNo}: sceneId 引用了不存在的场景：${shot.sceneId}。只能使用以下真实 ID：${formatIdManifest(manifest.scenes) || '（无）'}`);
  }
  const unknownProps = (shot.propIds ?? []).filter((id) => !knownProps.has(id));
  if (unknownProps.length > 0) {
    errors.push(`${shotNo}: propIds 包含不存在的道具 ID：${unknownProps.join('、')}。只能使用以下真实 ID：${formatIdManifest(manifest.props) || '（无）'}`);
  }
  return errors;
}

/** Resolve authored screenplay evidence per episode, never from synopsis/Beat summaries. */
export function shotScreenplaySource(data: Pick<WorkshopData, 'episodes' | 'scriptRevisions' | 'currentScriptRevisionId'>, shot: Partial<WsShot>): string {
  const normalizeEpisode = (value: string) => value.trim().replace(/^0+(?=\d)/, '');
  const episodeNo = shot.episode?.trim() || shot.shotNo?.match(/^(\d+)-/)?.[1] || '';
  const episode = data.episodes.find((item) => normalizeEpisode(item.no) === normalizeEpisode(episodeNo));
  if (episode?.script?.trim() && episode.scriptStatus !== 'planned') return episode.script;
  return data.scriptRevisions?.find((revision) => revision.id === data.currentScriptRevisionId)?.content ?? '';
}

/** One-way, ordered evidence matching. Never accept extra words around a valid quote. */
export function dialogueSupportedByScreenplay(dialogue: string, source: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/[\s"'“”‘’「」『』，。！？、；：:,.!?;…—_-]+/g, '');
  const evidence = normalize(source);
  let cursor = 0;
  for (const line of dialogue.split(/\r?\n/).map(normalize).filter(Boolean)) {
    const index = evidence.indexOf(line, cursor);
    if (index < 0) return false;
    cursor = index + line.length;
  }
  return Boolean(normalize(dialogue)) && Boolean(evidence);
}

export interface ShotWriteConflictInput {
  existing: readonly WsShot[];
  incoming: readonly Partial<WsShot>[];
  mode: BreakdownWriteMode;
  /** Caller already decided whether this write may restructure the shot list. */
  canRestructureShots: boolean;
  /** Edit scope used for dialogue redistribution rules. */
  scope: string;
  canonicalDialogue: string;
  screenplayForShot?: (shot: Partial<WsShot>) => string;
  valuesEqual: (a: unknown, b: unknown) => boolean;
  isTextSupportedByCanonical: (candidate: string | undefined, canonical: string | undefined) => boolean;
}

/**
 * Collect fact-lock conflicts for a shot write. Always returns an array — callers
 * must never assume an earlier declaration exists, since a thrown TypeError
 * here previously surfaced to users as
 * `undefined is not an object (evaluating 'conflicts.push(...)')`.
 */
export function collectShotWriteConflicts(input: ShotWriteConflictInput): string[] {
  const conflicts: string[] = [];
  const {
    existing, incoming, mode, canRestructureShots, scope,
    canonicalDialogue, screenplayForShot, valuesEqual, isTextSupportedByCanonical,
  } = input;

  if (mode === 'replace' && !canRestructureShots) {
    conflicts.push('全量替换分镜表');
  }

  const existingByNo = new Map(existing.map((shot) => [shot.shotNo, shot]));
  const structuralFields: Array<keyof WsShot> = ['description', 'episode', 'sceneId', 'characterIds', 'propIds'];

  for (const candidate of incoming) {
    const shotNo = candidate.shotNo ?? '未知镜号';
    const previous = candidate.shotNo ? existingByNo.get(candidate.shotNo) : undefined;
    if (!previous) {
      if (!canRestructureShots) conflicts.push(`${shotNo} 新增分镜`);
    } else {
      const changed = structuralFields.filter(
        (field) => candidate[field] !== undefined && !valuesEqual(candidate[field], previous[field]),
      );
      if (changed.length > 0 && !canRestructureShots) conflicts.push(`${shotNo} ${changed.join('/')}`);
    }

    if (candidate.dialogue !== undefined) {
      const oldDialogue = previous?.dialogue ?? '';
      const dialogueChanged = candidate.dialogue !== oldDialogue;
      const supportedRedistribution = (scope === 'shots' || scope === 'breakdown')
        && Boolean(candidate.dialogue.trim())
        && (screenplayForShot
          ? dialogueSupportedByScreenplay(candidate.dialogue, screenplayForShot({ ...previous, ...candidate }))
          : isTextSupportedByCanonical(candidate.dialogue, canonicalDialogue));
      if (dialogueChanged && scope !== 'story' && !supportedRedistribution) {
        conflicts.push(`${shotNo} 对白`);
      }
    }
  }

  if (mode === 'replace' && (scope === 'shots' || scope === 'breakdown')) {
    const nextDialogue = incoming.map((shot) => shot.dialogue ?? '').filter(Boolean).join('\n');
    if (
      canonicalDialogue.trim()
      && !dialogueSupportedByScreenplay(canonicalDialogue, nextDialogue)
    ) {
      conflicts.push('replace 后的对白总量与原剧本不一致');
    }
  }

  return conflicts;
}

const REQUIRED_TIMELINE_TRACKS = ['body', 'camera', 'sound'] as const;
type RequiredTimelineTrack = (typeof REQUIRED_TIMELINE_TRACKS)[number];

interface TimelineCharacterLike {
  id: string;
  name?: string;
}

function normalizedTimelineSubject(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function timelineSubjects(segment: Partial<ShotTimelineSegmentLike>): string[] {
  const subject = normalizedTimelineSubject(segment.subject);
  return subject ? [subject] : [];
}

function subjectMatchesCharacter(subject: string, character: TimelineCharacterLike): boolean {
  const id = normalizedTimelineSubject(character.id);
  const name = normalizedTimelineSubject(character.name);
  return subject === id
    || subject.includes(id)
    || Boolean(name && subject.includes(name));
}

/**
 * A multi-person shot must be traceable per physical character. The generic
 * body track answers "what happens in the shot", but it cannot distinguish
 * simultaneous performances such as one person operating while another looks
 * down and a third stands at the desk end.
 *
 * We deliberately validate `characterIds` (the authoritative physical cast),
 * not prose mentions or media-only people. A character satisfies this gate
 * when at least one timeline segment names them in `subject`; the segment may
 * use body, gaze, emotion, hand, or prop track depending on the authored beat.
 */
function findUncoveredCharacterIds(
  shot: Partial<WsShot>,
  characters: readonly TimelineCharacterLike[],
): string[] {
  const timeline = shot.actionTimeline;
  if (!timeline?.segments?.length) return [];
  const cast = [...new Set((shot.characterIds ?? []).filter(Boolean))];
  if (cast.length === 0) return [];

  const covered = new Set<string>();
  for (const segment of timeline.segments) {
    const subjects = timelineSubjects(segment);
    if (subjects.length === 0) continue;
    for (const characterId of cast) {
      const character = characters.find((item) => item.id === characterId) ?? { id: characterId };
      if (subjects.some((subject) => subjectMatchesCharacter(subject, character))) covered.add(characterId);
    }
  }
  return cast.filter((characterId) => !covered.has(characterId));
}

export function validateTimelineCharacterCoverage(
  shot: Partial<WsShot>,
  characters: readonly TimelineCharacterLike[],
): string[] {
  const missing = findUncoveredCharacterIds(shot, characters);
  if (missing.length === 0) return [];
  const missingNames = missing.map((characterId) => {
    const character = characters.find((item) => item.id === characterId);
    return character?.name ? `${characterId}=${character.name}` : characterId;
  });
  return [`${shot.shotNo ?? '未知镜号'}: actionTimeline 未逐人覆盖本镜实体角色：${missingNames.join('、')}。多人镜头必须为 characterIds 中每个角色至少写一条带 subject 的可见动作/反应时间段；subject 必须使用真实角色 id 或姓名，不能只写“队员”“众人”等泛称。`];
}

export interface TimelineCoverageRepair {
  shotNo: string;
  addedSubjects: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a continuity-state sentence into the per-character clauses that
 * authors already write. `entryState.characters` is a mandatory field shaped
 * like `"lu_chen坐操作位；zhou_ye低头；qin_yan站在桌端"`, so the position and
 * posture of every physical character is already recorded as a fact. Reusing
 * those clauses verbatim therefore restates stored facts instead of inventing
 * new action.
 */
function characterClauses(characters: string | undefined): string[] {
  return (characters ?? '')
    .split(/[;；\n]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function clauseForCharacter(
  clauseList: readonly string[],
  character: TimelineCharacterLike,
): string {
  const id = normalizedTimelineSubject(character.id);
  const name = normalizedTimelineSubject(character.name);
  return clauseList.find((clause) => {
    const normalized = normalizedTimelineSubject(clause);
    return normalized.includes(id) || Boolean(name && normalized.includes(name));
  }) ?? '';
}

/**
 * Deterministically restate stored continuity facts for any physical character
 * the timeline forgot to name. This mirrors `repairDerivableTimelineTracks`:
 * it never invents a story event, it only copies the character's already
 * recorded position/posture clause into a subject-tagged segment so a
 * multi-person shot stops rendering (and validating) as if only the lead acts.
 *
 * Callers should run this before `validateTimelineCharacterCoverage`; anything
 * still missing afterwards is a genuine authoring gap and must fail loudly.
 */
export function repairTimelineCharacterCoverage<T extends Partial<WsShot>>(
  shot: T,
  characters: readonly TimelineCharacterLike[],
): { shot: T; repair: TimelineCoverageRepair | null } {
  const timeline = shot.actionTimeline;
  if (!timeline?.segments?.length) return { shot, repair: null };
  const missing = findUncoveredCharacterIds(shot, characters);
  if (missing.length === 0) return { shot, repair: null };

  const duration = Number(
    Number.isFinite(timeline.durationSec) && timeline.durationSec > 0
      ? timeline.durationSec
      : shot.durationSec,
  );
  if (!Number.isFinite(duration) || duration <= 0) return { shot, repair: null };

  const entryClauses = characterClauses(shot.entryState?.characters);
  const exitClauses = characterClauses(shot.exitState?.characters);
  const segments = timeline.segments.map((segment) => ({ ...segment }));
  const extraSegments: ShotTimelineSegmentLike[] = [];
  const addedSubjects: string[] = [];
  for (const characterId of missing) {
    const character = characters.find((item) => item.id === characterId) ?? { id: characterId };
    const subject = character.name?.trim() || character.id;
    // Prefer the least invasive repair: an existing untagged segment whose
    // label already names this character *is* that character's beat. Tagging
    // it restores coverage without adding a duplicate lane.
    const namedSegment = segments.find((segment) => {
      if (segment.subject?.trim()) return false;
      return subjectMatchesCharacter(normalizedTimelineSubject(segment.label), character);
    });
    if (namedSegment) {
      namedSegment.subject = subject;
      addedSubjects.push(subject);
      continue;
    }
    // Otherwise fall back to the character's already-recorded continuity
    // clause, so a stationary background character still gets a subject beat.
    const clause = clauseForCharacter(entryClauses, character)
      || clauseForCharacter(exitClauses, character);
    if (!clause) continue;
    // The stored clause may lead with the raw id (`qin_yan站桌端…`); swap in
    // the display name so the generated timeline and prompt read naturally.
    const label = character.name
      ? clause.replace(new RegExp(escapeRegExp(character.id), 'giu'), character.name)
      : clause;
    extraSegments.push({ startSec: 0, endSec: duration, track: 'body', label, subject });
    addedSubjects.push(subject);
  }
  if (addedSubjects.length === 0) return { shot, repair: null };

  return {
    shot: {
      ...shot,
      actionTimeline: { ...timeline, segments: [...segments, ...extraSegments] },
    } as T,
    repair: { shotNo: shot.shotNo ?? '(未知镜号)', addedSubjects },
  };
}

export interface TimelineTrackRepair {
  shotNo: string;
  addedTracks: RequiredTimelineTrack[];
}

/**
 * Auto-fill *derivable* required actionTimeline tracks instead of rejecting the
 * whole batch.
 *
 * Rationale: `atomicAction`, `camera` and `soundIntent` are already mandatory on
 * every shot, so a timeline missing body/camera/sound is not missing a story
 * fact — it is missing a mechanical restatement of facts the shot already
 * carries. Deriving the track from those fields invents nothing and keeps the
 * all-or-nothing batch write from failing on a bookkeeping omission.
 *
 * Tracks whose source field is empty are left alone so genuine gaps still fail
 * loudly in the validator.
 */
export function repairDerivableTimelineTracks(
  shots: readonly Partial<WsShot>[],
): { shots: Array<Partial<WsShot>>; repairs: TimelineTrackRepair[] } {
  const repairs: TimelineTrackRepair[] = [];
  const next = shots.map((shot) => {
    const timeline = shot.actionTimeline;
    if (!timeline || !Array.isArray(timeline.segments) || timeline.segments.length === 0) return shot;

    const duration = Number(
      Number.isFinite(timeline.durationSec) && timeline.durationSec > 0
        ? timeline.durationSec
        : shot.durationSec,
    );
    if (!Number.isFinite(duration) || duration <= 0) return shot;

    const present = new Set(timeline.segments.map((segment) => String(segment.track)));
    const sources: Record<RequiredTimelineTrack, string> = {
      body: (shot.atomicAction || shot.description || '').trim(),
      camera: (shot.camera || '').trim(),
      sound: (shot.soundIntent || '').trim(),
    };

    const addedTracks: RequiredTimelineTrack[] = [];
    const extraSegments = [];
    for (const track of REQUIRED_TIMELINE_TRACKS) {
      if (present.has(track)) continue;
      const label = sources[track];
      if (!label) continue;
      extraSegments.push({ startSec: 0, endSec: duration, track, label });
      addedTracks.push(track);
    }
    if (addedTracks.length === 0) return shot;

    repairs.push({ shotNo: shot.shotNo ?? '(未知镜号)', addedTracks });
    return {
      ...shot,
      actionTimeline: {
        ...timeline,
        durationSec: duration,
        summary: timeline.summary?.trim() || sources.body || sources.camera || sources.sound,
        segments: [...timeline.segments, ...extraSegments],
      },
    };
  });
  return { shots: next, repairs };
}
