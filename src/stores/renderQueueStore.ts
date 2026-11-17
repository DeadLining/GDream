import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import {
  acceptProductionCandidate,
  type ProductionBinding,
  type ProductionCandidate,
  type ProductionReviewReceipt,
} from '@/lib/production/lifecycle';

export type RenderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RenderJob {
  id: string;
  kind: 'video' | 'jianying' | 'proxy' | 'prerender';
  status: RenderJobStatus;
  title: string;
  outputPath?: string;
  inputFingerprint?: string;
  stage?: string;
  detail?: string;
  percent?: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  candidate?: ProductionCandidate;
  review?: ProductionReviewReceipt;
  binding?: ProductionBinding;
}

interface RenderQueueState {
  jobs: RenderJob[];
  activeJobId: string | null;
  createJob: (job: Omit<RenderJob, 'id' | 'status' | 'createdAt'> & { id?: string; status?: RenderJobStatus }) => string;
  startJob: (id: string) => void;
  updateJob: (id: string, patch: Partial<Pick<RenderJob, 'stage' | 'detail' | 'percent' | 'outputPath'>>) => void;
  finishJob: (id: string, status: Exclude<RenderJobStatus, 'queued' | 'running'>, patch?: Partial<Pick<RenderJob, 'error' | 'outputPath' | 'detail'>>) => void;
  acceptCandidate: (id: string, expectedFingerprint: string, actor?: string, note?: string) => void;
  latest: () => RenderJob | null;
}

export const useRenderQueueStore = create<RenderQueueState>()(persist((set, get) => ({
  jobs: [],
  activeJobId: null,
  createJob: (job) => {
    const id = job.id ?? `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    set((s) => ({
      jobs: [
        {
          ...job,
          id,
          status: job.status ?? 'queued',
          createdAt: now,
        },
        ...s.jobs,
      ].slice(0, 30),
      activeJobId: job.status === 'running' ? id : s.activeJobId,
    }));
    return id;
  },
  startJob: (id) => set((s) => ({
    activeJobId: id,
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, status: 'running', startedAt: j.startedAt ?? Date.now() } : j)),
  })),
  updateJob: (id, patch) => set((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  })),
  finishJob: (id, status, patch = {}) => set((s) => ({
    activeJobId: s.activeJobId === id ? null : s.activeJobId,
    jobs: s.jobs.map((j) => {
      if (j.id !== id) return j;
      const next = { ...j, ...patch, status, finishedAt: Date.now(), percent: status === 'completed' ? 100 : j.percent };
      if (status === 'completed' && next.outputPath) {
        next.candidate = {
          candidateId: `render-${id}`,
          kind: 'render',
          path: next.outputPath,
          engineId: 'compose-editor-timeline',
          inputFingerprint: next.inputFingerprint,
          createdAt: next.finishedAt,
          metadata: { jobId: id, title: next.title },
        };
      }
      return next;
    }),
  })),
  acceptCandidate: (id, expectedFingerprint, actor, note) => set((s) => ({
    jobs: s.jobs.map((job) => {
      if (job.id !== id || !job.candidate) return job;
      const accepted = acceptProductionCandidate({
        candidates: [job.candidate],
        candidateId: job.candidate.candidateId,
        kind: 'render',
        expectedFingerprint,
        actor,
        note,
      });
      return { ...job, review: accepted.review, binding: accepted.binding };
    }),
  })),
  latest: () => get().jobs[0] ?? null,
}), {
  name: 'gdream-render-queue',
  storage: createJSONStorage(() => safeLocalStorage),
  version: 1,
  partialize: (state) => ({ jobs: state.jobs, activeJobId: null }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<RenderQueueState> | undefined;
    return {
      ...current,
      activeJobId: null,
      jobs: (saved?.jobs ?? []).map((job) => ['queued', 'running'].includes(job.status)
        ? { ...job, status: 'failed' as const, error: job.error ?? '应用重启时导出未完成，请重新导出' }
        : job),
    };
  },
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    void import('./workshopStore').then(({ useWorkshopStore }) => {
      useWorkshopStore.getState().reconcileProductionRuns(state.jobs);
    }).catch(() => {});
  },
}));
