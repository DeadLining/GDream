import {describe, expect, it, vi} from 'vitest';
import type {Job} from '../lib/types';
import {JobPollingTimeoutError, pollJob} from '../lib/jobs';

const job = (status: Job['status']): Job => ({
  id: 'job-1', operation: 'plan_episode', target_type: 'episode', target_id: 'ep-1',
  status, progress: status === 'succeeded' ? 100 : 5, result_metadata: {}, error: '',
  retry_count: 0, created_at: '', updated_at: '',
});

describe('pollJob', () => {
  it('polls persisted state until the job succeeds', async () => {
    const loadJob = vi.fn()
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValueOnce(job('succeeded'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await pollJob('job-1', {loadJob, sleep});

    expect(result.status).toBe('succeeded');
    expect(loadJob).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it('backs off after ten attempts', async () => {
    let calls = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const loadJob = vi.fn().mockImplementation(async () => {
      calls += 1;
      return calls === 12 ? job('failed') : job('running');
    });

    await pollJob('job-1', {loadJob, sleep});

    expect(sleep).toHaveBeenNthCalledWith(10, 1000);
    expect(sleep).toHaveBeenNthCalledWith(11, 3000);
  });

  it('stops after the configured timeout', async () => {
    let now = 0;
    const sleep = async (milliseconds: number) => { now += milliseconds; };

    await expect(pollJob('job-1', {
      loadJob: async () => job('running'), sleep, now: () => now, timeoutMs: 2000,
    })).rejects.toBeInstanceOf(JobPollingTimeoutError);
  });
});
