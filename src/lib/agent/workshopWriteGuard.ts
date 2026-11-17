/**
 * 重复写入刹车（workshop_* 非只读工具）。
 *
 * 动机（2026-09-16 端到端实测 Run H，缺陷 F15）：模型被工坊门禁拒绝后，
 * **照门禁自己给出的修法**用另一个工具改正了前置状态，然后重提同一载荷——
 * 却被刹车终止整个任务。旧实现的指纹只有「工具名 + 参数」且计数只增不减，
 * 于是把「修复后重提」与「原地打转重复提交」当成同一件事。
 *
 * 旧实现的设计注释写着：
 *   Repeating the same tool call after a validation error cannot change the inputs.
 * **这个前提不成立。** 当校验错误的成因位于**相邻可变状态**时，另一个工具可以改变它
 * （例如提示词门禁校验的是「本镜关联角色」，而 `workshop_update_shot_refs` 正是改它的工具）。
 * 此时「逐字相同的载荷」在两次调用之间语义已经不同。
 *
 * 规则（三条不变式）：
 *   1. 同一个助手消息里的两条相同调用 → 判定为重复（模型自身出错，与状态无关）。
 *   2. 跨轮的相同调用 → **只有在期间没有任何成功的工坊写入时**才判定为重复。
 *   3. 只读工具（`WORKSHOP_READ_ONLY_TOOLS`）永不参与。
 *
 * 实现方式是给指纹加一个「写入世代」：任何一次成功的工坊写入都会推进世代并清空计数，
 * 使此前的计数全部失效。语义即「**状态没变的前提下重复才算重复**」。
 *
 * 与 `repeatReadGuard.ts` 的 `RepeatReadMemo` 同源互补：那边管「写入后重复读」，
 * 这边管「状态未变时重复写」。
 */

/**
 * 键序无关的参数字典序化（**递归**：嵌套对象与数组内部的键序也不影响结果）。
 *
 * 注意与 `repeatReadGuard.ts` 的 `stableToolFingerprint()` 的区别：后者只对**顶层**
 * 键排序，嵌套对象的键序仍会影响结果。工坊写入参数普遍是深层嵌套
 * （`items[].actionTimeline.segments[]`），所以这里必须是深层的。
 */
export function stableToolParams(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableToolParams).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableToolParams(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 工坊**只读**工具：纯查询。重复调用是正常流程的一部分
 * （先读状态、再读引用、写完后复读确认），绝不能被当作重复写入。
 *
 * 与 `coordinator.ts` 的并发批次、以及 `scripts/pipeline-probe/run.mjs` 的桩执行器
 * 共用这一份定义——口径不一致会让实测结论失真。
 */
export const WORKSHOP_READ_ONLY_TOOLS = new Set<string>([
  'workshop_get_state',
  'workshop_get_shot_refs',
  'workshop_get_production_audit',
  'workshop_read_source',
]);

/** 非只读的 `workshop_*` 工具 = 会改变工坊数据的调用。 */
export function isWorkshopMutationTool(name: string): boolean {
  return name.startsWith('workshop_') && !WORKSHOP_READ_ONLY_TOOLS.has(name);
}

/** 判定为重复时回给模型的话（与旧行为保持同一文案）。 */
export function duplicateWriteNotice(name: string): string {
  return `已检测到同一工坊写入操作（${name}）重复调用，本次任务已结束。`;
}

export class WorkshopWriteGuard {
  /** 指纹 → 本世代内的出现次数。 */
  private counts = new Map<string, number>();

  /** 写入世代：每成功写入一次工坊数据就 +1。 */
  private generation = 0;

  private key(name: string, params?: Record<string, unknown>): string {
    return `${name}@${this.generation}:${stableToolParams(params ?? {})}`;
  }

  /** 调用方在**执行前**登记本次批次里的每一个调用。只读工具会被忽略。 */
  record(name: string, params?: Record<string, unknown>): void {
    if (!isWorkshopMutationTool(name)) return;
    const key = this.key(name, params);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /**
   * 本次批次是否包含重复的工坊写入。
   * 必须在**执行后、`noteResult` 之前**求值，否则会用到已被刷新的世代。
   */
  isDuplicate(name: string, params?: Record<string, unknown>): boolean {
    if (!isWorkshopMutationTool(name)) return false;
    return (this.counts.get(this.key(name, params)) ?? 0) > 1;
  }

  /**
   * 工具执行后登记结果。**只有成功的工坊写入才推进世代**：
   * 失败的调用保持计数，因此「什么都不改就重提」仍会在下一次被刹车。
   */
  noteResult(name: string, success: boolean): void {
    if (!success || !isWorkshopMutationTool(name)) return;
    this.generation += 1;
    this.counts.clear();
  }

  /** 一次运行结束时清空。 */
  reset(): void {
    this.counts.clear();
    this.generation = 0;
  }
}
