import type { WsShot } from './types.ts';

/** Show the planned first frame in the existing storyboard editor, with legacy fallback. */
export function editableStartFramePrompt(shot: Pick<WsShot, 'plannedStartFramePrompt' | 'imagePrompt'>): string {
  return shot.plannedStartFramePrompt ?? shot.imagePrompt ?? '';
}

/** Manual edits update both consumers; never substitute the historical submission wrapper. */
export function startFramePromptPatch(value: string): Pick<WsShot, 'plannedStartFramePrompt' | 'imagePrompt'> {
  return { plannedStartFramePrompt: value, imagePrompt: value };
}
