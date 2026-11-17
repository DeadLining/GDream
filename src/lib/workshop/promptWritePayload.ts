/** Reference signatures and control flags guard writes; they are not writable prompt content. */
export function hasNonVideoPromptPayload(item: Record<string, unknown>): boolean {
  return ['imagePrompt', 'image_prompt', 'startFramePrompt', 'start_frame_prompt', 'endFramePrompt', 'end_frame_prompt']
    .some((field) => typeof item[field] === 'string')
    || Array.isArray(item.audioPrompts ?? item.audio_prompts);
}
