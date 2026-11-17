import type { RhtvParams } from '@/lib/rhtv/types';

export type ProductionRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProductionRun {
  runId: string;
  projectId: string;
  shotNo?: string;
  kind: 'image' | 'video' | 'audio' | 'render';
  jobId?: string;
  inputFingerprint: string;
  status: ProductionRunStatus;
  createdAt: number;
  updatedAt: number;
}

export function productionRunIdForJob(jobId: string): string {
  const normalized = jobId.trim();
  if (!normalized) throw new Error('ProductionRun requires a durable job id');
  return `production-run-${normalized}`;
}

export function createProductionRun(input: {
  projectId: string;
  shotNo?: string;
  kind: ProductionRun['kind'];
  inputFingerprint: string;
  jobId?: string;
  runId?: string;
  now?: number;
}): ProductionRun {
  const now = input.now ?? Date.now();
  return {
    runId: input.runId ?? (input.jobId ? productionRunIdForJob(input.jobId) : `production-run-${now}`),
    projectId: input.projectId,
    shotNo: input.shotNo,
    kind: input.kind,
    jobId: input.jobId,
    inputFingerprint: input.inputFingerprint,
    status: input.jobId ? 'running' : 'queued',
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProductionRunStatus(
  run: ProductionRun,
  status: ProductionRunStatus,
  now = Date.now(),
): ProductionRun {
  if ((run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') && run.status !== status) {
    throw new Error(`ProductionRun ${run.runId} is terminal and cannot transition to ${status}`);
  }
  return { ...run, status, updatedAt: now };
}

export function reconcileProductionRunsFromJobs(
  runs: ProductionRun[],
  jobs: Array<{ id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' }>,
  now = Date.now(),
): ProductionRun[] {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return runs.map((run) => {
    if (run.kind !== 'render' || !run.jobId || ['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    const job = jobById.get(run.jobId);
    if (!job) return run;
    const status = job.status === 'completed' ? 'succeeded' : job.status === 'failed' ? 'failed' : job.status === 'cancelled' ? 'cancelled' : undefined;
    return status ? updateProductionRunStatus(run, status, now) : run;
  });
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function productionInputFingerprint(input: {
  kind: 'image' | 'video' | 'audio';
  engineId: string;
  endpoint: string;
  prompt: string;
  referenceUrls?: string[];
  audioUrls?: string[];
  videoUrls?: string[];
  params?: RhtvParams;
}): string {
  return `input-${fnv1a(JSON.stringify({
    kind: input.kind,
    engineId: input.engineId,
    endpoint: input.endpoint,
    prompt: input.prompt,
    referenceUrls: input.referenceUrls ?? [],
    audioUrls: input.audioUrls ?? [],
    videoUrls: input.videoUrls ?? [],
    params: input.params ?? {},
  }))}`;
}

export function renderInputFingerprint(input: {
  projectId?: string;
  timeline: unknown;
  settings: unknown;
  outputPath?: string;
}): string {
  return `render-input-${fnv1a(JSON.stringify({
    projectId: input.projectId ?? '',
    timeline: input.timeline,
    settings: input.settings,
    outputPath: input.outputPath ?? '',
  }))}`;
}
