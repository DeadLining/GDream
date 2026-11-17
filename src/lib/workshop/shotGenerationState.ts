import type { CanvasTask } from '../../stores/canvasTaskStore';
import type { WsShot } from './types';

function belongsToShot(task: CanvasTask, shot: WsShot, projectId: string): boolean {
  return task.projectId === projectId
    && task.workshopShotNo === shot.shotNo
    && Boolean(task.workshopShotKind)
    && !task.workshopStoryboardFrameId;
}

/** Never infer ownership from prompt text or from another project's shot number. */
export function shotGenerationTask(shot: WsShot, projectId: string, tasks: readonly CanvasTask[]): CanvasTask | undefined {
  if (shot.genTaskId) {
    return tasks.find((task) => task.id === shot.genTaskId && belongsToShot(task, shot, projectId));
  }
  let latest: CanvasTask | undefined;
  for (const task of tasks) {
    if (belongsToShot(task, shot, projectId) && (!latest || task.createdAt >= latest.createdAt)) latest = task;
  }
  // A finished newer attempt supersedes an older active task. Do not revive it.
  return latest && ['queued', 'uploading', 'running', 'downloading'].includes(latest.status) ? latest : undefined;
}

/** Restore UI ownership only; downloading and candidate adoption belong to recovery. */
export function restoreShotGenerationState(shot: WsShot, projectId: string, tasks: readonly CanvasTask[]): WsShot {
  const task = shotGenerationTask(shot, projectId, tasks);
  if (task) {
    if (task.status === 'failed') {
      return { ...shot, genStatus: 'failed', genError: task.error || shot.genError, genProgress: undefined };
    }
    return {
      ...shot,
      genTaskId: task.id,
      genStatus: task.status === 'queued' ? 'queued' : 'generating',
      genProgress: task.status === 'succeeded' ? '生成已完成，正在恢复结果…' : task.progress || shot.genProgress,
      genError: undefined,
    };
  }
  if (shot.genStatus === 'generating' || shot.genStatus === 'queued') {
    return { ...shot, genStatus: 'idle', genTaskId: undefined, genProgress: undefined };
  }
  return shot;
}
