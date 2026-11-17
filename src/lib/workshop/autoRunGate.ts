/**
 * 一键全流程的失败门控。
 *
 * 工坊串行队列原本把「成功」和「失败」一视同仁——两种情况下都只是把队首移除，
 * 于是下一步照常派发。四步链条里任何一步失败，后面几步仍会依次发出，把一次错误
 * 放大成四次（服务不稳时尤其明显，用户会连吃四个报错）。
 *
 * 这里把决策抽成纯函数：只有被标记为门控的步骤，且本轮确实以错误收场时，
 * 才取消后续排队步骤。用户手动输入的排队 prompt 不受影响。
 */

/** 本轮以错误收场，且该步是门控步骤 → 应取消后续排队步骤。 */
export function shouldGateRemainingSteps(
  gateOnFailure: boolean | undefined,
  turnError: string | null | undefined,
): boolean {
  if (gateOnFailure !== true) return false;
  return Boolean(typeof turnError === 'string' && turnError.trim());
}

/** 门控触发时给用户看的系统消息。 */
export function buildGateNotice(failure: string, cancelledCount: number): string {
  const reason = failure.trim() || '未知错误';
  if (cancelledCount <= 0) {
    return `一键全流程已中止：本步失败，没有后续步骤需要取消。\n失败原因：${reason}`;
  }
  return [
    `一键全流程已中止：本步失败，后续 ${cancelledCount} 个步骤已取消，避免把一次错误放大成连续报错。`,
    `失败原因：${reason}`,
    '修正后可以点「继续一键全流程」，核对已保存进度后续做，或手动执行剩下的步骤。',
  ].join('\n');
}

/** 队列条目里门控需要的最小形状（避免 lib 反向依赖组件类型）。 */
export interface GatedQueueItem {
  id: string;
  status: 'queued' | 'running';
}

/**
 * 门控触发后要取消哪些步骤。
 *
 * 语义要点（2026-09-17 复查）：取消**只针对排队中的后继步骤**——
 *   - 正在执行的那一条（status === 'running'）不属于「后续」，不能取消；
 *   - 刚失败的那一条（headId）由调用方自己移除，这里一并排除以免重复计数。
 *
 * 抽成纯函数的原因：原实现把计数写在 `setQueue` 的 updater 里当副作用，
 * 而 updater 的求值时机由 React 决定（严格模式下还会双调用），
 * 一旦延后，提示里的「后续 N 个步骤已取消」就会退化成 0，与实际不符。
 */
export function selectGatedCancellations(
  queue: readonly GatedQueueItem[],
  headId: string,
): GatedQueueItem[] {
  return queue.filter((item) => item.id !== headId && item.status === 'queued');
}

/** 应用门控后的新队列：保留执行中的条目，去掉排队中的条目与刚失败的那条。 */
export function applyGateToQueue<T extends GatedQueueItem>(
  queue: readonly T[],
  headId: string,
): T[] {
  return queue.filter((item) => item.id !== headId && item.status !== 'queued');
}
