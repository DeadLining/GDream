export function shouldShowGenerationHistory(history: unknown[] | null | undefined): boolean {
  return Array.isArray(history) && history.length > 1;
}
