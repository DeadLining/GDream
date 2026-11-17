import {
  escapeH3RegExp,
  findVisibleOffscreenSentences,
  mentionedSubjectNames,
  normalizeMiniMaxH3DialogueEmissions,
  sanitizeMiniMaxH3Prompt,
  tightShotFocalNames,
  validateMiniMaxH3VideoPrompt,
} from './h3PromptContract.ts';

const I2VA_BOUNDARY_WARNING_MARKERS = [
  '镜头块顺序风险',
  '尾帧继承风险',
  '紧画幅人物复制风险',
  '切镜主体继承风险',
  '对白重复发声风险',
] as const;

const RETURN_TO_MASTER_PATTERN = /(?:\b(?:camera\s+)?(?:returns?|returned|returning)\s+(?:from|to|into)\b|\b(?:cut|cuts|cutting)\s+(?:back\s+)?to\b|\b(?:pull|pulls|pulled|pulling)\s+(?:back|out)\b|\b(?:widen|widens|widened|widening)\b|\b(?:move|moves|moved|moving)\s+back\b|\b(?:reframe|reframes|reframed|reframing)\b|\b(?:end|ends|ending)\s+(?:on|with)\b)[\s\S]{0,170}\b(?:medium|two-shot|three-person|master|wider|wide)\b/giu;

function findReturnToMasterIndex(text: string): number {
  for (const match of text.matchAll(RETURN_TO_MASTER_PATTERN)) {
    const start = match.index ?? 0;
    const prefix = text.slice(Math.max(0, start - 36), start);
    if (/\b(?:without|not|never|no|avoids?|avoided)\s+(?:a\s+|an\s+|the\s+|another\s+)?(?:return\s+)?$/iu.test(prefix)) continue;
    if (/\b(?:does|do|did)\s+not\s*$/iu.test(prefix)) continue;
    if (/\bwithout\s+(?:a\s+)?return(?:ing)?\b/iu.test(match[0])) continue;
    if (/\b(?:never|does\s+not|doesn't)\s+return(?:s|ing)?\b/iu.test(match[0])) continue;
    return start;
  }
  return -1;
}

function shotBlocks(description: string): Array<{ index: number; text: string; start: number; end: number }> {
  return [...description.matchAll(/\[Shot\s+(\d+)\]([\s\S]*?)(?=\[Shot\s+\d+\]|\n\s*\[(?:SUBJECTS|WORLD_CONTINUITY|OBJECT_CONTINUITY|ACTION_ENGINE|DIALOGUE|CAMERA_LOGIC|STATE_TRANSITION|RESTRICTIONS)\]|$)/giu)]
    .map((match) => {
      const start = match.index ?? 0;
      return {
        index: Number(match[1]),
        text: match[2]?.trim() ?? '',
        start,
        end: start + match[0].length,
      };
    });
}

function subjectNamesFromPrompt(text: string): string[] {
  const subjectBlock = text.split('[SUBJECTS]')[1]?.split(/\[[A-Z_]+\]/u)[0] ?? '';
  return [...subjectBlock.matchAll(/([\p{Script=Han}·]{2,8}|[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*)\s*\(S\d+\b/gu)]
    .map((match) => match[1].trim())
    .filter((name, index, all) => name.length > 1 && all.indexOf(name) === index);
}

/**
 * The generated prompt previously emitted [Shot 3] before [Shot 2]. H3 reads
 * the sequence in playback order, so out-of-order labels can be interpreted as
 * parallel composition blocks and increase duplicate-body risk.
 */
export function getShotOrderRisk(prompt: string): string | null {
  const integrated = prompt.split('integrated_multimodal_description:')[1]?.split('overall_soundscape:')[0] ?? '';
  const numbers = [...integrated.matchAll(/\[Shot\s+(\d+)\]/giu)].map((match) => Number(match[1]));
  if (numbers.length < 2) return null;
  const expected = numbers.map((_, index) => index + 1);
  return numbers.every((number, index) => number === expected[index])
    ? null
    : `H3 镜头块顺序风险：integrated_multimodal_description 中的 [Shot N] 必须从 [Shot 1] 起按播放顺序连续编号；当前顺序为 ${numbers.map((number) => `[Shot ${number}]`).join(' -> ')}`;
}

function formatH3Time(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

/**
 * I2VA has only one submitted opening frame. Unless the canonical shot facts
 * explicitly authorize an internal transition, convert model-invented editorial
 * cuts into continuous reframing language. This prevents a reaction close-up
 * from re-instantiating the cast and keeps the final frame chainable.
 */
export function normalizeI2vaContinuousTake(prompt: string, allowInternalCut = false): string {
  if (allowInternalCut) return prompt;
  const start = prompt.indexOf('integrated_multimodal_description:');
  const end = prompt.indexOf('overall_soundscape:', start + 1);
  if (start < 0 || end < 0) return prompt;

  let integrated = prompt.slice(start, end)
    .replace(/(?:\n\s*)?\[Shot\s+(?:2|3|4|5|6|7|8|9|\d{2,})\]\s*/giu, '\n')
    .replace(/\b(?:the\s+camera\s+)?(?:make\s+)?(?:a\s+)?(?:single\s+)?cut\s+(?:once\s+)?to\b/giu, 'the camera continuously reframes toward')
    .replace(/\b(?:the\s+)?camera\s+cuts?\s+(?:once\s+)?to\b/giu, 'the camera continuously reframes toward')
    .replace(/\b(?:one|a single|the one specified|the single)\s+(?:editorial\s+)?cut\b/giu, 'one continuous reframing')
    .replace(/\bwithout another cut\b/giu, 'without interrupting the continuous take')
    .replace(/\bwith(?:out)?\s+a\s+cut\b/giu, 'within the continuous take')
    .replace(/\bthe single cut changes framing only\b/giu, 'the continuous reframing changes framing only')
    .replace(/\n{3,}/gu, '\n\n');
  let repaired = prompt.slice(0, start) + integrated + prompt.slice(end);
  if (!repaired.includes('CONTINUOUS TAKE LOCK')) {
    repaired = insertBeforeSection(
      repaired,
      '[CAMERA_LOGIC]',
      'CONTINUOUS TAKE LOCK: This I2VA shot is one uninterrupted take. All changes of framing, focus, or scale are continuous camera movement only; do not create an editorial cut or a new shot block. Existing subjects, props, world positions, and screen direction persist through the reframing.',
    );
  }
  return repaired;
}

function insertBeforeSection(text: string, section: string, addition: string): string {
  const start = text.indexOf(section);
  if (start < 0) return text;
  return `${text.slice(0, start).trimEnd()}\n${addition}\n${text.slice(start)}`;
}

/**
 * Return only I2VA boundary-composition risks. Ordinary factual, dialogue,
 * length, or section warnings are intentionally left to their own validators.
 */
export function getI2vaBoundaryRisks(
  prompt: string,
  durationSec: number,
  dialogue?: string,
): string[] {
  return validateMiniMaxH3VideoPrompt(prompt, durationSec, dialogue, 'i2va')
    .filter((warning) => I2VA_BOUNDARY_WARNING_MARKERS.some((marker) => warning.includes(marker)));
}

export function buildI2vaBoundaryRepairInstruction(warnings: readonly string[]): string {
  return `You are repairing an existing MiniMax H3 I2VA prompt. Return the complete corrected prompt only, with no explanation and no Markdown fence.

This is a boundary-composition repair, not a story rewrite. Preserve every established identity, relationship, dialogue line, prop, location fact, action order, sound detail, and required end state. Do not add or remove people, dialogue, props, plot events, or outcomes.

Mandatory correction:
- Treat the final [Shot N] as the composition at the target duration.
- If the final shot is a close-up, insert, reaction shot, or otherwise tighter than a medium framing, keep it only as internal coverage and add a return during the final action beat.
- The final [Shot N] must describe an inheritable medium framing or the established spatial master: the relevant existing subject or subjects remain visible with their action state legible, a modest recognizable amount of background preserves context, and world positions, facing, proportions, and screen direction stay consistent.
- Do not end on an isolated hand, eye, partial face, small prop detail, or ambiguous off-center crop.
- While tighter framing is active, omit off-screen subject names and visible behavior from the tight-shot prose; their world positions are already represented by [WORLD_CONTINUITY]. They stay invisible and must not be re-rendered, duplicated, or brought into that frame.
- Treat every internal cut or pull-out as a framing-only operation. Describe the actual matching subjects, poses, eyelines and prop contacts across the cut. Do not append generic LOCK paragraphs; write the concrete final medium composition in the final timed action paragraph.
- Update the camera-direction and state-transition prose so both agree with the corrected ending. Any earlier hold-close-up-to-the-end wording is superseded and must not control the final frame.
- Keep the exact I2VA alignment header, the complete required output structure and order, the exact dialogue whitelist, and the same total duration.
- Keep [Shot N] labels unique and in strict playback order starting with [Shot 1]. Do not emit a future composition, return, or fallback block before the actions it occurs after.
- For every tight shot, omit off-screen subject names from the visible action prose; their existence is already accounted for by [WORLD_CONTINUITY]. A cut or pull-out changes framing only and expands the existing view to the already-established subjects at their established positions, never a second instance.

Risks found in the current prompt:
${warnings.map((warning) => `- ${warning}`).join('\n')}`;
}

/**
 * Deterministic safety net used only when a targeted model repair still leaves
 * the I2VA tail unsafe. It adds composition direction without inventing story
 * facts and is independent of any particular project, genre, or character.
 */

/**
 * Remove a future boundary composition block that was inserted before the
 * structured prompt sections. The older fallback emitted `[Shot 3]` at the top
 * while the actual playback prose later continued with `[Shot 2]`, producing
 * `[Shot 1] -> [Shot 3] -> [Shot 2]`. Reordering arbitrary blocks is unsafe
 * because `[Shot N]` may occur inside [ACTION_ENGINE]; the safe repair is to
 * remove only an early final-return block whose numbered successor appears
 * later, while preserving every structural section and dialogue line verbatim.
 */
function removeMisplacedBoundaryShotBlocks(text: string): string {
  const start = text.indexOf('integrated_multimodal_description:');
  const end = text.indexOf('overall_soundscape:', start + 1);
  if (start < 0 || end < 0) return text;
  const integrated = text.slice(start, end);
  const blocks = shotBlocks(integrated);
  if (blocks.length < 2) return text;

  const firstSection = integrated.search(/\n\s*\[(?:SUBJECTS|WORLD_CONTINUITY|OBJECT_CONTINUITY|ACTION_ENGINE|DIALOGUE|CAMERA_LOGIC|STATE_TRANSITION|RESTRICTIONS)\]/u);
  if (firstSection < 0) return text;

  const prematureBoundary = blocks.find((block) => block.start < firstSection
    && /(?:final action beat|final frame|returns?\s+(?:from|to|into).{0,120}(?:medium|master)|established medium framing|spatial master)/isu.test(block.text)
    && blocks.some((candidate) => candidate.start > block.start && candidate.index < block.index));
  if (!prematureBoundary) return text;

  const repaired = `${integrated.slice(0, prematureBoundary.start)}${integrated.slice(prematureBoundary.end)}`
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n');
  return text.slice(0, start) + repaired + text.slice(end);
}

/**
 * Remove visible-behavior and named off-screen prose for people outside a
 * tight shot. Their existence is already represented by [WORLD_CONTINUITY];
 * omitting their names from the tight crop reduces I2VA re-instantiation risk.
 */
function neutralizeOffscreenVisibleAction(text: string): string {
  const integratedStart = text.indexOf('integrated_multimodal_description:');
  const integratedEnd = text.indexOf('overall_soundscape:', integratedStart + 1);
  if (integratedStart < 0 || integratedEnd < 0) return text;
  let integrated = text.slice(integratedStart, integratedEnd);
  const names = subjectNamesFromPrompt(text);
  if (names.length < 2) return text;

  const closeUpPattern = /\b(?:close-up|close shot|tight shot|reaction shot|insert shot|detail shot|macro shot)\b/giu;
  const ranges: Array<{ start: number; end: number; focal: string[]; offscreen: string[] }> = [];
  for (const block of shotBlocks(integrated)) {
    let cursor = 0;
    while (cursor < block.text.length) {
      closeUpPattern.lastIndex = 0;
      const match = closeUpPattern.exec(block.text.slice(cursor));
      if (!match) break;
      // Start at the shot block itself so prose emitted after the cut is
      // checked even when the actual close-up phrase arrives later in the same
      // sentence. The earlier master-shot prose belongs to Shot 1 and must not
      // be rewritten by this range.
      const tightStart = cursor + (match.index ?? 0);
      const tightTail = block.text.slice(tightStart);
      const boundary = findReturnToMasterIndex(tightTail);
      const tightEnd = boundary >= 0 ? tightStart + boundary : block.text.length;
      const tightText = block.text.slice(tightStart, tightEnd);
      const focalNames = tightShotFocalNames(tightText, names);
      const offscreen = names.filter((name) => !focalNames.some((focal) => focal.toLowerCase() === name.toLowerCase()));
      if (focalNames.length > 0 && offscreen.length > 0 && tightEnd > tightStart) {
        ranges.push({
          start: block.start + tightStart,
          end: block.start + tightEnd,
          focal: focalNames,
          offscreen,
        });
      }
      cursor = tightEnd > tightStart ? tightEnd : tightStart + match[0].length;
    }
  }
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    const segment = integrated.slice(range.start, range.end);
    const sentences = segment.split(/(?<=[.!?。！？])[ \t]+|\n+/u);
    const riskySentences = new Set(
      findVisibleOffscreenSentences(segment, range.focal, range.offscreen)
        .map((sentence) => sentence.trim()),
    );
    let genericReplacementWritten = false;
    const output: string[] = [];
    for (const sentence of sentences) {
      const sentenceOffscreen = mentionedSubjectNames(sentence, range.offscreen);
      const isNamedOffscreenState = sentenceOffscreen.length > 0
        && /\b(?:off-screen|offscreen|outside\s+(?:this\s+)?(?:crop|frame)|not\s+visible)\b/iu.test(sentence);
      if (isNamedOffscreenState && !riskySentences.has(sentence.trim())) {
        // Do not repeat proper names for people that are outside the crop. The
        // world-continuity ledger already accounts for them; repeating their
        // names in the tight-shot block can make an I2VA model instantiate a
        // second copy when the camera widens again.
        continue;
      }
      if (!riskySentences.has(sentence.trim())) {
        output.push(sentence);
        continue;
      }
      // Replace the whole off-screen behaviour sentence with a generic crop
      // lock. It keeps the focal subject visible and deliberately contains no
      // off-screen character names, which is safer than emitting a named
      // "remains outside this crop" clause.
      if (!genericReplacementWritten) {
        output.push('Only the focal subject is visible in this tight framing; off-screen subjects are not rendered.');
        genericReplacementWritten = true;
      }
    }
    const rewritten = output.join(' ');
    integrated = integrated.slice(0, range.start) + rewritten + integrated.slice(range.end);
  }
  return text.slice(0, integratedStart) + integrated + text.slice(integratedEnd);
}

function neutralizeOffscreenCameraNames(text: string): string {
  const cameraStart = text.indexOf('[CAMERA_LOGIC]');
  const cameraEnd = text.indexOf('[STATE_TRANSITION]', cameraStart + 1);
  if (cameraStart < 0 || cameraEnd < 0) return text;
  let camera = text.slice(cameraStart, cameraEnd);
  const names = subjectNamesFromPrompt(text);
  if (names.length < 2) return text;
  const closeUpPattern = /\b(?:close-up|close shot|tight shot|reaction shot|insert shot|detail shot|macro shot)\b/giu;
  let cursor = 0;
  while (cursor < camera.length) {
    closeUpPattern.lastIndex = 0;
    const match = closeUpPattern.exec(camera.slice(cursor));
    if (!match) break;
    const tightStart = cursor + (match.index ?? 0);
    const tail = camera.slice(tightStart);
    const boundary = findReturnToMasterIndex(tail);
    const tightEnd = boundary >= 0 ? tightStart + boundary : camera.length;
    const tightText = camera.slice(tightStart, tightEnd);
    const focalNames = tightShotFocalNames(tightText, names);
    const offscreen = names.filter((name) => !focalNames.some((focal) => focal.toLowerCase() === name.toLowerCase()));
    if (focalNames.length > 0 && offscreen.length > 0) {
      let rewritten = tightText;
      for (const name of offscreen) {
        rewritten = rewritten.replace(new RegExp(`\\b${escapeH3RegExp(name)}\\b`, 'giu'), 'the off-screen subject');
      }
      rewritten = rewritten.replace(/(?:the off-screen subject\s+and\s+){1,}the off-screen subject/giu, 'the off-screen subjects');
      camera = camera.slice(0, tightStart) + rewritten + camera.slice(tightEnd);
      cursor = tightStart + rewritten.length;
    } else {
      cursor = tightEnd > tightStart ? tightEnd : tightStart + match[0].length;
    }
  }
  return text.slice(0, cameraStart) + camera + text.slice(cameraEnd);
}

function normalizeI2vaReintroductionLanguage(text: string): string {
  // Camera coverage must not sound like a new cast entrance. Keep this
  // rewrite narrow: only alter reveal/show wording that explicitly refers to
  // the same people during a pull-out or return.
  return text.replace(
    /\b(?:reveal(?:s|ed|ing)?|show(?:s|ed|ing)?)\s+(?:the\s+)?same\s+[^.!?\n]{0,120}/giu,
    'expand the existing framing to the already-established composition',
  );
}

function ensureI2vaCutContinuityLock(text: string): string {
  if (text.includes('CUT CONTINUITY LOCK')) return text;
  if (!text.includes('[CAMERA_LOGIC]')) return text;
  const cameraSection = text.split('[CAMERA_LOGIC]')[1]?.split('[STATE_TRANSITION]')[0] ?? '';
  const integrated = text.split('integrated_multimodal_description:')[1]?.split('overall_soundscape:')[0] ?? '';
  if (!/(?:\b(?:cut|cuts|cutting|pull(?:s|ed|ing)?|widen(?:s|ed|ing)?|return(?:s|ed|ing)?|refram(?:e|es|ed|ing))\b|\b(?:close-up|reaction shot|insert shot|tight shot)\b)/iu.test(`${integrated}\n${cameraSection}`)) return text;
  return insertBeforeSection(
    text,
    '[STATE_TRANSITION]',
    'CUT CONTINUITY LOCK: Every internal cut, pull-out, or return changes framing only. No physical subject, fixed prop, or spatial anchor enters, exits, duplicates, or changes world position. A tight crop hides off-screen subjects without regenerating them; widening expands the existing view to the already-established composition rather than revealing a newly generated person.',
  );
}

export function applyI2vaBoundaryFallback(prompt: string, durationSec: number, dialogue?: string): string {
  let text = sanitizeMiniMaxH3Prompt(prompt, 'i2va');
  text = normalizeMiniMaxH3DialogueEmissions(text, dialogue);
  const endTime = formatH3Time(durationSec);

  text = removeMisplacedBoundaryShotBlocks(text);
  text = neutralizeOffscreenVisibleAction(text);
  text = neutralizeOffscreenCameraNames(text);
  text = normalizeI2vaReintroductionLanguage(text);
  text = ensureI2vaCutContinuityLock(text);

  if (!text.includes('FINAL INHERITANCE BOUNDARY')) {
    text = insertBeforeSection(
      text,
      '[STATE_TRANSITION]',
      `FINAL INHERITANCE BOUNDARY: during the final action beat before ${endTime}, despite any earlier hold-through-end wording, the camera returns from every close-up or insert to the established medium framing or spatial master. The existing subject or subjects and recognizable background context remain visible through the final frame. While tighter framing was active, off-screen subjects stayed invisible and were not re-rendered or duplicated.`,
    );
  }

  if (!text.includes('FINAL ACTION RETURN')) {
    text = insertBeforeSection(
      text,
      '[DIALOGUE]',
      `FINAL ACTION RETURN: during the final action beat before ${endTime}, the existing action state resolves into the established medium framing or spatial master. This changes composition only and adds no new event, person, prop, or dialogue.`,
    );
  }

  if (!text.includes('FINAL COMPOSITION:')) {
    text = insertBeforeSection(
      text,
      '[RESTRICTIONS]',
      `FINAL COMPOSITION: At ${endTime}, the shot is on an inheritable medium framing or the established spatial master with the existing subject or subjects and recognizable background context. Do not end on an isolated hand, eye, partial face, small prop detail, or ambiguous crop. This is a composition state only and does not add a new action or character.`,
    );
  }

  return sanitizeMiniMaxH3Prompt(text, 'i2va');
}

export async function repairI2vaBoundary(
  prompt: string,
  input: {
    duration: number;
    dialogue?: string;
    factualContext?: string;
    quickChat: (messages: Array<{ role: string; content: string }>, options: {
      maxTokens: number;
      continueOnTruncation: boolean;
      workspaceScope: 'workshop';
    }) => Promise<string>;
  },
): Promise<string> {
  const initial = normalizeMiniMaxH3DialogueEmissions(sanitizeMiniMaxH3Prompt(prompt, 'i2va'), input.dialogue);
  const risks = getI2vaBoundaryRisks(initial, input.duration, input.dialogue);
  if (risks.length === 0) return initial;

  let repaired = initial;
  try {
    const rawRepair = await input.quickChat([
      {
        role: 'system',
        content: buildI2vaBoundaryRepairInstruction(risks),
      },
      {
        role: 'user',
        content: `TARGET DURATION: ${input.duration} seconds

EXACT DIALOGUE WHITELIST:
${input.dialogue?.trim() || 'No dialogue. Do not add dialogue or intelligible speech.'}

CANONICAL FACTS FOR IDENTITY AND SPATIAL CONTINUITY ONLY:
${input.factualContext?.trim() || 'No additional facts supplied. Preserve the existing prompt facts.'}

PROMPT TO REPAIR:
${initial}

Repair only the final composition boundary and the camera/state wording needed to support it. Keep the whole prompt complete.`,
      },
    ], {
      maxTokens: 16000,
      continueOnTruncation: true,
      workspaceScope: 'workshop',
    });
    const candidate = normalizeMiniMaxH3DialogueEmissions(sanitizeMiniMaxH3Prompt(rawRepair, 'i2va'), input.dialogue);
    const dialogueLines = (input.dialogue ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const candidateIsComplete = candidate.includes('integrated_multimodal_description:')
      && candidate.includes('overall_soundscape:')
      && candidate.includes('non_diegetic_music:')
      && ['[SUBJECTS]', '[WORLD_CONTINUITY]', '[OBJECT_CONTINUITY]', '[ACTION_ENGINE]', '[DIALOGUE]', '[CAMERA_LOGIC]', '[STATE_TRANSITION]', '[RESTRICTIONS]']
        .every((section) => candidate.includes(section))
      && dialogueLines.every((line) => candidate.includes(line));
    if (candidateIsComplete) repaired = candidate;
  } catch {
    // A safety fallback below must still make the direct rewrite usable.
  }

  const remainingRisks = getI2vaBoundaryRisks(repaired, input.duration, input.dialogue);
  return remainingRisks.length > 0
    ? applyI2vaBoundaryFallback(repaired, input.duration, input.dialogue)
    : repaired;
}
