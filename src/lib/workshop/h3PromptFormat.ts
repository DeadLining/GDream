import { OUTPUT_FORMAT } from './h3PromptWritingSkillContent.ts';

interface H3OutputFormat {
  version: number;
  baseFields: string[];
  referenceFields: string[];
  baseTimelineField: string;
  referenceTimelineField: string;
  emptyAudioValue: string;
}

/** Shared with the standalone skill validator; generated from the skill source. */
export const H3_OUTPUT_FORMAT: H3OutputFormat = JSON.parse(OUTPUT_FORMAT);

export function h3FormatFields(referenceMode: boolean): readonly string[] {
  return referenceMode ? H3_OUTPUT_FORMAT.referenceFields : H3_OUTPUT_FORMAT.baseFields;
}

export function h3FormatAuthoringContract(referenceMode: boolean): string {
  const fields = h3FormatFields(referenceMode);
  const body = referenceMode ? H3_OUTPUT_FORMAT.referenceTimelineField : H3_OUTPUT_FORMAT.baseTimelineField;
  return `CANONICAL H3 OUTPUT FORMAT v${H3_OUTPUT_FORMAT.version}:
Return these exact lowercase fields once each, at the beginning of a line, in this order: ${fields.join(', ')}.
Every field has non-empty content. For absent sound or score use ${H3_OUTPUT_FORMAT.emptyAudioValue}; never omit a field. No Markdown fences, alternate field names, or authoring appendix.
${referenceMode ? 'subject_definitions binds the actual reference roles once. summary is one short task/reference-scope sentence, not a plot replay. retention_analysis concisely states what each reference preserves or transfers; identity preservation does not freeze pose, expression, props or camera. Neither summary nor retention_analysis repeats dialogue or action chronology.' : 'Only the selected mode\'s official keyframe-alignment instruction may precede the fields; T2VA starts directly with integrated_multimodal_description.'}
${body} is the sole chronological performance schedule. Start it with [Shot 1], even for a single take. Add [Shot 2], [Shot 3], etc. only for actual internal cuts, numbered consecutively; put each later cut time at the start of its block. Within a shot, use natural paragraphs and meaningful MM:SS.mmm-MM:SS.mmm event windows, not equal bins. Opening composition comes first; the final action paragraph carries the approved end state. Timed beats do not create cuts. Do not add a mandatory eight-block checklist or a second action/dialogue schedule.
Preserve exact dialogue beside its sole speaker and stable (Sx), using <d>[language] original words</d>. Intentional repeated script turns remain repeated; bookkeeping never repeats a vocalization. Whole-clip ambience belongs in overall_soundscape; audience-only score belongs in non_diegetic_music.`;
}

/** Format checks only: they do not infer story facts or rewrite historical prompts. */
export function h3FormatIssues(prompt: string, referenceMode: boolean): string[] {
  const text = prompt.trim();
  if (!text) return ['缺少视频提示词'];
  // Spoken text may itself contain a field name or shot label.
  const prose = text.replace(/<d\s*>[\s\S]*?<\/d\s*>/giu, (match) => match.replace(/[^\r\n]/g, ' '));
  const required = h3FormatFields(referenceMode);
  const allFields = [...new Set([...H3_OUTPUT_FORMAT.baseFields, ...H3_OUTPUT_FORMAT.referenceFields])];
  const marks = [...prose.matchAll(new RegExp(`^[ \\t]*(${allFields.join('|')}):`, 'gmu'))];
  const issues: string[] = [];
  if (/^\s*```/mu.test(prose)) issues.push('H3 统一格式不得包含 Markdown 代码围栏');
  if (/^\s*\[(?:REFERENCE_ALIGNMENT|SUBJECTS|WORLD_CONTINUITY|OBJECT_CONTINUITY|ACTION_ENGINE|DIALOGUE|CAMERA_LOGIC|STATE_TRANSITION|AUDIO_LOGIC|RESTRICTIONS)\]/mu.test(prose)) {
    issues.push('H3 统一格式不得追加旧分块台账；将身份、动作、对白与摄影融合进当前模式字段及 [Shot N] 正文');
  }
  const missing = required.filter((field) => !marks.some((mark) => mark[1] === field));
  if (missing.length) issues.push(`缺少 H3 统一格式字段：${missing.join('、')}`);
  const duplicate = required.filter((field) => marks.filter((mark) => mark[1] === field).length > 1);
  if (duplicate.length) issues.push(`H3 统一格式字段重复：${duplicate.join('、')}`);
  const unexpected = marks.filter((mark) => !required.includes(mark[1])).map((mark) => mark[1]);
  if (unexpected.length) issues.push(`H3 当前模式使用了其它模式字段：${[...new Set(unexpected)].join('、')}`);
  const actual = marks.filter((mark) => required.includes(mark[1])).map((mark) => mark[1]);
  if (!missing.length && !duplicate.length && actual.some((field, index) => field !== required[index])) {
    issues.push(`H3 统一格式字段顺序错误：必须依次使用 ${required.join('、')}`);
  }
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    const start = (mark.index ?? 0) + mark[0].length;
    const end = marks[index + 1]?.index ?? text.length;
    if (required.includes(mark[1]) && !text.slice(start, end).trim()) {
      issues.push(`H3 统一格式字段不能为空：${mark[1]}（无声音或配乐时填写 N/A）`);
    }
  }
  const first = marks[0];
  const preamble = first ? prose.slice(0, first.index).trim() : '';
  if (preamble && referenceMode) {
    issues.push('H3 ref2va 必须从 subject_definitions 开始，不得在字段前附加自由段落');
  } else if (preamble && !/^(?:For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.|How the reference pictures align with the target video[^\r\n]*)$/u.test(preamble)) {
    issues.push('H3 基础模式字段前只允许对应的官方关键帧对齐说明，不得附加自由段落');
  }
  const timelineField = referenceMode ? H3_OUTPUT_FORMAT.referenceTimelineField : H3_OUTPUT_FORMAT.baseTimelineField;
  const timelineIndex = marks.findIndex((mark) => mark[1] === timelineField);
  if (timelineIndex >= 0) {
    const mark = marks[timelineIndex];
    const timeline = prose.slice((mark.index ?? 0) + mark[0].length, marks[timelineIndex + 1]?.index);
    const shots = [...timeline.matchAll(/\[Shot\s+(\d+)\]/giu)];
    if (!shots.length || !timeline.trimStart().startsWith('[Shot 1]')) {
      issues.push(`H3 统一镜头正文必须以 [Shot 1] 开始：${timelineField}`);
    } else if (shots.some((shot, index) => Number(shot[1]) !== index + 1)) {
      issues.push('H3 统一镜头编号必须从 [Shot 1] 起连续递增，不得重复或跳号');
    }
  }
  return issues;
}
