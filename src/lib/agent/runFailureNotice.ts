/**
 * A failed run must leave something in the transcript.
 *
 * Observed (GDream workshop, 2026-09-14): a run died after two successful tool
 * calls and the chat showed nothing at all. `onError` only set a global
 * `chatStore.error` string that the main chat header renders as a truncated
 * pill — the workshop AgentDrawer never renders it, and nothing was persisted
 * to the session. The user saw a permanent "no output".
 */
export function buildRunFailureNotice(message: string): string {
  const detail = String(message ?? '').replace(/\s+/g, ' ').trim();
  const lines = ['本轮任务未能完成。'];
  if (detail) lines.push(`原因：${detail}`);
  lines.push('请从已保存进度继续，不要整轮重发；若涉及付费生成，请先核对原任务是否已提交。');
  return lines.join('\n');
}

/** True when the failure is an expected user abort, which the run already reported. */
export function isAbortFailure(message: string | undefined): boolean {
  const text = String(message ?? '').toLowerCase();
  return text.includes('abort') || text.includes('中止');
}
