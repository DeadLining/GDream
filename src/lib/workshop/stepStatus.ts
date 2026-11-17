import { breakdownWorkUnits, pendingBreakdownUnits } from './breakdownQueue.ts';
import { episodesWithoutShots } from './breakdownExecution.ts';
import type { AigcProject } from '@/lib/aigc/projectStore';
import type { AssetCandidate, WorkshopData, WorkshopStepId, WorkshopStepState, WsShot } from './types.ts';
import { assetBindingIsCurrent } from './assetLineage.ts';
import { videoAdoptionIsCurrent } from './productionLifecycle.ts';
import { isMiniMaxH3Model } from './providerCapabilities.ts';

function assetIsReadyForProduction(item: {
  assetImagePath?: string;
  candidates?: AssetCandidate[];
  assetReviews?: import('./types').AssetReviewReceipt[];
  assetProductionBinding?: import('./types').AssetProductionBinding;
}): boolean {
  if (!item.assetImagePath) return false;
  const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
  return Boolean(candidate?.checksum
    && (candidate.source !== 'generate' || candidate.inputFingerprint)
    && candidate
    && assetBindingIsCurrent({
      candidate,
      binding: item.assetProductionBinding,
      reviews: item.assetReviews,
    }));
}

export function reconcileGenerationStepState(shots: WsShot[], current: WorkshopStepState): WorkshopStepState {
  const complete = shots.length > 0 && shots.every(videoAdoptionIsCurrent);
  // Upstream edits after adoption still need an explicit user decision, not automatic approval.
  if (current.status === 'stale' && (!complete
    || shots.some((shot) => !(shot.videoProductionBinding!.boundAt >= current.updatedAt)))) return current;
  const status = complete ? 'done' : (current.status === 'done' ? 'in-progress' : current.status);
  return status === current.status ? current : { ...current, status, updatedAt: Date.now() };
}

type BreakdownCompletionInput = Pick<WorkshopData,
  'breakdownWork' | 'synopsis' | 'episodes' | 'narrativeBeats' | 'characters' | 'scenes' | 'props' | 'currentScriptRevisionId' | 'scriptReview' | 'shots'
>;

/** Story planning can populate synopsis/assets before any shot has been decomposed. */
export function breakdownActionLabel(input: {
  scriptNeedsRepair: boolean;
  shotCount: number;
  incomplete: boolean;
}): string {
  if (input.scriptNeedsRepair) return 'AI 修订剧本';
  if (input.shotCount === 0) return 'AI 拆解';
  return input.incomplete ? '继续 AI 拆解' : '重新拆解';
}

export function breakdownCompletionReasons(data: BreakdownCompletionInput): string[] {
  if (!data.shots.length) return ['尚未保存分镜，请先写入镜头。'];
  if (data.breakdownWork) {
    const pending = pendingBreakdownUnits(data);
    if (pending.length) return [`仍有 ${pending.length} 段正文未完成拆解保存，下一段为第 ${pending[0].episode} 集第 ${pending[0].index + 1} 段。请继续当前片段，不重写已保存镜头。`];
  }
  const missing = episodesWithoutShots(data);
  return missing.length ? [`第 ${missing.join('、')} 集尚未保存任何镜头，请继续拆解；已写镜头不需要重新验收。`] : [];
}

export function reasonsForStepCompletion(input: {
  data: WorkshopData;
  project?: Pick<AigcProject, 'sources'> | null;
  step: WorkshopStepId;
}): string[] {
  const { data, project, step } = input;
  const reasons: string[] = [];
  if (step === 'script' && !project?.sources?.length) {
    const currentRevision = (data.scriptRevisions ?? []).find((revision) => revision.id === data.currentScriptRevisionId);
    if (!(currentRevision?.sourceKind === 'idea' && currentRevision.content?.trim())) reasons.push('尚未导入剧本源文件');
  }
  if (step === 'breakdown') {
    reasons.push(...breakdownCompletionReasons(data));
  }
  if (step === 'assets') {
    const missing = [
      ...data.characters.filter((item) => !assetIsReadyForProduction(item)).map((item) => `角色${item.name}`),
      ...data.scenes.filter((item) => !assetIsReadyForProduction(item)).map((item) => `场景${item.name}`),
      ...(data.props ?? []).filter((item) => !assetIsReadyForProduction(item)).map((item) => `道具${item.name}`),
    ];
    if (missing.length > 0) reasons.push(`仍缺少资产图或正式世系：${missing.slice(0, 6).join('、')}`);
  }
  if (step === 'prompts') {
    const missing = data.shots.filter((shot) => {
      const model = shot.videoModel || data.videoModel || '';
      const prompt = isMiniMaxH3Model(model) || (shot.videoPromptTemplate || data.videoPromptTemplate) === 'universal'
        ? shot.universalVideoPrompt
        : shot.videoPrompt;
      return !prompt?.trim();
    }).map((shot) => shot.shotNo);
    if (missing.length > 0) reasons.push(`提示词未完成：${missing.slice(0, 8).join('、')}`);
  }
  if (step === 'generate') {
    if (!data.shots.length) reasons.push('尚未保存分镜，请先写入镜头。');
    const missing = data.shots.filter((shot) => !videoAdoptionIsCurrent(shot)).map((shot) => shot.shotNo);
    if (missing.length > 0) reasons.push(`仍有视频未生成或未采用：${missing.slice(0, 8).join('、')}`);
  }
  if (step === 'handoff') reasons.push('交付步骤只能通过交付界面的 manifest 门禁完成，不能由 Agent 直接标记 done。');
  return reasons;
}

/**
 * Reconcile persisted step badges from actual saved business evidence.
 * This is intentionally pure so opening a project, recovering a background task,
 * and rendering the project list all use the same gate semantics.
 */
export function reconcileWorkshopSteps(
  data: WorkshopData,
  project?: Pick<AigcProject, 'sources'> | null,
): WorkshopData {
  const steps = { ...data.steps };
  for (const step of ['script', 'breakdown', 'assets', 'prompts', 'generate'] as const) {
    const current = steps[step];
    if (step === 'generate') {
      steps.generate = reconcileGenerationStepState(data.shots, current);
      continue;
    }
    // A persisted stale badge is superseded only by current-source receipts.
    const breakdownRevalidated = step === 'breakdown'
      && breakdownWorkUnits(data).length > 0
      && pendingBreakdownUnits(data).length === 0
      && data.shots.every(shot => !data.currentScriptRevisionId || shot.sourceScriptRevisionId === data.currentScriptRevisionId);
    if (current.status === 'stale' && !breakdownRevalidated) continue;
    const complete = reasonsForStepCompletion({ data, project, step }).length === 0;
    const status = complete ? 'done' : (current.status === 'done' ? 'in-progress' : current.status);
    if (status !== current.status) steps[step] = { ...current, status, updatedAt: Date.now() };
  }

  // Handoff has an explicit manifest gate and must never be inferred from
  // generation text or provider callbacks. Preserve its persisted receipt.
  const stepOrder = ['script', 'breakdown', 'assets', 'prompts', 'generate', 'handoff'] as const;
  const firstIncomplete = stepOrder.findIndex((step) => steps[step].status !== 'done');
  const currentIndex = stepOrder.indexOf(data.currentStep);
  const nextStep = firstIncomplete >= 0
    && (currentIndex < 0 || currentIndex > firstIncomplete || steps[data.currentStep].status === 'done')
    ? stepOrder[firstIncomplete]
    : data.currentStep;
  return { ...data, steps, currentStep: nextStep };
}
