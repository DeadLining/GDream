import type { Session } from '@/types';

/** Keep one canonical project chat; prefer content-bearing and newer sessions. */
export function dedupeProjectSessions(sessions: Session[], projectId: string): Session[] {
  const matches = sessions.filter((session) => session.projectId === projectId);
  if (matches.length <= 1) return matches;
  const canonical = [...matches].sort((a, b) =>
    (b.messageCount - a.messageCount)
    || (b.updatedAt - a.updatedAt)
    || (b.createdAt - a.createdAt)
    || a.id.localeCompare(b.id),
  )[0];
  return [canonical];
}

/** Canonical selection is not history deletion: keep every content-bearing chat. */
export function projectSessionHistory(sessions: Session[], projectId: string): Session[] {
  const matches = sessions.filter(session => session.projectId === projectId);
  const populated = matches.filter(session => session.messageCount > 0);
  return (populated.length ? populated : dedupeProjectSessions(matches, projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
