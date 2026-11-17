import type { VideoPromptTemplate } from '@/lib/videoPrompt/prompt';

/** Deprecated: prompt generation is now always the new format. */
export default function VideoPromptVersionSwitch(_props: { value: VideoPromptTemplate; onChange: (value: VideoPromptTemplate) => void; prominent?: boolean; title?: string }) {
  return null;
}
