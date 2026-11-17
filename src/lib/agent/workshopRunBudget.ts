import { isBreakdownReconciliationRequest } from '../workshop/breakdownIntent.ts';
import { isEpisodeScriptRequest } from '../workshop/episodeScriptTask.ts';

/**
 * 工坊运行轮次预算：按任务类型和真实工作量决定单轮允许的工具步数上限。
 *
 * 背景：聊天默认上限（30）是按普通对话设计的。剧本拆解要读状态、补齐
 * Scene/Beat、再分批写 Atomic Shot，DeepSeek 这类模型又习惯把工作拆成很多
 * 小工具调用，按 30 轮封顶会把一次本可完成的修复截断在中途，用户看到的是
 * “调用步骤过多，已安全停止”。这里把上限与真实工作量挂钩；真正防止死循环
 * 的是 coordinator 里的重复写入/失败重试守卫，而不是这个数字。
 */

export type WorkshopRunKind = 'episode-script' | 'prompt-rewrite' | 'breakdown' | 'default';

export interface WorkshopRunBudgetOptions {
  userInput: string;
  defaultMaxTurns: number;
  shotCount?: number;
  sceneCount?: number;
  beatCount?: number;
  episodeScriptCount?: number;
  sourceChars?: number;
}

export interface WorkshopRunBudget {
  kind: WorkshopRunKind;
  maxTurns: number;
}

const PROMPT_REWRITE_PATTERN = /工坊[\s\S]{0,80}(?:重写|重新编写)[\s\S]{0,80}(?:提示词|videoPrompt|imagePrompt)/u;

/** 拆解类指令的稳定特征：首次拆解 / AI 修复拆解 / 按单镜时间轴重排。 */
const BREAKDOWN_RUN_SIGNATURES: readonly RegExp[] = [
  /请对当前工坊项目执行剧本拆解/u,
  /\[工坊任务:breakdown\]/u,
  /请把当前工坊已有的过度细碎分镜/u,
  // “针对错误修复并重提”按钮会提交失败批次的最小修复，本质上仍属于拆解
  // 写入。漏掉这条特征会让它只拿到默认 30 轮预算，尚未完成就被判“步骤过多”。
  /请修复一批未写入的\s*Atomic Shot/u,
  /breakdown\/rejected-shots\//u,
];

export function isWorkshopPromptRewriteRun(userInput: string): boolean {
  return PROMPT_REWRITE_PATTERN.test(userInput);
}

export function isWorkshopBreakdownRun(userInput: string): boolean {
  return isBreakdownReconciliationRequest(userInput) || BREAKDOWN_RUN_SIGNATURES.some((pattern) => pattern.test(userInput));
}

export function resolveWorkshopRunBudget(options: WorkshopRunBudgetOptions): WorkshopRunBudget {
  const shotCount = Math.max(0, options.shotCount ?? 0);
  const defaultMaxTurns = Math.max(1, Math.floor(options.defaultMaxTurns) || 1);
  if (isEpisodeScriptRequest(options.userInput)) {
    const episodeCount = Math.max(1, options.episodeScriptCount ?? 1);
    const sourcePages = Math.ceil(Math.max(0, options.sourceChars ?? 0) / 8_000);
    return {
      kind: 'episode-script',
      // Source pagination + per-episode scoped read/write/limited recovery; not
      // proportional to already-produced shots, and never an unbounded replay.
      maxTurns: Math.max(defaultMaxTurns, Math.min(16 + sourcePages + episodeCount * 8, 96)),
    };
  }
  if (isWorkshopPromptRewriteRun(options.userInput)) {
    return {
      kind: 'prompt-rewrite',
      maxTurns: Math.max(16, Math.min(12 + Math.ceil(shotCount * 4), 96)),
    };
  }
  if (isWorkshopBreakdownRun(options.userInput)) {
    const workload = shotCount
      + Math.max(0, options.sceneCount ?? 0)
      + Math.max(0, options.beatCount ?? 0);
    return {
      kind: 'breakdown',
      maxTurns: Math.max(defaultMaxTurns, Math.min(18 + Math.ceil(workload * 1.5) + Math.ceil((options.sourceChars ?? 0) / 2400) * 4 + (options.episodeScriptCount ?? 0) * 8, 512)),
    };
  }
  return { kind: 'default', maxTurns: defaultMaxTurns };
}
