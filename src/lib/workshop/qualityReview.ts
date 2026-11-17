import type { DshVideoEvidence } from './dshVideoReview.ts';
export type QualityReviewKind = 'boundary-frames' | 'video';

export type QualityReviewTarget = 'start-frame' | 'end-frame' | 'both-frames' | 'video' | 'unknown';

export type QualityIssueCode =
  | 'character-identity'
  | 'character-scale'
  | 'character-position'
  | 'scene-continuity'
  | 'lighting-continuity'
  | 'prop-continuity'
  | 'composition-continuity'
  | 'action-mismatch'
  | 'audio-sync'
  | 'visual-artifact'
  | 'policy'
  | 'unknown';

export interface QualityReviewIssue {
  code: QualityIssueCode;
  severity: 'warning' | 'error';
  message: string;
  target?: QualityReviewTarget;
  location?: string;
  repairHint?: string;
}

export interface QualityReviewReport {
  /** Native DSH evidence; sampled frames are not a full audiovisual approval. */
  evidence?: DshVideoEvidence;
  kind: QualityReviewKind;
  passed: boolean;
  score: number;
  summary: string;
  issues: QualityReviewIssue[];
  reviewedAt: number;
  model: string;
  /** 审核服务地址与模型的非密钥指纹；配置变化后旧审核不得继续作为门禁证据。 */
  reviewerFingerprint?: string;
  attempt: number;
  artifactPath?: string;
  /** 视频终审时绑定候选内容指纹，防止同一路径文件被覆盖后误用旧审核。 */
  artifactFingerprint?: string;
}

interface RawQualityReviewIssue {
  code?: unknown;
  severity?: unknown;
  message?: unknown;
  target?: unknown;
  location?: unknown;
  repair_hint?: unknown;
  repairHint?: unknown;
}

interface RawQualityReviewReport {
  passed?: unknown;
  score?: unknown;
  summary?: unknown;
  issues?: unknown;
}

const ISSUE_PATCHES: Record<QualityIssueCode, string> = {
  'character-identity': '强化角色身份锚点：保持脸型、五官、年龄感、发型、服装和配饰与已提交角色资产一致，不得发生角色替换或身份特征转移。',
  'character-scale': '强化人物尺度锚点：以场景中的台阶、门框、家具或另一人物为参照，保持人物身高比例、画面占比和透视尺度连续。',
  'character-position': '强化空间关系：逐段写清人物相对固定参照物的方位、距离、朝向和移动后的落点，位置变化必须符合时间轴动作。',
  'scene-continuity': '强化场景拓扑：固定入口、台阶、墙面、地面、家具等稳定结构及其相对关系，不得无剧情依据更换地点或重置空间。',
  'lighting-continuity': '强化光源连续性：锁定主光方向、色温、天气、阴影投射方向和环境反光，动作过程中只允许符合物理规律的局部明暗变化。',
  'prop-continuity': '强化道具状态账本：写清道具当前持有人、相对位置、朝向、完整/破损状态及变化过程，禁止道具回到旧持有人或恢复旧形态。',
  'composition-continuity': '强化镜头连续性：固定机位、焦距、景别、轴线与画幅；若需要特写，必须写清进入特写和返回主构图的连续摄影机路径。',
  'action-mismatch': '强化动作验收：按因果顺序补全动作起点、过程、接触反馈和最终结果，不得省略、替换、倒放或提前结束核心动作。',
  'audio-sync': '强化声画同步：明确唯一说话人、对白原文和起止时间；说话人口型持续同步，未说话角色不得形成可辨识语音。',
  'visual-artifact': '强化画面质量约束：避免畸形肢体、穿模、重影、字幕、水印、画中画、重复人物和无来源物体。',
  policy: '移除或改写触发服务安全策略的内容，同时保持原剧情目标与镜头因果关系不变。',
  unknown: '依据审核报告只修复明确指出的问题，保留原分镜事实、动作顺序、资产绑定和镜头设计。',
};

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function clampQualityScore(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

export function qualityReviewEndpoint(baseUrl: string, endpoint: 'chat' | 'models'): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  const apiBase = /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
  return `${apiBase}/${endpoint === 'chat' ? 'chat/completions' : 'models'}`;
}

export function qualityReviewerFingerprint(baseUrl: string, model: string): string {
  return `quality-reviewer-${fnv1a(`${qualityReviewEndpoint(baseUrl, 'chat')}|${model.trim()}`)}`;
}

export function qualityReviewMatchesReviewer(
  report: QualityReviewReport | undefined,
  reviewerFingerprint?: string,
): boolean {
  return Boolean(report && (!reviewerFingerprint || report.reviewerFingerprint === reviewerFingerprint));
}

export function boundaryFrameReviewGate(input: {
  enabled: boolean;
  report?: QualityReviewReport;
  boundarySignature?: string;
  reviewSignature?: string;
  reviewerFingerprint?: string;
  manualReviewRequired?: boolean;
}): { allowed: boolean; reason?: string } {
  if (!input.enabled) {
    return { allowed: false, reason: '多模态首尾帧审核未启用' };
  }
  if (input.manualReviewRequired) {
    return { allowed: false, reason: '首尾帧已达到自动重绘上限，需要人工复盘' };
  }
  if (!input.boundarySignature || input.reviewSignature !== input.boundarySignature) {
    return { allowed: false, reason: '首尾帧审核结果与当前生成输入不匹配' };
  }
  if (!qualityReviewMatchesReviewer(input.report, input.reviewerFingerprint)) {
    return { allowed: false, reason: '首尾帧审核结果不属于当前审核服务或模型' };
  }
  if (!input.report?.passed) {
    return { allowed: false, reason: input.report ? '首尾帧质量审核未通过' : '首尾帧尚未完成质量审核' };
  }
  return { allowed: true };
}

export function normalizeQualityIssueCode(value: unknown): QualityIssueCode {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized in ISSUE_PATCHES) return normalized as QualityIssueCode;
  const aliases: Record<string, QualityIssueCode> = {
    identity: 'character-identity',
    scale: 'character-scale',
    position: 'character-position',
    scene: 'scene-continuity',
    lighting: 'lighting-continuity',
    prop: 'prop-continuity',
    composition: 'composition-continuity',
    action: 'action-mismatch',
    audio: 'audio-sync',
    artifact: 'visual-artifact',
    compliance: 'policy',
  };
  return aliases[normalized] ?? 'unknown';
}

export function normalizeQualityReviewTarget(value: unknown, fallbackText = ''): QualityReviewTarget {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  const aliases: Record<string, QualityReviewTarget> = {
    start: 'start-frame',
    'start-frame': 'start-frame',
    first: 'start-frame',
    'first-frame': 'start-frame',
    opening: 'start-frame',
    'opening-frame': 'start-frame',
    end: 'end-frame',
    'end-frame': 'end-frame',
    last: 'end-frame',
    'last-frame': 'end-frame',
    closing: 'end-frame',
    'closing-frame': 'end-frame',
    both: 'both-frames',
    'both-frames': 'both-frames',
    boundary: 'both-frames',
    'boundary-frames': 'both-frames',
    video: 'video',
  };
  if (aliases[normalized]) return aliases[normalized];
  const text = `${value ?? ''} ${fallbackText}`.toLowerCase();
  if (/首尾帧|两[张个]帧|both frames|boundary frames/.test(text)) return 'both-frames';
  if (/首帧|起始帧|start frame|first frame|opening frame/.test(text)) return 'start-frame';
  if (/尾帧|结束帧|end frame|last frame|closing frame/.test(text)) return 'end-frame';
  if (/视频|成片|video/.test(text)) return 'video';
  return 'unknown';
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('审核模型未返回 JSON 对象');
  return text.slice(start, end + 1);
}

export function parseQualityReviewResponse(input: {
  text: string;
  kind: QualityReviewKind;
  model: string;
  attempt: number;
  reviewedAt?: number;
  artifactPath?: string;
  artifactFingerprint?: string;
  reviewerFingerprint?: string;
}): QualityReviewReport {
  const raw = JSON.parse(extractJsonObject(input.text)) as RawQualityReviewReport;
  const issues = Array.isArray(raw.issues)
    ? raw.issues.flatMap((value): QualityReviewIssue[] => {
        if (!value || typeof value !== 'object') return [];
        const issue = value as RawQualityReviewIssue;
        const message = String(issue.message ?? '').trim();
        if (!message) return [];
        const severity = String(issue.severity ?? '').toLowerCase() === 'warning' ? 'warning' : 'error';
        const location = String(issue.location ?? '').trim() || undefined;
        const repairHint = String(issue.repair_hint ?? issue.repairHint ?? '').trim() || undefined;
        const target = normalizeQualityReviewTarget(issue.target, `${location ?? ''} ${message}`);
        return [{ code: normalizeQualityIssueCode(issue.code), severity, message, target, location, repairHint }];
      })
    : [];
  const passed = raw.passed === true || String(raw.passed).toLowerCase() === 'true';
  return {
    kind: input.kind,
    passed: passed && !issues.some((issue) => issue.severity === 'error'),
    score: clampQualityScore(raw.score),
    summary: String(raw.summary ?? (passed ? '审核通过' : '审核未通过')).trim(),
    issues,
    reviewedAt: input.reviewedAt ?? Date.now(),
    model: input.model,
    reviewerFingerprint: input.reviewerFingerprint,
    attempt: Math.max(1, Math.round(input.attempt)),
    artifactPath: input.artifactPath,
    artifactFingerprint: input.artifactFingerprint,
  };
}

export function videoQualityReviewForCandidate(input: {
  reports?: Array<QualityReviewReport | undefined>;
  candidatePath: string;
  candidateFingerprint: string;
  reviewerFingerprint?: string;
}): QualityReviewReport | undefined {
  return (input.reports ?? [])
    .filter((report): report is QualityReviewReport => Boolean(report))
    .filter((report) => report.kind === 'video'
      && report.artifactPath === input.candidatePath
      && report.artifactFingerprint === input.candidateFingerprint
      && qualityReviewMatchesReviewer(report, input.reviewerFingerprint))
    .sort((left, right) => right.reviewedAt - left.reviewedAt)[0];
}

export function currentVideoQualityReview(input: {
  reports?: Array<QualityReviewReport | undefined>;
  candidatePath: string;
  candidateFingerprint: string;
  reviewerFingerprint?: string;
}): QualityReviewReport | undefined {
  const report = videoQualityReviewForCandidate(input);
  return report?.passed ? report : undefined;
}

export function buildQualityRepairPatch(issues: QualityReviewIssue[]): string {
  const codes = [...new Set(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code))];
  if (codes.length === 0) return '';
  return [
    '【自动质检最小修复补丁】',
    ...codes.map((code) => `- ${ISSUE_PATCHES[code]}`),
    '仅应用以上针对性修复，不重写剧情、不增加新人物、新场景、新道具或无关动作。',
    '【自动质检最小修复补丁结束】',
  ].join('\n');
}

export function appendQualityRepairPatch(prompt: string, issues: QualityReviewIssue[]): string {
  const patch = buildQualityRepairPatch(issues);
  if (!patch) return prompt.trim();
  const withoutOldPatch = prompt.replace(/\n*【自动质检最小修复补丁】[\s\S]*?【自动质检最小修复补丁结束】\s*/g, '\n').trim();
  return `${withoutOldPatch}\n\n${patch}`;
}

export function shouldRetryQualityReview(report: QualityReviewReport, maxAttempts = 3): boolean {
  return !report.passed && report.attempt < Math.max(1, maxAttempts) && report.issues.some((issue) => issue.severity === 'error');
}

export function boundaryFrameRedrawPlan(report: QualityReviewReport): { redrawStart: boolean; redrawEnd: boolean } {
  if (report.passed) return { redrawStart: false, redrawEnd: false };
  const targets = report.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.target ?? normalizeQualityReviewTarget(undefined, `${issue.location ?? ''} ${issue.message}`));
  return {
    redrawStart: targets.some((target) => target === 'start-frame' || target === 'both-frames'),
    redrawEnd: targets.length > 0,
  };
}
