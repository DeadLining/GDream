import { buildAdShotContinuityContext } from './adContinuity.ts';
import { normalizeCharacterBibleRules } from './bibleNormalization.ts';
import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import type { WorkshopData, WsShot } from './types';

/** A reference item as seen by the prompt rewriter.  The helper deliberately
 * keeps this structural so it can be used by both workshop and canvas code. */
export interface ShotRewriteReference {
  label: string;
  kind?: string;
  /** Actual local/data URL used for native multimodal rewrite input. */
  path?: string;
  /** A preceding accepted-video tail stays a Ref2VA reference with prompt-level opening alignment, not an API boundary keyframe. */
  continuityReference?: boolean;
  /** Boundary references can be marked by the caller when their display label
   * does not contain 首帧/尾帧 (for example a canvas edge). */
  runtimeBoundary?: boolean;
}

/** Minimal workshop projection needed to build prompt facts.  Keeping this
 * narrower than WorkshopData lets render-only views (such as StepGenerate)
 * avoid subscribing to or assembling unrelated workflow state. */
export type ShotRewriteData = Pick<
  WorkshopData,
  'episodes' | 'narrativeBeats' | 'characters' | 'scenes' | 'props' | 'bibles' | 'style'
> & Partial<Pick<WorkshopData, 'shots' | 'creativeSpec' | 'synopsis'>>;

function isBoundaryLabel(label: string): boolean {
  return /(?:当前镜|本镜|镜头)?(?:首帧|尾帧|起始帧|结束帧|start\s*frame|end\s*frame)/iu.test(label);
}

/**
 * Select only the references that can be submitted for a MiniMax H3 task.
 *
 * fl2va accepts the runtime first/last frame pair, i2va accepts the runtime
 * first frame, ref2va accepts ordinary visual/audio/video references, and
 * t2va accepts none. Boundary tasks never fall back to ordinary asset
 * references: an asset image is not a substitute for a generated boundary frame.
 */
export function selectH3TaskReferences<T extends ShotRewriteReference>(
  references: readonly T[],
  task: SglangH3Task,
): T[] {
  if (task === 't2va') return [];
  if (task === 'i2va') {
    const boundaries = references.filter((reference) => reference.runtimeBoundary || isBoundaryLabel(reference.label));
    const start = boundaries.filter((reference) => /首帧|起始帧|start\s*frame/i.test(reference.label));
    return start.slice(0, 1);
  }
  if (task === 'fl2va') {
    const boundaries = references.filter((reference) => reference.runtimeBoundary || isBoundaryLabel(reference.label));
    return boundaries.slice(0, 2);
  }
  return references.filter((reference) => !(reference.runtimeBoundary || (isBoundaryLabel(reference.label) && !reference.continuityReference)));
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function formatBlockingContinuity(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): string[] => {
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const parts = [
      typeof record.scene === 'string' && record.scene ? `scene=${record.scene}` : '',
      typeof record.anchor === 'string' && record.anchor ? `anchor=${record.anchor}` : '',
      typeof record.axis === 'string' && record.axis ? `axis=${record.axis}` : '',
      typeof record.exits === 'string' && record.exits ? `exits=${record.exits}` : '',
      typeof record.state === 'string' && record.state ? `state=${record.state}` : '',
    ].filter(Boolean);
    return parts.length ? [parts.join(' | ')] : [];
  });
}
interface DialogueSpeakerFact {
  speakerLine: string;
  speakerId: string | null;
  speakerName: string | null;
  line: string;
}

/** Parse only explicit speaker labels such as `鲁肃：...`; never infer a speaker from prose. */
function parseDialogueSpeakers(dialogue: string | undefined, characters: ShotRewriteData['characters']): DialogueSpeakerFact[] {
  if (!dialogue?.trim()) return [];
  const normalizeName = (value: string) => value
    .replace(/[（(][^（）()]*[)）]/gu, '')
    .replace(/[“”‘’'”.\s·・]/gu, '')
    .trim();
  const byName = new Map(characters.map((character) => [normalizeName(character.name), character.id]));
  const resolveSpeaker = (speaker: string): string | null => {
    const normalized = normalizeName(speaker);
    if (!normalized) return null;
    const exact = byName.get(normalized);
    if (exact) return exact;
    const matches = characters.filter((character) => {
      const canonical = normalizeName(character.name);
      return canonical.length > 1 && normalized.length > 1
        && (canonical.includes(normalized) || normalized.includes(canonical));
    });
    return matches.length === 1 ? matches[0].id : null;
  };
  return dialogue
    .split(/\r?\n/u)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      // Accept both straight and curly quotes after the speaker label. The
      // original line is retained verbatim so the editor can copy it without
      // normalizing any punctuation inside the whitelist.
      const match = raw.match(/^(.{1,24}?)[：:]\s*(.+)$/u);
      if (!match) return { speakerLine: '', speakerId: null, speakerName: null, line: raw };
      const speakerName = match[1].replace(/[“”‘’'”.]/gu, '').trim();
      return { speakerLine: speakerName, speakerId: resolveSpeaker(speakerName), speakerName, line: match[2].trim() };
    });
}

/**
 * Build the canonical, structured facts supplied to the H3 prompt editor.
 * This is intentionally text rather than a model-specific request object: the
 * same facts are consumed by rewriteMiniMaxH3ShotPrompt from both entry points.
 *
 * The legacy prompt is deliberately absent: both rewrite routes carry it in
 * their own dedicated section, and echoing it here fed the writer the same text
 * twice.
 */
export function buildShotRewriteFacts(
  data: ShotRewriteData,
  shot: WsShot,
  sourceOrPrevious?: string | WsShot,
  legacyPrevious?: WsShot,
): string {
  const previousShot = typeof sourceOrPrevious === 'string' ? legacyPrevious : sourceOrPrevious;
  const sourcePrompt = typeof sourceOrPrevious === 'string' ? sourceOrPrevious : '';
  const scenes = data.scenes ?? [];
  const episodes = data.episodes ?? [];
  const scene = scenes.find((item) => item.id === shot.sceneId);
  // Older projects may contain a corrupted `scene.rules` value (a string
  // expanded into single-character objects). Prompt rewriting must stay
  // resilient and simply fall back to no scene-bible rule in that case.
  const sceneBibleRules = Array.isArray(data.bibles?.scene?.rules)
    ? data.bibles.scene.rules
    : [];
  const sceneBible = sceneBibleRules.find((rule) => rule.sceneId === shot.sceneId);
  const beat = data.narrativeBeats?.find((item) => item.id === shot.narrativeBeat || item.shotNos?.includes(shot.shotNo));
  const episode = episodes.find((item) => item.no === shot.episode);
  // `characterIds` is the authoritative physical cast for a shot.  The
  // visible/screen arrays are retained in the canonical shot snapshot below,
  // but must not silently pull extra character assets into this rewrite.
  const characterIds = new Set(shot.characterIds ?? []);
  const propIds = new Set([...(shot.propIds ?? []), ...(shot.assetPropIds ?? [])]);
  const characterFacts = data.characters
    .filter((character) => characterIds.has(character.id))
    .map((character) => ({
      id: character.id,
      name: character.name,
      personality: character.personality,
      appearance: character.appearance,
      lifecycleStages: character.lifecycleStages,
      voiceEnabled: shot.voiceCharacterIds?.includes(character.id) ?? false,
    }));
  const characterBible = data.bibles?.character;
  const normalizedCharacterBible = characterBible
    ? normalizeCharacterBibleRules(characterBible.rules as unknown, data.characters ?? [], characterBible.globalRules)
    : undefined;
  const characterBibleFacts = characterFacts.map((character) => ({
    characterId: character.id,
    lockedAppearance: normalizedCharacterBible?.rules
      .filter((rule) => rule.characterId === character.id)
      .map((rule) => rule.lockedAppearance) ?? [],
    costumeRules: normalizedCharacterBible?.rules
      .filter((rule) => rule.characterId === character.id)
      .flatMap((rule) => rule.costumeRules) ?? [],
    voiceRules: normalizedCharacterBible?.rules
      .filter((rule) => rule.characterId === character.id)
      .map((rule) => rule.voiceRules)
      .filter((rule): rule is string => Boolean(rule)) ?? [],
    lifecycleRules: normalizedCharacterBible?.rules
      .filter((rule) => rule.characterId === character.id)
      .flatMap((rule) => rule.lifecycleRules ?? []) ?? [],
  }));
  const dialogueSpeakers = parseDialogueSpeakers(shot.dialogue, characterFacts);
  const identityMap = characterFacts.map((character, index) => ({
    stableId: `S${index + 1}`,
    characterId: character.id,
    canonicalName: character.name,
    voiceEnabled: character.voiceEnabled,
  }));
  const speakerBindings = dialogueSpeakers.map((entry) => {
    const stable = identityMap.find((item) => item.characterId === entry.speakerId);
    return {
      speakerLabel: entry.speakerLine || entry.speakerName || 'unlabelled',
      canonicalName: stable?.canonicalName ?? entry.speakerName,
      characterId: stable?.characterId ?? null,
      stableId: stable?.stableId ?? null,
      line: entry.line,
    };
  });
  const propFacts = data.props
    .filter((prop) => propIds.has(prop.id))
    .map((prop) => ({ id: prop.id, name: prop.name, description: prop.description }));
  // The predecessor is continuity context, not a second script. `description`
  // and `atomicAction` are parallel restatements of the same events as
  // `actionTimeline`; feeding them alongside it makes the writer translate each
  // restatement as its own beat. Carry only the structural state a continuing
  // shot actually needs, plus the finished prompt as a prose fallback.
  const previousContinuityFacts = previousShot ? {
    shotNo: previousShot.shotNo,
    sceneId: previousShot.sceneId,
    characterIds: previousShot.characterIds,
    propIds: previousShot.propIds,
    spatialStaging: previousShot.spatialStaging,
    actionTimeline: previousShot.actionTimeline,
    entryState: previousShot.entryState,
    exitState: previousShot.exitState,
    shotType: previousShot.shotType,
    camera: previousShot.camera,
  } : undefined;

  // Director intent is the single most important input: the model must realize
  // these choices instead of inventing camera work or flattening the staging.
  // Keeping it out of the big fact object prevents it from being diluted among
  // a dozen equally weighted id fields.
  const spatial = shot.spatialStaging;
  const shotIntent = {
    camera: shot.camera,
    shotType: shot.shotType,
    mood: shot.mood,
    viewpoint: spatial?.viewpoint,
    stagingRelation: spatial?.relation,
    cameraMotivation: spatial?.cameraMotivation,
    dramaticIntent: spatial?.dramaticIntent,
    transitionPlan: shot.transitionPlan,
    soundIntent: shot.soundIntent,
  };
  // `description`, `atomicAction`, `sourceExcerpt` and `actionTimeline.summary`
  // are parallel restatements of the same events. Feeding more than one of them
  // makes the model write each restatement as its own beat, so the finished
  // prompt repeats itself. Only the structured timeline carries the action.
  const sections = [
    buildAdShotContinuityContext(data, shot),

    `DIRECTOR INTENT FOR THIS SHOT (realize these exactly; they are the shot design, not suggestions):
${stringify(shotIntent)}`,

    shot.actionTimeline
      ? `ACTION SEQUENCE — the only record of what happens, in order. Every beat below is one event; write each once.
${stringify(shot.actionTimeline)}`
      : `SOURCE ACTION TO PLAN (no authoritative timeline is available): ${shot.sourceExcerpt || shot.description || shot.atomicAction || sourcePrompt || 'No action source recorded.'}`,

    `OPENING STATE — a snapshot of what already exists at 0.00s. Read it as the starting condition, not as events to narrate.
${stringify(shot.entryState ?? null)}`,

    `CLOSING STATE — a snapshot of what is true after the final beat. Read it as the ending condition, not as events to narrate.
${stringify(shot.exitState ?? null)}`,

    `SPATIAL LAYERS for this shot:
${stringify(spatial?.layers ?? null)}`,

    `Shot identity: shot ${shot.shotNo}; episode ${shot.episode || 'unspecified'}; scene ${scene?.name || shot.sceneId || 'unspecified'}.`,
    `Scene asset fact (single source of truth): ${scene?.description || 'No scene description recorded.'}`,
    'The scene reference images already define object-to-object placement. Do not re-describe or redesign furniture, doors, windows, walls, or fixed-anchor relationships; describe only character blocking relative to an anchor when movement or physical reach requires it.',

    `Project style: ${data.style?.customText || data.style?.keywords?.join(', ') || 'Use the established project style.'}`,
    `Project and episode dramatic context (judge power relationship and camera motivation from it; genre alone never dictates an angle): ${stringify({
      genre: data.creativeSpec?.genre,
      tone: data.creativeSpec?.tone,
      audience: data.creativeSpec?.audience,
      synopsis: data.synopsis,
      episodeSynopsis: episode?.synopsis,
      episodeCentralConflict: episode?.centralConflict,
      episodeClimax: episode?.climax,
    })}`,
    sceneBible
      ? `Scene bible spatial layout: ${sceneBible.spatialLayout}\nScene bible lighting: ${sceneBible.lighting}\nScene bible palette: ${sceneBible.palette}\nScene bible texture rules: ${sceneBible.textureRules.join('; ')}`
      : '',
    `Episode context: ${episode ? stringify({
      no: episode.no,
      title: episode.title,
      synopsis: episode.synopsis,
      openingState: episode.openingState,
      centralConflict: episode.centralConflict,
      climax: episode.climax,
      endingState: episode.endingState,
      script: episode.script,
    }) : 'No matching episode record.'}`,
    beat ? `Narrative beat record: ${stringify(beat)}` : '',

    `Canonical character records: ${stringify(characterFacts)}`,
    `Canonical character bible records (identity, costume, voice and lifecycle rules): ${stringify(characterBibleFacts)}`,
    normalizedCharacterBible?.globalRules.length
      ? `Project-wide character bible rules: ${normalizedCharacterBible.globalRules.join('; ')}`
      : '',
    `Dialogue identity map (mandatory): ${stringify({ physicalCast: identityMap, speakerBindings })}\nThis map is the only cast for the shot. Any courtesy name, style name, title, rank, kinship term, or form of address inside a dialogue line belongs to the same bound speaker or the canonical character already present on stage. It must not create another visible person, listener, mouth, or sound source.`,
    `Canonical prop records: ${stringify(propFacts)}`,
    `Selected standalone prop references: ${stringify(shot.assetPropIds ?? shot.propIds ?? [])}. Incidental objects (text facts, not requests for new images): ${stringify(shot.incidentalObjects ?? [])}. Preserve their states and actions without inventing reference labels.`,

    formatBlockingContinuity(data.bibles?.continuity?.blockingContinuity).length
      ? `Blocking continuity rules: ${formatBlockingContinuity(data.bibles?.continuity?.blockingContinuity).join('; ')}`
      : '',
    data.bibles?.continuity?.lockedItems?.length
      ? `Locked continuity items: ${data.bibles.continuity.lockedItems.join('; ')}`
      : '',
    previousContinuityFacts
      ? `Previous same-scene shot continuity context (temporal predecessor, not extra cast or an additional scene): ${stringify(previousContinuityFacts)}
Use this previous shot to understand the last known world position, support surface, facing, prop state, camera direction, and the completed action. ${shot.usePreviousTailAsFirstFrame
  ? 'The accepted tail is explicitly selected as the first-frame anchor. Match its visible opening state, then continue the current action; it does not force the ending composition.'
  : "The accepted tail, when present, is optional continuity context for identity, wardrobe, relative positions, facing, supports, prop state and lighting; it does not force the current shot's opening or ending composition."} When the current shot continues directly, carry that physical state forward; otherwise follow the current shot's own entryState and actionTimeline.`
      : '',

  ];
  return sections.filter(Boolean).join('\n\n');
}
