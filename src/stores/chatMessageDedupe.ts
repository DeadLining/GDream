export interface DedupeMessage { id: string; role: string; content: string }

/** Prevent queue/recovery races from rendering the same system notice repeatedly. */
export function dedupeChatMessages<T extends DedupeMessage>(messages: T[]): T[] {
  const seenIds = new Set<string>();
  const seenSystemContent = new Set<string>();
  return messages.filter((message) => {
    if (seenIds.has(message.id)) return false;
    seenIds.add(message.id);
    if (message.role === 'system') {
      if (seenSystemContent.has(message.content)) return false;
      seenSystemContent.add(message.content);
    }
    return true;
  });
}
