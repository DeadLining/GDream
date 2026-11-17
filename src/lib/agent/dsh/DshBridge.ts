import { RepeatedToolFailureGuard } from './repeatedToolFailure';
import { resolveWorkshopRunBudget } from '../workshopRunBudget';
import { resolveEpisodeScriptTask, buildEpisodeScriptTaskContext, episodeScriptProgress, episodeScriptStopNotice } from '../../workshop/episodeScriptTask';
import { isWorkshopMutationTool } from '../workshopWriteGuard';
import { useRunStepStore } from '@/stores/runStepStore';
import { isTruncatedFinishReason, mergePromptContinuation } from '../completionGuard';
import { useWorkshopStore } from '@/stores/workshopStore';
import { ExecutionRecovery, ExecutionStoppedError, resolveWorkshopExecutionTask } from '../executionRecovery';
import type { AgentUserContentBlock } from '../types';
import { sanitizeProgressText } from '../toolSummary';
import { DshAcpClient, type AcpUpdate } from './acpClient';
import { DshToolBridge } from './toolBridge';
import { parseDshStreamUpdate } from './streamUpdate';
import type { DshRunOptions, DshRunResult } from './types';

export interface DshBridgeDependencies {
  createAcp?: (...args: ConstructorParameters<typeof DshAcpClient>) => Pick<DshAcpClient, 'start' | 'prompt' | 'cancel' | 'dispose'>;
  createTools?: (...args: ConstructorParameters<typeof DshToolBridge>) => Pick<DshToolBridge, 'start' | 'abort' | 'dispose'>;
}

export class DshBridge {
  private readonly dependencies: DshBridgeDependencies;
  constructor(dependencies: DshBridgeDependencies = {}) { this.dependencies = dependencies; }
  private running = false;
  private queuedGuidance: Array<{ text: string; media: AgentUserContentBlock[] }> = [];
  private acp: Pick<DshAcpClient, 'start' | 'prompt' | 'cancel' | 'dispose'> | null = null;
  private tools: Pick<DshToolBridge, 'start' | 'abort' | 'dispose'> | null = null;
  private visibleOutput = false;
  private aborted = false;

  getIsRunning(): boolean {
    return this.running;
  }

  hasVisibleOutput(): boolean {
    return this.visibleOutput;
  }

  queueGuidance(text: string, media: AgentUserContentBlock[] = []): boolean {
    if (!this.running || (!text.trim() && media.length === 0)) return false;
    this.queuedGuidance.push({ text: text.trim(), media });
    return true;
  }

  async run(options: DshRunOptions): Promise<DshRunResult> {
    if (this.running) throw new Error('DeepSeek Harness is already running');
    this.running = true;
    this.aborted = false;
    this.visibleOutput = false;
    const recovery = new ExecutionRecovery(options.executionTask ?? resolveWorkshopExecutionTask(options.input, useWorkshopStore.getState().data));
    options.toolRegistry.resetRepeatReads();
    let episodeScriptTask = resolveEpisodeScriptTask(options.input, useWorkshopStore.getState().data);
    const episodeScriptReceipts = new Set<string>();
    const episodeScriptYieldKeys = new Set<string>();
    const episodeBudget = resolveWorkshopRunBudget({ userInput: options.input, defaultMaxTurns: 30, episodeScriptCount: episodeScriptTask?.targetEpisodeNos.length });
    let episodeTurns = 0;
    let promptHadTools = false;
    let terminalToolError = '';
    const failureGuard = new RepeatedToolFailureGuard();
    let thinking = '';
    let currentMessage = '';
    let usage = { used: 0, size: options.contextWindow ?? 1_000_000 };
    let stopReason: string | undefined;
    const instanceId = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onUpdate = ({ update }: AcpUpdate) => {
      if (!this.running || this.aborted) return;
      const parsed = parseDshStreamUpdate(update);
      if (parsed.type === 'text') {
        const delta = parsed.text;
        if (!delta) return;
        this.visibleOutput = true;
        currentMessage += delta;
        options.callbacks.onTextDelta(delta);
      } else if (parsed.type === 'thinking') {
        const delta = parsed.text;
        if (!delta) return;
        this.visibleOutput = true;
        thinking += delta;
        options.callbacks.onThinkingDelta(delta);
      } else if (parsed.type === 'tool_call') {
        // A tool call may already have created a paid or irreversible side
        // effect. Treat it as observable progress even when no prose has been
        // streamed yet, so an ACP failure cannot replay the whole turn through
        // built-in DeepSeek and charge the user twice.
        this.visibleOutput = true;
        const progress = sanitizeProgressText(currentMessage);
        if (progress) options.callbacks.onProgressText?.(currentMessage, progress);
        currentMessage = '';
      } else if (parsed.type === 'usage') {
        usage = { used: parsed.used, size: parsed.size };
        options.callbacks.onContextUsage?.({ estimatedTokens: parsed.used, maxTokens: parsed.size });
      } else if (parsed.type === 'compaction') {
        if (parsed.phase === 'start') {
          options.callbacks.onProgressText?.('', '上下文接近容量，我正在整理较早的任务记录，完成后会继续当前步骤。');
        } else if (parsed.phase === 'end') {
          options.callbacks.onProgressText?.(
            '',
            parsed.failed
              ? '较早记录暂时未能整理，但当前任务会继续执行。'
              : '较早记录已整理完成，我会继续处理当前任务。',
          );
        }
      }
    };
    this.tools = (this.dependencies.createTools ?? ((...args) => new DshToolBridge(...args)))(
      options.runId,
      instanceId,
      options.toolRegistry,
      options.callbacks,
      // A tool reaching the executor may already have created a paid side
      // effect. Mark visible output here too — the ACP tool_call stream event
      // can be lost if the dsh process dies mid-dispatch, and without this a
      // fallback replay would run the paid tool a second time.
      (name) => {
        this.visibleOutput = true;
        promptHadTools = true;
        recovery.dispatched(name);
      },
      { languageModel: { providerId: options.providerId?.trim() || 'deepseek', modelId: options.model },
        beforeExecute: (name, params) => {
          if (!episodeScriptTask || !isWorkshopMutationTool(name)) return undefined;
          const no = String(params.episode_no ?? '');
          if (useWorkshopStore.getState().data?.projectId !== episodeScriptTask.projectId
            || name !== 'workshop_set_episode_script' || !episodeScriptTask.targetEpisodeNos.includes(no)) {
            return { success: false, output: '', error: '本轮仅补写指定分集剧本，当前写入超出范围或项目已切换；保留其他分集及已有镜头。', recoverable: true };
          }
          if (episodeScriptReceipts.has(no)) return { success: true, output: `第 ${no} 集已有保存成功回执，没有重复写入。` };
          return undefined;
        },
      },
      (name, params, result) => {
        recovery.observe(name, params, result);
        const failure = failureGuard.observe(name, result);
        if (failure && !terminalToolError) {
          terminalToolError = failure;
          options.callbacks.onProgressText?.('', failure);
          // Stop the active ACP prompt immediately, not after the model's internal tool loop.
          // Marked dispatch prevents any whole-run replay, including paid tool calls.
          this.tools?.abort();
          void this.acp?.dispose();
        }
        const no = String(params.episode_no ?? '');
        if (episodeScriptTask && name === 'workshop_set_episode_script' && result.success
          && episodeScriptTask.targetEpisodeNos.includes(no)) episodeScriptReceipts.add(no);
      },
    );
    this.acp = (this.dependencies.createAcp ?? ((...args) => new DshAcpClient(...args)))(options, instanceId, onUpdate);
    const abort = () => void this.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (episodeScriptTask && !episodeScriptTask.targetEpisodeNos.length && !episodeScriptTask.missingEpisodeNos.length) {
        return { text: `第 ${episodeScriptTask.protectedEpisodeNos.join('、')} 集已有保存的剧本草稿；没有重复覆盖。`, thinking, visibleOutput: false };
      }
      try {
        await this.tools.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`DeepSeek Harness 工具桥初始化失败: ${message}`);
      }
      try {
        await this.acp.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`DeepSeek Harness ACP 启动失败: ${message}`);
      }
      let nextInput = options.input;
      let nextMedia = options.mediaBlocks;
      let finalText = '';
      let continuationText = '';
      while (true) {
        if (this.aborted || options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (episodeScriptTask && episodeTurns++ >= episodeBudget.maxTurns) {
          finalText = episodeScriptStopNotice(episodeScriptTask, useWorkshopStore.getState().data, episodeBudget.maxTurns, episodeScriptReceipts);
          break;
        }
        currentMessage = '';
        promptHadTools = false;
        const checkpoint = episodeScriptTask
          ? buildEpisodeScriptTaskContext(episodeScriptTask, useWorkshopStore.getState().data)
          : recovery.checkpoint(useWorkshopStore.getState().data);
        let response;
        try {
          response = await this.acp.prompt(checkpoint ? `${nextInput}\n\n${checkpoint}` : nextInput, nextMedia);
        } catch (error) {
          if (terminalToolError) throw new ExecutionStoppedError(terminalToolError);
          throw error;
        }
        if (terminalToolError) throw new ExecutionStoppedError(terminalToolError);
        stopReason = response.stopReason;
        if (this.aborted || options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (this.queuedGuidance.length > 0) {
          const guidance = this.queuedGuidance.shift()!;
          useRunStepStore.setState((state) => {
            const run = state.runsById[options.runId];
            if (!run || run.status !== 'running') return {};
            return { runsById: { ...state.runsById, [options.runId]: { ...run, userRequest: guidance.text, workshopShotSync: undefined } } };
          });
          episodeScriptTask = null;
          recovery.cancelTask();
          continuationText = '';
          nextInput = guidance.text;
          nextMedia = guidance.media;
          options.callbacks.onProgressText?.('', '收到你的补充，我会沿用当前进度继续处理。');
          continue;
        }
        if (terminalToolError) { finalText = terminalToolError; break; }
        if (episodeScriptTask) {
          const progress = episodeScriptProgress(episodeScriptTask, useWorkshopStore.getState().data);
          if (!progress.sameProject) throw new ExecutionStoppedError('当前工坊项目已切换，停止原分集剧本任务。');
          if (!episodeScriptTask.missingEpisodeNos.length && progress.remaining.length === 0
            && episodeScriptTask.targetEpisodeNos.every((no) => episodeScriptReceipts.has(no))) {
            finalText = `已保存第 ${episodeScriptTask.targetEpisodeNos.join('、')} 集的剧本草稿。本轮分集剧本任务完成，尚未执行这些分集的镜头拆解。`;
            break;
          }
          const key = progress.remaining.join(',');
          if (stopReason !== 'tool_calls' && progress.remaining.length > 0) {
            if (episodeScriptReceipts.size > 0 && !episodeScriptTask.missingEpisodeNos.length && !episodeScriptYieldKeys.has(key)) {
              episodeScriptYieldKeys.add(key);
              nextInput = '任务尚未完成，继续保存未完成集，不要重复已保存集。'; nextMedia = []; continue;
            }
            finalText = `分集剧本尚未全部保存。当前待保存：第 ${progress.remaining.join('、')} 集。\n${currentMessage}`;
            break;
          }
          if (stopReason === 'tool_calls') { nextInput = '继续保存尚未完成的目标集。'; nextMedia = []; continue; }
        }
        const decision = recovery.decide({ data: useWorkshopStore.getState().data, text: currentMessage, finishReason: stopReason, toolContinuation: promptHadTools && (stopReason === 'tool_calls' || !currentMessage.trim()) });
        if (decision.kind === 'stop') throw new ExecutionStoppedError(decision.message);
        if (decision.kind === 'continue') {
          if (isTruncatedFinishReason(stopReason)) continuationText = mergePromptContinuation(continuationText, currentMessage);
          // Same ACP session, only the next step. Never resend original media or recreate the run.
          nextInput = decision.prompt;
          nextMedia = [];
          continue;
        }
        finalText = decision.kind === 'complete' ? decision.text : mergePromptContinuation(continuationText, currentMessage);
        break;
      }
      options.callbacks.onContextUsage?.({ estimatedTokens: usage.used, maxTokens: usage.size });
      return { text: finalText, thinking, visibleOutput: this.visibleOutput, stopReason };
    } finally {
      options.signal?.removeEventListener('abort', abort);
      await this.dispose();
    }
  }

  async abort(): Promise<void> {
    // Make cancellation visible synchronously.  The UI can accept a new
    // request immediately after Stop is clicked, so leaving `running` true
    // while an ACP notification is in flight can accidentally append that
    // request to the run being cancelled.
    this.running = false;
    this.aborted = true;
    this.queuedGuidance = [];
    const tools = this.tools;
    const acp = this.acp;
    this.tools = null;
    this.acp = null;
    tools?.dispose();

    // Killing the owned ACP process is the authoritative cancellation path.
    // A best-effort session/cancel notification is not sufficient when the
    // model is blocked inside a long-running tool call.
    await acp?.dispose();
  }

  private async dispose(): Promise<void> {
    this.queuedGuidance = [];
    this.tools?.dispose();
    this.tools = null;
    const acp = this.acp;
    this.acp = null;
    await acp?.dispose();
    this.running = false;
  }
}
