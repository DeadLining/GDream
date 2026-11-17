export interface RecoverableTaskIdentity {
  kind: 'image' | 'video' | 'audio';
  engineId: string;
  engineLabel: string;
  endpoint: string;
}

export const DEFAULT_MAX_RECOVERY_ATTEMPTS = 30;

export function isIndefiniteRecoveryTask(task: RecoverableTaskIdentity): boolean {
  if (task.kind !== 'video') return false;
  const label = task.engineLabel.trim().toLowerCase();
  const engineId = task.engineId.trim().toLowerCase();
  const endpoint = task.endpoint.trim().toLowerCase();
  return label.includes('sglang minimax-h3')
    || label.includes('sglang minimax h3')
    || (engineId.includes('minimax-h3') && endpoint.includes('/v1/videos'));
}

export function recoveryFailurePolicy(
  task: RecoverableTaskIdentity,
  attempts: number,
  maxAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS,
  errorMessage = '',
): { shouldFail: boolean; progress: string } {
  // A disappeared/expired remote job must not be polled forever. Allow a
  // short grace period for eventually consistent status endpoints.
  if (/\bHTTP\s+(404|410)\b/i.test(errorMessage) && attempts >= 3) {
    return {
      shouldFail: true,
      progress: '远端任务持续不可查询，已停止自动恢复；保留任务 ID，请核对原任务，勿直接重提',
    };
  }
  if (isIndefiniteRecoveryTask(task)) {
    return {
      shouldFail: false,
      progress: `后台恢复查询暂时失败（已重试 ${attempts} 次），保留原任务 ID，10 秒后继续查询`,
    };
  }
  const shouldFail = attempts >= maxAttempts;
  return {
    shouldFail,
    progress: shouldFail
      ? `恢复重试 ${maxAttempts} 次仍然失败`
      : `后台恢复轮询暂时失败(${attempts}/${maxAttempts})`,
  };
}
