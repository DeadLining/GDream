import type { CanvasTask, CanvasTaskStatus } from '@/stores/canvasTaskStore';
import { retryDecision } from './retryPolicy.ts';

export interface CanvasTaskMetrics {
  total: number;
  queued: number;
  active: number;
  failed: number;
  succeeded: number;
  recoverable: number;
  byProject: Record<string, number>;
  statusCounts: Partial<Record<CanvasTaskStatus, number>>;
}

const ACTIVE_STATUSES = new Set<CanvasTaskStatus>(['uploading', 'running', 'downloading']);

export function summarizeCanvasTasks(tasks: CanvasTask[]): CanvasTaskMetrics {
  const statusCounts: Partial<Record<CanvasTaskStatus, number>> = {};
  const byProject: Record<string, number> = {};
  for (const task of tasks) {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    const project = task.projectId || 'unbound';
    byProject[project] = (byProject[project] ?? 0) + 1;
  }
  return {
    total: tasks.length,
    queued: statusCounts.queued ?? 0,
    active: tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length,
    failed: statusCounts.failed ?? 0,
    succeeded: statusCounts.succeeded ?? 0,
    recoverable: tasks.filter((task) =>
      Boolean(task.rhTaskId || task.providerJobId)
      && (ACTIVE_STATUSES.has(task.status) || (task.status === 'failed' && retryDecision(task) === 'recover')),
    ).length,
    byProject,
    statusCounts,
  };
}
