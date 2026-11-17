import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useChatStore } from '@/stores/chatStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { useAskUserStore } from '@/stores/askUserStore';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { useRunStepStore } from '@/stores/runStepStore';
import { readProjectFile } from '@/lib/aigc/projectStore';
import { ensureProjectSession } from '@/lib/projectSessions';
import { isMiniMaxH3Model } from './providerCapabilities';
import { buildAdTaskContext } from './adTaskPrompt';
import { assertContinuationOwner, buildContinueAutoRunPrompt, runContinuation, type ContinuationOwner, type ContinuationSnapshot } from './continueAutoRun';
import type { WorkshopData } from './types';

export function workshopContinuationSnapshot(): ContinuationSnapshot {
  const workshop = useWorkshopStore.getState();
  return {
    projectId: workshop.project?.id,
    unifiedId: useUnifiedProjectStore.getState().activeId,
    data: workshop.data,
    hasSourceFiles: Boolean(workshop.project?.sources.length),
    switching: workshop.loading || useUnifiedProjectStore.getState().opening,
    tasks: useCanvasTaskStore.getState().tasks,
    waitingForConfirmation: Boolean(useAskUserStore.getState().pending || useToolConfirmStore.getState().pending),
  };
}

export function currentWorkshopOwner(): ContinuationOwner | undefined {
  const state = workshopContinuationSnapshot();
  if (state.switching || !state.projectId || state.unifiedId !== state.projectId || state.data?.projectId !== state.projectId) return;
  return {projectId:state.projectId, unifiedId:state.unifiedId};
}

export function assertWorkshopOwner(owner: ContinuationOwner, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  assertContinuationOwner(owner, workshopContinuationSnapshot());
}

/** All queued workshop messages carry an immutable owner, including while session loading awaits. */
export async function sendScopedWorkshopMessage(
  owner: ContinuationOwner,
  text: string,
  send: (content: string, files?: string[]) => Promise<void> | void,
  files?: string[],
  signal?: AbortSignal,
): Promise<void> {
  assertWorkshopOwner(owner, signal);
  const session = await ensureProjectSession(owner.unifiedId, useWorkshopStore.getState().project!.name);
  assertWorkshopOwner(owner, signal);
  const chat = useChatStore.getState();
  if (!session || session.id !== chat.currentSessionId || session.projectId !== owner.unifiedId) {
    throw new Error('项目会话未就绪，未提交任务。');
  }
  if (chat.streamingPhase !== 'idle') throw new Error('当前还有执行中的任务，未重复提交。');
  const state = useWorkshopStore.getState();
  const prefix = `[工坊上下文：项目「${state.project!.name}」，当前步骤 ${state.data!.currentStep}。按需先调用 workshop_get_state 读取必要状态；修改工坊请使用 workshop_* 工具并确保 UI 实时联动。]\n\n`;
  await send(prefix + buildAdTaskContext(state.data, text) + text, files);
}

export async function runWorkshopContinuation(
  owner: ContinuationOwner,
  send: (text: string) => Promise<void>,
  style: string,
  signal?: AbortSignal,
) {
  const initialChat = useChatStore.getState();
  let boundSessionId = initialChat.sessions.find(s => s.id === initialChat.currentSessionId)?.projectId === owner.projectId
    ? initialChat.currentSessionId : undefined;
  const check = () => {
    assertWorkshopOwner(owner, signal);
    if (boundSessionId && useChatStore.getState().currentSessionId !== boundSessionId) throw new Error('项目会话已切换，本次全流程已停止。');
    return workshopContinuationSnapshot();
  };
  return runContinuation(owner, {
    snapshot: check,
    saveAndRead: async () => {
      const before = check().data!;
      await useWorkshopStore.getState().commitNow(); check();
      const raw = await readProjectFile(owner.projectId, 'workshop.json');
      const now = check();
      if (!raw) throw new Error('无法回读项目保存结果，未放行后续阶段。');
      const saved = JSON.parse(raw) as WorkshopData;
      if (JSON.stringify(saved) !== JSON.stringify(before) || JSON.stringify(now.data) !== JSON.stringify(before)) {
        throw new Error('项目保存回读不一致或期间内容已变化，已停止后续阶段，请重新核对后继续。');
      }
      return saved;
    },
    execute: async (stage, data) => {
      check();
      const usesH3 = isMiniMaxH3Model(data.videoModel || '') || data.shots.some(s => isMiniMaxH3Model(s.videoModel || ''));
      // Keep the visible workshop stage bound to the same evidence-gated stage
      // that is actually being dispatched. Previously continuation only chose the
      // next stage internally; currentStep stayed at the last UI tab (often
      // `assets`), so a prompts task looked like it had restarted assets.
      const stageStep = stage === 'asset-prompts' ? 'assets' : stage;
      if (useWorkshopStore.getState().data?.currentStep !== stageStep) {
        useWorkshopStore.getState().setCurrentStep(stageStep as WorkshopData['currentStep']);
        await useWorkshopStore.getState().commitNow();
        check();
      }
      const prompt = buildContinueAutoRunPrompt(stage, data, style, {
        hasSourceFiles: Boolean(useWorkshopStore.getState().project?.sources.length),
        videoPromptTemplate: data.videoPromptTemplate ?? 'legacy',
        h3Task: usesH3 ? useWorkshopStore.getState().getH3InputMode() : undefined,
      });
      const previousRunId = useRunStepStore.getState().currentRunId;
      await send(prompt); check();
      const runs = useRunStepStore.getState();
      const run = runs.currentRunId ? runs.runsById[runs.currentRunId] : undefined;
      if (!run || run.id === previousRunId || run.sessionId !== useChatStore.getState().currentSessionId || run.projectId !== owner.projectId || run.status !== 'done') {
        return {error:'本轮未收到正常结束的执行回执（可能取消、失败或仍在确认），后续阶段未提交。'};
      }
      boundSessionId = run.sessionId;
      const error = useChatStore.getState().error;
      return error ? {error:String(error)} : {};
    },
  });
}
