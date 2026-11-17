import { isBreakdownReconciliationRequest } from '../workshop/breakdownIntent.ts';
import { breakdownReconciliationState, breakdownQueueInstruction } from '../workshop/breakdownQueue.ts';
import type { WorkshopData } from '../workshop/types.ts';
import type { ToolResult } from './types.ts';
import { breakdownExecutionProgress, isBreakdownResplitExecution, isFullBreakdownExecution } from '../workshop/breakdownExecution.ts';
import { isTruncatedFinishReason } from './completionGuard.ts';

export interface WorkshopExecutionTask { kind: 'breakdown' | 'breakdown-resplit'; projectId: string }

/** Resolve once at the UI/engine boundary; the engines carry this typed task afterwards. */
export function resolveWorkshopExecutionTask(input: string, data?: WorkshopData | null): WorkshopExecutionTask | undefined {
  if (!data) return undefined;
  const request = input.replace(/^\[工坊上下文：[^\n]*\]\s*/u, '').trim();
  const intent = request.split(/\n\s*\n|【/u, 1)[0];
  const inspection = /(?:只|仅)(?:做)?(?:检查|核对|查看|读取|汇报)|先不(?:要)?(?:执行|修改|写入)/u.test(intent);
  if (inspection) return undefined;
  const continuation = data.currentStep === 'breakdown' && /^(?:请)?(?:继续[。！!]?|把剩下的补齐[。！!]?|按刚才(?:的)?顺序继续[。！!]?)$/u.test(request);
  if (isBreakdownResplitExecution(request)) return { kind: 'breakdown-resplit', projectId: data.projectId };
  return isFullBreakdownExecution(request) || continuation || (data.currentStep === 'breakdown' && isBreakdownReconciliationRequest(request)) || request.includes('[工坊任务:breakdown]')
    ? { kind: 'breakdown', projectId: data.projectId } : undefined;
}

export class ExecutionStoppedError extends Error {
  constructor(message: string) { super(message); this.name = 'ExecutionStoppedError'; }
}
export type RecoveryDecision = { kind: 'continue'; prompt: string } | { kind: 'stop'; message: string } | { kind: 'complete'; text: string } | { kind: 'pass' };

/** DSH execution recovery. Never restart a run or replay a media submission. */
export class ExecutionRecovery {
  private task?: WorkshopExecutionTask;
  private emptyCount = 0;
  private truncations = 0;
  private yielded = new Set<string>();
  private confirmed = false;
  private paidDispatched = false;
  private hardFailure = '';
  private failures = new Map<string, string>();
  private receipts = new Set<string>();
  private reads = new Set<string>();
  private rejectedShots?: Record<string, unknown>;
  private dialogueRepair?: { workUnitId: string; shotNos: string[] };
  private repairedCheckpoints = new Set<string>();
  private nextPage?: Record<string, unknown>;
  private rebuildApplied = false;

  constructor(task?: WorkshopExecutionTask) { this.task = task; }
  cancelTask(): void {
    this.task = undefined;
    this.emptyCount = 0;
    this.truncations = 0;
    this.hardFailure = '';
    this.failures.clear();
    this.dialogueRepair = undefined;
    this.repairedCheckpoints.clear();
    this.rejectedShots = undefined;
    this.yielded.clear();
    this.nextPage = undefined;
    this.rebuildApplied = false;
    // Keep paidDispatched: new guidance must not enable an automatic replay.
  }
  noteUsableResponse(): void { this.emptyCount = 0; }
  dispatched(name: string): void {
    if (/(?:generate|image_gen|video_gen|audio_gen|text_to_speech|suno|midjourney|submit|render)/i.test(name)) this.paidDispatched = true;
  }
  observe(name: string, params: Record<string, unknown>, result: Pick<ToolResult, 'success' | 'output' | 'error' | 'recoverable'>): void {
    this.emptyCount = 0;
    this.truncations = 0;
    if (!result.success) {
      const error = (result.error || result.output || '工具未成功').slice(0, 1200);
      this.failures.set(name, error);
      if (this.task && name === 'workshop_complete_breakdown_unit' && /原文对白尚未登记/u.test(error)
        && typeof params.workUnitId === 'string' && Array.isArray(params.shotNos)) {
        this.dialogueRepair = { workUnitId: params.workUnitId, shotNos: params.shotNos.filter((no): no is string => typeof no === 'string') };
      }
      if (this.task && name === 'workshop_set_shots') this.rejectedShots = structuredClone(params);
      if (name === 'workshop_get_state' && /快照不存在|快照.*过期|工坊数据已变化/u.test(error)) this.nextPage = undefined;
      if (/用户拒绝|用户取消|被禁止执行|提交结果未知|可能.*扣费/u.test(error)) this.hardFailure = `${name}：${error}`;
      return;
    }
    this.failures.delete(name);
    if (name === 'workshop_complete_breakdown_unit' && params.workUnitId === this.dialogueRepair?.workUnitId) this.dialogueRepair = undefined;
    if (name === 'workshop_set_shots') this.rejectedShots = undefined;
    if (name === 'workshop_set_shots' && params.confirmRebuild === true && params.mode === 'replace') this.rebuildApplied = true;
    if (name === 'workshop_set_step_status' && params.step === 'breakdown' && params.status === 'done') this.confirmed = true;
    if (/^workshop_(?:set_|update_|record_|restore_shot_dialogue|complete_breakdown_)/.test(name)) {
      if (name !== 'workshop_set_step_status') this.confirmed = false;
      const receipt = name === 'workshop_set_shots' && Array.isArray(params.shots)
        ? `镜头 ${(params.shots as Array<{ shotNo?: string }>).map((s) => s.shotNo).filter(Boolean).join('、')}`
        : name === 'workshop_set_episode_script' ? `第 ${String(params.episode_no)} 集剧本` : name;
      this.receipts.add(receipt);
      // Successful writes invalidate paging snapshots; keep the read history but not its cursor.
      this.nextPage = undefined;
    }
    if (name === 'workshop_get_state') {
      this.reads.add(JSON.stringify(params));
      try {
        const header = JSON.parse(result.output.split('\n', 1)[0]);
        if (header.output_id && typeof header.complete === 'boolean') this.nextPage = header.complete ? undefined : header.next_call;
      } catch { /* Ordinary state JSON is not a page envelope. */ }
    }
  }
  checkpoint(data?: WorkshopData | null): string {
    if (!this.task || data?.projectId !== this.task.projectId) return '';
    if (this.dialogueRepair) {
      try {
        const state = breakdownReconciliationState(data, this.dialogueRepair.workUnitId);
        const repair = JSON.stringify({ ...state, shots: state.shots.filter((shot) => this.dialogueRepair!.shotNos.includes(shot.shotNo)) });
        const context = repair.length <= 14000 ? repair
          : `workshop_get_state(section:"breakdown-work",work_unit_id:"${this.dialogueRepair.workUnitId}")；按 next_call 读完。`;
        return `[当前任务：先修复漏对白，不是再次登记完成]\n${context}\n将当前正文台词按剧情对应到这些已有镜号，立即调用 workshop_restore_shot_dialogue。为空则补回，冲突则按当前正文替换；不增加重复镜头，不拼接两版台词，不重复请求已有授权。每镜成功后继续剩余镜头；全部同步后才重提 workshop_complete_breakdown_unit(${JSON.stringify(this.dialogueRepair)})。对白归属有歧义时明确指出，不得猜测塞入一镜。`;
      } catch { this.dialogueRepair = undefined; }
    }
    if (this.rejectedShots) {
      const error = this.failures.get('workshop_set_shots') || '';
      const refreshedTask = /正文已变化|workUnitId/.test(error) ? `\n当前有效任务（只更新过期的任务 ID，不删已有镜头）：\n${breakdownQueueInstruction(data)}` : '';
      return `[失败批次定向修复：未保存，禁止重读全项目或改写其他镜头]\n错误：${error}\n原始完整参数：${JSON.stringify(this.rejectedShots)}\n只修正错误字段，以同一 mode 重提本批；workUnitId 未过期则原样保留。若错误要求补齐审核或资产等前置记录，先完成该必要项再重提。成功后程序继续下一片段。${refreshedTask}`;
    }
    if (this.task.kind === 'breakdown-resplit') {
      const target = data?.shots.length ?? 0;
      return `[当前任务：重新拆解并重排已有分镜，不是核对完成状态]\n已保存：${[...this.receipts].join('；') || '本轮暂无写入回执'}。\n已读取：${[...this.reads].slice(-6).join('；') || '尚未读取'}。\n当前项目有 ${target} 条已保存镜头；旧的 breakdown=done 只代表上一版结果，不能作为本轮结束依据。\n先重新读取当前正式剧本、Scene、Narrative Beat、角色/场景/道具和现有镜头；保留剧情事实与对白，只重组生成单元与时长。按剧情权重合并过度细碎镜头，高潮与关键揭示加长，铺垫与单一信息点缩短。\n重排后必须把完整镜头表在同一次 workshop_set_shots(mode:"replace",confirmRebuild:true) 中提交；禁止先 replace 再 merge，也禁止只提交部分镜头。成功后再调用 workshop_set_step_status(step:"breakdown",status:"done") 收尾。不要生成图片或视频。`;
    }
    return `[执行检查点：来自工具回执，不是模型计划]\n已保存：${[...this.receipts].join('；') || '本轮暂无写入回执'}。\n已读取：${[...this.reads].slice(-6).join('；') || '尚未读取'}。\n${this.nextPage ? `先沿原快照续页 workshop_get_state(${JSON.stringify(this.nextPage)})，不要重开全量快照。` : breakdownQueueInstruction(data)}\n沿用已有事实；只有需要的正文不在上下文中才定向恢复该集/原页，不重新盘点全项目。禁止重复提交已保存批次、生成媒体或把计划当成果。`;
  }
  decide(input: { data?: WorkshopData | null; text: string; finishReason?: string | null; toolContinuation?: boolean }): RecoveryDecision {
    const { data, text, finishReason } = input;
    if (this.task && data?.projectId !== this.task.projectId) return { kind: 'stop', message: '执行项目已变化，已停止旧项目任务；不会向新项目继续写入。' };
    const progress = this.task && data ? breakdownExecutionProgress(data) : undefined;
    const saved = [...this.receipts].join('；') || '本轮没有确认的新写入';
    const resplitNeedsWrite = this.task?.kind === 'breakdown-resplit' && !this.rebuildApplied;
    if (progress?.finished && this.confirmed && !resplitNeedsWrite) return { kind: 'complete', text: `第②步已收到完成状态的工具回执。${saved}。当前共 ${data!.shots.length} 条已保存镜头；本结果表示执行完成，不是镜头质量评分。` };
    if (this.hardFailure) return { kind: 'stop', message: `${this.hardFailure}\n${saved}。已停止自动继续。` };
    if (progress?.reviewBlocked) return { kind: 'stop', message: `当前正式剧本审核尚有阻塞：${data!.scriptReview?.issues.join('；') || '需要修订剧本'}。${saved}。` };
    if (progress || !text.trim() || isTruncatedFinishReason(finishReason)) {
      if (this.paidDispatched) return { kind: 'stop', message: `本轮已派发可能产生扣费的工具，禁止自动重放或补发。${saved}。请核对原任务结果后续作。` };
    }
    if (input.toolContinuation) return { kind: 'continue', prompt: this.checkpoint(data) || '沿用工具结果继续操作，若已完成则据实汇报。' };
    if (progress) {
      const key = progress.key; // Reading the same state and rephrasing errors cannot buy retries.
      // A first concrete repairable error is a new execution phase, even if no
      // mutation happened. Grant ONE repair dispatch for this saved checkpoint;
      // repeated failures/reads/prose cannot keep replenishing it.
      if (this.dialogueRepair && !this.repairedCheckpoints.has(key) && this.repairedCheckpoints.size < 512) {
        this.repairedCheckpoints.add(key);
        this.yielded.add(key);
        return { kind: 'continue', prompt: this.checkpoint(data) };
      }
      if (this.yielded.has(key) || this.yielded.size >= 512) return { kind: 'stop', message: `第②步尚未完成：${progress.missing.length ? `第 ${progress.missing.join('、')} 集尚无镜头。` : '未收到本轮完成状态的保存回执。'}${saved}。已纠正提前结束，但没有完成后续写入；停止重复准备。${this.failures.size ? `具体工具错误：${[...this.failures].map(([name, error]) => `${name}：${error}`).join('；')}` : '模型未执行下一项必需操作，未将任务标记完成。'}` };
      this.yielded.add(key);
      return { kind: 'continue', prompt: `这是执行任务，不是要求最终总结。${this.checkpoint(data)}\n${this.failures.size ? `先针对工具错误修正：${[...this.failures].map(([name, error]) => `${name}：${error}`).join('；')}` : ''}\n立即执行下一项工具操作；目标内容写完后调用 workshop_set_step_status(step:"breakdown",status:"done")。不得只答“尚未调用工具”“后续需要”后结束。` };
    }
    if (isTruncatedFinishReason(finishReason)) {
      if (++this.truncations > 2) return { kind: 'stop', message: '模型输出连续截断，已停止继续拼接。已执行工具不会重放，请从已保存进度续作。' };
      return { kind: 'continue', prompt: '上次输出因长度限制截断，并非任务完成。请续接未完成的内容或下一项工具操作，不重述开头，不重复已执行工具。' };
    }
    if (!text.trim()) {
      if (++this.emptyCount > 1) return { kind: 'stop', message: `当前请求连续两次未得到正文或工具调用（结束原因：${finishReason || '未收到结束标记'}）。${saved}。已停止本次响应恢复；不代表此前工具未执行，请从保存进度续作，不要整轮重发。` };
      return { kind: 'continue', prompt: '上次响应没有正文或工具调用，不能据此认定任务结束。若还有待执行工作，请接着执行下一项必要工具；若工具已完成，依据真实回执简要汇报。不要重新开始任务，不重复付费或已成功的写入。' };
    }
    this.noteUsableResponse();
    this.truncations = 0;
    return { kind: 'pass' };
  }
}
