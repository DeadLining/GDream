/**
 * Canonical, mode-agnostic H3 shot contract.
 *
 * Only factual contradictions block a save. Camera choice, staging, prop
 * handling, pacing and action granularity are guidance because they depend on
 * the shot and should not force a rewrite on their own.
 */
export interface H3ShotContractInput {
  prompt: string;
  dialogue?: string;
  durationSeconds?: number;
}

/**
 * Short writer-facing action guidance, not a save checklist and not output
 * prose. Keep it positive on purpose: models tend to copy prohibitions into the
 * finished prompt as defensive boilerplate ("he does not kneel again"),
 * which fills the shot with restrictions instead of visible action.
 */
export const H3_SHOT_CONTRACT_AUTHORING_EN = `SHOT GUIDANCE (turn this into visible action, never copy these notes into the prompt):
- Give every important action a cause, a contact or movement path, and a visible result, then carry the changed position, balance and prop contact into the next action.
- Match detail to the event: a simple gesture may need one paragraph, while a complex change needs its intermediate states. Length and number of sections are not quality targets.
- Develop exact dialogue through delivery, listening and a relevant response or continuation; silence and an intentional hold are also valid beats.
- Express the chosen style through medium, material behavior, light, motion texture and sound, not generic cinematic adjective stacks. State identity and continuity anchors once, then describe changes.
- In a fight, keep continuous physical play: attack or intent, response, contact or miss, consequence, then recovery or changed position. Split a long exchange at meaningful turns rather than on a uniform timer, and let one exchange develop through several beats.
- Keep one camera idea per continuous block, and show the movement or cut that changes it.
- Treat a referenced prop as a real object in motion: grip, release, transfer and resulting position follow the action.
- Bind every spoken line to its sole established speaker; on-screen speakers remain identifiable, and deliberately off-screen voices keep their authored identity. Listeners and silent groups retain one identity and relevant listening behavior.
- Reuse established subjects: the preceding tail and every reference image describe the same physical cast. A new participant comes from the shot facts, not from splitting an existing subject.
- When the shot continues a same-scene action, carry position, facing, support, prop contact and momentum forward.
- End on the visible result of the shot's action.`;
function section(prompt: string, from: string, to: string): string {
  const start = prompt.indexOf(from);
  if (start < 0) return '';
  const end = prompt.indexOf(to, start + from.length);
  return prompt.slice(start + from.length, end >= 0 ? end : undefined).trim();
}

export function h3TimelineSection(prompt: string): string {
  const detailedStart = /detailed_description:/iu.exec(prompt);
  if (detailedStart?.index !== undefined) {
    const rest = prompt.slice(detailedStart.index + detailedStart[0].length);
    const end = /overall_soundscape:/iu.exec(rest);
    return end && end.index !== undefined ? rest.slice(0, end.index) : rest;
  }
  const action = section(prompt, '[ACTION_ENGINE]', '[DIALOGUE]');
  const camera = section(prompt, '[CAMERA_LOGIC]', '[STATE_TRANSITION]');
  if (action || camera) return `${action}\n${camera}`.trim();
  const integratedStart = /integrated_multimodal_description:/iu.exec(prompt);
  if (integratedStart?.index !== undefined) {
    const rest = prompt.slice(integratedStart.index + integratedStart[0].length);
    const end = /overall_soundscape:/iu.exec(rest);
    return end && end.index !== undefined ? rest.slice(0, end.index) : rest;
  }
  return prompt;
}

/** Split the timeline into un-cut [Shot N] blocks; a shotless timeline is one block. */
export function h3ShotBlocks(timeline: string): Array<{ index: number; text: string }> {
  const marks = [...timeline.matchAll(/\[Shot\s+(\d+)\]/giu)];
  if (!marks.length) return [{ index: 1, text: timeline }];
  return marks.map((mark, position) => ({
    index: Number(mark[1]),
    text: timeline.slice(
      (mark.index ?? 0) + mark[0].length,
      position + 1 < marks.length ? marks[position + 1].index ?? undefined : undefined,
    ),
  }));
}

function definitionsOf(prompt: string): string {
  return prompt.match(/subject_definitions:\s*([\s\S]*?)(?=\nsummary:|\nretention_analysis:|\ndetailed_description:|\noverall_soundscape:|\nnon_diegetic_music:|$)/iu)?.[1] ?? prompt;
}

function declaredVoiceIds(prompt: string): Map<string, { subject: string | null; clause: string }> {
  const definitions = prompt.match(/subject_definitions:\s*([\s\S]*?)(?=\nsummary:|\nretention_analysis:|\ndetailed_description:|\noverall_soundscape:|\nnon_diegetic_music:|$)/iu)?.[1] ?? prompt;
  const declared = new Map<string, { subject: string | null; clause: string }>();
  const subjectMentions = [...definitions.matchAll(/<Subject\s+(\d+)>/giu)].map((match) => ({
    subject: match[1],
    index: match.index ?? 0,
  }));
  for (const match of definitions.matchAll(/\((S\d+)\)|\[\s*(S\d+)\s*\]/giu)) {
    const id = match[1] || match[2];
    if (!id) continue;
    const normal = `S${Number(id.slice(1))}`;
    const at = match.index ?? 0;
    const nearest = subjectMentions
      .filter((mention) => mention.index <= at)
      .sort((left, right) => right.index - left.index)[0]
      ?? subjectMentions
        .filter((mention) => mention.index > at)
        .sort((left, right) => left.index - right.index)[0];
    const sentenceStart = Math.max(definitions.lastIndexOf('.', at), definitions.lastIndexOf(';', at), definitions.lastIndexOf('\n', at)) + 1;
    const sentenceEndCandidates = [definitions.indexOf('.', at), definitions.indexOf(';', at), definitions.indexOf('\n', at)].filter((index) => index >= 0);
    const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : definitions.length;
    const clause = definitions.slice(sentenceStart, sentenceEnd).trim() || definitions.slice(Math.max(0, at - 80), at + 80).trim();
    if (!/\bvoice\b|\bspeaker\b|\bsays?\b|\bspeaks?\b|\bsilent\b|\bno (?:spoken )?lines?\b|声源|音色|说话|无对白|不说话|没有台词/iu.test(clause)) continue;
    const existing = declared.get(normal);
    declared.set(normal, {
      subject: existing?.subject ?? nearest?.subject ?? null,
      clause: existing ? `${existing.clause} ${clause}` : clause,
    });
  }
  return declared;
}

function auditVoiceIds(prompt: string, timeline: string): string[] {
  const issues: string[] = [];
  const declared = declaredVoiceIds(prompt);
  for (const [id, entry] of declared) {
    const silent = /\bno (?:spoken )?lines?\b|\bno dialogue\b|\bwithout (?:any )?(?:spoken )?lines?\b|\bdoes not speak\b|\bsilent\b|无对白|不说话|没有台词|未开口/iu.test(entry.clause);
    const silentSubject = entry.subject !== null && new RegExp(`<Subject\\s+${entry.subject}>[^\\n]*?(?:silent|no (?:spoken )?lines?|does not speak)|(?:silent|no (?:spoken )?lines?|does not speak)[^\\n]*?<Subject\\s+${entry.subject}>`, 'iu').test(definitionsOf(prompt));
    if (silent && (entry.subject === null || silentSubject)) {
      issues.push(`${id} 被分配给了无口播的主体：只有真正说话的主体才需要 (Sx) 声源编号；静默群体、队列和听者保留 <Subject N> 身份即可。`);
      continue;
    }
    const idBesideLine = new RegExp(`[（(]\\s*${id}\\s*[)）][\\s\\S]{0,300}?<d\\s*>`, 'iu').test(timeline)
      || new RegExp(`<d\\s*>[\\s\\S]{0,300}?[（(]\\s*${id}\\s*[)）]`, 'iu').test(timeline);
    const subjectBesideLine = entry.subject !== null
      && (new RegExp(`<Subject\\s+${entry.subject}>[\\s\\S]{0,200}?<d\\s*>`, 'iu').test(timeline)
        || new RegExp(`<d\\s*>[\\s\\S]{0,200}?<Subject\\s+${entry.subject}>`, 'iu').test(timeline));
    const speakerPresent = new RegExp(`<Subject\\s+${entry.subject ?? '\\d+'}>`, 'iu').test(timeline);
    if (!idBesideLine && !(subjectBesideLine && speakerPresent)) {
      issues.push(`${id} 声明了声源编号，但时间轴中没有绑定到该编号的台词；若该主体不说话，请删除该 (Sx) 编号。`);
    }
  }
  const timelineIds = new Set([...timeline.matchAll(/[（(]\s*(S\d+)\s*[)）]|\[\s*(S\d+)\s*\]/giu)].map((match) => (match[1] || match[2]).toUpperCase()));
  for (const id of timelineIds) {
    if (declared.has(id)) continue;
    const bound = new RegExp(`<Subject\\s+\\d+>[^.!?。！？]{0,120}?[（(]\\s*${id}\\s*[)）]|\\[\\s*${id}\\s*\\][^.!?。！？]{0,120}?<Subject\\s+\\d+>`, 'iu').test(timeline);
    if (!bound) issues.push(`时间轴使用了未声明的声源编号 ${id}：请先在主体定义中绑定唯一说话人，或删除该编号。`);
  }
  if (/<d\s*>/iu.test(timeline) && timelineIds.size === 0 && declared.size === 0) {
    issues.push('时间轴包含台词，但没有绑定任何 (Sx) 声源编号：每句台词都必须紧邻唯一说话人的稳定声源编号。');
  }
  return issues;
}

/** Only factual contradictions block a save. */
export function auditH3ShotContract(input: H3ShotContractInput): string[] {
  const prompt = input.prompt ?? '';
  const timeline = h3TimelineSection(prompt);
  if (!timeline.trim()) return [];
  // Named-subject checks stay here. Anonymous-noun detection was a keyword
  // heuristic ("a monkey runs out") that could not distinguish an established
  // background member from an invented person; that judgement belongs to the
  // shot facts, not to a save-blocking regex.
  return [...new Set(auditVoiceIds(prompt, timeline))];
}
