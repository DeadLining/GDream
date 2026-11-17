import { invoke } from '@tauri-apps/api/tauri';
import { create } from 'zustand';
import { readTextFile, createDir, renameFile, removeFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import type { RunSession } from '../../stores/runStepStore';
import { sanitizeRunEvidence } from './runPresentation';

const directory = '.gdream/chats/run-history';
const fileFor = (id: string) => `${directory}/${encodeURIComponent(id)}.json`;
const deletedFileFor = (id: string) => `${fileFor(id)}.deleted`;
const options = { dir: BaseDirectory.Home };
const queues = new Map<string, Promise<void>>();
const deletedSessions = new Set<string>();
const errors = new Map<string, string>();
export const useRunArchiveStatus = create<{ error: string | null }>(() => ({ error: null }));

function report(sessionId: string, message?: string) {
  if (message) errors.set(sessionId, message); else errors.delete(sessionId);
  useRunArchiveStatus.setState({ error: [...errors.values()][0] ?? null });
}
export const isRunArchiveDeletionRequested = (sessionId: string): boolean => deletedSessions.has(sessionId);
export async function isRunArchiveDeleted(sessionId: string): Promise<boolean> {
  if (deletedSessions.has(sessionId)) return true;
  if (await exists(deletedFileFor(sessionId), options)) {
    deletedSessions.add(sessionId);
    return true;
  }
  return false;
}

/** Queue deletes with writes; a failed operation must not poison subsequent retries. */
function enqueue(sessionId: string, action: () => Promise<void>, error: string): Promise<void> {
  const next = (queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(action);
  queues.set(sessionId, next);
  void next.then(() => report(sessionId), () => report(sessionId, error)).then(() => {
    if (queues.get(sessionId) === next) queues.delete(sessionId);
  });
  return next;
}

export async function readRunArchive(sessionId: string): Promise<RunSession[]> {
  if (await isRunArchiveDeleted(sessionId)) return [];
  const file = fileFor(sessionId);
  if (!await exists(file, options)) return [];
  const archive = JSON.parse(await readTextFile(file, options));
  if (archive?.version !== 1 || archive.sessionId !== sessionId || !Array.isArray(archive.runs)
    || archive.runs.some((r: RunSession) => !r || r.sessionId !== sessionId || !r.id || !Array.isArray(r.steps))) {
    throw new Error('执行记录格式不匹配，未覆盖原文件');
  }
  if (await isRunArchiveDeleted(sessionId)) return [];
  return archive.runs.map(sanitizeRunEvidence);
}

/** Serialized atomic writes. A durable deletion marker wins over even newer stale snapshots. */
export function writeRunArchive(sessionId: string, runs: RunSession[]): Promise<void> {
  if (deletedSessions.has(sessionId)) return Promise.resolve();
  return enqueue(sessionId, async () => {
    if (await isRunArchiveDeleted(sessionId)) return;
    await createDir(directory, { ...options, recursive: true });
    const existing = await readRunArchive(sessionId);
    const merged = new Map(existing.map((run) => [run.id, run]));
    for (const run of runs) {
      if (run.sessionId !== sessionId) throw new Error('执行记录会话不匹配');
      const previous = merged.get(run.id);
      if (!previous || (run.updatedAt ?? run.startedAt) >= (previous.updatedAt ?? previous.startedAt)) {
        merged.set(run.id, sanitizeRunEvidence(run));
      }
    }
    if (await isRunArchiveDeleted(sessionId)) return;
    const file = fileFor(sessionId);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await invoke('write_text_file_private', { path: temp, contents: JSON.stringify({ version: 1, sessionId, runs: [...merged.values()] }) });
      if (await isRunArchiveDeleted(sessionId)) return;
      await renameFile(temp, file, options);
    } finally {
      await removeIfPresent(temp);
    }
    // Another WebView may have deleted the session while IPC was in flight.
    if (await isRunArchiveDeleted(sessionId)) await removeIfPresent(file);
  }, '执行记录未能写入磁盘，请勿关闭应用；内存记录仍保留。');
}

async function removeIfPresent(path: string) {
  if (await exists(path, options)) await removeFile(path, options);
}

/** IDs are not reused. Keep only an empty tombstone, never the deleted business content. */
export function deleteRunArchive(sessionId: string): Promise<void> {
  deletedSessions.add(sessionId); // Block deferred snapshots and in-flight hydration immediately.
  return enqueue(sessionId, async () => {
    await createDir(directory, { ...options, recursive: true });
    await invoke('write_text_file_private', { path: deletedFileFor(sessionId), contents: '' });
    await removeIfPresent(fileFor(sessionId));
    await removeIfPresent(`${fileFor(sessionId)}.tmp`);
  }, '会话执行记录删除失败，请重试；已阻止本进程继续写入该会话。');
}

export async function flushRunArchive(): Promise<void> {
  while (queues.size) await Promise.all([...queues.values()]);
}
