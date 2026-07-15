export type MediaPromptSuggestion = {
  mode: 'panel' | 'video';
  prompt: string;
  negative_prompt: string;
  rationale: string;
  used_context: string[];
};
