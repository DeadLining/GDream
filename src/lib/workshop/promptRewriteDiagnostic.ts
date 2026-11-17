/**
 * Actionable diagnostics retained between prompt-rewrite attempts.
 *
 * A failed attempt may be retried by the user, but this module never starts a
 * second model run by itself. It only preserves the reason and any explicit
 * duration adjustment so the next click can supply better context.
 */
export interface PromptRewriteDiagnostic {
  kind: 'ref2va_timing' | 'prompt_preflight';
  message: string;
  task?: string;
  requestedDurationSec?: number;
  suggestedDurationSec?: number;
  createdAt: number;
}

const H3_MIN_DURATION_SEC = 5;
const H3_MAX_DURATION_SEC = 15;

/**
 * Extract the smallest duration adjustment the writer explicitly requested.
 * This intentionally requires an adjustment verb near the number so ordinary
 * mentions such as "10 秒时长" do not become false duration overrides.
 */
export function suggestedRef2vaDurationFromError(message: string, currentDurationSec: number): number | undefined {
  const normalized = message.replace(/\s+/gu, ' ');
  const match = normalized.match(
    /(?:延长(?:到|至)?|调整(?:到|为|至)|至少(?:需要)?|最小(?:方案)?(?:为|是)?|需要(?:约)?|建议(?:为|到|至)?|改为)\s*(?:约\s*)?(\d+(?:\.\d+)?)\s*(?:秒|s\b|seconds?\b)/iu,
  );
  const requested = match?.[1] ? Number(match[1]) : undefined;
  if (requested === undefined || !Number.isFinite(requested) || requested <= currentDurationSec) return undefined;
  if (requested > H3_MAX_DURATION_SEC) return undefined;
  const clamped = Math.max(H3_MIN_DURATION_SEC, Math.ceil(requested));
  return clamped > currentDurationSec ? clamped : undefined;
}

export function buildRef2vaTimingDiagnostic(
  message: string,
  currentDurationSec: number,
  now = Date.now(),
): PromptRewriteDiagnostic {
  return {
    kind: 'ref2va_timing',
    message: message.trim(),
    requestedDurationSec: currentDurationSec,
    suggestedDurationSec: suggestedRef2vaDurationFromError(message, currentDurationSec),
    createdAt: now,
  };
}

export function buildPromptRewriteDiagnostic(
  message: string,
  currentDurationSec: number,
  task?: string,
  now = Date.now(),
): PromptRewriteDiagnostic {
  if (isRef2vaTimingFailure(message)) {
    return {
      ...buildRef2vaTimingDiagnostic(message, currentDurationSec, now),
      task,
    };
  }
  return {
    kind: 'prompt_preflight',
    message: message.trim(),
    task,
    createdAt: now,
  };
}

export function isRef2vaTimingFailure(message: string): boolean {
  return /H3_TIMING_UNRESOLVED|REF2VA_TIMING_UNRESOLVED|参考模式排时未完成/u.test(message);
}

/** Old deterministic veto conflated saved duration/estimates with real minima. */
export function isObsoleteShotTimingDiagnostic(message: string): boolean {
  return /^H3_TIMING_UNRESOLVED:\s*本镜至少需要约\s*\d+(?:\.\d+)?\s*秒，超过当前单镜预算/u.test(message.trim());
}

/** Only persist failures that can be corrected by feeding them back to the writer. */
export function isRetryablePromptRewriteFailure(message: string): boolean {
  return isRef2vaTimingFailure(message)
    || /(?:未通过[^：:\n]{0,24}预检|预检失败|定向修复未通过|事实锁拒绝写入|未覆盖原提示词|缺少原文对白|同一句原文对白重复出现|FRAME_BINDING_UNRESOLVED|REFERENCE_BINDING_UNRESOLVED|characterIds\s*未包含)/iu.test(message);
}

/** Prompt block used on the next user-triggered attempt, never on an internal retry. */
export function formatPromptRewriteDiagnostic(
  diagnostic: PromptRewriteDiagnostic | undefined,
  task?: string,
): string {
  if (!diagnostic || isObsoleteShotTimingDiagnostic(diagnostic.message) || (diagnostic.task && task && diagnostic.task !== task)) return '';
  const taskLine = diagnostic.task ? ` Failed H3 task: ${diagnostic.task}.` : '';
  const adjustment = diagnostic.suggestedDurationSec && diagnostic.requestedDurationSec
    ? ` Suggested target duration: ${diagnostic.suggestedDurationSec} seconds; the previous attempt used ${diagnostic.requestedDurationSec} seconds.`
    : diagnostic.requestedDurationSec
      ? ` Previous attempted duration: ${diagnostic.requestedDurationSec} seconds. No supported duration adjustment could be inferred.`
      : '';
  return `PREVIOUS REWRITE FAILURE DIAGNOSTIC:\n${diagnostic.message}${taskLine}${adjustment}\nCorrect every reported failure before returning the new prompt. Treat this as feedback from the prior rejected draft, not as new story facts. Preserve all canonical dialogue, cast, facts and event order. Resolve the reported mechanics explicitly; do not delete the action or repeat the previous wording. A suggested duration is only an advisory starting point, not a hard floor; recompute the clip length and flexible windows from the complete dialogue and actions. Shortening time is allowed when the content naturally fits, never by deleting or rewriting dialogue.`;
}
