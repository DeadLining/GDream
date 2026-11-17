export type WorkshopEditScope = 'story' | 'breakdown' | 'shots' | 'prompts' | 'unknown';

const NEGATED_STORY_EDIT_RE =
  /(?:不要|不得|禁止|别|无需|不需要|不能|不可|绝?不等于|并非|不是|不代表|不(?=改|修改|重写|调整|增删|新增|删除|替换|改编)).{0,10}(?:改|修改|重写|调整|增删|新增|删除|替换|改编).{0,8}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定|画面描述|分镜描述)/gi;

// Agent instructions often restate the permission boundary (for example,
// "只有用户明确要求修改剧本时..."). Such a condition is not itself user
// authorization, so remove it before looking for a positive story-edit request.
const CONDITIONAL_STORY_PERMISSION_PATTERNS = [
  /(?:除非|只有|仅当).{0,32}(?:用户|本轮|当前请求).{0,20}(?:明确)?(?:要求|授权).{0,20}(?:改|修改|重写|调整|增删|新增|删除|替换|改编).{0,8}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定)/gi,
  /(?:如果|若).{0,16}(?:要|需要|准备)?(?:改|修改|重写|调整|增删|新增|删除|替换|改编).{0,8}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定).{0,32}(?:必须|需要|应当).{0,20}(?:用户|明确要求|授权)/gi,
];

const STORY_EDIT_TERM_RE = /(?:改|修改|重写|调整|增删|新增|删除|替换|改编).{0,12}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定|人物)/i;

/**
 * Workflow prompts describe permission boundaries in full sentences. Those
 * sentences are policy, not the user's requested mutation scope. Strip the
 * whole conditional clause so a trailing list item such as “改剧情、改对白”
 * cannot survive a narrower regular-expression replacement and grant story
 * editing by accident.
 */
function stripConditionalStoryPermissionClauses(text: string): string {
  return text
    .split(/([。！？；\n])/u)
    .map((segment) => {
      if (
        /(?:除非|只有|仅当)/.test(segment)
        && /(?:用户|本轮|当前请求)/.test(segment)
        && /(?:明确)?(?:要求|授权)/.test(segment)
        && STORY_EDIT_TERM_RE.test(segment)
      ) return ' ';
      return segment;
    })
    .join('');
}

const NEGATED_BREAKDOWN_EDIT_RE =
  /(?:不要|不得|禁止|别|无需|不需要|不能|不可).{0,12}(?:重新|再次|继续|重做|修复|优化|完善|补充|补齐|补|执行|进行)?(?:剧本)?(?:拆解|分镜)/gi;

const STORY_EDIT_PATTERNS = [
  /(?:改|修改|重写|调整|重构|续写|扩写|删减|删除|增加|新增|替换|改编).{0,10}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定)/i,
  /(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定).{0,10}(?:要改|改成|修改|重写|调整|重构|续写|扩写|删减|删除|增加|新增|替换|改编)/i,
  /把.{0,24}(?:台词|对白).{0,8}(?:改成|换成|删掉|删除|增加|补上)/i,
  /(?:让|改成让).{0,16}(?:说|问|回答|喊|念|旁白)/i,
];

const SHOT_EDIT_PATTERNS = [
  /(?:重做|重排|重新|修改|调整|拆分|合并|增加|新增|删除|替换|优化).{0,10}(?:分镜表|分镜结构|镜头结构|分镜头|镜头拆分|镜头顺序|镜号)/i,
  /(?:分镜表|分镜结构|镜头结构|分镜头|镜头拆分|镜头顺序|镜号).{0,10}(?:重做|重排|重新|修改|调整|拆分|合并|增加|新增|删除|替换|优化)/i,
  /(?:修改|调整|修正|补充).{0,10}(?:角色关联|人物关联|场景关联|道具关联|参考资产)/i,
];

const BREAKDOWN_EDIT_PATTERNS = [
  /(?:重新|再次|继续|重做|重跑|修复|优化|完善|执行|进行)?\s*(?:剧本)?\s*拆解/i,
  /(?:修复|重做|重跑|重新执行|继续|优化|完善|完成).{0,12}(?:第\s*[②2二]\s*步|剧本拆解)/i,
  /(?:第\s*[②2二]\s*步|剧本拆解).{0,12}(?:修复|重做|重跑|重新执行|继续|优化|完善|完成)/i,
  /(?:补|补充|补齐|完善|生成|新增).{0,8}(?:原子)?分镜/i,
];

const PROMPT_EDIT_RE = /(?:提示词|prompt|生图词|视频词|配音词|生成词)/i;

export function classifyWorkshopEditScope(request: string): WorkshopEditScope {
  const text = request.trim();
  if (!text) return 'unknown';
  const withoutConditionalPermissions = stripConditionalStoryPermissionClauses(text);
  const positiveText = CONDITIONAL_STORY_PERMISSION_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, ' '),
    withoutConditionalPermissions.replace(NEGATED_STORY_EDIT_RE, ' ').replace(NEGATED_BREAKDOWN_EDIT_RE, ' '),
  );
  if (STORY_EDIT_PATTERNS.some((pattern) => pattern.test(positiveText))) return 'story';
  if (BREAKDOWN_EDIT_PATTERNS.some((pattern) => pattern.test(positiveText))) return 'breakdown';
  if (SHOT_EDIT_PATTERNS.some((pattern) => pattern.test(positiveText))) return 'shots';
  if (PROMPT_EDIT_RE.test(text)) return 'prompts';
  return 'unknown';
}

function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s"'“”‘’「」『』《》【】（）()，。！？、；：:,.!?;…—_-]+/g, '');
}

/** Replacement characters mean the persisted screenplay was already decoded incorrectly. */
export function dialogueEncodingIssue(dialogue: string | undefined): string | undefined {
  if (!dialogue?.includes('\uFFFD')) return undefined;
  return '当前分镜对白包含 Unicode 替换字符（�），正式剧本对白已损坏；请先从正式剧本修复对白，未生成或覆盖提示词。';
}

export function isTextSupportedByCanonical(candidate: string | undefined, canonical: string | undefined): boolean {
  const next = normalizeEvidenceText(candidate ?? '');
  if (!next) return true;
  const source = normalizeEvidenceText(canonical ?? '');
  return Boolean(source) && (source.includes(next) || next.includes(source));
}

function quoteCandidates(text: string): Array<{ value: string; index: number }> {
  const results: Array<{ value: string; index: number }> = [];
  const patterns = [
    /[“"「『]([^”"」』]{1,160})[”"」』]/g,
    /\{([^{}]{1,160})\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) results.push({ value, index: match.index ?? 0 });
    }
  }
  return results;
}

function looksLikeSpokenText(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 36), index);
  return /(?:说|问|回答|答道|喊|吼|念|开口|回应|对白|台词|旁白|画外音|内心独白|解说|vo|voice[\s-]?over|@图片[一二三四五六七八九十百\d]+.{0,10}[：:])[^。！？\n]*$/i.test(prefix);
}

export function findUnsupportedPromptDialogue(args: {
  videoPrompt?: string;
  audioPrompts?: Array<{ prompt: string }>;
  canonicalDialogue?: string;
}): string[] {
  const evidence = normalizeEvidenceText(args.canonicalDialogue ?? '');
  const candidates: string[] = [];

  if (args.videoPrompt) {
    for (const candidate of quoteCandidates(args.videoPrompt)) {
      if (looksLikeSpokenText(args.videoPrompt, candidate.index)) candidates.push(candidate.value);
    }
  }
  for (const audio of args.audioPrompts ?? []) {
    candidates.push(...quoteCandidates(audio.prompt).map((candidate) => candidate.value));
  }

  return [...new Set(candidates.filter((candidate) => {
    const normalized = normalizeEvidenceText(candidate);
    if (!normalized) return false;
    return !evidence || !evidence.includes(normalized);
  }))];
}

export interface AudioPromptValidationInput {
  dialogue?: string;
  characterIds?: string[];
  audioPrompts?: Array<{ characterId: string; prompt: string }>;
}

function canonicalDialogueUnits(dialogue: string): string[] {
  const quoted = quoteCandidates(dialogue).map((candidate) => candidate.value);
  if (quoted.length > 0) return quoted;
  return dialogue
    .split(/\r?\n|[。！？!?；;]/u)
    .map((line) => line.replace(/^\s*[^：:]{1,24}[：:]/u, '').trim())
    .filter((line) => normalizeEvidenceText(line).length >= 2);
}

export function validateAudioPromptsAgainstShot(args: AudioPromptValidationInput): string[] {
  const prompts = args.audioPrompts ?? [];
  if (prompts.length === 0) return [];
  const dialogue = args.dialogue?.trim() ?? '';
  const errors: string[] = [];
  if (!dialogue) {
    errors.push('本镜没有剧本对白，禁止生成配音提示词；如需旁白或新台词，必须先修改剧本对白。');
    return errors;
  }

  const allowedCharacters = new Set(args.characterIds ?? []);
  const seenCharacters = new Set<string>();
  const units = canonicalDialogueUnits(dialogue).map(normalizeEvidenceText).filter(Boolean);
  for (const audio of prompts) {
    if (!allowedCharacters.has(audio.characterId)) {
      errors.push(`配音角色 ${audio.characterId} 未关联到本镜 characterIds，禁止错配角色音频。`);
    }
    if (seenCharacters.has(audio.characterId)) {
      errors.push(`角色 ${audio.characterId} 存在重复 audioPrompts，禁止为同一角色生成多条未区分台词的配音。`);
    }
    seenCharacters.add(audio.characterId);
    const prompt = audio.prompt?.trim() ?? '';
    if (!prompt) {
      errors.push(`角色 ${audio.characterId} 的配音提示词为空。`);
      continue;
    }
    const normalizedPrompt = normalizeEvidenceText(prompt);
    if (!units.some((unit) => normalizedPrompt.includes(unit))) {
      errors.push(`角色 ${audio.characterId} 的配音提示词没有包含本镜剧本对白原文，禁止让语音模型自行编造台词。`);
    }
    const unsupported = findUnsupportedPromptDialogue({ audioPrompts: [audio], canonicalDialogue: dialogue });
    if (unsupported.length > 0) {
      errors.push(`角色 ${audio.characterId} 的配音提示词包含剧本中不存在的台词：${unsupported.map((line) => `“${line}”`).join('、')}`);
    }
  }
  return [...new Set(errors)];
}

const RELATIONSHIP_TERMS = [
  '父亲', '母亲', '父子', '父女', '母子', '母女', '兄长', '弟弟', '姐姐', '妹妹',
  '兄弟', '姐妹', '夫妻', '丈夫', '妻子', '恋人', '情侣', '未婚夫', '未婚妻',
  '师父', '师傅', '徒弟', '师徒', '主仆', '主人', '仆人', '同胞', '亲生',
];

/** 提示词可以丰富导演表达，但不得凭空建立剧本中没有的人物关系。 */
export function findUnsupportedRelationshipClaims(args: {
  prompts: Array<string | undefined>;
  canonicalFacts: string;
}): string[] {
  const promptText = args.prompts.filter(Boolean).join('\n');
  const canonical = normalizeEvidenceText(args.canonicalFacts);
  if (!promptText) return [];
  return RELATIONSHIP_TERMS.filter((term) =>
    promptText.includes(term) && !canonical.includes(normalizeEvidenceText(term)));
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}
