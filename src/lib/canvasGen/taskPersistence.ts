export const PERSISTED_PROMPT_MAX = 4000;

export interface PersistableCanvasTask {
  prompt: string;
  promptTruncated?: boolean;
  workshopShotNo?: string;
  workshopStoryboardFrameId?: string;
  referenceUrls?: string[];
  inFlight?: boolean;
}

export function persistedCanvasTask<T extends PersistableCanvasTask>(task: T): T & PersistableCanvasTask {
  const retainsFullPrompt = Boolean(task.workshopShotNo || task.workshopStoryboardFrameId);
  const truncate = !retainsFullPrompt && task.prompt.length > PERSISTED_PROMPT_MAX;

  return {
    ...task,
    prompt: truncate ? task.prompt.slice(0, PERSISTED_PROMPT_MAX) : task.prompt,
    promptTruncated: truncate ? true : undefined,
    referenceUrls: task.referenceUrls,
    inFlight: undefined,
  };
}
