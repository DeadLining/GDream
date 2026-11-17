/** Local cancellation stops tracking, not necessarily the remote provider job. */
export function cancellationPatch(now = Date.now()) {
  return {
    status: 'failed' as const,
    cancelledAt: now,
    finishedAt: now,
    inFlight: false,
    automaticRetryBlocked: true,
    error: '用户已停止本地跟踪（不代表远端任务已取消）',
    progress: '已停止跟踪，保留任务 ID 和已有产物',
  };
}

/** Ignore responses from requests that were already in flight when cancelled. */
export function applyCancellationSafePatch<T extends { status: string; cancelledAt?: number }>(
  task: T, patch: Partial<T> & { cancelledAt?: number; [key: string]: unknown },
): T & { cancelledAt?: number } {
  if (task.cancelledAt != null && !Object.prototype.hasOwnProperty.call(patch, 'cancelledAt')) return task;
  return { ...task, ...patch };
}
