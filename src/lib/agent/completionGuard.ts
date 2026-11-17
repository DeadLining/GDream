export function isTruncatedFinishReason(reason?: string | null): boolean {
  const normalized = String(reason ?? '').trim().toLowerCase();
  return normalized === 'max_tokens'
    || normalized === 'max_output_tokens'
    || normalized === 'length';
}

/** Remove the short overlap some gateways repeat when continuing a completion. */
export function mergePromptContinuation(base: string, continuation: string): string {
  const next = continuation.trimStart();
  if (!base) return next;
  if (!next) return base;
  const maxOverlap = Math.min(600, base.length, next.length);
  for (let size = maxOverlap; size >= 4; size -= 1) {
    if (base.endsWith(next.slice(0, size))) return base + next.slice(size);
  }
  return base + next;
}

/** Pending user guidance always wins over a tool-declared terminal outcome. */
export function terminalToolResults<T extends { terminal?: boolean }>(
  results: T[],
  hasPendingGuidance: boolean,
): T[] {
  return hasPendingGuidance ? [] : results.filter((result) => result.terminal === true);
}

/**
 * A malformed tool-argument payload or a pre-write validation error is the
 * model's own correctable mistake, not a business failure. Give it exactly one
 * extra turn to re-emit valid arguments; a second failure is still terminal so
 * a looping model cannot keep the task alive forever.
 */
export function shouldAllowWorkshopRecovery<T extends {
  success: boolean;
  recoverable?: boolean;
}>(results: T[], recoveryCount: number): boolean {
  return recoveryCount < 1
    && results.some((result) => !result.success && result.recoverable === true);
}
