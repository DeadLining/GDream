import { REF2VA_GUIDE, REF2VA_SKILL } from './h3Ref2vaSkillContent.ts';
import { unquoteH3Dialogue } from './h3DialoguePayload.ts';
import { h3FormatAuthoringContract, h3FormatIssues } from './h3PromptFormat.ts';

/** Bundled reference-mode authoring skill and its supporting guide. */
export const H3_REF2VA_SKILL = `${REF2VA_SKILL}\n\n## Complete Reference Mode Guide\n${REF2VA_GUIDE}`;
export const H3_REF2VA_OUTPUT_CONTRACT = h3FormatAuthoringContract(true);
const FIELDS = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:'];

/** Pull the predecessor's finished physical state out of the same-scene context. */
export function tailExitState(previousShotContext?: string): string {
  if (!previousShotContext) return '';
  try {
    const parsed = JSON.parse(previousShotContext) as { exitState?: unknown };
    const exitState = parsed.exitState;
    if (typeof exitState === 'string') return exitState.trim();
    if (exitState && typeof exitState === 'object') {
      return ['location', 'time', 'characters', 'props', 'environment']
        .map((key) => {
          const value = (exitState as Record<string, unknown>)[key];
          return typeof value === 'string' ? value.trim() : '';
        })
        .filter(Boolean)
        .join('; ');
    }
  } catch {
    // previousShotContext may be free text; absence of a structured exitState is fine.
  }
  return '';
}

/** Previous-shot reference policy: optional by default, explicitly first-frame on request. */
export function ref2vaPreviousShotReferenceInstruction(
  references: ReadonlyArray<{ kind?: string; path?: string }>,
  previousTailPath?: string,
  previousShotContext?: string,
  asFirstFrame = false,
): string {
  if (!previousTailPath) return 'No previous-shot continuity reference is attached.';
  const pictures = references.filter((ref) => ref.kind !== '音频' && ref.kind !== '视频');
  const index = pictures.findIndex((ref) => ref.path === previousTailPath);
  if (index < 0) throw new Error('上一镜真实尾帧未包含在本次参考图中，无法作为连续性参考。');
  if (asFirstFrame) {
    const exitState = tailExitState(previousShotContext);
    return `FIRST-FRAME ANCHOR (EXPLICIT USER REQUEST): <Picture ${index + 1}> is the authored first frame.\n${ref2vaOpeningFrameInstruction(references, previousTailPath)}` +
      (exitState ? `\nThe accepted previous shot already completed this physical state: ${exitState}. Treat it as history and continue forward from there.` : '') +
      `\nDevelop the planned action continuously from this opening state. This does not force the current shot's ending composition.`;
  }
  return `OPTIONAL PREVIOUS-SHOT CONTINUITY REFERENCE: <Picture ${index + 1}> is the previous shot's accepted tail. It is optional continuity context only, not a required first frame, keyframe, or last frame.
Use it only when it helps preserve identity, wardrobe, screen positions, facing, support surfaces, prop ownership, and lighting continuity. The current shot may choose its own opening composition, make motivated cuts, and end on its own planned final composition.
Do not treat this image as a template for the whole shot or force the current shot into its composition. When current-shot facts establish a different camera setup or staging, follow the current shot and script.`;
}
/** Prompt-level opening alignment; keeps Ref2VA references, never switches API mode. */
export function ref2vaOpeningFrameInstruction(
  references: ReadonlyArray<{ kind?: string; path?: string }>,
  previousTailPath?: string,
): string {
  if (!previousTailPath) return 'No accepted preceding tail is attached: do not invent a first-frame alignment target.';
  const pictures = references.filter((ref) => ref.kind !== '音频' && ref.kind !== '视频');
  const index = pictures.findIndex((ref) => ref.path === previousTailPath);
  if (index < 0) throw new Error('上一镜真实尾帧未包含在本次参考图中，无法按该图约束开场。');
  return `REQUIRED OPENING FRAME: <Picture ${index + 1}> is the accepted preceding tail and the required visual starting frame at 00:00.000.
In subject_definitions identify that exact Picture as the opening target, not another Subject. In detailed_description begin [Shot 1] at 00:00.000 matching that Picture and describe its actual visible composition: camera viewpoint, framing, subject scale, world positions, support surfaces where evidenced, facing, poses, held objects/contact, lighting and background arrangement. Do not infer flight from cropped feet, fog or airborne background figures. Do not open on another composition and dissolve, cut, or morph into the reference. Other asset images supply identity and appearance, not replacement opening blocking.
Preserve each consequential visible object state: a closed laptop stays closed until a visible opening action; an object stays held or supported until an explicit release or transfer. Asset appearance never overrides this starting state. Do not invent an unobserved state.
Only the opening instant is aligned; continue the current action immediately with natural motion and motivated camera changes, without freezing the image or replaying the preceding shot. Later cuts must preserve physical continuity. This is a prompt-level requirement inside the six-section Ref2VA format, not an I2VA request or an API-guaranteed pixel lock. Ignore legacy wording that calls this tail optional or says it is not a mandatory first frame.`;
}

/** Validate only. Submitting must not silently prepend authoring instructions. */
export function validateRef2vaSubmission(prompt: string, referencePaths: readonly string[], previousTailPath?: string): void {
  if (/This is a reference image,\s*not a required keyframe or ending\.?/iu.test(prompt)) {
    throw new Error('提示词仍含旧版“尾帧不是必须关键帧”的冲突说明，请在编辑器中删除或重写后提交；原内容未修改，未提交视频生成。');
  }
  if (previousTailPath && !referencePaths.includes(previousTailPath)) {
    throw new Error('上一镜实际尾帧未包含在最终参考图中，未提交视频生成。');
  }
}

/** Remove verbatim speech copies outside detailed_description, not repeated script turns. */
export function normalizeRef2vaDialogue(prompt: string): string {
  const section = detailSection(prompt);
  if (!section) return prompt;
  const { start, end } = section;
  const pattern = /<d\s*>[\s\S]*?<\/d\s*>/giu;
  const canonical = new Set((prompt.slice(start, end).match(pattern) ?? []).map((line) => line.replace(/\s+/gu, ' ').trim()));
  return prompt.replace(pattern, (line, index: number) => index >= start && index < end || !canonical.has(line.replace(/\s+/gu, ' ').trim())
    ? line : '(dialogue performed in the detailed timeline)');
}

/** Authoring ledgers never reach the video model, regardless of prompt layout. */
export function stripRef2vaAuthoringAppendix(prompt: string): string {
  // REFERENCE ORDER / REFERENCE ROLES normally belong in the request header
  // before subject_definitions. Only drop them when they appear after the last
  // real section, which is where a model leaks an authoring appendix.
  const finalSection = prompt.indexOf('non_diegetic_music:');
  const from = finalSection < 0 ? 0 : finalSection + 'non_diegetic_music:'.length;
  const tail = prompt.slice(from);
  const marker = /\n+(?:EXACT DIALOGUE|AUTHORITATIVE SPEECH TURNS|CANONICAL FACTS|LEGACY PROMPT|REFERENCE ORDER|REFERENCE ROLES)\s*:/iu.exec(tail);
  if (marker?.index === undefined) return prompt;
  const at = from + marker.index;
  return prompt.slice(0, at).trimEnd();
}

/**
 * Remove meta-prevention prose so it cannot re-enter a rewrite. This is not a
 * semantic audit and it blocks nothing: it breaks a self-copying loop. A
 * previous generated prompt is fed back as legacy text, and fact fields phrased
 * as prohibitions ("他不会再次跪地") get translated into lines such as "he does
 * not kneel again". Those clauses carry no cinematography, they crowd out the
 * action, and once written they get copied forward forever. The surrounding
 * action prose is preserved.
 */
/**
 * Normalize auxiliary prose labels inside detailed_description. `CAMERA:` and
 * `CONTINUITY:` sometimes come from the old authoring scaffold, but carry
 * real information, particularly camera movement. Strip only the label and
 * keep the sentence, so the content stays in the timeline instead of being
 * deleted.
 */
export function foldRef2vaAuxiliaryLabels(prompt: string): string {
  const start = prompt.indexOf('detailed_description:');
  const end = prompt.indexOf('overall_soundscape:', start);
  if (start < 0 || end < start) return prompt;
  const body = prompt.slice(start + 'detailed_description:'.length, end);
  const label = /^\s*(?:CAMERA|CONTINUITY|STAGING|BLOCKING|PROP CONTINUITY)\s*:/imu;
  if (!label.test(body)) return prompt;
  const cleaned = body
    // Keep the prose after each label; merge it into the preceding line so the
    // detail remains camera/staging content inside the shot block.
    .replace(/^[ \t]*(?:CAMERA|CONTINUITY|STAGING|BLOCKING|PROP CONTINUITY)[ \t]*:[ \t]*/gimu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return `${prompt.slice(0, start + 'detailed_description:'.length)}\n${cleaned}\n\n${prompt.slice(end).replace(/^\s+/, '')}`;
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function subjectDefinitions(prompt: string): string {
  const start = prompt.indexOf('subject_definitions:');
  if (start >= 0) {
    const from = start + 'subject_definitions:'.length;
    const ends = FIELDS.filter((field) => field !== 'subject_definitions:')
      .map((field) => prompt.indexOf(field, from)).filter((at) => at >= 0);
    return prompt.slice(from, ends.length ? Math.min(...ends) : undefined).trim();
  }
  // Headerless identity bindings are explicit declarations, not action mentions.
  return prompt.split(/\r?\n/u)
    .filter((line) => /^\s*<Subject\s+\d+>\s*(?:[（(][^）)]*[）)])?\s*[:：]/iu.test(line))
    .join('\n');
}

function detailSection(prompt: string): { start: number; end: number; text: string } | null {
  if (!prompt.trim()) return null;
  const starts = ['detailed_description:', 'integrated_multimodal_description:']
    .map((field) => prompt.indexOf(field)).filter((at) => at >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  const ends = ['overall_soundscape:', 'non_diegetic_music:']
    .map((field) => prompt.indexOf(field, start)).filter((at) => at >= 0);
  const end = ends.length ? Math.min(...ends) : prompt.length;
  return { start, end, text: prompt.slice(start, end) };
}

function dialogueTagOccurrences(timeline: string, text: string): RegExpMatchArray[] {
  const wanted = spokenWords(text);
  return [...timeline.matchAll(/<d\s*>\s*(?:\[[^\]]+\]\s*)?([\s\S]*?)\s*<\/d\s*>/giu)]
    .filter((match) => spokenWords(match[1] ?? '') === wanted);
}

/** Wrap a supplied exact line already present in the timeline; never invent speech. */
export function ensureRef2vaDialogueTags(prompt: string, dialogue?: string): string {
  const section = detailSection(prompt);
  if (!section) return prompt;
  const turns = (dialogue ?? '')
    .split(/\r?\n/u)
    .map(parseRef2vaDialogueLine)
    .filter((turn): turn is Ref2vaDialogueTurn => Boolean(turn));
  if (!turns.length) return prompt;
  let timeline = section.text;
  for (const turn of turns) {
    if (dialogueTagOccurrences(timeline, turn.exactSpokenText).length > 0) continue;
    const words = escapeRegExp(turn.exactSpokenText);
    const labelled = new RegExp(`[^：:\\n]{1,40}?[（(][^）)]*[）)][：:]\\s*[「“『]?${words}[」”』]?`, 'u');
    if (labelled.test(timeline)) timeline = timeline.replace(labelled, turn.requiredDialogueTag);
    else timeline = timeline.replace(new RegExp(escapeRegExp(turn.exactSpokenText), 'u'), turn.requiredDialogueTag);
  }
  return prompt.slice(0, section.start) + timeline + prompt.slice(section.end);
}

/**
 * Ref2VA examples require a stable (Sx) beside every emitted line. When the
 * model used visual Subject ids but omitted voice ids, derive them from the
 * nearest Subject already present; this changes formatting, not authorship.
 */
/**
 * Assign `(Sx)` by the order of actual vocal events, as the H3 guide requires.
 *
 * The id is a property of the utterance order, not of the `<Subject N>` asset
 * index. Numbering by subject index produced prompts whose first speaker was
 * labelled `(S2)`, which contradicts the guide and makes the model rebind the
 * voice to the wrong on-screen speaker.
 */
export function voiceIdByVocalOrder(timeline: string, subjectForEmission?: (emissionIndex: number) => string | undefined): Map<string, string> {
  const mapping = new Map<string, string>();
  let index = 0;
  for (const emission of timeline.matchAll(/<d\s*>[\s\S]*?<\/d\s*>/giu)) {
    const at = emission.index ?? 0;
    const subject = subjectForEmission
      ? subjectForEmission(emission.index ?? 0)
      : [...timeline.slice(0, at).matchAll(/<Subject\s+(\d+)>/giu)].slice(-1)[0]?.[1];
    if (!subject || mapping.has(subject)) continue;
    mapping.set(subject, `S${++index}`);
  }
  return mapping;
}

/**
 * Map a `<Subject N>` definition line to the name(s) it declares.
 * `<Subject 2> (宇智波佐助 / Sasuke): ...` and `<Subject 2> is Sasuke...` both work.
 */
function subjectNamesByIndex(prompt: string): Map<string, string> {
  const definitions = subjectDefinitions(prompt);
  const names = new Map<string, string>();
  for (const line of definitions.split(/\r?\n/u)) {
    if (/^\s*<Subject\s+\d+> speaker voice \(S\d+\)\.\s*$/iu.test(line)) continue;
    const index = line.match(/<Subject\s+(\d+)>/iu)?.[1];
    if (!index) continue;
    const head = line.split(/[:：]/u, 1)[0];
    const parenthetical = head.match(/[（(]([^（）()]*)[)）]/u)?.[1] ?? '';
    const bare = head
      .replace(/<Subject\s+\d+>/iu, '')
      .replace(/[（(][^（）()]*[)）]/gu, '')
      .trim();
    names.set(index, [parenthetical, bare].filter(Boolean).join(' / '));
  }
  return names;
}

/**
 * Align `<Subject N>` numbering with vocal order whenever a shot has dialogue.
 *
 * Three signals describe the same thing and must not disagree: the subject
 * number, the `(Sx)` speaker id, and who actually speaks first. When a shot
 * opens on the second-listed subject and that subject speaks first, the prompt
 * carried `<Subject 2> (S1)`, and a model that pairs numbers by index gives the
 * line to `<Subject 1>`. Renumbering the speaking subjects to the front makes
 * every reading of the prompt agree, without changing any referenced identity.
 *
 * Subjects that never speak keep their relative order after the speakers.
 */
export function alignRef2vaSubjectNumbering(prompt: string, dialogue?: string): string {
  const turns = parseDialogueTurns(dialogue);
  const names = subjectNamesByIndex(prompt);
  if (!turns.length || !names.size) return prompt;

  // Resolve each turn to the single subject whose definition names that speaker.
  const speakingOrder: string[] = [];
  for (const turn of turns) {
    const wanted = turn.speaker.normalize('NFKC').replace(/[\s"“”‘’'·・]/gu, '').toLowerCase();
    if (!wanted) return prompt;
    const matches = [...names.entries()].filter(([, name]) => {
      const canonical = name.normalize('NFKC').replace(/[\s"“”‘’'·・/]/gu, '').toLowerCase();
      return canonical.length > 1 && wanted.length > 1
        && (canonical.includes(wanted) || wanted.includes(canonical));
    });
    if (matches.length !== 1) return prompt;
    if (!speakingOrder.includes(matches[0][0])) speakingOrder.push(matches[0][0]);
  }
  if (!speakingOrder.length) return prompt;

  const rest = [...names.keys()].filter((index) => !speakingOrder.includes(index));
  const order = [...speakingOrder, ...rest];
  const remap = new Map<string, string>();
  order.forEach((oldIndex, position) => remap.set(oldIndex, String(position + 1)));
  if (order.every((oldIndex) => remap.get(oldIndex) === oldIndex)) return prompt;

  // Single pass through placeholders so swapped indices cannot collide.
  const token = (value: string) => `\u0000SUBJECT${value}\u0000`;
  let result = prompt;
  for (const [oldIndex, newIndex] of remap) {
    result = result.replace(new RegExp(`<Subject\\s+${oldIndex}>`, 'giu'), token(newIndex));
  }
  result = result.replace(/\u0000SUBJECT(\d+)\u0000/gu, '<Subject $1>');
  return sortRef2vaSubjectDefinitions(result);
}

/**
 * List `subject_definitions` lines in ascending `<Subject N>` order.
 *
 * The definition block is read top to bottom, and a shot's first spoken line
 * was being bound to whoever appeared on the first line rather than to the
 * subject the line was actually assigned. Renumbering alone did not change that;
 * the lines have to be listed in the same order as the numbers they carry.
 */
export function sortRef2vaSubjectDefinitions(prompt: string): string {
  const start = prompt.indexOf('subject_definitions:');
  if (start < 0) return prompt;
  const from = start + 'subject_definitions:'.length;
  const ends = FIELDS.filter((field) => field !== 'subject_definitions:')
    .map((field) => prompt.indexOf(field, from)).filter((at) => at >= 0);
  const end = ends.length ? Math.min(...ends) : prompt.length;
  const lines = prompt.slice(from, end).split(/\r?\n/u);
  const indexed: Array<{ line: string; index: number; order: number }> = [];
  const others: string[] = [];
  lines.forEach((line, order) => {
    const index = line.match(/<Subject\s+(\d+)>/iu)?.[1];
    if (index) indexed.push({ line, index: Number(index), order });
    else others.push(line);
  });
  if (indexed.length < 2) return prompt;
  const sorted = [...indexed].sort((a, b) => a.index - b.index);
  if (indexed.every((entry, position) => entry === sorted[position])) return prompt;
  const body = [...sorted.map((entry) => entry.line), ...others.filter((line) => line.trim())];
  return prompt.slice(0, from) + '\n' + body.join('\n') + '\n' + prompt.slice(end);
}

/** Drop any existing `(Sx)` voice markers so numbering can be reassigned cleanly. */
function stripRef2vaVoiceIds(timeline: string): string {
  return timeline.replace(
    /(<d\s*>[\s\S]*?<\/d\s*>)|[ \t]*(?:[（(]\s*S\d+\s*(?:[;；]\s*speaker)?\s*[）)]|\[\s*S\d+\s*\])[ \t]*/giu,
    (_match, dialogue: string | undefined) => dialogue ?? ' ',
  );
}

export function bindRef2vaVoiceIds(prompt: string): string {
  const section = detailSection(prompt);
  if (!section) return prompt;
  // Reassign from scratch: an id already in the draft may have been numbered by
  // subject index rather than by the guide's vocal-event order.
  const timeline = stripRef2vaVoiceIds(section.text);
  const voiceIds = voiceIdByVocalOrder(timeline);
  if (!voiceIds.size) return prompt;
  let numbered = timeline;
  for (const emission of [...numbered.matchAll(/<d\s*>[\s\S]*?<\/d\s*>/giu)].reverse()) {
    const at = emission.index ?? 0;
    const subject = [...numbered.slice(0, at).matchAll(/<Subject\s+(\d+)>/giu)].slice(-1)[0]?.[1];
    const voiceId = subject ? voiceIds.get(subject) : undefined;
    if (!voiceId) continue;
    numbered = `${numbered.slice(0, at)}(${voiceId}) ${numbered.slice(at)}`;
  }
  const bound = prompt.slice(0, section.start) + numbered + prompt.slice(section.end);
  const definitions = /subject_definitions:([\s\S]*?)(?=\n(?:summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):|$)/iu.exec(bound);
  if (!definitions || !/<Subject\s+\d+>/iu.test(definitions[1])) return bound;
  // Keep existing voice descriptions, but use the same vocal-order ids in
  // both sections. Only already-defined, already-speaking subjects are bound.
  const body = definitions[1];
  const mentions = [...body.matchAll(/<Subject\s+(\d+)>/giu)];
  let synced = body.replace(/[（(]\s*(S\d+)\s*(?:[;；]\s*speaker)?\s*[）)]|\[\s*(S\d+)\s*\]/giu, (marker, _round, _square, at: number) => {
    const subject = mentions.filter((mention) => (mention.index ?? 0) <= at).slice(-1)[0]?.[1];
    const id = subject ? voiceIds.get(subject) : undefined;
    return id ? `(${id})` : marker;
  });
  for (const [subject, id] of voiceIds) {
    if (!mentions.some((mention) => mention[1] === subject)) continue;
    const declaration = `<Subject ${subject}> speaker voice (${id}).`;
    if (!synced.includes(declaration)) synced = `${synced.trimEnd()}\n${declaration}\n`;
  }
  synced = synced.trimEnd();
  const start = (definitions.index ?? 0) + 'subject_definitions:'.length;
  return bound.slice(0, start) + synced + bound.slice(start + body.length);
}



/** Explicit writer failure protocol, not a speech-rate or duration heuristic. */
export function assertRef2vaTimingResolved(text: string): void {
  const failure = text.trim().match(/^REF2VA_TIMING_UNRESOLVED:\s*([\s\S]*)$/u);
  if (failure) throw new Error(`参考模式排时未完成：${failure[1].trim() || '硬性时间约束无法兼容，请调整镜头时长或锁定时间。'}。未覆盖原提示词。`);
}

export interface Ref2vaDialogueTurn {
  speaker: string;
  language: string;
  exactSpokenText: string;
  requiredDialogueTag: string;
}

const LANGUAGE_MARKERS: Array<{ language: string; pattern: RegExp }> = [
  { language: 'Japanese', pattern: /日语|日文|日本語|Japanese/iu },
  { language: 'Korean', pattern: /韩语|韓語|朝鲜语|朝鮮語|한국어|Korean/iu },
  { language: 'English', pattern: /英语|英文|English/iu },
  { language: 'Chinese', pattern: /中文|汉语|漢語|普通话|國語|国语|Chinese|上古神言/iu },
];

function dialogueLanguage(annotation: string | undefined, text: string): string {
  const marked = annotation ? LANGUAGE_MARKERS.find((entry) => entry.pattern.test(annotation))?.language : undefined;
  if (marked) return marked;
  if (/[\u3040-\u30ff]/u.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/u.test(text)) return 'Korean';
  if (/\p{Script=Han}/u.test(text)) return 'Chinese';
  if (/[A-Za-z]/u.test(text)) return 'English';
  return 'Chinese';
}

/** Parse one canonical turn without changing the spoken words. */
export function parseRef2vaDialogueLine(rawLine: string): Ref2vaDialogueTurn | null {
  const raw = rawLine.trim();
  if (!raw) return null;
  const match = raw.match(/^(.{1,40}?)[：:]\s*([\s\S]+)$/u);
  const rawSpeaker = (match?.[1] || 'Unlabelled').trim();
  const annotation = [...rawSpeaker.matchAll(/[（(]([^（）()]*)[)）]/gu)].map((part) => part[1]).join(' ');
  const speaker = rawSpeaker
    .replace(/[（(][^（）()]*[)）]/gu, '')
    .replace(/[“”‘’'”.]/gu, '')
    .trim() || 'Unlabelled';
  let body = (match?.[2] || raw).trim();
  let taggedLanguage: string | undefined;
  const tagged = body.match(/^<d\s*>\s*(?:\[([^\]]+)\]\s*)?([\s\S]*?)\s*<\/d\s*>$/iu);
  if (tagged) {
    taggedLanguage = tagged[1]?.trim();
    body = tagged[2].trim();
  }
  const text = unquoteH3Dialogue(body).trim();
  if (!text) return null;
  const language = taggedLanguage || dialogueLanguage(annotation, text);
  return {
    speaker,
    language,
    exactSpokenText: text,
    requiredDialogueTag: `<d>[${language}] ${text}</d>`,
  };
}

/** Extract exact spoken turns from `speaker（language）: 「line」` dialogue facts. */
export function canonicalRef2vaDialogueLines(dialogue: string | undefined): string[] {
  return (dialogue || '')
    .split(/\r?\n/u)
    .map((raw) => parseRef2vaDialogueLine(raw)?.exactSpokenText)
    .filter((line): line is string => Boolean(line));
}

/** Explicit source turns for generation/repair; no inferred speech or speakers. */
export function ref2vaDialogueLedger(dialogue?: string): string {
  const turns = (dialogue ?? '')
    .split(/\r?\n/u)
    .map(parseRef2vaDialogueLine)
    .filter((turn): turn is Ref2vaDialogueTurn => Boolean(turn));
  if (!turns.length) return 'No dialogue. Do not add intelligible speech.';
  const voiceBySpeaker = new Map<string, string>();
  return turns.map((turn, index) => {
    if (!voiceBySpeaker.has(turn.speaker)) voiceBySpeaker.set(turn.speaker, `S${voiceBySpeaker.size + 1}`);
    return JSON.stringify({
      turn: index + 1,
      speaker: turn.speaker,
      speakerId: voiceBySpeaker.get(turn.speaker),
      language: turn.language,
      exactSpokenText: turn.exactSpokenText,
      requiredDialogueTag: turn.requiredDialogueTag,
    });
  }).join('\n');
}

/** Compare spoken words, not typography. Never changes the saved script. */
function spokenWords(text: string): string {
  return text.normalize('NFKC').replace(/[\p{P}\s]+/gu, '');
}

function parseDialogueTurns(dialogue?: string): Ref2vaDialogueTurn[] {
  return (dialogue ?? '')
    .split(/\r?\n/u)
    .map(parseRef2vaDialogueLine)
    .filter((turn): turn is Ref2vaDialogueTurn => Boolean(turn));
}

function subjectLabelForSpeaker(prompt: string, speaker: string): string | undefined {
  const definitions = subjectDefinitions(prompt);
  if (!definitions) return undefined;
  const wanted = speaker.normalize('NFKC').replace(/[\s"“”‘’']/gu, '').toLowerCase();
  if (!wanted) return undefined;
  const matches: string[] = [];
  for (const line of definitions.split(/\r?\n/u)) {
    const subject = line.match(/<Subject\s+(\d+)>/iu)?.[1];
    if (!subject) continue;
    const head = line.split(':', 1)[0].normalize('NFKC').replace(/[\s"“”‘’']/gu, '').toLowerCase();
    if (head.includes(wanted)) matches.push(subject);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Drop a speaker alias that duplicates the subject label. Voice ids are not
 * written here: `(Sx)` is owned by `bindRef2vaVoiceIds`, which numbers by vocal
 * order rather than by the `<Subject N>` asset index.
 */
function removeRedundantSpeakerAlias(text: string, subject: string): string {
  return text.replace(
    new RegExp(`<Subject\\s+${subject}>\\s*\\([^()]*\\)\\s*\\(S\\d+\\)`, 'giu'),
    `<Subject ${subject}>`,
  );
}

/** Remove cross-cut markers before comparing a spoken fragment to its script turn. */
function dialogueFragmentWords(text: string): string {
  return spokenWords(text.replace(/<\/?\s*(?:scenetrans|cutoff)\s*\/?>/giu, ''));
}

interface Ref2vaEmission {
  index: number;
  full: string;
  tagText: string;
  words: string;
  turnIndex?: number;
}

/**
 * Assign emitted dialogue fragments to canonical turns in playback order.
 *
 * A turn may cross an internal cut: `<d>前半<scenetrans></d>` followed by
 * `<d><scenetrans>后半</d>` is one utterance, not two speakers. Matching each
 * fragment only against a complete line loses that ownership and invites the
 * writer to rebind the continuation to whoever is nearest after the cut.
 */
function assignRef2vaDialogueTurns(emissions: Ref2vaEmission[], turns: Ref2vaDialogueTurn[]): void {
  const turnWords = turns.map((turn) => spokenWords(turn.exactSpokenText));
  let cursor = 0;
  let fragmentTurn: number | undefined;
  let fragmentWords = '';
  for (const emission of emissions) {
    const words = emission.words;
    if (!words) continue;
    if (fragmentTurn !== undefined) {
      const expected = turnWords[fragmentTurn] ?? '';
      const combined = fragmentWords + words;
      if (combined === expected) {
        emission.turnIndex = fragmentTurn;
        cursor = fragmentTurn + 1;
        fragmentTurn = undefined;
        fragmentWords = '';
        continue;
      }
      if (expected.startsWith(combined)) {
        emission.turnIndex = fragmentTurn;
        fragmentWords = combined;
        continue;
      }
      fragmentTurn = undefined;
      fragmentWords = '';
    }
    let exact = -1;
    for (let index = cursor; index < turnWords.length; index += 1) {
      if (turnWords[index] === words) {
        exact = index;
        break;
      }
    }
    if (exact >= 0) {
      emission.turnIndex = exact;
      cursor = exact + 1;
      continue;
    }
    let prefix = -1;
    for (let index = cursor; index < turnWords.length; index += 1) {
      if (turnWords[index].startsWith(words)) {
        prefix = index;
        break;
      }
    }
    if (prefix >= 0) {
      emission.turnIndex = prefix;
      fragmentTurn = prefix;
      fragmentWords = words;
    }
  }
}

/** Put the canonical speaker beside every fragment, including a continuation after a cut. */
function placeRef2vaSpeakerBesideEmission(timeline: string, at: number, subject: string): string {
  const before = timeline.slice(0, at);
  const subjectMatches = [...before.matchAll(/<Subject\s+(\d+)>/giu)];
  const lastSubject = subjectMatches[subjectMatches.length - 1];
  if (!lastSubject || lastSubject.index === undefined) {
    return `${timeline.slice(0, at)}<Subject ${subject}> ${timeline.slice(at)}`;
  }
  if (lastSubject[1] === subject) return timeline;
  const tail = before.slice(lastSubject.index + lastSubject[0].length);
  // Replace the subject only when the dialogue tag is still in the same
  // sentence. A listener named in a previous sentence stays in the shot
  // description, and the real speaker is inserted immediately before the tag.
  const sameSentence = tail.length <= 80 && !/[.!?。！？\n]/u.test(tail);
  if (sameSentence) {
    return timeline.slice(0, lastSubject.index)
      + `<Subject ${subject}>`
      + timeline.slice(lastSubject.index + lastSubject[0].length);
  }
  return `${timeline.slice(0, at)}<Subject ${subject}> ${timeline.slice(at)}`;
}

/**
 * Bind each supplied line to the Subject whose definition names that speaker.
 * This is deterministic because the script, not the draft, owns authorship.
 */
export function canonicalizeRef2vaSpeakerBindings(prompt: string, dialogue?: string): string {
  const turns = parseDialogueTurns(dialogue);
  const section = detailSection(prompt);
  if (!turns.length || !section) return prompt;
  let timeline = section.text;
  const emissions: Ref2vaEmission[] = [...timeline.matchAll(/<d\s*>(?:\s*\[[^\]]+\]\s*)?([\s\S]*?)<\/d\s*>/giu)].map((match) => ({
    index: match.index ?? 0,
    full: match[0],
    tagText: match[1] ?? '',
    words: dialogueFragmentWords(match[1] ?? ''),
  }));
  assignRef2vaDialogueTurns(emissions, turns);
  for (let index = emissions.length - 1; index >= 0; index -= 1) {
    const emission = emissions[index];
    if (emission.turnIndex === undefined) continue;
    const turn = turns[emission.turnIndex];
    const subject = subjectLabelForSpeaker(prompt, turn.speaker);
    if (!subject) continue;
    const inner = emission.tagText.trim().replace(/^\[[^\]]+\]\s*/u, '');
    const replacement = `<d>[${turn.language}] ${inner}</d>`;
    timeline = timeline.slice(0, emission.index) + replacement + timeline.slice(emission.index + emission.full.length);
    timeline = placeRef2vaSpeakerBesideEmission(timeline, emission.index, subject);
  }
  let result = prompt.slice(0, section.start) + timeline + prompt.slice(section.end);
  for (const turn of turns) {
    const subject = subjectLabelForSpeaker(result, turn.speaker);
    if (!subject) continue;
    result = removeRedundantSpeakerAlias(result, subject);
  }
  return result;
}

/**
 * Deterministic content checks, not a spatial semantic model. Repeated subject
 * mentions, crops, movement and cuts alone cannot prove multiple bodies.
 */
export function auditRef2vaPrompt(prompt: string, dialogue?: string, _previousTailPath?: string, _previousShotContext?: string): string[] {
  const issues: string[] = [];
  // Catch explicit leaked writer diagnostics only, never ordinary scene wording
  // or a character reading the same words aloud. Repair uses the existing budget.
  const prose = prompt.replace(/<d\s*>[\s\S]*?<\/d\s*>/giu, '');
  if (/\b(?:DURATION_CONFLICT|REF2VA_TIMING_UNRESOLVED)\b|\b(?:speech|dialogue) timing remains unresolved\b|\brequires resolving the duration conflict\b/iu.test(prose)) {
    issues.push('成品中含未解决的排时诊断：先协调可调整的对白与动作时间，输出确定的时间安排；硬约束确实无法兼容时使用独立排时报错，不要只删除诊断文字。');
  }

  const timeline = detailSection(prompt)?.text ?? '';

  // Previous-shot posture/prop state is not audited with keyword heuristics.
  // Actions such as standing up, kneeling, drawing, or re-gripping a prop are
  // shot-specific dramatic facts, not invariant grammar. The reference policy
  // and the writer's action timeline own that continuity; deterministic checks
  // here stay limited to structure, dialogue, explicit duplication and timing.

  const emissions: Array<{ words: string; subject: string; start: number; end: number; shotStart: number }> = [...timeline.matchAll(/<d\s*>\s*(?:\[[^\]]+\]\s*)?([\s\S]*?)\s*<\/d\s*>/giu)].map((m) => ({
    words: spokenWords(m[1]),
    // Scope speaker evidence to the current shot and since the previous speech.
    subject: '',
    start: m.index!, end: m.index! + m[0].length,
    shotStart: 0,
  }));
  emissions.forEach((emission, index) => {
    const before = timeline.slice(index ? emissions[index - 1].end : 0, emission.start);
    const shotStart = [...before.matchAll(/\[Shot\s+\d+\]/giu)].slice(-1)[0]?.index ?? 0;
    emission.subject = [...before.slice(shotStart).matchAll(/<Subject\s+(\d+)>/giu)].slice(-1)[0]?.[1] ?? '';
    emission.shotStart = shotStart;
  });
  // A sentence may be formatted as adjacent <d> chunks. Count it as one turn
  // only if no other known speaker intervenes; never join two people's lines.
  const groups: Array<{ words: string; subject: string }> = [];
  for (const emission of emissions) {
    const last = groups[groups.length - 1];
    if (last && emission.subject && emission.subject === last.subject) last.words += emission.words;
    else groups.push({ words: emission.words, subject: emission.subject });
  }
  const canonical = canonicalRef2vaDialogueLines(dialogue);
  const expected = new Map<string, { line: string; count: number }>();
  for (const line of canonical) {
    const words = spokenWords(line);
    if (!words) continue;
    expected.set(words, { line, count: (expected.get(words)?.count ?? 0) + 1 });
  }
  // A short reply ("还在") must not also count inside a longer authored
  // question ("还在吗"). Reserve longer matched utterances before shorter ones.
  const remaining = groups.map((group) => group.words);
  for (const [words, { line, count: wanted }] of [...expected].sort((left, right) => right[0].length - left[0].length)) {
    let count = 0;
    for (let group = 0; group < remaining.length; group++) {
      for (let at = remaining[group].indexOf(words); at >= 0; at = remaining[group].indexOf(words)) {
        count++;
        remaining[group] = remaining[group].slice(0, at) + ' '.repeat(words.length) + remaining[group].slice(at + words.length);
      }
    }
    if (count < wanted) issues.push(`缺少原文对白：${line}${wanted > 1 ? `（应有 ${wanted} 次，实际 ${count} 次）` : ''}`);
    if (count > wanted) issues.push(`同一句原文对白重复出现：${line}（应有 ${wanted} 次，实际 ${count} 次）`);
  }
  // Only explicit extra-body assertions are blocking. A subject standing behind
  // a desk and then seen in profile at the edge can be the very same person.
  // Strip dialogue before inspecting stage directions; quoted speech is not blocking.
  const staging = timeline.replace(/<d\s*>[\s\S]*?<\/d\s*>/giu, '');
  for (const sentence of staging.split(/[.!?。！？\n]+/u)) {
    if (/\b(?:no|not|never|without|avoid|do not|rather than|instead of|only one)\b|不要|不得|没有|禁止|而不是/iu.test(sentence)) continue;
    const duplicate = sentence.match(/\b(?:a\s+)?(?:second|another|duplicate|additional|extra)\s+(?:(?:physical|visible|separate)\s+)?(?:body|copy|figure|person|version)\s+of\s+<Subject\s+(\d+)>/iu)
      ?? sentence.match(/\b(?:two|multiple)\s+(?:bodies|copies|figures|versions)\s+of\s+<Subject\s+(\d+)>/iu);
    if (duplicate) issues.push(`Subject ${duplicate[1]} 被明确写成多个身体；请删除额外副本，保留同一人物的连续动作`);
  }
  return [...new Set(issues)];
}

/** New prompts use the official envelope; legacy parsing above remains readable. */
export function ref2vaStructureIssues(prompt: string): string[] {
  if (prompt.includes('REFERENCE_BINDING_UNRESOLVED')) {
    return ['参考对应无法确认（REFERENCE_BINDING_UNRESOLVED），请核对参考图片与主体身份'];
  }
  return h3FormatIssues(prompt, true);
}

export function validateRef2vaStructure(prompt: string): boolean {
  return ref2vaStructureIssues(prompt).length === 0;
}
