import { create } from 'zustand';

import { advanceRewriteTask, rewriteIsRunning, type RewritePhase, type WorkshopRewriteTask } from '@/lib/workshop/rewriteProgress';
export { rewriteIsRunning } from '@/lib/workshop/rewriteProgress';
export type { RewritePhase, WorkshopRewriteTask } from '@/lib/workshop/rewriteProgress';
export const WORKSHOP_REWRITE_OPEN = 'gdream-workshop-rewrite-open';
export const useWorkshopRewriteStore = create<{
  tasks: Record<string, WorkshopRewriteTask>;
  start: (key: string, projectId: string, shotNo: string) => void;
  update: (key: string, phase: RewritePhase, error?: string) => void;
  /** Remove a finished card so an old failure cannot look like the latest run forever. */
  dismiss: (key: string) => void;
}>((set) => ({
  tasks: {},
  start: (key, projectId, shotNo) => set((state) => {
    // Keep active jobs and a bounded list of recent results, independently of
    // the conversational agent's streaming state and current run ID.
    const recent = Object.values(state.tasks).sort((a, b) => b.startedAt - a.startedAt)
      .filter((task, index) => rewriteIsRunning(task.phase) || index < 40);
    return { tasks: { ...Object.fromEntries(recent.map((task) => [task.key, task])), [key]: { key, projectId, shotNo, phase: 'preparing', completedPhases: [], startedAt: Date.now() } } };
  }),
  update: (key, phase, error) => set((state) => {
    const task = state.tasks[key];
    if (!task) return state;
    return { tasks: { ...state.tasks, [key]: advanceRewriteTask(task, phase, error) } };
  }),
  dismiss: (key) => set((state) => {
    const task = state.tasks[key];
    if (!task || rewriteIsRunning(task.phase)) return state;
    const { [key]: _removed, ...rest } = state.tasks;
    return { tasks: rest };
  }),
}));
