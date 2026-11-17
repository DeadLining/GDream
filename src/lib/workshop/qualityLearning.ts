import { buildQualityRepairPatch, type QualityIssueCode, type QualityReviewReport } from './qualityReview.ts';

export interface QualityPromptExample {
  id: string;
  kind: QualityReviewReport['kind'];
  shotNo: string;
  prompt: string;
  score: number;
  model: string;
  createdAt: number;
}

export interface QualityAvoidanceRule {
  code: QualityIssueCode;
  rule: string;
  occurrences: number;
  lastSeenAt: number;
}

export interface QualityLearningState {
  highScorePrompts: QualityPromptExample[];
  avoidanceRules: QualityAvoidanceRule[];
  updatedAt: number;
}

export function emptyQualityLearning(now = Date.now()): QualityLearningState {
  return { highScorePrompts: [], avoidanceRules: [], updatedAt: now };
}

export function removeQualityLearningRule(
  current: QualityLearningState | undefined,
  code: QualityIssueCode,
  now = Date.now(),
): QualityLearningState | undefined {
  if (!current || !current.avoidanceRules.some((rule) => rule.code === code)) return current;
  return {
    ...current,
    avoidanceRules: current.avoidanceRules.filter((rule) => rule.code !== code),
    updatedAt: Math.max(current.updatedAt, now),
  };
}

export function removeQualityPromptExample(
  current: QualityLearningState | undefined,
  id: string,
  now = Date.now(),
): QualityLearningState | undefined {
  if (!current || !current.highScorePrompts.some((example) => example.id === id)) return current;
  return {
    ...current,
    highScorePrompts: current.highScorePrompts.filter((example) => example.id !== id),
    updatedAt: Math.max(current.updatedAt, now),
  };
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function updateQualityLearning(input: {
  current?: QualityLearningState;
  report: QualityReviewReport;
  prompt: string;
  shotNo: string;
  highScoreThreshold?: number;
}): QualityLearningState {
  const current: QualityLearningState = input.current ?? emptyQualityLearning(0);
  let highScorePrompts = [...current.highScorePrompts];
  if (input.report.passed && input.report.score >= (input.highScoreThreshold ?? 90) && input.prompt.trim()) {
    const id = `quality-prompt-${fnv1a(`${input.report.kind}|${input.report.model}|${input.prompt.trim()}`)}`;
    const example: QualityPromptExample = {
      id,
      kind: input.report.kind,
      shotNo: input.shotNo,
      prompt: input.prompt.trim(),
      score: input.report.score,
      model: input.report.model,
      createdAt: input.report.reviewedAt,
    };
    highScorePrompts = [example, ...highScorePrompts.filter((item) => item.id !== id)]
      .sort((left, right) => right.score - left.score || right.createdAt - left.createdAt)
      .slice(0, 20);
  }

  const rules = new Map(current.avoidanceRules.map((rule) => [rule.code, { ...rule }]));
  for (const issue of input.report.issues) {
    const existing = rules.get(issue.code);
    const generatedRule = buildQualityRepairPatch([{ ...issue, severity: 'error' }])
      .replace(/【自动质检最小修复补丁(?:结束)?】/g, '')
      .replace(/^- /gm, '')
      .replace(/仅应用以上针对性修复[^\n]*/g, '')
      .trim();
    rules.set(issue.code, {
      code: issue.code,
      rule: issue.repairHint?.trim() || generatedRule || issue.message,
      occurrences: (existing?.occurrences ?? 0) + 1,
      lastSeenAt: input.report.reviewedAt,
    });
  }

  return {
    highScorePrompts,
    avoidanceRules: [...rules.values()]
      .sort((left, right) => right.occurrences - left.occurrences || right.lastSeenAt - left.lastSeenAt)
      .slice(0, 50),
    updatedAt: Math.max(current.updatedAt, input.report.reviewedAt),
  };
}

export function appendQualityLearningGuidance(prompt: string, current?: QualityLearningState): string {
  const rules = current?.avoidanceRules.slice(0, 6) ?? [];
  if (rules.length === 0) return prompt.trim();
  const block = [
    '【项目历史质量规则】',
    ...rules.map((rule) => `- ${rule.rule}`),
    '这些规则只用于规避本项目已出现的生成缺陷，不得据此增加或改写剧情事实。',
    '【项目历史质量规则结束】',
  ].join('\n');
  const withoutOld = prompt.replace(/\n*【项目历史质量规则】[\s\S]*?【项目历史质量规则结束】\s*/g, '\n').trim();
  return `${withoutOld}\n\n${block}`;
}
