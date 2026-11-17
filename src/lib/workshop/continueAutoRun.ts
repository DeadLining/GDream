import { buildProductAdPrompt } from './adSpec.ts';
import { buildBreakdownPrompt } from './workshopPrompts.ts';
import { buildVideoReviewTask } from './videoReviewTask.ts';
import { resolveWorkshopH3Task } from './h3InputMode.ts';
import type { WorkshopData } from './types.ts';
import { reasonsForStepCompletion } from './stepStatus.ts';
import { adMaterialsError } from './adMaterials.ts';
import { AD_ASSET_PROGRESS_RULES, AD_RESEARCH_RULES } from './adTaskPrompt.ts';
import { buildAutoRunSteps, type AutoRunStepOptions } from './workshopPrompts.ts';
import { isMiniMaxH3Model } from './providerCapabilities.ts';

export const CONTINUATION_STAGES = ['research', 'script', 'breakdown', 'asset-prompts', 'assets', 'prompts', 'generate'] as const;
export type ContinuationStage = typeof CONTINUATION_STAGES[number];
export interface ContinuationOwner { projectId: string; unifiedId: string }
export interface ContinuationSnapshot {
  projectId?: string;
  unifiedId?: string | null;
  data?: WorkshopData | null;
  waitingForConfirmation?: boolean;
  switching?: boolean;
  hasSourceFiles?: boolean;
  tasks: Array<{id: string; projectId?: string; status: string; submissionUncertain?: boolean; automaticRetryBlocked?: boolean}>;
}
export interface ContinuationResult { status: 'paused' | 'complete'; message: string }

export function assertContinuationOwner(owner: ContinuationOwner, state: ContinuationSnapshot): void {
  if (state.switching || owner.projectId !== owner.unifiedId || state.projectId !== owner.projectId || state.data?.projectId !== owner.projectId || state.unifiedId !== owner.unifiedId) {
    throw new Error('项目已切换，本次全流程已停止；不会把排队任务发送到其他项目。');
  }
}

/** Recompute from saved business evidence; model prose and step badges cannot release a gate. */
export function nextContinuationStage(data: WorkshopData, hasSourceFiles = false): ContinuationStage | undefined {
  if (adMaterialsError(data.creativeSpec)) return 'research';
  if (data.creativeSpec?.workKind === 'product-ad' && !hasSourceFiles
    && !data.shots.length && !(data.scriptRevisions ?? []).some(r => r.id === data.currentScriptRevisionId && r.content?.trim())) return 'script';
  if (reasonsForStepCompletion({data, step:'breakdown'}).length
    || (data.currentScriptRevisionId && data.shots.some(s => s.sourceScriptRevisionId !== data.currentScriptRevisionId))) return 'breakdown';
  const assets = [...data.characters, ...data.scenes, ...(data.props ?? [])];
  if (assets.some(a => !a.assetImagePath && !a.candidates?.length && !a.assetPrompt?.trim())) return 'asset-prompts';
  if (reasonsForStepCompletion({data, step:'assets'}).length) return 'assets';
  if (reasonsForStepCompletion({data, step:'prompts'}).length || data.shots.some(s =>
    s.promptNeedsRefresh
    || (isMiniMaxH3Model(s.videoModel || data.videoModel || '')
      ? s.h3VideoPromptModeStale || (resolveWorkshopH3Task(data) !== 'ref2va' && resolveWorkshopH3Task(data) !== 't2va'
        && (!s.plannedStartFramePrompt?.trim() || (resolveWorkshopH3Task(data) === 'fl2va' && !s.plannedEndFramePrompt?.trim())))
      : !s.imagePrompt?.trim()))) return 'prompts';
  if (reasonsForStepCompletion({data, step:'generate'}).length) return 'generate';
  return undefined;
}

function waitingReason(state: ContinuationSnapshot, projectId: string): string | undefined {
  if (state.waitingForConfirmation) return '已有待确认事项，请先处理原确认卡；不会另开一轮替代确认。';
  const tasks = state.tasks.filter(t => t.projectId === projectId);
  const active = tasks.find(t => ['queued','uploading','running','downloading'].includes(t.status));
  if (active || state.data?.shots.some(s => s.genStatus === 'queued' || s.genStatus === 'generating')) {
    return `已有后台生成任务${active ? `（${active.id}）` : ''}，本次在此暂停。结果回填后再继续，不重新提交。`;
  }
  // Fail closed: a generic continue click is never permission to retry a paid attempt.
  const uncertain = tasks.find(t => t.status === 'failed' || t.submissionUncertain || t.automaticRetryBlocked);
  if (uncertain) return `生成任务 ${uncertain.id} 失败或提交结果未知。请先在任务面板核对并处理原任务；继续全流程不会自动重试付费提交。`;
}

/** Finite stage progression. Every await is followed by an ownership check. Never replay a stage. */
export async function runContinuation(owner: ContinuationOwner, io: {
  snapshot: () => ContinuationSnapshot;
  saveAndRead: () => Promise<WorkshopData>;
  execute: (stage: ContinuationStage, data: WorkshopData) => Promise<{error?: string}>;
}): Promise<ContinuationResult> {
  const check = () => { const state = io.snapshot(); assertContinuationOwner(owner, state); return state; };
  let state = check();
  let reason = waitingReason(state, owner.projectId);
  if (reason) return {status:'paused', message:reason};
  let saved = await io.saveAndRead(); check();
  if (saved.projectId !== owner.projectId) throw new Error('落盘项目不匹配，未提交任务。');
  const attempted = new Set<ContinuationStage>();
  for (let index = 0; index < CONTINUATION_STAGES.length; index++) {
    state = check();
    reason = waitingReason(state, owner.projectId);
    if (reason) return {status:'paused', message:reason};
    const stage = nextContinuationStage(saved, state.hasSourceFiles);
    if (!stage) return {status:'complete', message:'制作成果已满足保存及评审绑定条件，请到交付页复核；尚未自动交付。'};
    if (attempted.has(stage)) return {status:'paused', message:'当前阶段尚未完成，不自动重放；请查看本轮阻塞原因。'};
    attempted.add(stage);
    const outcome = await io.execute(stage, saved); check();
    if (outcome.error) return {status:'paused', message:outcome.error};
    saved = await io.saveAndRead(); state = check();
    if (saved.projectId !== owner.projectId) throw new Error('保存结果项目不匹配，已停止后续阶段。');
    reason = waitingReason(state, owner.projectId);
    if (reason) return {status:'paused', message:reason};
    const next = nextContinuationStage(saved, state.hasSourceFiles);
    if (!next) return {status:'complete', message:'制作成果已满足保存及评审绑定条件，请到交付页复核；尚未自动交付。'};
    if (CONTINUATION_STAGES.indexOf(next) <= CONTINUATION_STAGES.indexOf(stage)) {
      return {status:'paused', message:'本轮已结束，但当前阶段的保存结果或审核条件尚未满足。后续阶段未提交，请查看阻塞事项后再继续。'};
    }
  }
  return {status:'paused', message:'本次续做已到阶段边界，未自动重放任何阶段。'};
}

export function buildContinueAutoRunPrompt(stage: ContinuationStage, data: WorkshopData, style = '', options: AutoRunStepOptions = {}): string {
  let body: string;
  if (stage === 'research') {
    body = `只补齐当前广告的调研资料，不改写已有剧本和分镜，不生成图片或视频。\n${AD_RESEARCH_RULES}`;
  } else if (stage === 'script') {
    body = `${buildProductAdPrompt(data.ideaDraft ?? '', data.creativeSpec!.adSpec!)}
${style}
【剧本阶段边界覆盖】本轮只完成正式剧本与必要设定并落库核验，不要求本轮写完分镜。正式剧本保存成功后由应用自动进入拆解，不要求用户再次点击继续。`;
  } else if (stage === 'breakdown') {
    body = `读取已保存的正式剧本 revision 或已导入源文件，复用而非重写剧本；保存逐镜分镜并核验完整性。
${buildBreakdownPrompt(style)}`;
  } else if (stage === 'assets') {
    body = '只补齐资产及其审核绑定。先读取已有候选图与授权记录：已有候选但未采用时先请求审核/采用，不因 assetImagePath 为空就重新生成。确实没有候选的缺图资产才可申请授权后调用 workshop_generate(kind:"asset")。提交后台任务后结束本轮，不轮询等待，不继续写分镜提示词或生成视频。';
  } else if (stage === 'generate') {
    body = `只推进生成及结果审核。先核对已有任务 ID、状态和候选产物；已有成功结果直接复用，已有候选优先审核/采用。仅对确实未提交的缺项申请确认后调用 workshop_generate；当前项目 H3 输入方式为 ${data.h3InputMode ?? 'ref2va'}。若为 ref2va，分镜图不是视频前置条件，确认后直接生成视频，不调用 kind:"image"；其他模式遵循当前模型的实际帧输入要求。一次只推进当前可执行的生成子阶段，排入后台后立即结束本轮，不把“已排队”当作“已完成”，不继续提交依赖该结果的视频。不得使用 force 或全量重做。`;
  } else {
    const id = stage === 'asset-prompts' ? 'assets' : stage;
    body = buildAutoRunSteps(style, {...options,projectData:data}).find(s => s.id === id)!.prompt;
  }
  if (stage === 'generate') body += `\n${buildVideoReviewTask()}`;
  if (stage === 'assets' && data.creativeSpec?.workKind === 'product-ad') body += `\n${AD_ASSET_PROGRESS_RULES}`;
  return `【继续一键全流程 · ${stage}】\n${body}\n
【本轮边界】
用户启动的是一键全流程；本轮结束不代表全流程结束，由应用依据落盘成果接续下一阶段。已明确选择的受众沿用并保存，不因与原 brief 不同重复询问；用户明确暂停时停止。产品身份图或商用授权未确认不阻止剧本和分镜拆解：标记受影响的镜头与素材依赖，不编造外观、不认定授权，到依赖该资料的正式生成前再用确认卡处理。
本轮只执行上述阶段，由 DSH 根据 workshop_get_state、实际产物和工具回执补齐未完成部分；不执行下一阶段，不重写已保存且有效的内容。部分拆解继续缺失片段，不全量覆盖已有分镜。
广告筛选的资料与参考图使用 workshop_publish_ad_research 保存，入画布不是产品身份确认或商业授权；遵守“仅用已提供资料”的联网选择。
正在运行或结果未知的付费任务先核对原任务，不得重复提交，不得自动重试失败提交。需要新的付费提交仍通过 ask_user_question 确认具体范围并遵守原有工具授权；点击继续不扩大授权。
成果使用对应 workshop_* 工具落库。遇到阻塞先区分影响范围：只暂停受影响项，独立可执行项按既有授权推进；需要决定时用 ask_user_question，不以纯文字要求上传替代确认卡。无可执行项、用户明确暂停或权限/技术错误时停止，不能只用文字声称完成。后台任务已排队即停止本轮；应用核对实际落盘与阶段条件后才决定后续，不绕过交付门禁。`;
}
