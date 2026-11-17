import type { AssetCandidate, AssetProductionBinding, AssetReviewReceipt, WorkshopData, WsShot } from './types.ts';
import { bindingIsCurrent, productionCandidateFingerprint, type ProductionCandidate } from '../production/lifecycle.ts';
import { videoCandidateFingerprint, boundVideoReview } from './productionLifecycle.ts';
import { productionRunIdForJob } from '../production/run.ts';
import { assetBindingIsCurrent } from './assetLineage.ts';
import { validateBreakdownInput } from './breakdownValidation.ts';
import { validateCharacterHandoffs } from './characterContinuity.ts';
import { currentVideoQualityReview } from './qualityReview.ts';
import { validateEpisodeContinuity } from './episodeContinuity.ts';

export type ProductionAuditStatus = 'pass' | 'warn' | 'blocked';

export interface ProductionAuditCheck {
  id: string;
  label: string;
  status: ProductionAuditStatus;
  detail: string;
}

export interface ProductionAuditReport {
  status: ProductionAuditStatus;
  checks: ProductionAuditCheck[];
  lineage: {
    scriptRevisionId?: string;
    renderCandidateId?: string;
    renderCandidateFingerprint?: string;
    renderBindingId?: string;
    latestChangeAt?: number;
  };
}

function check(id: string, label: string, status: ProductionAuditStatus, detail: string): ProductionAuditCheck {
  return { id, label, status, detail };
}

function currentVideoBinding(shot: WsShot): boolean {
  if (!shot.videoPath || shot.videoProductionBinding?.path !== shot.videoPath) return false;
  const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoProductionBinding?.path);
  if (!candidate) return false;
  return Boolean(boundVideoReview(shot));
}

function formalVideoPacket(shot: WsShot) {
  if (!shot.videoPath) return undefined;
  const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
  if (!candidate) return undefined;
  if (candidate.productionPacket?.inputFingerprint === candidate.inputFingerprint) return candidate.productionPacket;
  return shot.lastProductionPacket?.inputFingerprint === candidate.inputFingerprint ? shot.lastProductionPacket : undefined;
}

function currentAssetBinding(item: {
  assetImagePath?: string;
  candidates?: AssetCandidate[];
  assetReviews?: AssetReviewReceipt[];
  assetProductionBinding?: AssetProductionBinding;
}): boolean {
  if (!item.assetImagePath) return false;
  const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
  return Boolean(candidate && assetBindingIsCurrent({
    candidate,
    binding: item.assetProductionBinding,
    reviews: item.assetReviews,
  }));
}

function shotRequiresBoundaryFrameReview(shot: WsShot): boolean {
  const packet = formalVideoPacket(shot) ?? shot.lastProductionPacket;
  const h3Task = String(packet?.params?.h3Task ?? '').trim();
  return h3Task === 'fl2va'
    || (!h3Task && packet?.params?.boundaryFrames === true);
}

export function buildProductionAudit(
  data: WorkshopData,
  options: { reviewerFingerprint?: string; videoQualityReviewRequired?: boolean } = {},
): ProductionAuditReport {
  const checks: ProductionAuditCheck[] = [];
  const shots = data.shots;
  const usedPaletteIds = new Set([
    data.globalColorPaletteId,
    ...shots.map((shot) => shot.colorPaletteId),
  ].filter((id): id is string => Boolean(id)));
  const usedColorPalettes = (data.colorPalettes ?? []).filter((palette) => usedPaletteIds.has(palette.id));
  const missingAssets = [
    ...data.characters.filter((item) => !item.assetImagePath).map((item) => `角色「${item.name}」`),
    ...data.scenes.filter((item) => !item.assetImagePath).map((item) => `场景「${item.name}」`),
    ...(data.props ?? []).filter((item) => !item.assetImagePath).map((item) => `道具「${item.name}」`),
    ...usedColorPalettes.filter((item) => !item.assetImagePath).map((item) => `色卡「${item.name}」`),
  ];
  const missingAssetLineage = [
    ...data.characters.filter((item) => item.assetImagePath && !item.candidates?.some((candidate) => candidate.path === item.assetImagePath && candidate.checksum)).map((item) => `角色「${item.name}」`),
    ...data.scenes.filter((item) => item.assetImagePath && !item.candidates?.some((candidate) => candidate.path === item.assetImagePath && candidate.checksum)).map((item) => `场景「${item.name}」`),
    ...(data.props ?? []).filter((item) => item.assetImagePath && !item.candidates?.some((candidate) => candidate.path === item.assetImagePath && candidate.checksum)).map((item) => `道具「${item.name}」`),
    ...usedColorPalettes.filter((item) => item.assetImagePath && !item.candidates?.some((candidate) => candidate.path === item.assetImagePath && candidate.checksum)).map((item) => `色卡「${item.name}」`),
  ];
  const missingAssetInputLineage = [
    ...data.characters.filter((item) => {
      const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
      return Boolean(candidate && candidate.source === 'generate' && !candidate.inputFingerprint);
    }).map((item) => `角色「${item.name}」`),
    ...data.scenes.filter((item) => {
      const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
      return Boolean(candidate && candidate.source === 'generate' && !candidate.inputFingerprint);
    }).map((item) => `场景「${item.name}」`),
    ...(data.props ?? []).filter((item) => {
      const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
      return Boolean(candidate && candidate.source === 'generate' && !candidate.inputFingerprint);
    }).map((item) => `道具「${item.name}」`),
    ...usedColorPalettes.filter((item) => {
      const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
      return Boolean(candidate && candidate.source === 'generate' && !candidate.inputFingerprint);
    }).map((item) => `色卡「${item.name}」`),
  ];
  const unboundAssets = [
    ...data.characters.filter((item) => item.assetImagePath && !currentAssetBinding(item)).map((item) => `角色「${item.name}」`),
    ...data.scenes.filter((item) => item.assetImagePath && !currentAssetBinding(item)).map((item) => `场景「${item.name}」`),
    ...(data.props ?? []).filter((item) => item.assetImagePath && !currentAssetBinding(item)).map((item) => `道具「${item.name}」`),
    ...usedColorPalettes.filter((item) => item.assetImagePath && !currentAssetBinding(item)).map((item) => `色卡「${item.name}」`),
  ];
  // H3/ref2va and the universal template intentionally persist their video
  // prompt in `universalVideoPrompt`. The legacy-only check made a fully
  // prepared project look incomplete, which then caused DSH continuation to
  // stop before submitting generation tasks.
  const missingPrompts = shots.filter((shot) => {
    const model = shot.videoModel || data.videoModel || '';
    const useUniversal = shot.videoPromptTemplate === 'universal'
      || (!shot.videoPromptTemplate && model.toLowerCase().includes('h3'));
    const prompt = useUniversal ? shot.universalVideoPrompt : shot.videoPrompt;
    return !prompt?.trim();
  }).map((shot) => shot.shotNo);
  const currentRevision = (data.scriptRevisions ?? []).find((revision) => revision.id === data.currentScriptRevisionId);
  const missingSourceEvidence = data.currentScriptRevisionId
    && currentRevision?.sourceKind !== 'idea'
    && !(data.breakdownSourceEvidence ?? []).some((item) => typeof item === 'string' && item.trim())
    ? '尚未保存剧本原文事实证据'
    : undefined;
  const bibleNames = ['director', 'character', 'scene', 'continuity'] as const;
  const missingBibles = bibleNames.filter((name) => !data.bibles?.[name]).map((name) => name === 'director' ? '导演' : name === 'character' ? '角色' : name === 'scene' ? '场景' : '连续性');
  const breakdownStructureErrors = validateBreakdownInput(data);
  const characterEpisodes = new Map<string, Set<string>>();
  for (const shot of shots) {
    const episode = shot.episode?.trim();
    if (!episode) continue;
    for (const characterId of shot.characterIds ?? []) {
      const episodes = characterEpisodes.get(characterId) ?? new Set<string>();
      episodes.add(episode);
      characterEpisodes.set(characterId, episodes);
    }
  }
  const crossEpisodeCharacters = [...characterEpisodes.entries()].filter(([, episodes]) => episodes.size > 1).map(([characterId]) => characterId);
  const characterHandoffIssues = validateCharacterHandoffs(data);
  const episodeContinuityIssues = validateEpisodeContinuity(shots);
  const missingCharacterHandoffs = crossEpisodeCharacters.filter((characterId) => {
    const episodes = [...(characterEpisodes.get(characterId) ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return episodes.slice(1).some((targetEpisode) => !(data.characterHandoffs ?? []).some((handoff) => handoff.characterId === characterId && handoff.targetEpisode === targetEpisode));
  });
  const missingVideos = shots.filter((shot) => !shot.videoPath).map((shot) => shot.shotNo);
  const unboundVideos = shots.filter((shot) => shot.videoPath && !currentVideoBinding(shot)).map((shot) => shot.shotNo);
  const unreviewedBoundaryFrames = shots.filter((shot) => {
    if (!shotRequiresBoundaryFrameReview(shot)) return false;
    return !shot.videoStartFramePath
      || !shot.videoEndFramePath
      || !shot.boundaryFrameQualityReview?.passed
      || (options.reviewerFingerprint
        && shot.boundaryFrameQualityReview.reviewerFingerprint !== options.reviewerFingerprint)
      || shot.boundaryFrameQualityReviewSignature !== shot.videoBoundaryFrameSignature;
  }).map((shot) => shot.shotNo);
  const unreviewedFinalVideos = shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
    if (!candidate) return true;
    return !currentVideoQualityReview({
      reports: [shot.videoQualityReview, ...(shot.qualityReviewHistory ?? [])],
      candidatePath: candidate.path,
      candidateFingerprint: videoCandidateFingerprint(candidate),
      reviewerFingerprint: options.reviewerFingerprint,
    });
  }).map((shot) => shot.shotNo);
  const manualQualityReviewShots = shots
    .filter((shot) => shotRequiresBoundaryFrameReview(shot) && shot.qualityReviewRequiresManualReview)
    .map((shot) => shot.shotNo);
  const missingCreativeReviewEvidence = shots.filter((shot) => {
    if (!shot.videoPath || !currentVideoBinding(shot)) return false;
    const review = boundVideoReview(shot);
    const criteria = review?.criteria;
    return !criteria || [criteria.continuity, criteria.visualIdentity, criteria.performance, criteria.pacing].some(value => !value || value === 'not-reviewed');
  }).map((shot) => shot.shotNo);
  const missingVideoInputLineage = shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
    return !candidate?.inputFingerprint;
  }).map((shot) => shot.shotNo);
  const staleProductionPackets = shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
    const packet = formalVideoPacket(shot);
    if (!candidate?.inputFingerprint || !packet) return true;
    if (packet.inputFingerprint !== candidate.inputFingerprint) return true;
    if (packet.projectId !== data.projectId || packet.shotNo !== shot.shotNo) return true;
    return Boolean(data.currentScriptRevisionId && packet.sourceScriptRevisionId !== data.currentScriptRevisionId);
  }).map((shot) => shot.shotNo);
  const missingProductionRunMappings = shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const packet = formalVideoPacket(shot);
    if (!packet?.jobId || !packet.productionRunId) return true;
    if (packet.productionRunId !== productionRunIdForJob(packet.jobId)) return true;
    // Legacy workshop files did not persist the run index. They remain valid
    // when their packet has the deterministic mapping; newly written files
    // must also carry the durable project-level record.
    if (!data.productionRuns) return false;
    return !data.productionRuns.some((run) =>
      run.runId === packet.productionRunId
      && run.projectId === data.projectId
      && run.jobId === packet.jobId
      && run.inputFingerprint === packet.inputFingerprint,
    );
  }).map((shot) => shot.shotNo);
  const latestRender = data.renderCandidates?.[data.renderCandidates.length - 1] as ProductionCandidate | undefined;
  const currentRenderBinding = Boolean(latestRender && bindingIsCurrent({
    candidate: latestRender,
    binding: data.renderProductionBinding,
    reviews: data.renderReviews,
  }));
  const renderJobId = typeof latestRender?.metadata?.jobId === 'string' ? latestRender.metadata.jobId : undefined;
  const missingRenderRunMapping = Boolean(latestRender && (
    !latestRender.inputFingerprint
    || !renderJobId
    || (data.productionRuns !== undefined && !data.productionRuns.some((run) =>
      run.kind === 'render'
      && run.projectId === data.projectId
      && run.jobId === renderJobId
      && run.inputFingerprint === latestRender.inputFingerprint
      && run.status === 'succeeded',
    ))
  ));

  checks.push(data.currentScriptRevisionId
    ? check('script-revision', '剧本生产版本', 'pass', `已冻结 ${data.currentScriptRevisionId}`)
    : check('script-revision', '剧本生产版本', 'blocked', '尚未冻结当前剧本 revision'));
  const scriptReview = data.scriptReview;
  checks.push(scriptReview && scriptReview.revisionId === data.currentScriptRevisionId && scriptReview.status === 'passed'
    ? check('script-review', '剧本 Draft Review', 'pass', `已审核 Scene ${scriptReview.sceneCount}、Beat ${scriptReview.beatCount}`)
    : check('script-review', '剧本 Draft Review', 'blocked', scriptReview?.status === 'needs-repair' ? `需要先修订：${scriptReview.issues.slice(0, 3).join('；')}` : '当前剧本 revision 尚未通过 Draft Review'));
  checks.push(missingSourceEvidence
    ? check('script-evidence', '剧本事实证据', 'blocked', missingSourceEvidence)
    : check('script-evidence', '剧本事实证据', 'pass', '已保存剧本原文短句作为事实收据'));
  checks.push(missingBibles.length === 0
    ? check('project-bibles', '四圣经约束', 'pass', '导演、角色、场景、连续性圣经均已准备')
    : check('project-bibles', '四圣经约束', 'blocked', `缺少：${missingBibles.join('、')}圣经`));
  checks.push(breakdownStructureErrors.length === 0
    ? check('breakdown-structure', '拆解结构校验', 'pass', 'Scene、Narrative Beat、角色和引用关系有效')
    : check('breakdown-structure', '拆解结构校验', 'blocked', breakdownStructureErrors.slice(0, 4).join('；')));
  checks.push(missingAssets.length === 0
    ? check('asset-bundle', '资产引用包', 'pass', '角色、场景、道具均有当前参考图')
    : check('asset-bundle', '资产引用包', 'blocked', `缺少：${missingAssets.slice(0, 4).join('、')}${missingAssets.length > 4 ? '…' : ''}`));
  checks.push(missingAssetLineage.length === 0
    ? check('asset-lineage', '资产文件世系', 'pass', '当前角色、场景、道具均有文件 checksum')
    : check('asset-lineage', '资产文件世系', 'blocked', `缺少 checksum：${missingAssetLineage.slice(0, 4).join('、')}${missingAssetLineage.length > 4 ? '…' : ''}；请重新导入或重新生成资产`));
  checks.push(unboundAssets.length === 0
    ? check('asset-binding', '资产评审绑定', 'pass', '当前正式资产均有有效候选指纹与评审收据')
    : check('asset-binding', '资产评审绑定', 'blocked', `未完成当前评审绑定：${unboundAssets.slice(0, 4).join('、')}${unboundAssets.length > 4 ? '…' : ''}`));
  checks.push(missingAssetInputLineage.length === 0
    ? check('asset-input-lineage', '资产生成输入世系', 'pass', '生成资产均保留提示词、引擎、参考图和参数指纹')
    : check('asset-input-lineage', '资产生成输入世系', 'blocked', `缺少生成输入指纹：${missingAssetInputLineage.slice(0, 4).join('、')}${missingAssetInputLineage.length > 4 ? '…' : ''}；请重新生成或重新导入`));
  checks.push(missingPrompts.length === 0
    ? check('shot-prompts', '视频提示词', 'pass', `已准备 ${shots.length} 镜`)
    : check('shot-prompts', '视频提示词', 'warn', `缺少：${missingPrompts.join('、')}`));
  checks.push(characterHandoffIssues.length === 0 && missingCharacterHandoffs.length === 0
    ? check('character-continuity', '跨集人物连续性', 'pass', crossEpisodeCharacters.length === 0 ? '当前项目没有跨集人物引用' : '所有跨集人物均有显式状态 handoff')
    : check('character-continuity', '跨集人物连续性', 'blocked', [
      missingCharacterHandoffs.length > 0 ? `缺少 handoff：${missingCharacterHandoffs.join('、')}` : '',
      ...characterHandoffIssues.slice(0, 3).map((issue) => issue.message),
    ].filter(Boolean).join('；')));
  checks.push(episodeContinuityIssues.length === 0
    ? check('episode-continuity', '跨镜头连续性', 'pass', '时间轴、相机和道具状态在显式继承镜头间连续')
    : check('episode-continuity', '跨镜头连续性', 'blocked', episodeContinuityIssues.slice(0, 5).map((issue) => `${issue.shotNo}：${issue.message}`).join('；')));
  checks.push(missingVideos.length === 0
    ? check('video-output', '视频产物', 'pass', `已生成 ${shots.length} 段`)
    : check('video-output', '视频产物', 'warn', `待生成：${missingVideos.join('、')}`));
  checks.push(unreviewedBoundaryFrames.length === 0
    ? check('boundary-frame-quality', '首尾帧多模态审核', 'pass', '已有首尾帧均通过当前输入签名对应的质量审核')
    : check('boundary-frame-quality', '首尾帧多模态审核', 'blocked', `未审核、审核失败或审核已过期：${unreviewedBoundaryFrames.join('、')}`));
  checks.push(options.videoQualityReviewRequired === false
    ? check('video-quality-review', '视频成片多模态终审', 'warn', '未启用 AI 终审；人工采用不等于 AI 审核通过')
    : unreviewedFinalVideos.length === 0
    ? check('video-quality-review', '视频成片多模态终审', 'pass', '正式视频均有与当前文件绑定的通过结果')
    : check('video-quality-review', '视频成片多模态终审', 'blocked', `未通过或审核结果与正式文件不匹配：${unreviewedFinalVideos.join('、')}`));
  checks.push(manualQualityReviewShots.length === 0
    ? check('quality-manual-review', '质量异常人工复盘', 'pass', '没有超过自动重绘上限的镜头')
    : check('quality-manual-review', '质量异常人工复盘', 'blocked', `首尾帧已连续三次未通过，请复盘脚本、资产或空间设定：${manualQualityReviewShots.join('、')}`));
  checks.push(unboundVideos.length === 0
    ? check('video-binding', '视频评审绑定', 'pass', '每段正式视频都有当前候选指纹与评审收据')
    : check('video-binding', '视频评审绑定', 'blocked', `未绑定或已过期：${unboundVideos.join('、')}`));
  checks.push(missingCreativeReviewEvidence.length === 0
    ? check('creative-review-evidence', '创意评审证据', 'pass', '当前正式视频均记录连续性、视觉身份、表演和节奏评审')
    : check('creative-review-evidence', '创意评审证据', 'warn', `待补充结构化评审（${missingCreativeReviewEvidence.length} 镜）：${missingCreativeReviewEvidence.join('、')}`));
  checks.push(missingVideoInputLineage.length === 0
    ? check('video-input-lineage', '视频输入世系', 'pass', '每段正式视频都有提示词、参考素材和参数输入指纹')
    : check('video-input-lineage', '视频输入世系', 'blocked', `缺少输入指纹：${missingVideoInputLineage.join('、')}；请先核对历史候选与提交记录，无需直接重新生成`));
  checks.push(staleProductionPackets.length === 0
    ? check('production-packet', '视频提交输入包', 'pass', '每段正式视频都能回溯到最后一次实际提交的完整输入包')
    : check('production-packet', '视频提交输入包', 'blocked', `缺少或已过期：${staleProductionPackets.join('、')}`));
  checks.push(missingProductionRunMappings.length === 0
    ? check('production-run-mapping', '运行任务一对一映射', 'pass', '每段正式视频都绑定唯一 durable job 与 ProductionRun')
    : check('production-run-mapping', '运行任务一对一映射', 'blocked', `缺少或不一致：${missingProductionRunMappings.join('、')}`));
  checks.push(latestRender
    ? check('render-lineage', '渲染候选世系', currentRenderBinding ? 'pass' : 'blocked', currentRenderBinding ? `已绑定 ${latestRender.candidateId}` : `候选 ${latestRender.candidateId} 尚未完成当前评审绑定`)
    : check('render-lineage', '渲染候选世系', 'warn', '尚未产生正式渲染候选'));
  checks.push(missingRenderRunMapping
    ? check('render-run-mapping', '最终渲染运行映射', 'blocked', '最终 MP4 缺少成功的 render ProductionRun、job ID 或输入指纹')
    : check('render-run-mapping', '最终渲染运行映射', latestRender ? 'pass' : 'warn', latestRender ? '最终 MP4 可回溯到成功的 render ProductionRun' : '尚未产生最终渲染任务'));

  const status: ProductionAuditStatus = checks.some((item) => item.status === 'blocked')
    ? 'blocked'
    : checks.some((item) => item.status === 'warn')
      ? 'warn'
      : 'pass';
  return {
    status,
    checks,
    lineage: {
      scriptRevisionId: data.currentScriptRevisionId,
      renderCandidateId: latestRender?.candidateId,
      renderCandidateFingerprint: latestRender ? productionCandidateFingerprint(latestRender) : undefined,
      renderBindingId: data.renderProductionBinding?.candidateId,
      latestChangeAt: data.changelog.length > 0 ? data.changelog[data.changelog.length - 1].at : undefined,
    },
  };
}
