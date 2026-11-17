/**
 * A turn whose stream dies before producing ANY output is safe to retry: the
 * coordinator has not executed a tool, written state, or billed a paid task for
 * that turn, so re-issuing the same request cannot duplicate a side effect.
 *
 * Observed failure (GDream workshop, 2026-09-14): the follow-up turn after
 * workshop_get_state/workshop_read_source stalled mid-stream and the Rust
 * stream proxy killed it with an idle timeout (transport status 0). Because the
 * failure arrived before any delta, the whole run ended with nothing on screen.
 */
export interface StreamFailureLike {
  name?: string;
  message?: string;
  status?: number;
}

const TRANSPORT_PATTERNS = [
  /idle timeout/i,
  /first chunk timeout/i,
  /timeout/i,
  /network error/i,
  /upstream read failed/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /socket/i,
  /connection/i,
  /fetch failed/i,
];

function isTransportStatus(status: number | undefined): boolean {
  // status 0 / undefined are the Tauri/Rust transport failures (DNS, TLS,
  // socket, proxy, idle-timeout). 408/429/5xx are upstream pressure.
  if (status === undefined || status === 0) return true;
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Only retry when nothing was emitted for this turn, the user did not abort,
 * and the failure looks like transport trouble rather than a business error
 * (e.g. context_length_exceeded, invalid request), which would just repeat.
 */
export function shouldRetryStreamFailure(
  error: StreamFailureLike | undefined,
  yieldedAnything: boolean,
  aborted: boolean,
): boolean {
  if (aborted) return false;
  if (yieldedAnything) return false;
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  if (isTransportStatus(error.status)) return true;
  const message = String(error.message ?? '');
  return TRANSPORT_PATTERNS.some((pattern) => pattern.test(message));
}

/** User-facing line shown while the coordinator silently re-issues the turn. */
export const STREAM_RETRY_PROGRESS = '模型连接中断（未产生任何输出），正在自动重试本次请求…';
