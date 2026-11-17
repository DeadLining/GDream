interface PromptViewport { scrollTop: number; clientWidth: number; clientHeight: number }
interface PromptPreview { scrollTop: number; style: { width: string; height: string } }
/** The transparent textarea remains the sole scroll owner, focused or not. */
export function syncPromptPreview(input: PromptViewport | null, preview: PromptPreview | null): void {
  if (!input || !preview) return;
  // Match the content viewport, excluding the native scrollbar, to preserve wrapping.
  preview.style.width = `${input.clientWidth}px`;
  preview.style.height = `${input.clientHeight}px`;
  preview.scrollTop = input.scrollTop;
}
