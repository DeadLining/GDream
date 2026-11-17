/**
 * canvasTaskStore — queue + status for canvas generation tasks (rhtv chain).
 *
 * Separate from videoGenStore (chat-view ark/happyhorse, untouched per
 * decision) and backgroundTaskStore (agent dreamina polling). The download
 * center reads from here; the canvas nodes subscribe for in-place progress.
 *
 * Concurrency: at most MAX_CONCURRENT tasks run; the rest sit 'queued' and
 * are promoted by the orchestrator when a slot frees. Slot accounting uses
 * `inFlight` (in-memory only) — recovery-polled zombies must NOT hold slots.
 */
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import type { RhtvParams } from '@/lib/rhtv/types';
import { productionInputFingerprint, productionRunIdForJob } from '@/lib/production/run';
import { shouldRetainFailedTask } from '@/lib/canvasGen/retryPolicy';
import { applyCancellationSafePatch } from '@/lib/canvasGen/taskCancellation';
import { persistedCanvasTask } from '@/lib/canvasGen/taskPersistence';
import type { ShotProductionPacket } from '@/lib/workshop/types';

export type CanvasTaskStatus =
  | 'queued'
  | 'uploading'
  | 'running'
  | 'downloading'
  | 'succeeded'
  | 'failed';

export interface CanvasTask {
  id: string;
  nodeId: string;
  kind: 'image' | 'video' | 'audio';
  engineId: string;
  engineLabel: string;
  endpoint: string;
  prompt: string;
  /** 持久化时 prompt 被截断的标记（重试前应提示用户） */
  promptTruncated?: boolean;
  rhTaskId?: string;
  /** Provider 返回的查询地址（不含 query/hash 凭证），用于应用重启后的精确恢复。 */
  providerStatusUrl?: string;
  /** 提交该任务时实际使用的 Provider Base URL；切换设置后仍按原服务恢复。 */
  providerBaseUrl?: string;
  providerStatus?: string;
  providerPhase?: string;
  providerProgress?: string | number;
  providerRequestId?: string;
  pollCount?: number;
  elapsedSeconds?: number;
  productionRunId?: string;
  providerJobId?: string;
  inputFingerprint?: string;
  status: CanvasTaskStatus;
  /** Human-readable progress line ("RUNNING 45s"). */
  progress?: string;
  /** Local file paths of downloaded outputs. */
  resultPaths: string[];
  /** Remote URLs (kept for re-download / download center). */
  resultUrls: string[];
  /** 参考素材（本地路径/asset URL）。恢复期降级重生成、面板重试都依赖它，
   * 缺失会让图生图退化成文生图。 */
  referenceUrls?: string[];
  /** H3/多模态任务实际请求中的音频和视频素材快照。 */
  audioUrls?: string[];
  videoUrls?: string[];
  /** 上游提交回执。requested 是调用入口收到的素材，submitted 是路由、补图和降级后真正发给模型的素材。 */
  submissionReceipt?: {
    requestedImages: number;
    requestedAudio: number;
    requestedVideo: number;
    submittedImages: number;
    submittedAudio: number;
    submittedVideo: number;
    provider?: string;
    fallbackUsed?: boolean;
  };
  /** 提交后发生本地/网络错误时的计费安全标记；有这些标记不得盲目重新提交。 */
  submissionUncertain?: boolean;
  submissionCommitted?: boolean;
  automaticRetryBlocked?: boolean;
  /** 提交参数快照（aspectRatio/ratio/duration…），恢复重生成时复用 */
  params?: RhtvParams;
  error?: string;
  fallbackUsed?: boolean;
  /** 任务归属的 AIGC 项目——跨项目切换时禁止把结果回填进别的项目 */
  projectId?: string;
  /** Workshop shot number — present when this task was spawned from workshop generateShot. */
  workshopShotNo?: string;
  workshopShotKind?: 'image' | 'video';
  /** 本次视频任务独立冻结的生产输入包；恢复时不得借用后续尝试覆盖后的镜头最近包。 */
  workshopProductionPacket?: ShotProductionPacket;
  workshopShotFrameRole?: 'video-start' | 'video-end';
  /** 边界帧输入签名；恢复回填时一并保存，避免重试重复付费生图。 */
  workshopShotFrameSignature?: string;
  /** 高清故事板格子 ID。存在时，完成结果应回填到该格子，而不是整镜首帧图。 */
  workshopStoryboardFrameId?: string;
  /** 前台 Promise 正在驱动本任务（不持久化）。占并发槽的唯一依据；
   * 恢复线程轮询的僵尸任务不置此位，不挤占新任务。 */
  inFlight?: boolean;
  createdAt: number;
  updatedAt?: number;
  finishedAt?: number;
  recoveryAttempts?: number;
  cancelledAt?: number;
}

export const MAX_CONCURRENT_CANVAS_TASKS = 6;

interface CanvasTaskState {
  tasks: CanvasTask[];
  addTask: (t: Omit<CanvasTask, 'id' | 'createdAt' | 'status' | 'resultPaths' | 'resultUrls'>) => string;
  updateTask: (id: string, patch: Partial<CanvasTask>) => void;
  removeTask: (id: string) => void;
  clearFinished: () => void;
  runningCount: () => number;
  nextQueued: () => CanvasTask | undefined;
}

let counter = 0;
const genId = () => `ct-${Date.now()}-${++counter}`;

const ACTIVE: CanvasTaskStatus[] = ['uploading', 'running', 'downloading'];
/** rehydrate 需要处理的状态：queued 也算——重启后没有前台 Promise 会推进它 */
const ACTIVE_OR_QUEUED: CanvasTaskStatus[] = ['queued', ...ACTIVE];

// The task queue and workshop project are persisted independently. Recovery
// needs an explicit barrier so a terminal task receipt is durable before the
// matching workshop snapshot is considered complete.
let flushCanvasTaskStorage = (): void => {};

export function flushCanvasTaskPersistence(): void {
  flushCanvasTaskStorage();
}

type PersistedCanvasTaskState = Pick<CanvasTaskState, 'tasks'>;

function compactPersistedTasks(state: PersistedCanvasTaskState): PersistedCanvasTaskState {
  return {
    tasks: state.tasks.slice(-80).map(persistedCanvasTask),
  };
}

/**
 * Task progress can update several times per second. Keep the latest
 * structured state in memory, then compact/stringify once after the burst;
 * serializing 80 historical tasks in every polling callback stalls WebKit.
 */
function createDeferredCanvasTaskStorage(delayMs = 900): PersistStorage<PersistedCanvasTaskState> {
  let pending: { name: string; value: StorageValue<PersistedCanvasTaskState> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const current = pending;
    pending = null;
    if (!current) return;
    const compacted: StorageValue<PersistedCanvasTaskState> = {
      ...current.value,
      state: compactPersistedTasks(current.value.state),
    };
    safeLocalStorage.setItem(current.name, JSON.stringify(compacted));
  };

  flushCanvasTaskStorage = flush;

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    getItem(name) {
      if (pending?.name === name) return pending.value;
      const raw = safeLocalStorage.getItem(name);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<PersistedCanvasTaskState>;
      } catch {
        safeLocalStorage.removeItem(name);
        return null;
      }
    },
    setItem(name, value) {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem(name) {
      if (pending?.name === name) pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      safeLocalStorage.removeItem(name);
    },
  };
}

const deferredCanvasTaskStorage = createDeferredCanvasTaskStorage();

function rehydrateActiveTask(task: CanvasTask): CanvasTask {
  const canRecover = Boolean(task.rhTaskId || task.resultPaths.length > 0 || task.resultUrls.length > 0);
  if (canRecover) {
    const progress = task.resultPaths.length > 0
      ? '恢复回填中…'
      : task.resultUrls.length > 0
        ? '恢复下载中…'
        : '恢复轮询中…';
    return { ...task, status: 'running', progress, inFlight: false };
  }
  return { ...task, status: 'failed', error: '任务在应用关闭时中断，请重试', finishedAt: Date.now() };
}

export const useCanvasTaskStore = create<CanvasTaskState>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (t) => {
        const id = genId();
        const now = Date.now();
        set((s) => ({
          tasks: [
            ...s.tasks,
            {
              ...t,
              id,
              productionRunId: t.productionRunId ?? productionRunIdForJob(id),
              inputFingerprint: t.inputFingerprint ?? productionInputFingerprint(t),
              status: 'queued',
              resultPaths: [],
              resultUrls: [],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        return id;
      },

      updateTask: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((task) => (task.id === id ? {
          ...applyCancellationSafePatch(task, {
            ...patch,
            ...(patch.rhTaskId ? { providerJobId: patch.rhTaskId } : {}),
            updatedAt: Date.now(),
          }),
        } : task)) })),

      removeTask: (id) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      clearFinished: () =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.status !== 'succeeded' && (t.status !== 'failed' || shouldRetainFailedTask(t))),
        })),

      // 只统计前台 Promise 真实驱动中的任务。恢复线程接管的僵尸（rehydrate
      // 后 status=running 但 inFlight=false）不占槽，否则重启后 6 个僵尸
      // 会把 acquireSlot 饿死，所有新生成永远排队。
      runningCount: () => get().tasks.filter((t) => ACTIVE.includes(t.status) && t.inFlight).length,

      nextQueued: () => get().tasks.find((t) => t.status === 'queued'),
    }),
    {
      name: 'gdream-canvas-tasks',
      storage: deferredCanvasTaskStorage,
      version: 2,
      // v1→v2：丢弃没有显式 frameId 的故事板图任务（旧版靠 prompt 匹配格子，
      // 两格同词时会串格回填）。其余任务原样保留。
      migrate: (state, version) => {
        const s = state as { tasks?: CanvasTask[] };
        if (version < 2 && Array.isArray(s?.tasks)) {
          s.tasks = s.tasks.filter((t) =>
            !(t.workshopShotNo && t.workshopShotKind === 'image' && t.kind === 'image' && !t.workshopStoryboardFrameId),
          );
        }
        return s as CanvasTaskState;
      },
      // 只持久化最近任务，防任务历史无限膨胀挤爆 localStorage 配额。
      // 工坊/高清故事板任务需要完整 prompt 兜底定位回填格子，不能截断。
      // Keep partialize O(1). The deferred storage adapter performs expensive
      // clipping and serialization only once after progress updates settle.
      partialize: (s) => ({ tasks: s.tasks }),
      // 水合时转换：持久化为 active/queued 的任务实际都没在执行——有恢复
      // 句柄的转入恢复态（recovery hook 接管），没有的直接判失败。
      // 注意必须用 merge 而不是 onRehydrateStorage 回调：同步 storage 下
      // hydration 在 create() 执行中发生，回调里引用导出的 store const 会
      // 因未初始化而抛错被吞，导致转换从未生效（历史 bug）。
      merge: (persisted, current) => {
        const p = persisted as { tasks?: CanvasTask[] } | undefined;
        return {
          ...current,
          tasks: (p?.tasks ?? []).map((t) =>
            ACTIVE_OR_QUEUED.includes(t.status) ? rehydrateActiveTask(t) : t,
          ),
        };
      },
    },
  ),
);
