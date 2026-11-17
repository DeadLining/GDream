/** Only optional read selectors are normalized. Never coerce cursor numbers or
 * strip fields globally: empty values may mean explicit deletion on write tools. */
export function normalizeWorkshopStateRead(params: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...params };
  for (const key of ['detail', 'section', 'episode', 'shot_no', 'work_unit_id', 'output_id']) {
    const value = normalized[key];
    if (value == null || (typeof value === 'string' && !value.trim())) delete normalized[key];
  }
  if (normalized.offset === null) delete normalized.offset;
  return normalized;
}

/** Missing/empty cursor plus an omitted or numeric zero offset is an initial
 * read. A real cursor always remains a continuation, including offset zero. */
export function isInitialWorkshopStateRead(params: { output_id?: unknown; offset?: unknown }): boolean {
  const normalized = normalizeWorkshopStateRead(params);
  return normalized.output_id === undefined && (normalized.offset === undefined || normalized.offset === 0);
}

/** Bounded, immutable state-output snapshots. Paging never reassembles different revisions. */
export const WORKSHOP_STATE_PAGE_CHARS = 8_000;
const MAX_SNAPSHOTS = 8;

// Zustand/project persistence commonly recreates WorkshopData objects without
// changing their contents. Object identity is therefore not a valid snapshot
// version and made page 2+ fail with "工坊数据已变化". Keep a deterministic
// content key so only an actual state change invalidates a cursor.
function sourceKey(source: unknown): string {
  try { return JSON.stringify(source) ?? String(source); }
  catch { return String(source); }
}

export class WorkshopStatePager {
  private snapshots = new Map<string, { text: string; sourceKey: string; projectId: string }>();
  private sequence = 0;

  start(text: string, source: unknown, projectId: string): string {
    if (text.length <= WORKSHOP_STATE_PAGE_CHARS) return text;
    // Reopening an unchanged section must keep its cursor and must not evict
    // other sections just because the model is restoring compacted context.
    const key = sourceKey(source);
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.sourceKey === key && snapshot.projectId === projectId && snapshot.text === text) {
        return this.read(id, 0, source, projectId);
      }
    }
    const id = `ws-state-${Date.now()}-${++this.sequence}`;
    this.snapshots.set(id, { text, sourceKey: key, projectId });
    while (this.snapshots.size > MAX_SNAPSHOTS) {
      this.snapshots.delete(this.snapshots.keys().next().value!);
    }
    return this.read(id, 0, source, projectId);
  }

  read(id: string, offset: unknown, source: unknown, projectId: string): string {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) throw new Error('状态快照不存在或已过期，请重新读取 workshop_get_state(detail:"step", section:"breakdown")。');
    if (snapshot.sourceKey !== sourceKey(source) || snapshot.projectId !== projectId) {
      this.snapshots.delete(id);
      throw new Error('工坊数据已变化，不能拼接不同版本的状态。请重新读取所需 section 的状态。');
    }
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset >= snapshot.text.length) {
      throw new Error('offset 必须是快照范围内的整数，请原样使用上页 next_call。');
    }
    // Keep actively restored snapshots in the bounded LRU cache.
    this.snapshots.delete(id);
    this.snapshots.set(id, snapshot);
    // JS UTF-16 offsets: avoid splitting an emoji/surrogate pair between pages.
    let end = Math.min(snapshot.text.length, offset + WORKSHOP_STATE_PAGE_CHARS);
    if (end < snapshot.text.length && /[\uD800-\uDBFF]/.test(snapshot.text[end - 1])) end--;
    const done = end === snapshot.text.length;
    const metadata = {
      output_id: id, offset, total_chars: snapshot.text.length,
      next_offset: done ? null : end, complete: done,
      next_call: done ? null : { output_id: id, offset: end },
    };
    return `${JSON.stringify(metadata)}\n[状态快照分页；正文按 offset 顺序拼接；complete 只表示已到末页。未读完所需事实前不得写入。续读请调用 workshop_get_state(next_call)，不算重复状态读取。]\n${snapshot.text.slice(offset, end)}`;
  }
}

/** A paged state read is one logical result: don't discard page 1 while reading page 5. */
export function protectWorkshopStatePages(
  messages: readonly { role: string; content?: unknown }[],
  protectedIndices: Set<number>,
): void {
  const pageIds = new Map<number, string>();
  messages.forEach((message, index) => {
    if (message.role !== 'tool' || typeof message.content !== 'string') return;
    const firstLine = message.content.split('\n', 1)[0];
    if (!firstLine.startsWith('{"output_id":"ws-state-')) return;
    try {
      const header = JSON.parse(firstLine);
      if (typeof header.output_id === 'string' && typeof header.offset === 'number' && typeof header.complete === 'boolean') {
        pageIds.set(index, header.output_id);
      }
    } catch { /* Not a state-page envelope. */ }
  });
  const activeIds = new Set([...pageIds].filter(([index]) => protectedIndices.has(index)).map(([, id]) => id));
  for (const [index, id] of pageIds) {
    if (activeIds.has(id)) protectedIndices.add(index);
  }
}
