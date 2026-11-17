/**
 * TaskQueuePanel — bottom-right drawer listing canvas generation tasks
 * (running / queued / finished), with retry & cancel. Mirrors the
 * task-queue pattern from TapNow/LibTV: progress lives on the canvas, the
 * panel is the overview.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ListTodo, X, RotateCcw, Square, Trash2, Loader2, CheckCircle2, XCircle, Clock, Eye } from 'lucide-react';
import { useCanvasTaskStore, type CanvasTask } from '@/stores/canvasTaskStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { generateForNode, abortCanvasTask, runGeneration } from '@/lib/canvasGen';
import { recoverCanvasTaskNow } from '@/hooks/useCanvasTaskRecovery';
import { retryDecision } from '@/lib/canvasGen/retryPolicy';
import { confirm as tauriConfirm, message as tauriMessage } from '@tauri-apps/api/dialog';
import { collectNodeReferences, selfVideoFallback } from '@/lib/canvas/collectRefs';
import { mergeCanvasNodeGenerationParams } from '@/lib/canvas/generationParams';
import { SGLANG_H3_POLL_INTERVAL_MS } from '@/lib/canvasGen/sglangH3';

const ACTIVE_STATUSES = ['queued', 'uploading', 'running', 'downloading'];

function retryEngineId(task: CanvasTask): string {
  if (task.engineId.startsWith('api:')) {
    return task.engineId.includes('seedream-v5-pro') ? 'seedream-v5-pro' : 'gpt-image-2';
  }
  if (task.engineId.includes('seedream-v5-pro')) return 'seedream-v5-pro';
  if (task.engineId.startsWith('gpt-image')) return 'gpt-image-2';
  return task.engineId;
}

function StatusIcon({ task }: { task: CanvasTask }) {
  switch (task.status) {
    case 'succeeded': return <CheckCircle2 size={13} className="text-emerald-500" />;
    case 'failed': return <XCircle size={13} className="text-red-400" />;
    case 'queued': return <Clock size={13} className="text-[var(--canvas-text-2)]" />;
    default: return <Loader2 size={13} className="animate-spin text-[var(--canvas-text-2)]" />;
  }
}

function TaskPromptDialog({ task, onClose }: { task: CanvasTask; onClose: () => void }) {
  const frameLabel = task.workshopShotFrameRole === 'video-start'
    ? '视频首帧'
    : task.workshopShotFrameRole === 'video-end'
      ? '视频尾帧'
      : task.kind === 'video' ? '视频' : task.kind === 'image' ? '图片' : '音频';
  const mediaGroups = [
    { label: '图片', values: task.referenceUrls ?? [] },
    { label: '音频', values: task.audioUrls ?? [] },
    { label: '视频', values: task.videoUrls ?? [] },
  ].filter((group) => group.values.length > 0);
  const mediaCount = mediaGroups.reduce((total, group) => total + group.values.length, 0);
  return createPortal(
    <div
      className="canvas-dark fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--canvas-node-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--canvas-text-1)]">完整生成提示词</div>
            <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">
              {task.engineLabel} · {frameLabel}{task.workshopShotNo ? ` · 分镜 ${task.workshopShotNo}` : ''} · 参考素材 {mediaCount} 个
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]" title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-[var(--canvas-text-1)]">{task.prompt}</pre>
          {mediaGroups.length > 0 && (
            <div className="mt-5 border-t border-[var(--canvas-node-border)] pt-4">
              <div className="mb-2 text-[12px] font-medium text-[var(--canvas-text-1)]">实际提交的参考素材</div>
              <div className="space-y-3">
                {mediaGroups.map((group) => (
                  <div key={group.label}>
                    <div className="mb-1 text-[10px] text-[var(--canvas-text-3)]">{group.label} · {group.values.length} 个</div>
                    <div className="space-y-1.5">
                      {group.values.map((reference, index) => (
                        <div key={`${group.label}-${reference}-${index}`} className="break-all rounded-lg bg-black/20 px-3 py-2 text-[11px] text-[var(--canvas-text-2)]">
                          {group.label}{index + 1} · {reference}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-5 border-t border-[var(--canvas-node-border)] pt-4">
            <div className="mb-2 text-[12px] font-medium text-[var(--canvas-text-1)]">运行与参数快照</div>
            <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[11px]">
              <span className="text-[var(--canvas-text-3)]">本地任务 ID</span>
              <span className="break-all font-mono text-[var(--canvas-text-2)]">{task.id}</span>
              <span className="text-[var(--canvas-text-3)]">ProductionRun</span>
              <span className="break-all font-mono text-[var(--canvas-text-2)]">{task.productionRunId || '未生成'}</span>
              <span className="text-[var(--canvas-text-3)]">Provider 任务 ID</span>
              <span className="break-all font-mono text-[var(--canvas-text-2)]">{task.providerJobId || task.rhTaskId || '尚未返回'}</span>
              {task.providerStatusUrl && <>
                <span className="text-[var(--canvas-text-3)]">状态查询地址</span>
                <span className="break-all font-mono text-[var(--canvas-text-2)]">{task.providerStatusUrl}</span>
              </>}
              {task.providerBaseUrl && <>
                <span className="text-[var(--canvas-text-3)]">提交服务地址</span>
                <span className="break-all font-mono text-[var(--canvas-text-2)]">{task.providerBaseUrl}</span>
              </>}
              {task.engineLabel.includes('MiniMax-H3') && <>
                <span className="text-[var(--canvas-text-3)]">查询频率</span>
                <span className="text-[var(--canvas-text-2)]">每 {SGLANG_H3_POLL_INTERVAL_MS / 1000} 秒一次；不设置固定生成超时</span>
                <span className="text-[var(--canvas-text-3)]">Provider 状态</span>
                <span className="break-all text-[var(--canvas-text-2)]">{task.providerStatus || '尚未查询'}{task.providerPhase ? ` · ${task.providerPhase}` : ''}{task.providerProgress !== undefined ? ` · 进度 ${task.providerProgress}` : ''}</span>
                <span className="text-[var(--canvas-text-3)]">已查询 / 已等待</span>
                <span className="text-[var(--canvas-text-2)]">{task.pollCount ?? 0} 次 / {task.elapsedSeconds ?? 0} 秒{task.providerRequestId ? ` · request ${task.providerRequestId}` : ''}</span>
              </>}
              <span className="text-[var(--canvas-text-3)]">输入指纹</span>
              <span className="break-all font-mono text-[var(--canvas-text-2)]">{task.inputFingerprint || '未记录'}</span>
              <span className="text-[var(--canvas-text-3)]">请求参数</span>
              <pre className="m-0 whitespace-pre-wrap break-all rounded-lg bg-black/20 px-2 py-1.5 font-mono text-[10px] leading-5 text-[var(--canvas-text-2)]">{JSON.stringify(task.params ?? {}, null, 2)}</pre>
              {task.submissionReceipt && <>
                <span className="text-[var(--canvas-text-3)]">提交回执</span>
                <pre className="m-0 whitespace-pre-wrap break-all rounded-lg bg-black/20 px-2 py-1.5 font-mono text-[10px] leading-5 text-[var(--canvas-text-2)]">{JSON.stringify(task.submissionReceipt, null, 2)}</pre>
              </>}
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--canvas-node-border)] px-5 py-2 text-right text-[10px] text-[var(--canvas-text-3)]">
          {task.prompt.length} 字符
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TaskRow({ task }: { task: CanvasTask }) {
  const removeTask = useCanvasTaskStore((s) => s.removeTask);
  const isActive = ACTIVE_STATUSES.includes(task.status);
  const [promptOpen, setPromptOpen] = useState(false);

  const handleRetry = async () => {
    const decision = retryDecision(task);
    if (decision === 'recover') {
      try {
        await recoverCanvasTaskNow({ taskId: task.id });
      } catch (error) {
        await tauriMessage(error instanceof Error ? error.message : String(error), { title: '恢复任务失败' });
      }
      return;
    }
    if (decision === 'blocked') {
      await tauriMessage('该任务可能已经提交到付费 Provider，但没有可用的远端任务 ID。为避免重复扣费，已禁止重新提交；请先在 Provider 控制台确认任务状态。', { title: '已阻止重复提交' });
      return;
    }
    removeTask(task.id);
    if (task.workshopStoryboardFrameId) {
      // 故事板格子任务：直接重跑该格子的生成，绝不能落到 generateShot——
      // 那会用分镜主提示词覆盖整镜首帧图（imagePath）。
      void runGeneration({
        engineId: retryEngineId(task),
        prompt: task.prompt,
        referenceUrls: task.referenceUrls,
        params: task.params,
        projectId: task.projectId,
        workshopShotNo: task.workshopShotNo,
        workshopShotKind: task.workshopShotKind ?? 'image',
        workshopStoryboardFrameId: task.workshopStoryboardFrameId,
      });
    } else if (task.workshopShotNo) {
      void useWorkshopStore.getState().generateShot(
        task.workshopShotNo,
        task.workshopShotFrameRole ? 'video' : (task.workshopShotKind ?? 'image'),
        task.workshopShotFrameRole ? { boundaryFramesOnly: true } : undefined,
      );
    } else {
      // 从节点重新收集参考素材：必须与 NodeInfoBar / canvas_generate 同源，
      // 否则重试会漏掉组图、音频、视频和工坊局部参考节点。
      const collected = collectNodeReferences(task.nodeId);
      const referenceUrls = collected.images.map((r) => r.submitUrl);
      const audioUrls = collected.audios.map((r) => r.submitUrl);
      const videoUrls = selfVideoFallback(task.nodeId, collected).slice(0, 1);
      const node = useCanvasStore.getState().nodes.find((item) => item.id === task.nodeId);
      const retryParams = mergeCanvasNodeGenerationParams(
        task.kind,
        (node?.data ?? {}) as Record<string, unknown>,
        (task.params ?? {}) as Record<string, string | number | boolean>,
      );
      void generateForNode({
        nodeId: task.nodeId,
        engineId: task.engineId,
        prompt: task.prompt,
        ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
        ...(audioUrls.length > 0 ? { audioUrls } : {}),
        ...(videoUrls.length > 0 ? { videoUrls } : {}),
        params: retryParams,
        overwrite: true,
      });
    }
  };

  const handleRemove = async () => {
    if (retryDecision(task) !== 'retry') {
      const confirmed = await tauriConfirm('该记录包含远端任务或可能已提交的付费状态。移除后将无法从 GDream 继续恢复查询，确定只移除本地记录吗？', { title: '移除远端任务记录', type: 'warning' }).catch(() => false);
      if (!confirmed) return;
    }
    removeTask(task.id);
  };

  return (
    <>
      <div className="flex items-start gap-2 px-3 py-2 border-b border-[var(--canvas-node-border)] last:border-0 hover:bg-[var(--canvas-controls-hover)] group">
        <div className="mt-0.5 shrink-0"><StatusIcon task={task} /></div>
        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => setPromptOpen(true)}
          title="点击查看完整生成提示词"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[var(--canvas-text-1)]">{task.engineLabel}</span>
            {task.fallbackUsed && (
              <span className="text-[9px] px-1 rounded bg-amber-50 text-amber-600 border border-amber-200">降级</span>
            )}
          </div>
          <p className="text-[11px] text-[var(--canvas-text-2)] truncate">{task.prompt}</p>
          {task.progress && isActive && (
            <p className="text-[10px] text-[var(--canvas-text-2)]">{task.progress}</p>
          )}
          {task.error && (
            <p className="text-[10px] text-red-400 line-clamp-2">{task.error}</p>
          )}
          {task.automaticRetryBlocked && task.rhTaskId && (
            <p className="text-[10px] text-amber-400">已提交到 Provider，禁止重复提交；可恢复查询</p>
          )}
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => setPromptOpen(true)} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]" title="查看完整提示词">
            <Eye size={12} />
          </button>
          {task.automaticRetryBlocked && task.rhTaskId && (
            <button
              onClick={() => void handleRetry()}
              className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-amber-400 hover:text-amber-300"
              title="恢复查询，不重新提交"
            >
              <RotateCcw size={12} />
            </button>
          )}
          {task.status === 'failed' && !(task.automaticRetryBlocked && task.rhTaskId) && (
            <button onClick={() => void handleRetry()} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]" title={retryDecision(task) === 'recover' ? '恢复查询' : retryDecision(task) === 'blocked' ? '已阻止重复提交' : '重试'}>
              <RotateCcw size={12} />
            </button>
          )}
          {isActive && (
            <button onClick={() => abortCanvasTask(task.id)} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-red-500" title="取消">
              <Square size={12} />
            </button>
          )}
          {!isActive && (
            <button onClick={() => void handleRemove()} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-red-500" title="移除记录">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      {promptOpen && <TaskPromptDialog task={task} onClose={() => setPromptOpen(false)} />}
    </>
  );
}

export default function TaskQueuePanel() {
  const tasks = useCanvasTaskStore((s) => s.tasks);
  const clearFinished = useCanvasTaskStore((s) => s.clearFinished);
  const [open, setOpen] = useState(false);

  const activeCount = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
  if (tasks.length === 0) return null;

  return (
    // right-20 keeps clear of the CanvasChatBubble pinned at bottom-5 right-5
    <div className="absolute bottom-4 right-20 z-20 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            className="w-[320px] max-h-[360px] overflow-hidden flex flex-col bg-[var(--canvas-panel)] rounded-xl border border-[var(--canvas-node-border)] shadow-xl"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--canvas-node-border)]">
              <span className="text-[12px] font-medium text-[var(--canvas-text-1)]">
                生成任务 {activeCount > 0 && <span className="text-[var(--canvas-accent)]">· {activeCount} 进行中</span>}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={clearFinished} className="text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] px-1.5 py-0.5 rounded hover:bg-[var(--canvas-controls-hover)]">
                  清除已完成
                </button>
                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]">
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto">
              {[...tasks].reverse().map((t) => <TaskRow key={t.id} task={t} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] shadow-md hover:shadow-lg text-[var(--canvas-text-1)] transition-shadow"
        title="生成任务队列"
      >
        {activeCount > 0
          ? <Loader2 size={14} className="animate-spin text-[var(--canvas-accent)]" />
          : <ListTodo size={14} className="text-[var(--canvas-text-2)]" />}
        <span className="text-[12px] font-medium">
          {activeCount > 0 ? `${activeCount} 个任务` : '任务'}
        </span>
      </button>
    </div>
  );
}
