import { useWorkshopRewriteStore, WORKSHOP_REWRITE_OPEN } from '@/stores/workshopRewriteStore';
import WorkshopRewriteProgress from './WorkshopRewriteProgress';
import { rewriteWorkshopShotVideo } from '@/lib/workshop/rewriteShotVideo';
/**
 * WorkshopChatPanel — 工坊GDream抽屉（AgentDrawer 壳的工坊 wrapper）。
 *
 * 步骤组件通过 window CustomEvent 'gdream-workshop-prompt' 注入预制
 * prompt（自动展开并发送；流式中则进入真队列排队，空闲后按序补发）。
 */
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { currentWorkshopOwner, assertWorkshopOwner, sendScopedWorkshopMessage, runWorkshopContinuation } from '@/lib/workshop/continuationRuntime';
import type { ContinuationOwner } from '@/lib/workshop/continueAutoRun';
import { buildStyleSection } from './StyleSelector';
import { useHelloGreeting } from '@/lib/greeting';
import AgentDrawer from '../chat/AgentDrawer';
import { SYSTEM_REPAIR_PROMPT_EVENT, type SystemRepairPromptDetail } from '@/lib/agent/systemRepair';
import {
  shouldGateRemainingSteps,
  buildGateNotice,
  selectGatedCancellations,
  applyGateToQueue,
} from '@/lib/workshop/autoRunGate';

const STRIP_RE = /^\[工坊上下文[\s\S]*?\]\n\n/;

interface QueueItem {
  id: string;
  label: string;
  prompt: string;
  owner: ContinuationOwner;
  continuation?: boolean;
  filePaths?: string[];
  status: 'queued' | 'running';
  enqueuedAt: number;
  /**
   * 一键全流程这类多步链条：本步失败时取消后续排队步骤，而不是照常派发。
   * 用户手动输入的 prompt 不带这个标记，保持原有行为。
   */
  gateOnFailure?: boolean;
}

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void> | void;
  onAbort: () => void;
  onBusyChange?: (busy: boolean) => void;
}

/** 步骤组件用：向抽屉注入预制 prompt 并触发发送 */
export function dispatchWorkshopPrompt(prompt: string, options?: { gateOnFailure?: boolean; filePaths?: string[]; continuation?: boolean }) {
  const owner = currentWorkshopOwner();
  if (!owner) throw new Error('请先打开有效项目，再提交工坊任务。');
  window.dispatchEvent(new CustomEvent('gdream-workshop-prompt', {
    detail: { prompt, owner, continuation: options?.continuation, gateOnFailure: options?.gateOnFailure, filePaths: options?.filePaths },
  }));
}

/** 队列条展示名：取 prompt 第一行，去掉方括号前缀，截 30 字 */
function makeLabel(prompt: string): string {
  const first = (prompt.split('\n')[0] ?? '').replace(/^\[[^\]]*\]\s*/, '').trim();
  if (!first) return '未命名任务';
  return first.length > 30 ? `${first.slice(0, 30)}…` : first;
}

export default function WorkshopChatPanel({ onSendMessage, onAbort, onBusyChange }: Props) {
  const hello = useHelloGreeting();
  const rewriteProjectId = useWorkshopStore((s) => s.data?.projectId);
  const rewriteTasks = useWorkshopRewriteStore((s) => s.tasks);
  const projectRewrites = Object.values(rewriteTasks).filter((task) => task.projectId === rewriteProjectId).sort((a, b) => a.startedAt - b.startedAt);
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const isStreaming = useChatStore((s) => s.streamingPhase) !== 'idle';
  useEffect(() => {
    onBusyChange?.(queue.length > 0 || isStreaming);
  }, [queue.length, isStreaming, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const seqRef = useRef(0);
  // 定时器回调闭包捕获的是「派发那一刻」的 queue（effect 依赖 queue 但并不重跑
  // 已排队的 timer）。门控取消数量必须读**当前**队列，所以镜像一份到 ref。
  // 在 effect 里同步而非渲染中赋值：渲染期写 ref 在并发渲染下会串状态。
  const queueRef = useRef<QueueItem[]>([]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const projectId = useWorkshopStore((s) => s.project?.id);
  const unifiedId = useUnifiedProjectStore((s) => s.activeId);
  const continuationController = useRef<AbortController | null>(null);

  const sendWithContext = async (text: string, filePaths?: string[], owner = currentWorkshopOwner(), signal?: AbortSignal) => {
    if (!owner) throw new Error('项目未就绪，未提交任务。');
    await sendScopedWorkshopMessage(owner, text, onSendMessage, filePaths, signal);
  };

  // 入队：队列/执行中已有完全相同 prompt 时跳过（同类去重）
  const enqueue = (prompt: string, gateOnFailure?: boolean, filePaths?: string[], owner = currentWorkshopOwner(), continuation = false) => {
    if (!owner) return;
    try { assertWorkshopOwner(owner); } catch { return; }
    setOpen(true);
    setQueue((prev) => {
      if (prev.some((q) => q.owner.projectId === owner.projectId && (q.prompt === prompt || (q.continuation && continuation)))) return prev;
      seqRef.current += 1;
      return [...prev, {
        id: `wq-${Date.now()}-${seqRef.current}`,
        label: makeLabel(prompt),
        prompt,
        owner,
        continuation,
        filePaths,
        status: 'queued' as const,
        enqueuedAt: Date.now(),
        gateOnFailure,
      }];
    });
  };

  useEffect(() => {
    const showProgress = () => setOpen(true);
    window.addEventListener(WORKSHOP_REWRITE_OPEN, showProgress);
    return () => window.removeEventListener(WORKSHOP_REWRITE_OPEN, showProgress);
  }, []);

  // 步骤组件注入预制 prompt
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt: string; gateOnFailure?: boolean; filePaths?: string[]; owner?: ContinuationOwner; continuation?: boolean }>).detail;
      if (!detail?.prompt) return;
      enqueue(detail.prompt, detail.gateOnFailure, detail.filePaths, detail.owner, detail.continuation);
    };
    window.addEventListener('gdream-workshop-prompt', handler);
    return () => window.removeEventListener('gdream-workshop-prompt', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = (event as CustomEvent<SystemRepairPromptDetail>).detail?.prompt;
      if (!prompt) return;
      enqueue(prompt);
    };
    window.addEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 空闲且无在执行项时取队首发送并标 running（保持 250ms 节奏）
  // 注意：定时器必须放进 ref——标记 running 会触发本 effect 重跑，
  // 若用 cleanup 清定时器，发送会被自己取消（队列永远卡在"执行中"）。
  const scheduledRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setQueue(prev => prev.filter(item => item.owner.projectId === projectId && item.owner.unifiedId === unifiedId));
    return () => {
      // Stop only local continuation/queued dispatch, never abort or replay a live paid/model task.
      continuationController.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      scheduledRef.current = null;
    };
  }, [projectId, unifiedId]);
  useEffect(() => {
    if (isStreaming) return;
    if (queue.some((q) => q.status === 'running')) return;
    const head = queue.find((q) => q.status === 'queued');
    if (!head) return;
    if (scheduledRef.current === head.id) return;
    scheduledRef.current = head.id;
    setQueue((prev) => prev.map((q) => (q.id === head.id ? { ...q, status: 'running' as const } : q)));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      scheduledRef.current = null;
      // Promise settle 是唯一的队列放行信号。不能再用 streamingPhase 回到 idle
      // 提前移除 running；流式正文结束后 coordinator 仍可能在做工具收尾。
      const controller = new AbortController();
      continuationController.current = controller;
      const execute = async () => {
        assertWorkshopOwner(head.owner, controller.signal);
        if (!head.continuation) return sendWithContext(head.prompt, head.filePaths, head.owner, controller.signal);
        const style = await buildStyleSection();
        assertWorkshopOwner(head.owner, controller.signal);
        const result = await runWorkshopContinuation(head.owner,
          text => sendWithContext(text, undefined, head.owner, controller.signal), style, controller.signal);
        assertWorkshopOwner(head.owner, controller.signal);
        useChatStore.getState().addMessage({id:`wq-result-${head.id}`,role:'system',content:result.message,timestamp:Date.now()});
      };
      execute().then(
        () => {
          // 失败门控：多步链条的某一步以错误收场时，取消后续排队步骤，
          // 避免把一次错误放大成连续报错（服务不稳时尤其致命）。
          try { assertWorkshopOwner(head.owner, controller.signal); } catch { return; }
          const turnError = useChatStore.getState().error;
          if (shouldGateRemainingSteps(head.gateOnFailure, turnError)) {
            // 待取消的数量必须在这里算出（同步、可预期），不能塞进 setQueue 的
            // updater 里当副作用：updater 的求值时机由 React 决定（严格模式下
            // 还会双调用），一旦延后，提示里的「后续 N 个步骤已取消」就会写成 0。
            // 队列是本地 state，这里的 snapshot 就是当前真实队列。
            const cancelled = selectGatedCancellations(queueRef.current, head.id).length;
            // 只清掉「排队中」的后继步骤：正在执行的那一条不属于本次取消范围。
            setQueue((prev) => applyGateToQueue(prev, head.id));
            useChatStore.getState().addMessage({
              id: `wq-gate-${head.id}`,
              role: 'system',
              content: buildGateNotice(String(turnError), cancelled),
              timestamp: Date.now(),
            });
            return;
          }
          setQueue((prev) => prev.filter((q) => q.id !== head.id));
        },
        (err) => {
          console.warn('[workshop-queue] 任务发送失败，已从队列移除', err);
          if (!controller.signal.aborted && currentWorkshopOwner()?.projectId === head.owner.projectId) {
            useChatStore.getState().addMessage({id:`wq-error-${head.id}`,role:'system',content:err instanceof Error ? err.message : '任务未完成，后续阶段未提交。',timestamp:Date.now()});
          }
          setQueue((prev) => prev.filter((q) => q.id !== head.id));
        },
      ).finally(() => {
        setQueue(prev => prev.filter(item => item.id !== head.id));
      });
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, isStreaming]);

  // 卸载时清掉未发的定时器，避免组件销毁后还发消息
  useEffect(() => () => {
    continuationController.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const cancelQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id || q.status !== 'queued'));
  };

  return (
    <AgentDrawer
      open={open}
      onOpenChange={setOpen}
      stripPrefixRe={STRIP_RE}
      greeting={{ hello: hello, title: '这条流水线交给我吧' }}
      suggestions={[
        '读取我上传的剧本并完成拆解',
        '为所有角色和场景写资产图提示词',
        '把第 3 镜的视频提示词改得更有张力',
      ]}
      onSend={(text, files) => enqueue(text, undefined, files)}
      onAbort={() => {
        continuationController.current?.abort();
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          scheduledRef.current = null;
          setQueue(prev => prev.filter(item => item.status !== 'running'));
        }
        onAbort();
      }}
      activityContent={projectRewrites.length ? (
        <WorkshopRewriteProgress
          tasks={projectRewrites}
          onRetry={(task) => {
            void rewriteWorkshopShotVideo(task.projectId, task.shotNo).catch(() => {
              // Start() already replaces the failed card and the progress panel
              // carries the model/validation error; avoid a second modal here.
            });
          }}
        />
      ) : undefined}
      modelScope="workshop"
      placeholder="拆剧本、写提示词、批量生成，描述即可"
      queueItems={queue.map(({ id, label, status }) => ({ id, label, status }))}
      onCancelQueueItem={cancelQueueItem}
    />
  );
}
