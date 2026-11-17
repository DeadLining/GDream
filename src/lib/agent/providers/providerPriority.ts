/** Priority ordering shared by the settings list and the chat router. */

/** Build a stable provider order from the effective primary, fallbacks, then known ids. */
export function orderedProviderIds(
  primary: string | undefined,
  fallbackChain: readonly string[] | undefined,
  knownIds: readonly string[],
): string[] {
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const rawId of [primary, ...(fallbackChain ?? []), ...knownIds]) {
    const id = rawId?.trim();
    if (!id || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/**
 * Move one provider to another provider's index.
 *
 * Dragging upward inserts before the target; dragging downward inserts after
 * it because the target index is interpreted in the original list.
 */
export function moveProviderToIndex(
  order: readonly string[],
  sourceId: string,
  targetId: string,
): string[] {
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
