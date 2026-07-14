import {getJob} from './api';
import type {Job} from './types';

export class JobPollingTimeoutError extends Error {
  constructor() {
    super('任务仍在后台执行，请稍后刷新');
    this.name = 'JobPollingTimeoutError';
  }
}

type PollOptions = {
  loadJob?: (jobId: string) => Promise<Job>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: Job) => void;
};

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function pollJob(jobId: string, options: PollOptions = {}): Promise<Job> {
  const loadJob = options.loadJob ?? getJob;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const startedAt = now();
  let attempt = 0;
  while (now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await loadJob(jobId);
    options.onUpdate?.(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    attempt += 1;
    await sleep(attempt <= 10 ? 1000 : 3000);
  }
  throw new JobPollingTimeoutError();
}
