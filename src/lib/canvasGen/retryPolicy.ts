export interface RetryPolicyTask {
  rhTaskId?: string;
  providerJobId?: string;
  submissionUncertain?: boolean;
  submissionCommitted?: boolean;
  automaticRetryBlocked?: boolean;
}

export type RetryDecision = 'retry' | 'recover' | 'blocked';

export function retryDecision(task: RetryPolicyTask): RetryDecision {
  if (task.rhTaskId || task.providerJobId) return 'recover';
  if (task.submissionUncertain || task.submissionCommitted || task.automaticRetryBlocked) return 'blocked';
  return 'retry';
}

export function shouldRetainFailedTask(task: RetryPolicyTask & { status?: string }): boolean {
  return task.status === 'failed' && retryDecision(task) !== 'retry';
}
