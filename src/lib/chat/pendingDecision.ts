/** Live requests belong to a conversation, not the surface that happened to ask. */
export function pendingDecisionForSession<T extends { sourceSessionId: string | null }>(
  pending: T | null,
  sessionId: string | null,
): T | null {
  return sessionId && pending?.sourceSessionId === sessionId ? pending : null;
}
