/**
 * projectSessions — 项目对话隔离。
 *
 * 每个 AIGC 项目有自己的会话集（Session.projectId）。普通对话与项目对话
 * 是两套互不干扰的会话空间：
 * - 自由模式（普通 chat）只显示、只创建 projectId 为空的会话；
 * - 项目模式（工坊/画布/剪辑）只使用当前项目的会话。
 *
 * 因此进入项目时**不会**把正在进行的普通对话「原地收编」成项目对话：
 * 普通对话保持原样留在自由模式，项目侧切换到自己的会话（没有则新建）。
 */
import { useChatStore } from '@/stores';
import { createSessionRaw, loadSessionRaw, loadSessionIndexRaw } from '@/hooks/useSessions';
import type { Session } from '@/types';
import { dedupeProjectSessions } from './projectSessionPolicy';

export { dedupeProjectSessions } from './projectSessionPolicy';

/** 项目的所有会话，新→旧排序 */

export function listProjectSessions(projectId: string): Session[] {
  return dedupeProjectSessions(useChatStore.getState().sessions, projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 确保当前会话属于该项目（项目模式专用）。
 *
 * - 当前会话已属于该项目：原样沿用；
 * - 否则切换到该项目最近的会话，没有就新建「项目名 · 对话1」。
 *
 * 普通对话不会被改写归属：它留在自由模式，切回自由模式时照常可见。
 * 流式中不切换会话，返回 null 由调用方决定是否继续。
 */
const ensureProjectSessionInFlight = new Map<string, Promise<Session | null>>();
let sessionTransitionTail: Promise<unknown> = Promise.resolve();

export async function ensureProjectSession(projectId: string, projectName: string): Promise<Session | null> {
  // Project opening can be triggered concurrently by the workshop, canvas and
  // editor surfaces. Serialize the check-and-create sequence so they cannot all
  // observe an empty session list and create duplicate project chats.
  const existingInFlight = ensureProjectSessionInFlight.get(projectId);
  if (existingInFlight) return existingInFlight;

  const run = sessionTransitionTail.catch(() => undefined).then(async () => {
    await loadSessionIndexRaw();
    const store = useChatStore.getState();
    const current = store.sessions.find((s) => s.id === store.currentSessionId);
    if (current?.projectId === projectId) return current;

    // Never rebind a different project's chat while a run is streaming. The
    // caller can retry after the run completes; switching here would make the
    // visible chat and the active execution belong to different projects.
    if (store.isStreaming) return null;

    const existing = listProjectSessions(projectId);
    if (existing.length > 0) {
      const ok = await loadSessionRaw(existing[0].id);
      const selected = useChatStore.getState().sessions.find((s) => s.id === existing[0].id);
      return ok && selected?.projectId === projectId ? selected : null;
    }

    const created = await createSessionRaw(`${projectName} · 对话1`, projectId);
    const selected = created && useChatStore.getState().sessions.find((s) => s.id === created.id);
    return selected?.projectId === projectId ? selected : null;
  });
  sessionTransitionTail = run;
  ensureProjectSessionInFlight.set(projectId, run);
  try {
    return await run;
  } finally {
    if (ensureProjectSessionInFlight.get(projectId) === run) {
      ensureProjectSessionInFlight.delete(projectId);
    }
  }
}

/** 在项目下新建一个编号递增的对话并切换过去。 */
export async function createProjectSession(projectId: string, projectName: string): Promise<Session | null> {
  if (useChatStore.getState().isStreaming) return null;
  const n = listProjectSessions(projectId).length + 1;
  return createSessionRaw(`${projectName} · 对话${n}`, projectId);
}
