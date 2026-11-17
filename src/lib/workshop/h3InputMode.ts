import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import type { WorkshopData } from './types.ts';

export function resolveWorkshopH3Task(data: Pick<WorkshopData, 'h3InputMode'> | null | undefined, fallback: SglangH3Task = 'ref2va'): SglangH3Task {
  return data?.h3InputMode ?? fallback;
}

/** Mode switches retain authored text and media; only video prompts become stale. */
export function changeWorkshopH3Task(data: WorkshopData, task: SglangH3Task, previous: SglangH3Task): WorkshopData {
  if (!['i2va', 'ref2va', 'fl2va', 't2va'].includes(task)) return data;
  if (data.h3InputMode === task) return data;
  const shots = data.shots.map((shot) => {
    const hasPrompt = Boolean(shot.universalVideoPrompt || shot.videoPrompt || shot.seedance25VideoPrompt);
    if (!hasPrompt || (shot.videoModel && !/minimax|hailuo|\bh3\b/i.test(shot.videoModel))) return shot;
    const authoredMode = shot.h3VideoPromptTask ?? previous;
    return { ...shot, h3VideoPromptTask: authoredMode, h3VideoPromptModeStale: authoredMode !== task };
  });
  return { ...data, h3InputMode: task, shots };
}
