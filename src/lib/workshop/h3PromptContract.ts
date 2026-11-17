import { deduplicateH3SectionDialogue, unquoteH3Dialogue } from './h3DialoguePayload.ts';
import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import { auditRef2vaPrompt, ref2vaStructureIssues } from './h3Ref2vaPrompt.ts';
import { h3TimelineSection } from './h3ShotContract.ts';
import { h3FormatIssues } from './h3PromptFormat.ts';

export function sanitizeMiniMaxH3Prompt(prompt: string, task: SglangH3Task): string {
  let text = prompt.trim();
  if (task === 'i2va') {
    text = text
      .replace(/@(图片|音频|视频)\s*(?:[一二两三四五六七八九十零〇]+|\d+)/gu, '')
      .replace(/<(?:Picture|Audio|Video)\s+(?!1\b)\d+>/giu, '')
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  }
  return text.trim();
}


function canonicalDialogueLines(dialogue?: string): string[] {
  return (dialogue ?? '')
    .split(/\r?\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => unquoteH3Dialogue(line.replace(/^[^:：]{1,40}[:：]\s*/u, '').trim()))
    .filter((line) => line.length > 0)
    .filter((line, index, all) => all.indexOf(line) === index);
}

/**
 * Keep each canonical utterance as one actual H3 vocalization. The official
 * sections may carry a dialogue ledger, but copying the quoted line into
 * [Shot N], [ACTION_ENGINE], and [DIALOGUE] makes video models perform it
 * multiple times. Prefer actual event emissions, whether in [ACTION_ENGINE],
 * an integrated description, or headerless prose. Preserve repeated turns in
 * that event; only copies in separate bookkeeping become non-spoken text.
 */
export function normalizeMiniMaxH3DialogueEmissions(prompt: string, dialogue?: string): string {
  const lines = canonicalDialogueLines(dialogue);
  if (lines.length === 0) return deduplicateH3SectionDialogue(prompt);

  let text = deduplicateH3SectionDialogue(prompt);
  const spokenReplacement = 'the canonical utterance is logged above and must not be vocalized again';

  for (const line of lines) {
    let actionStart = text.indexOf('[ACTION_ENGINE]');
    let actionEnd = text.indexOf('[DIALOGUE]', actionStart + 1);
    if (actionStart < 0 || actionEnd <= actionStart) {
      const starts = ['detailed_description:', 'integrated_multimodal_description:']
        .map((field) => text.indexOf(field)).filter((at) => at >= 0);
      actionStart = starts.length ? Math.min(...starts) : 0;
      const ends = ['overall_soundscape:', 'non_diegetic_music:']
        .map((field) => text.indexOf(field, actionStart)).filter((at) => at >= 0);
      actionEnd = ends.length ? Math.min(...ends) : text.length;
    }
    const inAction = (start: number, end: number) => actionStart >= 0 && actionEnd > actionStart
      && start >= actionStart && end <= actionEnd;
    const escaped = escapeH3RegExp(line);
    const candidates: Array<{ start: number; end: number; isAction: boolean }> = [];
    const tagged = new RegExp(`<d\\s*>\\s*(?:\\[(?:Chinese|English|Japanese|Korean)\\]\\s*)?${escaped}\\s*</d>`, 'giu');
    for (const match of text.matchAll(tagged)) {
      const start = match.index ?? 0;
      candidates.push({ start, end: start + match[0].length, isAction: inAction(start, start + match[0].length) });
    }
    const plain = new RegExp(escaped, 'gu');
    for (const match of text.matchAll(plain)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // A tagged occurrence already owns this span; do not process its inner text twice.
      if (candidates.some((candidate) => start >= candidate.start && end <= candidate.end)) continue;
      candidates.push({ start, end, isAction: inAction(start, end) });
    }
    if (candidates.length <= 1) continue;

    // Prefer exactly one occurrence in ACTION_ENGINE. If the model omitted it,
    // keep the first occurrence and leave the dialogue ledger non-vocal.
    const actionCandidates = candidates.filter((candidate) => candidate.isAction);
    const kept = new Set(actionCandidates.length ? actionCandidates : [candidates[0]]);
    for (const candidate of candidates
      .filter((candidate) => !kept.has(candidate))
      .sort((a, b) => b.start - a.start)) {
      text = `${text.slice(0, candidate.start)}${spokenReplacement}${text.slice(candidate.end)}`;
    }
  }

  const dialogueSection = text.indexOf('[DIALOGUE]');
  if (dialogueSection >= 0 && !text.includes('DIALOGUE LEDGER ONLY')) {
    text = `${text.slice(0, dialogueSection + '[DIALOGUE]'.length)}\nDIALOGUE LEDGER ONLY: each canonical line is spoken exactly once in the action timeline; this section does not trigger another vocalization. Bind every line to its single Sx speaker; aliases and forms of address never create another speaker.\n${text.slice(dialogueSection + '[DIALOGUE]'.length)}`;
  }
  return text;
}

export const MINIMAX_H3_REQUIRED_PROMPT_SECTIONS: readonly string[] = [
  '[SUBJECTS]',
  '[WORLD_CONTINUITY]',
  '[OBJECT_CONTINUITY]',
  '[ACTION_ENGINE]',
  '[DIALOGUE]',
  '[CAMERA_LOGIC]',
  '[STATE_TRANSITION]',
  '[RESTRICTIONS]',
] as const;

const REMOVED_CHINESE_H3_SECTIONS = [
  '【素材身份】',
  '【素材身份与优先级】',
  '【视觉媒介与主体锁】',
  '【空间与初始状态】',
  '【时间轴动作与表演】',
  '【摄影机与构图】',
  '【物理反馈与环境响应】',
  '【尾帧与动作验收】',
  '【声音设计】',
  '【连续性与禁止项】',
] as const;

function extractTimedActionSegments(section: string): string[] {
  const marker = /(?:from\s+)?(?:\d{1,2}:)?\d+(?:\.\d+)?\s*(?:[-–—~至]|\bto\b)\s*(?:\d{1,2}:)?\d+(?:\.\d+)?\s*(?:秒|seconds?|s)?/gi;
  const matches = [...section.matchAll(marker)];
  return matches.map((match, index) => section.slice(
    match.index ?? 0,
    matches[index + 1]?.index ?? section.length,
  ).trim()).filter(Boolean);
}

function extractNamedSubjects(text: string, actionPattern: string): string[] {
  const actionRegex = new RegExp(actionPattern, 'gu');
  return [...text.matchAll(actionRegex)]
    .map((match) => {
      const prefix = text.slice(0, match.index ?? 0);
      const clauses = prefix.split(/[，。；：\n]/u);
      const clause = clauses[clauses.length - 1]?.trim() ?? '';
      return clause.match(/([\p{Script=Han}·]{2,8})(?:仍|继续|随即|随后|立即|已经|正|再)?$/u)?.[1] ?? '';
    })
    .filter(Boolean);
}

function hasCrossLevelContact(segments: string[]): boolean {
  const contactAction = '踩住|踩向|踩中|踏住|踏向|抓住|抓起|拾起|拿起|按住|踢中|击中|触碰';
  const levelTransitionPattern = /(下阶|走下|跃下|跳下|落地|走近|靠近|瞬移|闪现|缩地|遁光|空间跃迁)/;
  const highLevelSubjectPattern = /(?:^|[，。；：\n])([\p{Script=Han}·]{2,8}?)(?:仍|继续|已经|正)?(?:站在|立于|停在|位于)(?:高台|台上)/gu;

  return segments.some((segment, index) => {
    if (!/(台下|青石地面|地面)/.test(segment) || !new RegExp(contactAction).test(segment)) return false;
    const context = `${segments[index - 1] ?? ''}\n${segment}`;
    if (levelTransitionPattern.test(context)) return false;
    const contactSubjects = extractNamedSubjects(segment, contactAction);
    if (contactSubjects.length === 0) return false;
    const highLevelSubjects = [...context.matchAll(highLevelSubjectPattern)].map((match) => match[1]);
    return contactSubjects.some((subject) => highLevelSubjects.includes(subject));
  });
}


function splitIntegratedShots(description: string): Array<{ index: number; text: string }> {
  // A generated prompt can accidentally place `[Shot 2]` inside
  // [ACTION_ENGINE]. Treat that as prose until the next shot or the next
  // formal section, so a misplaced shot does not swallow the whole prompt.
  return [...description.matchAll(/\[Shot\s+(\d+)\]([\s\S]*?)(?=\[Shot\s+\d+\]|\n\s*\[(?:SUBJECTS|WORLD_CONTINUITY|OBJECT_CONTINUITY|ACTION_ENGINE|DIALOGUE|CAMERA_LOGIC|STATE_TRANSITION|RESTRICTIONS)\]|$)/giu)]
    .map((match) => ({ index: Number(match[1]), text: match[2]?.trim() ?? '' }));
}


function subjectNamesFromPrompt(text: string): string[] {
  const subjectBlock = text.split('[SUBJECTS]')[1]?.split(/\[[A-Z_]+\]/u)[0] ?? '';
  // Subject lines in the official contract are `Name (S1)...`; capturing
  // through the stable id keeps multi-word names such as "Lu Su" intact.
  // Han names are included because the generated prompt may intentionally keep
  // canonical names in their original script while the prose stays English.
  const namePattern = /([\p{Script=Han}·]{2,8}|[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*)\s*\(S\d+\b/gu;
  return [...subjectBlock.matchAll(namePattern)]
    .map((match) => match[1].trim())
    .filter((name, index, all) => name.length > 1 && all.indexOf(name) === index);
}

export function escapeH3RegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasHanScript(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value);
}

function namedSubjectPattern(name: string, flags = 'iu'): RegExp {
  const escaped = escapeH3RegExp(name);
  return hasHanScript(name)
    ? new RegExp(escaped, flags)
    : new RegExp(`(?:^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, flags);
}

export function mentionedSubjectNames(text: string, names: readonly string[]): string[] {
  return names.filter((name) => namedSubjectPattern(name).test(text));
}

function mentionsNameAsActor(text: string, name: string): boolean {
  const pattern = namedSubjectPattern(name, 'giu');
  for (const match of text.matchAll(pattern)) {
    const matchStart = match.index ?? 0;
    const nameOffset = match[0].toLowerCase().lastIndexOf(name.toLowerCase());
    const nameStart = matchStart + Math.max(0, nameOffset);
    const prefix = text.slice(Math.max(0, nameStart - 40), nameStart);
    const isGazeOrRelationshipObject = /\b(?:toward|towards|to|at|for|with|beside|before|behind|near|against|from|of)\s+(?:the\s+)?$/iu.test(prefix);
    if (!isGazeOrRelationshipObject) return true;
  }
  return false;
}

const VISIBLE_BEHAVIOUR_SOURCE = 'face|facial|eyes?|eyelids?|eyebrows?|brows?|lips?|mouth|gaze|looks?|looked|looking|watches?|watched|watching|chest|shoulders?|hands?|arms?|torso|posture|motion|movement|mov(?:e|es|ed|ing)|breath(?:s|ing|ed)?|inclin(?:e|es|ed|ing)|lean(?:s|ed|ing)?|turn(?:s|ed|ing)?|nod(?:s|ded|ding)?|react(?:s|ed|ing)?|listen(?:s|ed|ing)?|remain(?:s|ed|ing)?|stay(?:s|ed|ing)?|wait(?:s|ed|ing)?|plant(?:s|ed|ing)?';
const VISIBLE_BEHAVIOUR_PATTERN = new RegExp(`\\b(?:${VISIBLE_BEHAVIOUR_SOURCE})\\b`, 'iu');

const SAFE_OFFSCREEN_PATTERN = /\b(?:off-screen|offscreen|outside\s+(?:this\s+)?crop|outside\s+(?:this\s+)?frame|not\s+visible\s+in\s+(?:this\s+)?(?:tight\s+shot|close-up)|no\s+visible\s+(?:action|expression|movement))\b/iu;

const DIALOGUE_TAG_PATTERN = /<\/?d(?:\s[^>]*)?>|\[(?:Chinese|English|Japanese|Korean)\]/iu;
const PRONOUN_REFERENCE_PATTERN = /\b(?:he|him|his|she|her|hers|they|them|their|theirs)\b|[他她其]/u;

/**
 * An off-screen person may remain a gaze target, but must not become the
 * subject of visible facial or bodily behaviour inside a tight crop. This
 * distinction prevents a harmless phrase such as "looking at Lu Su's
 * position" from being mistaken for a second on-screen Lu Su.
 */
export function describesVisibleOffscreenAction(sentence: string, offscreenNames: readonly string[]): boolean {
  if (DIALOGUE_TAG_PATTERN.test(sentence)) return false;
  if (SAFE_OFFSCREEN_PATTERN.test(sentence)) return false;
  if (!VISIBLE_BEHAVIOUR_PATTERN.test(sentence)) return false;

  return offscreenNames.some((name) => {
    const escaped = escapeH3RegExp(name);
    if (hasHanScript(name)) {
      // Chinese prose often places the name before the behaviour without a
      // space. Keep this conservative: a name alone or as a gaze object is not
      // enough; it must lead a visible-behaviour clause.
      return new RegExp(`(?:^|[，。；：!?！？\\s])${escaped}(?:仍|继续|正|随即|随后|已经|又|再)?(?:看|望|注视|皱眉|闭嘴|抿唇|呼吸|转身|点头|摇头|抬起|放下|移动|站|坐|靠|面向|听|等|停|保持)`, 'u').test(sentence)
        || new RegExp(`${escaped}(?:的)?(?:脸|眼|眉|嘴|唇|下颌|肩|手|呼吸|姿态|身体)`, 'u').test(sentence);
    }

    const directSubject = new RegExp(
      `(?:^|[.!?;；。！？]\\s*|,\\s*|\\b(?:and|while|as)\\s+)${escaped}(?:['’]s)?\\s+(?:(?:keeps?|continues?|begins?|starts?|is|are)\\s+)?(?:${VISIBLE_BEHAVIOUR_SOURCE})\\b`,
      'iu',
    );
    const possessiveBodyPart = new RegExp(
      `${escaped}(?:['’]s)?\\s+(?:face|facial features?|eyes?|eyelids?|eyebrows?|brows?|lips?|mouth|chest|shoulders?|hands?|arms?|torso|posture|breath(?:ing)?)\\b`,
      'iu',
    );
    return directSubject.test(sentence) || possessiveBodyPart.test(sentence);
  });
}

/**
 * Find visible-behaviour sentences that belong to an off-screen person. A
 * sentence can inherit that subject through a pronoun (for example, a Lu Su
 * sentence followed by "A brief interruption in his breathing"), so validating
 * only sentences that repeat the proper name is insufficient.
 */
export function findVisibleOffscreenSentences(
  tightText: string,
  focalNames: readonly string[],
  offscreenNames: readonly string[],
): string[] {
  const risky: string[] = [];
  // A tight shot is a continuous framing interval, not a sentence-by-sentence
  // reset. Once a named off-screen person is the subject of visible behaviour,
  // later pronouns in the same shot inherit that person until the focal subject
  // is explicitly named again. Otherwise a previous focal mention can make
  // "his breathing" look like the on-screen speaker even though the antecedent
  // is the off-screen listener from the preceding sentence.
  let activeSubject: 'focal' | 'offscreen' = 'focal';
  for (const sentence of tightText.split(/(?<=[.!?。！？])[ \t]+|\n+/u)) {
    if (!sentence.trim()) continue;
    // Only a sentence that uses the focal name as the grammatical subject
    // resets the active subject. A mere gaze target such as "looks toward
    // Zhou Yu" must not reset a preceding off-screen listener sentence.
    const namesFocal = focalNames.some((name) => mentionsNameAsActor(sentence, name));
    if (namesFocal) activeSubject = 'focal';
    if (DIALOGUE_TAG_PATTERN.test(sentence) || SAFE_OFFSCREEN_PATTERN.test(sentence)) continue;

    const explicitlyVisible = describesVisibleOffscreenAction(sentence, offscreenNames);
    const pronounVisible = activeSubject === 'offscreen'
      && !namesFocal
      && PRONOUN_REFERENCE_PATTERN.test(sentence)
      && VISIBLE_BEHAVIOUR_PATTERN.test(sentence);
    if (explicitlyVisible) activeSubject = 'offscreen';
    if (explicitlyVisible || pronounVisible) risky.push(sentence);
  }
  return risky;
}

/**
 * Resolve the person or people actually inside a tight framing from the prose
 * immediately following the framing term. Array order is deliberately ignored:
 * "close-up of Zhou Yu ... looking toward Lu Su" must select Zhou Yu, not the
 * first subject listed elsewhere in [SUBJECTS].
 */
export function tightShotFocalNames(tightText: string, names: readonly string[]): string[] {
  const framingEnd = tightText.search(/\b(?:close-up|close shot|tight shot|reaction shot|insert shot|detail shot|macro shot)\b/iu);
  const afterFraming = framingEnd < 0
    ? tightText
    : tightText.slice(framingEnd).replace(/^.*?\b(?:close-up|close shot|tight shot|reaction shot|insert shot|detail shot|macro shot)\b/iu, '');
  const normalized = afterFraming.replace(/^\s*(?:of|on|at|toward|the)\s+/iu, '');
  const candidates = names
    .map((name) => ({ name, index: normalized.search(namedSubjectPattern(name)) }))
    .filter((candidate) => candidate.index === 0)
    .sort((a, b) => b.name.length - a.name.length);
  const first = candidates[0];
  if (!first) return [];

  const focal = [first.name];
  let remainder = normalized.slice(first.name.length);
  // Include only explicitly co-framed people connected directly to the first
  // focal subject, e.g. "Alex and Jordan" or "周瑜和鲁肃".
  while (true) {
    const conjunction = remainder.match(/^\s*(?:and|与|和|、|,)\s*/iu);
    if (!conjunction) break;
    const afterConjunction = remainder.slice(conjunction[0].length);
    const next = names
      .map((name) => ({ name, index: afterConjunction.search(namedSubjectPattern(name)) }))
      .filter((candidate) => candidate.index === 0)
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!next || focal.includes(next.name)) break;
    focal.push(next.name);
    remainder = afterConjunction.slice(next.name.length);
  }
  return focal;
}

const RETURN_TO_MASTER_PATTERN = /(?:\b(?:camera\s+)?(?:returns?|returned|returning)\s+(?:from|to|into)\b|\b(?:cut|cuts|cutting)\s+(?:back\s+)?to\b|\b(?:pull|pulls|pulled|pulling)\s+(?:back|out)\b|\b(?:widen|widens|widened|widening)\b|\b(?:move|moves|moved|moving)\s+back\b|\b(?:reframe|reframes|reframed|reframing)\b|\b(?:end|ends|ending)\s+(?:on|with)\b)[\s\S]{0,170}\b(?:medium|two-shot|three-person|master|wider|wide)\b/giu;

function findReturnToMasterIndex(text: string): number {
  for (const match of text.matchAll(RETURN_TO_MASTER_PATTERN)) {
    const start = match.index ?? 0;
    const prefix = text.slice(Math.max(0, start - 36), start);
    if (/\b(?:without|not|never|no|avoids?|avoided|avoids\s+another)\s+(?:a\s+|an\s+|the\s+|another\s+)?(?:return\s+)?$/iu.test(prefix)) continue;
    if (/\b(?:does|do|did)\s+not\s*$/iu.test(prefix)) continue;
    // A single match can span both a negated sentence ("without returning to
    // the master") and an unrelated framing noun later in the paragraph. Such
    // a match is not evidence of a return; a real later pull-out/cut-back is
    // handled by its own match in the next iteration.
    if (/\bwithout\s+(?:a\s+)?return(?:ing)?\b/iu.test(match[0])) continue;
    if (/\b(?:never|does\s+not|doesn't)\s+return(?:s|ing)?\b/iu.test(match[0])) continue;
    return start;
  }
  return -1;
}

function hasReturnToMaster(text: string): boolean {
  return findReturnToMasterIndex(text) >= 0;
}

const INTERNAL_FRAMING_CHANGE_PATTERN = /\b(?:cut|cuts|cutting|pulls?|pulled|pulling|widen(?:s|ed|ing)?|returns?|returned|returning|reframes?|reframed|reframing)\b/iu;
const REINITIALIZE_SUBJECT_PATTERN = /\b(?:reveal(?:s|ed|ing)?|reintroduc(?:e|es|ed|ing)|reappear(?:s|ed|ing)?|bring(?:s|ing)?\s+[^.]{0,60}\s+into\s+(?:the\s+)?(?:frame|shot|view))\b[^.]{0,100}\b(?:the\s+)?(?:same|again|another|new)\b/iu;

function i2vaSubjectReinitializationWarnings(integrated: string, cameraSection: string, shots: Array<{ index: number; text: string }>): string[] {
  if (shots.length < 2 || !INTERNAL_FRAMING_CHANGE_PATTERN.test(`${integrated}\n${cameraSection}`)) return [];
  const warnings: string[] = [];
  const framingText = `${shots.slice(1).map((shot) => shot.text).join('\n')}\n${cameraSection}`;
  if (REINITIALIZE_SUBJECT_PATTERN.test(framingText)) {
    warnings.push('H3 I2VA 切镜主体继承风险：切镜或拉回使用了“重新揭示/再次出现同一人物”的表达；镜头模型可能把既有主体重新生成成分身，必须改为“只改变取景，扩大既有构图，不新增人物实例”');
  }
  return warnings;
}

function i2vaVisibilityWarnings(text: string, integrated: string): string[] {
  const warnings: string[] = [];
  const shots = splitIntegratedShots(integrated);
  if (shots.length > 1) {
    const numbers = shots.map((shot) => shot.index);
    const expected = numbers.map((_, index) => index + 1);
    if (numbers.some((number, index) => number !== expected[index])) {
      warnings.push(`H3 I2VA 镜头块顺序风险：integrated_multimodal_description 中的 [Shot N] 必须从 [Shot 1] 起按播放顺序连续编号；当前顺序为 ${numbers.map((number) => `[Shot ${number}]`).join(' -> ')}`);
    }
  }

  const cameraSection = text.split('[CAMERA_LOGIC]')[1]?.split('[STATE_TRANSITION]')[0] ?? '';
  warnings.push(...i2vaSubjectReinitializationWarnings(integrated, cameraSection, shots));
  const tailShot = shots.length > 0 ? (shots[shots.length - 1]?.text ?? '') : integrated.slice(-600);
  const cameraTail = cameraSection.trim().slice(-420);
  const returnText = `${tailShot}\n${cameraTail}`;
  const returnsToMaster = hasReturnToMaster(returnText);
  const tailHasCloseUp = /\b(?:close-up|close shot|tight shot|reaction shot|insert shot|detail shot|macro shot)\b|\b(?:hold|holds|holding|remain|remains|stay|stays)\b[\s\S]{0,45}\b(?:close-up|tight shot|reaction shot|insert|detail shot)\b/iu.test(returnText);
  if (tailHasCloseUp && !returnsToMaster) {
    warnings.push('H3 I2VA 尾帧继承风险：最后一个镜头停留在单人特写或近景，未在最后动作节拍回到可继承中景/主构图；下一镜头继承时会放大局部或复制人物');
  }

  const names = subjectNamesFromPrompt(text);
  for (const shot of shots) {
    const block = shot.text;
    const closeUpMatch = block.match(/\b(?:cuts?|cutting|shows?|showing|holds?|holding)\b[\s\S]{0,80}\b(?:close-up|close shot|tight shot|reaction shot|insert shot|detail shot|macro shot)\b/iu);
    if (!closeUpMatch) continue;
    // Start at the shot block itself so prose emitted after the cut is checked
    // even when the actual close-up phrase arrives later in the same sentence.
    // The earlier master-shot prose belongs to the previous block and remains
    // outside this duplicate-body interval.
    const tightStart = 0;
    const returnIndex = findReturnToMasterIndex(block);
    const tightText = returnIndex > tightStart ? block.slice(tightStart, returnIndex) : block.slice(tightStart);
    const focalNames = tightShotFocalNames(tightText, names);
    if (focalNames.length === 0) continue;
    const offscreenNames = names.filter((name) => !focalNames.some((focal) => focal.toLowerCase() === name.toLowerCase()));
    const riskySentences = findVisibleOffscreenSentences(tightText, focalNames, offscreenNames);
    if (riskySentences.length > 0) {
      warnings.push(`H3 紧画幅人物复制风险：紧画幅内仍在描写画外人物 ${offscreenNames.join('、')} 的可见表情或身体动作；切紧画幅后画外人物必须完全移出描述，不得重新建模或复制`);
    }
  }
  return warnings;
}

export function validateMiniMaxH3VideoPrompt(prompt: string, _durationSec = 5, dialogue?: string, task?: SglangH3Task): string[] {
  const text = prompt.trim();
  if (!text) return ['缺少视频提示词'];
  if (task) {
    const warnings: string[] = [];
    const legacyBlocks = [...REMOVED_CHINESE_H3_SECTIONS, '【受控转场】', '【连续性与生成约束】', '分镜场景设定在：', 'Refs:'];
    const foundLegacyBlocks = legacyBlocks.filter((marker) => text.includes(marker));
    if (foundLegacyBlocks.length > 0) warnings.push(`H3 官方 skill 输出被旧模板污染：请删除 ${foundLegacyBlocks.join('、')}`);

    if (task === 'ref2va') {
      warnings.push(...ref2vaStructureIssues(text), ...auditRef2vaPrompt(text, dialogue));
    } else {
      warnings.push(...h3FormatIssues(text, false));
    }

    const pictureTokens = text.match(/<(?:Picture|Audio|Video)\s+\d+>|\bPicture\s+\d+\b|@(图片|音频|视频)\s*(?:[一二两三四五六七八九十零〇]+|\d+)/giu) ?? [];
    const assetTokens = pictureTokens.filter((token) => token.startsWith('@'));
    if (task === 't2va' && pictureTokens.length > 0) warnings.push('H3 t2va 不得出现任何素材或关键帧标签');
    if (task === 'i2va') {
      const invalid = pictureTokens.filter((token) => !/\bPicture\s+1\b/i.test(token));
      if (invalid.length > 0) warnings.push('H3 i2va 只允许在关键帧对齐说明中使用 Picture 1；不得写角色、场景、道具 Refs 或其它图片编号');
      if (!/^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\./i.test(text)) {
        warnings.push('H3 i2va 缺少官方首帧对齐说明：必须使用 For the target video... 句式，且 Picture 1 只表示 0.00 秒首帧关键帧');
      }
      if (assetTokens.length > 0) warnings.push('H3 i2va 提示词不得出现素材编号：当前任务只提交运行时首帧，不提交角色、场景或道具参考图');
    }
    if (task === 'fl2va') {
      if (!/Picture 1[\s\S]*0\.00-second mark/i.test(text) || !/Picture 2/i.test(text)) {
        warnings.push('H3 fl2va 必须声明 Picture 1 为首帧、Picture 2 为尾帧');
      }
      if (assetTokens.length > 0) warnings.push('H3 fl2va 提示词不得出现素材编号：当前任务只提交运行时首尾关键帧');
    }
    if (task === 'ref2va') {
      const legacyRefTokens = pictureTokens.filter((token) => token.startsWith('@'));
      const counts = new Map<string, number>();
      for (const token of legacyRefTokens) {
        const key = token.replace(/\s+/g, '').toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([token]) => token);
      if (repeated.length > 0) warnings.push(`H3 ref2va 素材编号重复过多：${repeated.join('、')} 只应在素材定义中建立稳定含义`);
    }

    const descriptionField = task === 'ref2va'
      ? h3TimelineSection(text)
      : text.split('integrated_multimodal_description:')[1]?.split('overall_soundscape:')[0] ?? '';
    if (task === 'i2va') warnings.push(...i2vaVisibilityWarnings(text, descriptionField));
    if (dialogue?.trim()) {
      const canonicalLines = canonicalDialogueLines(dialogue);
      const complete = canonicalLines.length > 0
        ? canonicalLines.every((line) => text.includes(line))
        : text.includes(dialogue.trim());
      if (!complete) warnings.push('H3 对白不完整：必须逐字保留当前镜 dialogue 原文');
    }
    return warnings;
  }
  const warnings: string[] = [];
  const removedSections = REMOVED_CHINESE_H3_SECTIONS.filter((section) => text.includes(section));
  if (removedSections.length > 0) warnings.push(`H3 不再支持旧中文九段模板：请删除 ${removedSections.join('、')}，改用可执行的视听事件描述`);

  const referenceTokens = text.match(/@(图片|音频|视频)\s*(?:[一二两三四五六七八九十零〇]+|\d+)|<(?:Picture|Audio|Video)\s+\d+>/giu) ?? [];
  if ((task === 'fl2va' || task === 'i2va' || task === 't2va') && referenceTokens.length > 0) {
    warnings.push(`H3 ${task} 提示词不得出现素材编号：当前任务不会按这些编号提交参考素材，请改为直接描述首尾状态或文本画面`);
  }
  if (task === 'ref2va') {
    const referenceCounts = new Map<string, number>();
    for (const token of referenceTokens) {
      const key = token.replace(/\s+/gu, '').toLowerCase();
      referenceCounts.set(key, (referenceCounts.get(key) ?? 0) + 1);
    }
    const repeated = [...referenceCounts.entries()].filter(([, count]) => count > 1).map(([token]) => token);
    if (repeated.length > 0) warnings.push(`H3 ref2va 素材编号重复过多：${repeated.join('、')} 只应在 subject_definitions 中各建立一次含义，后续正文改用人物名、场景名和道具名`);
  }

  if (/站位不变|位置不变|姿态不变/.test(text)) warnings.push('H3 连续性不能冻结动态状态：请改写为保持身份和空间拓扑，同时按时间轴明确位置、姿态、朝向和道具状态的变化路径');
  const timelineSection = text.split('[ACTION_ENGINE]')[1]?.split('[DIALOGUE]')[0] ?? '';
  const cameraSection = text.split('[CAMERA_LOGIC]')[1]?.split('[STATE_TRANSITION]')[0] ?? '';
  const soundSection = text.split('[DIALOGUE]')[1]?.split('[CAMERA_LOGIC]')[0] ?? '';
  const timedActionSegments = extractTimedActionSegments(timelineSection);
  const contactActionPattern = /(踩|踏|抓|握|接住|拥抱|搂|递|交给|推|拉|扶|按住|触碰|击中|攻击|踢|吻|拾起|拿起)/;
  const reachableRangePattern = /(进入.{0,8}(接触|伸手|落脚|近身)范围|距离.{0,10}(缩短|半步|一步|触手可及)|相距.{0,8}(半步|一步)|脚边|身边|面前|胸前|手边|近前|旁边|贴近|紧邻|同一(?:平面|地面|台阶)|走近|靠近|下阶|跨步|俯身|伸手|瞬移|闪现|缩地|遁光|空间跃迁)/;
  const unreachableContactSegments = timedActionSegments.filter((segment, index) => {
    if (!contactActionPattern.test(segment)) return false;
    const previousSegment = timedActionSegments[index - 1] ?? '';
    return !reachableRangePattern.test(`${previousSegment}\n${segment}`);
  });
  if (unreachableContactSegments.length > 0) {
    warnings.push(`H3 接触可达性不足：${unreachableContactSegments.length} 个时间区间包含踩踏、抓取、拥抱、递交、推拉或攻击等接触动作，但没有说明主体如何进入可接触距离`);
  }
  const crossLevelContact = hasCrossLevelContact(timedActionSegments);
  if (crossLevelContact) {
    warnings.push('H3 垂直空间不可达：同一人物前一时间段仍在高台、后一时间段却直接接触台下地面目标，缺少下阶、跃下、走近或超自然位移过程');
  }
  const continuitySection = text.split('[RESTRICTIONS]')[1] ?? '';
  const cameraContinuityText = `${cameraSection}\n${continuitySection}`;
  const hasCloseShot = /(特写|近景|推近|景别渐变|移焦)/.test(cameraSection);
  const hasAxisContinuity = /(动作轴线|空间轴线|轴线同一侧|不跳轴|轴线延续)/.test(cameraContinuityText);
  const hasFacingContinuity = /(面朝.{0,8}(同一|保持|延续|目标)|朝向.{0,8}(保持|延续|一致)|世界面朝目标)/.test(cameraContinuityText);
  const hasScreenContinuity = /(?:(屏幕方向|画面方向|左右关系).{0,10}(保持|延续|一致|不变)|(保持|延续|维持).{0,8}(相同|一致)?(屏幕方向|画面方向|左右关系))/.test(cameraContinuityText);
  const hasScaleContinuity = /(人物尺度|真实身高|头身比例|体型关系)/.test(cameraContinuityText)
    && /(保持|延续|维持|一致|不变|不改变|只改变取景|只改变焦点)/.test(cameraContinuityText);
  if (hasCloseShot && !(hasAxisContinuity && hasFacingContinuity && hasScreenContinuity && hasScaleContinuity)) {
    warnings.push('H3 特写连续性不足：特写、推近或景别渐变必须说明前后继承同一动作轴线、世界面朝目标、屏幕方向、视线关系和人物尺度，特写只改变取景或焦点');
  }
  const hasSupernaturalMove = /(瞬移|瞬间移动|闪现|缩地|遁光|空间跃迁)/.test(timelineSection);
  if (hasSupernaturalMove) {
    const hasTriggerOrEffect = /(触发|结印|掐诀|抬手|踏地|灵光|残影|空间扭曲|涟漪|光痕|符纹|粒子|雷光|剑光)/.test(timelineSection);
    const hasRelativeLanding = /(旁边|身边|面前|脚边|附近|旁侧|侧后方|前方|后方|半步|一步|落点|朝向|距离)/.test(timelineSection);
    const hasArrivalFeedback = /(现身|落地|风压|尘土|衣摆|发丝|光影|地面|空气|纸边|水面)/.test(timelineSection);
    if (!hasTriggerOrEffect || !hasRelativeLanding || !hasArrivalFeedback) {
      warnings.push('H3 超自然位移细节不足：瞬移、闪现、缩地、遁光或空间跃迁必须写清发动触发、起点与现身特效、相对目标的落点/朝向/距离，以及环境反馈');
    }
  }
  if (/(全程闭嘴|不产生任何口型|不产生口型)/.test(text)) {
    warnings.push('H3 无对白约束不能冻结整张脸：请改写为双唇自然合拢或微松、不形成说话音节，同时保留眼睑、视线、下颌、吞咽、呼吸和脸颊的自然反应');
  }
  if (/(禁止|不得|严禁).{0,8}(瞬移|闪现|缩地|遁光|空间跃迁)/.test(text)) {
    warnings.push('H3 不应笼统禁止超自然位移：普通走位写清相对路径；剧情明确的瞬移、闪现、缩地、遁光或空间跃迁应保留能力设定并补足特效、相对落点和环境反馈');
  }
  if (/(?:神色|表情|嘴角|视线).{0,10}(?:没有变化|保持不变|始终不变)/.test(text)) {
    warnings.push('H3 人物表情被写成静态锁：身份可以稳定，但眼睑、注视目标、眉间、唇线、下颌和呼吸必须随刺激形成自然变化');
  }
  const rigidPerformanceTerms = timelineSection.match(/保持(?:不变|静止|原位)|固定站立|静止不动|僵硬(?:站|停|不动)|定在原地|几乎不动/g) ?? [];
  if (rigidPerformanceTerms.length >= 3) {
    warnings.push(`H3 静态约束过密：时间轴识别到 ${rigidPerformanceTerms.length} 处冻结人物表演的措辞。请只锁身份与世界拓扑，正文改用正向的自然表演和运动路径`);
  }
  const exactDialogue = dialogue?.trim();
  const dialogueLines = canonicalDialogueLines(dialogue);
  const repeatedDialogueLines = dialogueLines.filter((line) => (text.match(new RegExp(escapeH3RegExp(line), 'gu')) ?? []).length > 1);
  if (repeatedDialogueLines.length > 0) {
    warnings.push(`H3 对白重复发声风险：以下原文对白在提示词中出现超过一次，模型可能重复播报：${repeatedDialogueLines.map((line) => `“${line}”`).join('、')}`);
  }
  if (exactDialogue) {
    const dialogueComplete = dialogueLines.length > 0
      ? dialogueLines.every((line) => text.includes(line))
      : text.includes(exactDialogue);
    if (!dialogueComplete) warnings.push('H3 对白不完整：提示词必须逐字包含本镜 dialogue 原文');
    if (!/嘴唇|嘴形|口型|启唇/.test(timelineSection) || !/下颌|脸颊/.test(timelineSection)) {
      warnings.push('H3 对白表演不足：时间轴中必须写说话前启唇、说话期间嘴唇/下颌持续运动和说完自然收口；未说话角色只需保留不形成说话音节的自然反应');
    }
    if (!/(严禁|禁止|不得).{0,16}(新增|改写|重复|多余).{0,12}(对白|台词|旁白|口播|人声)/s.test(text)) {
      warnings.push('H3 对白白名单不明确：必须禁止新增、改写或重复对白，并禁止额外旁白、VO 和无来源人声');
    }
    if (!/(声源绑定|声源.{0,12}(口部|嘴部)|声音只从.{0,16}(口部|嘴部))/.test(soundSection)
      || !/(年龄|少年|少女|青年|中年|老年).{0,12}(性别|男声|女声|音色)|性别.{0,12}(音色|男声|女声)/.test(soundSection)) {
      warnings.push('H3 对白声源绑定不足：必须写明唯一说话人的身份、年龄/性别对应音色、画面位置，以及声音只从该人物口部发出，不得转移给其他角色或画外位置');
    }
  }
  return warnings;
}

/** Remove legacy authoring notes, not concrete timed actions or quoted dialogue. */
export function stripH3AuthoringNotes(prompt: string): string {
  return prompt.split('\n').filter((line) => !/^\s*(?:SPEAKER EXCLUSIVITY LOCK|CONTINUOUS TAKE LOCK|CUT CONTINUITY LOCK|FINAL ACTION RETURN|FINAL INHERITANCE BOUNDARY|FINAL COMPOSITION):/u.test(line) || /<d\b/iu.test(line)).join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}
