export type RewritePhase = 'preparing' | 'planning' | 'writing' | 'saving' | 'done' | 'failed';
export interface WorkshopRewriteTask {
  key: string;
  projectId: string;
  shotNo: string;
  phase: RewritePhase;
  startedAt: number;
  endedAt?: number;
  error?: string;
  completedPhases?: RewritePhase[];
  failedPhase?: RewritePhase;
  timelineMode?: 'planned' | 'reused';
}
export const rewriteIsRunning = (phase?: RewritePhase) => !!phase && phase !== 'done' && phase !== 'failed';

export function advanceRewriteTask(task: WorkshopRewriteTask, phase: RewritePhase, error?: string): WorkshopRewriteTask {
  if (!rewriteIsRunning(task.phase)) return task;
  const completedPhases = [...(task.completedPhases ?? [])];
  if (phase !== 'failed' && phase !== task.phase && !completedPhases.includes(task.phase)) completedPhases.push(task.phase);
  return {
    ...task, phase, error, completedPhases,
    failedPhase: phase === 'failed' ? task.phase : undefined,
    timelineMode: phase === 'writing' ? (completedPhases.includes('planning') ? 'planned' : 'reused') : task.timelineMode,
    endedAt: rewriteIsRunning(phase) ? undefined : Date.now(),
  };
}

export function rewriteProgressRows(task: WorkshopRewriteTask) {
  const phases = [
    ['preparing', '读取镜头事实与参考，准备 H3 skill'],
    ['planning', task.timelineMode === 'reused' ? '第一层：已核对并复用现有动作时间轴' : '第一层：重新规划动作时间轴并保存'],
    ['writing', '第二层：从镜头事实生成 H3 视频提示词'],
    ['saving', '检查是否有并发修改并保存提示词'],
  ] as const;
  return phases.map(([phase, label]) => ({
    phase, label,
    status: phase === 'planning' && task.timelineMode === 'reused' ? 'reused'
      : task.completedPhases?.includes(phase) ? 'completed'
      : task.failedPhase === phase ? 'failed'
      : task.phase === phase ? 'running' : 'pending',
  }));
}
