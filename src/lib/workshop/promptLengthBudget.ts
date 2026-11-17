import type { ShotPlanningMode } from './types';

/**
 * 提示词长度预算的单一事实源。
 *
 * 为什么必须单一：同一组数字曾散落在**四处**，并且已经彼此漂移——
 *   1. `workshopPrompts.ts` 的两条提示词告诉模型「500-1200」；
 *   2. `workshop_update_shot` 的工具说明写「280-520」；
 *   3. `workshop_set_prompts` 的工具说明写「500-1200」；
 *   4. `collectDirectorPromptWarnings()` 实际在 1400 才报「过长」。
 *
 * 其中第 2、3 条对**同一条** videoPrompt 给出互相矛盾的建议，且都不区分分镜模式；
 * 第 4 条则让 1200-1400 成为**静默区**——既不满足模型被告知的契约，也拿不到任何反馈。
 * 这与 F14 修掉的「466 字被判过长」是同一类缺陷的另一面：那次是**错误反馈**，
 * 这次是**缺失反馈**。两者都源于「判定阈值」与「契约文本」各写各的。
 *
 * 本模块只维护一条规则：
 *   **告知模型的区间，必须与工具实际告警的阈值完全一致**——两者都从本模块派生。
 *
 * 因此修改长度要求时只改这里；`promptLengthBudget.test.ts` 锁住纯函数不变量，
 * `scripts/pipeline-probe/storecheck.mjs` 的 A9/A10 用真实 `tool.execute()` 锁住
 * 「告警确实在预算边界触发」。
 */

export interface PromptLengthBudget {
  /** 建议下限（字符数，忽略空白）。低于此值报「过短」。 */
  min: number;
  /** 建议上限（字符数，忽略空白）。高于此值报「过长」。 */
  max: number;
}

/**
 * 视频提示词预算，按分镜规划模式区分。
 *
 * - `single-timeline`：一个生成镜头内按精确时间段走完一条主叙事线，容量最大。
 * - `atomic`：单一动作，不承载时间轴，容量更小。
 */
export const VIDEO_PROMPT_BUDGET: Record<ShotPlanningMode, PromptLengthBudget> = {
  'single-timeline': { min: 500, max: 1200 },
  atomic: { min: 280, max: 520 },
};

/** 生图提示词预算：只描述 0.00 秒首帧，容量最小。 */
export const IMAGE_PROMPT_BUDGET: PromptLengthBudget = { min: 80, max: 220 };

/** 取「500-1200」这类文案，供提示词与工具说明复用。 */
export function budgetLabel(budget: PromptLengthBudget): string {
  return `${budget.min}-${budget.max}`;
}

/** 分镜规划模式 → 视频提示词预算。未知模式按原子镜头（更保守的区间）处理。 */
export function videoPromptBudget(mode: ShotPlanningMode | undefined): PromptLengthBudget {
  return mode === 'single-timeline' ? VIDEO_PROMPT_BUDGET['single-timeline'] : VIDEO_PROMPT_BUDGET.atomic;
}

/** 分镜规划模式的中文名，供告警文案复用。 */
export function planningModeLabel(mode: ShotPlanningMode | undefined): string {
  return mode === 'single-timeline' ? '单镜时间轴' : '原子镜头';
}

/**
 * 两种模式都写进同一段文案时的完整表述。
 * 工具说明（`workshop_update_shot` / `workshop_set_prompts`）面对两种模式，用它避免二选一。
 */
export function videoBudgetText(): string {
  return `single-timeline 建议 ${budgetLabel(VIDEO_PROMPT_BUDGET['single-timeline'])} 字，原子镜头建议 ${budgetLabel(VIDEO_PROMPT_BUDGET.atomic)} 字`;
}
