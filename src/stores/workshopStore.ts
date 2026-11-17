import { normalizeCharacterBibleRules } from '@/lib/workshop/bibleNormalization';
import { validateRef2vaSubmission } from '@/lib/workshop/h3Ref2vaPrompt';
import { changeWorkshopH3Task, resolveWorkshopH3Task } from '@/lib/workshop/h3InputMode';
import { reconcileCharacterIdentity, remapCharacterReferences } from '@/lib/workshop/characterIdentity';
import { buildAdBoundaryPrompt } from '@/lib/workshop/adBoundaryPrompt';
import { buildAssetPromptPlan } from '@/lib/workshop/assetPrompt';
import { adMaterialsError } from '@/lib/workshop/adMaterials';
import { migrateSingleSceneReferences } from '../lib/workshop/singleSceneMigration';
/**
 * workshopStore — 创作工坊状态（6 步流水线）。
 *
 * 文件为源 of truth：~/.gdream/aigc-memory/projects/<id>/workshop.json，
 * store 内存态 + debounce 800ms 自动落盘。生成走 canvasGen.runGeneration
 * （与画布共享 MAX 3 槽位队列），产物拷贝进项目 shots/ 目录。
 */
import { create } from 'zustand';
import { copyFile, createDir, exists, readBinaryFile, readTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import {
  type AigcProject,
  createProject,
  readProject,
  readProjectFile,
  writeProject,
  writeProjectFile,
} from '@/lib/aigc/projectStore';
import {
  type AssetCandidate,
  type AssetReviewReceipt,
  type AssetProductionBinding,
  type AudioCandidate,
  type GeneratedAudio,
  type PaletteColor,
  type WorkshopData,
  type WorkshopAssetKind,
  type WorkshopStepId,
  type WsCharacter,
  type WsNarrativeBeat,
  type WorkshopProjectBibles,
  type WsColorPalette,
  type WsProp,
  type WsScene,
  type WsShot,
  type ScriptRevision,
  type ScriptReviewReceipt,
  emptyWorkshopData,
  STEP_ORDER,
} from '@/lib/workshop/types';
import { runGeneration, abortCanvasTask } from '@/lib/canvasGen';
import { sglangH3TaskUsesBoundaryFrames, sglangH3TaskUsesReferenceAssets, type SglangH3Task } from '@/lib/canvasGen/sglangH3';
import { flushCanvasTaskPersistence, useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { restoreShotGenerationState, shotGenerationTask } from '@/lib/workshop/shotGenerationState';
import { adoptedVideoRecoveryCandidates } from '@/lib/workshop/adoptedVideoRecovery';
import { useSettingsStore } from '@/stores/settingsStore';
import { acceptedVideoTailPath, canInheritAcceptedVideoTail, inheritedStartFramePatch } from '@/lib/workshop/inheritedVideoFrame';
import { resolveExistingVideoFrames } from '@/lib/workshop/existingVideoFrames';
import { sanitizeMiniMaxH3Prompt } from '@/lib/workshop/h3PromptContract';
import type { RhtvParams } from '@/lib/rhtv/types';
import {
  ensureMidjourneyStyleReference,
  getMidjourneyStyle,
  resolveMidjourneyStyleParameters,
} from '@/lib/midjourney/styles';
import { MIDJOURNEY_DEFAULT_VERSION, normalizeMidjourneyVersion } from '@/lib/midjourney/prompt';
import {
  acceptProductionCandidate,
  type ProductionBinding,
  type ProductionCandidate,
  type ProductionReviewReceipt,
} from '@/lib/production/lifecycle';
import {
  buildColorPalettePrompt,
  buildPaletteUsagePrompt,
  ensureDefaultColorPalettes,
} from '@/lib/workshop/colorPalettes';
import {
  buildImageRefBindings,
  getBoundaryFrameBindings,
  buildVideoRefBindings,
  effectiveOpeningCharacterIds,
  numToCn,
  remapShotPromptRefs,
  shotReferenceSignature,
  validateShotReferenceBindings,
  storyboardBoardIsApproved,
  videoPromptForShot,
} from '@/lib/workshop/shotRefs';
import { DREAMINA_SEEDANCE_25_ENGINE_ID } from '@/lib/dreamina/video';
import { writeGlobalVideoPromptTemplate } from '@/lib/videoPrompt/prompt';
import {
  buildShotContinuityReferencePlan,
  buildPreviousTailContinuityPrompt,
  buildShotEndFramePrompt,
  buildShotStartFramePrompt,
  buildShotVideoContinuityPrompt,
  extractBoundaryFramePromptSegments,
  shouldUsePreviousTail,
  validateShotContinuityForGeneration,
  shotBoundaryFrameSignature,
  appendShotSoundIntent,
} from '@/lib/workshop/shotContinuity';
import { validateAudioPromptsAgainstShot } from '@/lib/workshop/narrativeGuard';
import { acceptVideoCandidate, videoCandidateFingerprint, videoCandidateMatchesProductionInput } from '@/lib/workshop/productionLifecycle';
import { isMiniMaxH3Model, projectMiniMaxH3Ref2vaCapabilities, projectProviderCapabilities } from '@/lib/workshop/providerCapabilities';
import { buildShotProductionPacket, normalizeShotProductionPacket } from '@/lib/workshop/productionPacket';
import { normalizeLegacyWorkshopData } from '@/lib/workshop/legacyMigration';
import { applyShotDeletionTombstones, patchShotById } from '@/lib/workshop/shotMutation';
import { createProductionRun, productionRunIdForJob, reconcileProductionRunsFromJobs, updateProductionRunStatus, type ProductionRun, type ProductionRunStatus } from '@/lib/production/run';
import { useRenderQueueStore } from '@/stores/renderQueueStore';
import { acceptAssetCandidate, assetBindingIsCurrent, assetCandidateFingerprint, assetInputFingerprint, assetReviewFingerprint } from '@/lib/workshop/assetLineage';
import { buildProductionAudit } from '@/lib/workshop/productionAudit';
import { reconcileGenerationStepState, reconcileWorkshopSteps } from '@/lib/workshop/stepStatus';
import { applyCreativeSpecUpdate } from '@/lib/workshop/creativeSpecUpdate';
import { validateEpisodeContinuity } from '@/lib/workshop/episodeContinuity';
import { appendQualityRepairPatch, boundaryFrameRedrawPlan, currentVideoQualityReview, qualityReviewerFingerprint, shouldRetryQualityReview, type QualityIssueCode } from '@/lib/workshop/qualityReview';
import { runQualityReview } from '@/lib/workshop/qualityReviewClient';
import { detectFfmpeg } from '@/lib/canvas/videoCompose';
import { invoke } from '@tauri-apps/api/tauri';
import {
  appendQualityLearningGuidance,
  emptyQualityLearning,
  removeQualityLearningRule as removeQualityLearningRuleState,
  removeQualityPromptExample as removeQualityPromptExampleState,
  updateQualityLearning,
} from '@/lib/workshop/qualityLearning';
import {
  imageReferenceIndexMap,
  imageReferenceProjectionPrompt,
  projectImageReferencesForProvider,
  remapImageReferenceMentions,
  type ImageReferenceProjection,
} from '@/lib/workshop/imageReferencePolicy';

export { getSceneReferencePaths } from '@/lib/workshop/shotRefs';

const WORKSHOP_FILE = 'workshop.json';
const boundaryFrameJobs = new Map<string, Promise<{ start: string; end: string }>>();
function cloneCandidates(
  candidates?: AssetCandidate[],
  fallback: { projectId?: string; shotNo?: string } = {},
): AssetCandidate[] | undefined {
  return candidates?.map((item) => ({
    ...item,
    productionPacket: normalizeShotProductionPacket(item.productionPacket, fallback),
  }));
}

function asArray<T>(items: T[] | null | undefined): T[] {
  return Array.isArray(items) ? items : [];
}

/**
 * Legacy `bibles.scene.rules` was written as a plain string and then indexed
 * during serialization, producing an array of single-character objects. That
 * is not a scene-rule list, so treat it as absent and let the current bibles
 * remain the source of truth instead of throwing at prompt-rewrite time.
 */
type SceneBibleRule = { sceneId: string; spatialLayout: string; lighting: string; palette: string; textureRules: string[] };

function normalizeSceneRules(value: unknown): SceneBibleRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rule): SceneBibleRule[] => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return [];
    const record = rule as Record<string, unknown>;
    const sceneId = typeof record.sceneId === 'string' ? record.sceneId : '';
    if (!sceneId) return [];
    return [{
      sceneId,
      spatialLayout: typeof record.spatialLayout === 'string' ? record.spatialLayout : '',
      lighting: typeof record.lighting === 'string' ? record.lighting : '',
      palette: typeof record.palette === 'string' ? record.palette : '',
      textureRules: Array.isArray(record.textureRules)
        ? record.textureRules.filter((item): item is string => typeof item === 'string')
        : [],
    }];
  });
}

function createShotId(projectId: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `shot-${projectId}-${random}`;
}

function ideaRevisionContent(data: WorkshopData): string {
  const episodes = (data.episodes ?? []).map((episode) => [
    `第${episode.no}集《${episode.title}》`,
    episode.synopsis ? `本集梗概：${episode.synopsis}` : '',
    episode.sceneList ? `场次：${episode.sceneList}` : '',
    episode.openingState ? `开场状态：${episode.openingState}` : '',
    episode.centralConflict ? `核心冲突：${episode.centralConflict}` : '',
    episode.climax ? `高潮：${episode.climax}` : '',
    episode.endingState ? `结尾状态：${episode.endingState}` : '',
    episode.script ? `详细剧本：\n${episode.script}` : '',
  ].filter(Boolean).join('\n'));
  return [data.synopsis ? `故事梗概：${data.synopsis}` : '', ...episodes]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

const SHOT_PLANNING_FIELDS: Array<keyof WsShot> = [
  'description',
  'dialogue',
  'sceneId',
  'durationSec',
  'narrativeBeat',
  'atomicAction',
  'shotPlanningMode',
  'continuityMode',
  'entryState',
  'exitState',
  'transitionPlan',
  'soundIntent',
  'characterIds',
  'propIds',
  'imagePrompt',
  'videoPrompt',
  'universalVideoPrompt',
  'seedance25VideoPrompt',
  'videoModel',
  'videoRatio',
  'videoPromptTemplate',
  'voiceCharacterIds',
];

function shotFieldEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createGenerationToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function invalidateShotProductionOutputs(shot: WsShot, clearAudio: boolean, markPromptStale = true): WsShot {
  const next: WsShot = {
    ...shot,
    videoStartFramePath: undefined,
    videoStartFrameInheritance: undefined,
    acceptedVideoTail: undefined,
    videoStartFramePrompt: undefined,
    videoStartFrameReferencePaths: undefined,
    videoStartFrameReferenceLabels: undefined,
    videoEndFramePath: undefined,
    videoEndFramePrompt: undefined,
    videoEndFrameReferencePaths: undefined,
    videoEndFrameReferenceLabels: undefined,
    videoBoundaryFrameSignature: undefined,
    boundaryFrameQualityReview: undefined,
    boundaryFrameQualityReviewSignature: undefined,
    videoQualityReview: undefined,
    qualityReviewRequiresManualReview: false,
    lastProductionPacket: undefined,
    videoPath: undefined,
    videoThumbPath: undefined,
    videoProductionBinding: undefined,
    promptNeedsRefresh: markPromptStale ? true : shot.promptNeedsRefresh,
    audioInjected: clearAudio ? false : shot.audioInjected,
    genError: undefined,
    genProgress: undefined,
    genTaskId: undefined,
    generationToken: createGenerationToken(),
    genStatus: shot.genStatus === 'queued' || shot.genStatus === 'generating' ? shot.genStatus : 'idle',
  };
  if (clearAudio) {
    next.generatedAudios = undefined;
    next.audioProductionBinding = undefined;
  }
  return next;
}

function invalidateChangedShotChains(nextShots: WsShot[], oldShots: WsShot[]): WsShot[] {
  const oldByIdOrNo = new Map(oldShots.map((shot) => [shot.id ?? shot.shotNo, shot]));
  const changed = new Set<number>();
  nextShots.forEach((shot, index) => {
    const old = oldByIdOrNo.get(shot.id ?? shot.shotNo);
    if (!old) return;
    if (SHOT_PLANNING_FIELDS.some((field) => !shotFieldEqual(old[field], shot[field]))) changed.add(index);
  });
  const affected = new Set<number>();
  for (const index of changed) {
    affected.add(index);
    for (let nextIndex = index + 1; nextIndex < nextShots.length; nextIndex++) {
      if (!shouldUsePreviousTail(nextShots[nextIndex], nextShots[nextIndex - 1])) break;
      affected.add(nextIndex);
    }
  }
  return nextShots.map((shot, index) => {
    if (!affected.has(index)) return shot;
    const old = oldByIdOrNo.get(shot.id ?? shot.shotNo);
    const clearAudio = Boolean(old && (!shotFieldEqual(old.dialogue, shot.dialogue)
      || !shotFieldEqual(old.characterIds, shot.characterIds)));
    const promptChanged = Boolean(old && (
      !shotFieldEqual(old.imagePrompt, shot.imagePrompt)
      || !shotFieldEqual(old.videoPrompt, shot.videoPrompt)
      || !shotFieldEqual(old.universalVideoPrompt, shot.universalVideoPrompt)
      || !shotFieldEqual(old.seedance25VideoPrompt, shot.seedance25VideoPrompt)
    ));
    return invalidateShotProductionOutputs(shot, clearAudio, !promptChanged);
  });
}

function ensureShotIds(shots: WsShot[], projectId: string): WsShot[] {
  const used = new Set<string>();
  return shots.map((shot) => {
    let id = shot.id;
    if (!id || used.has(id)) id = createShotId(projectId);
    used.add(id);
    return id === shot.id ? shot : { ...shot, id };
  });
}

async function computeAssetChecksum(path: string): Promise<string | undefined> {
  try {
    const bytes = new Uint8Array(await readBinaryFile(path));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

function applyAssetChecksum(data: WorkshopData, path: string, checksum: string): WorkshopData {
  const updateCandidates = (items: AssetCandidate[] | undefined) => items?.map((item) => (
    item.path === path && !item.checksum ? { ...item, checksum } : item
  ));
  const refreshAcceptance = <T extends {
    candidates?: AssetCandidate[];
    assetReviews?: AssetReviewReceipt[];
    assetProductionBinding?: AssetProductionBinding;
  }>(item: T): T => {
    const candidates = updateCandidates(item.candidates);
    if (!item.assetProductionBinding || !candidates) return { ...item, candidates };
    const selected = candidates.find((candidate) => candidate.path === item.assetProductionBinding?.path);
    if (!selected) return { ...item, candidates };
    const fingerprint = assetCandidateFingerprint(selected);
    const reviews = (item.assetReviews ?? []).map((review) => review.candidatePath === selected.path && review.verdict === 'accepted'
      ? { ...review, candidateFingerprint: fingerprint }
      : review);
    const review = reviews.find((candidateReview) => candidateReview.candidatePath === selected.path
      && candidateReview.verdict === 'accepted'
      && candidateReview.candidateFingerprint === fingerprint);
    return {
      ...item,
      candidates,
      assetReviews: reviews,
      assetProductionBinding: review
        ? { ...item.assetProductionBinding, candidateFingerprint: fingerprint, reviewFingerprint: assetReviewFingerprint(review) }
        : item.assetProductionBinding,
    };
  };
  return {
    ...data,
    characters: data.characters.map((item) => refreshAcceptance(item)),
    scenes: data.scenes.map((item) => refreshAcceptance(item)),
    props: (data.props ?? []).map((item) => refreshAcceptance(item)),
    colorPalettes: (data.colorPalettes ?? []).map((item) => refreshAcceptance(item)),
    shots: data.shots.map((shot) => ({
      ...shot,
      videoCandidates: shot.videoCandidates?.map((candidate) => (
        candidate.path === path && !candidate.checksum ? { ...candidate, checksum } : candidate
      )),
    })),
  };
}

type AssetLineageItem = {
  candidates?: AssetCandidate[];
  assetImagePath?: string;
  assetReviews?: AssetReviewReceipt[];
  assetProductionBinding?: AssetProductionBinding;
};

function acceptSelectedAsset<T extends AssetLineageItem>(item: T, path: string): T {
  const candidate = item.candidates?.find((value) => value.path === path);
  if (!candidate) return { ...item, assetImagePath: path };
  const accepted = acceptAssetCandidate({ candidates: [candidate], path });
  return {
    ...item,
    assetImagePath: path,
    assetReviews: [...(item.assetReviews ?? []).filter((review) => review.candidatePath !== path), accepted.review],
    assetProductionBinding: accepted.binding,
  };
}

function applyAssetSelectionReceipt(data: WorkshopData, kind: WorkshopAssetKind, id: string, path: string): WorkshopData {
  if (kind === 'character') return { ...data, characters: data.characters.map((item) => item.id === id ? acceptSelectedAsset(item, path) : item) };
  if (kind === 'scene') return { ...data, scenes: data.scenes.map((item) => item.id === id ? acceptSelectedAsset(item, path) : item) };
  if (kind === 'colorPalette') return { ...data, colorPalettes: (data.colorPalettes ?? []).map((item) => item.id === id ? acceptSelectedAsset(item, path) : item) };
  return { ...data, props: (data.props ?? []).map((item) => item.id === id ? acceptSelectedAsset(item, path) : item) };
}

function backfillAssetAcceptance<T extends AssetLineageItem>(item: T): T {
  if (!item.assetImagePath || item.assetProductionBinding) return item;
  return acceptSelectedAsset(item, item.assetImagePath);
}

function assetPathsMissingChecksum(data: WorkshopData): string[] {
  const paths = [
    ...data.characters.flatMap((item) => item.candidates ?? []),
    ...data.scenes.flatMap((item) => item.candidates ?? []),
    ...(data.props ?? []).flatMap((item) => item.candidates ?? []),
    ...(data.colorPalettes ?? []).flatMap((item) => item.candidates ?? []),
    ...data.shots.flatMap((shot) => shot.videoCandidates ?? []),
  ].filter((candidate) => candidate.path && !candidate.checksum && !/^https?:\/\//i.test(candidate.path)).map((candidate) => candidate.path);
  return [...new Set(paths)];
}

function shotsNeedIdMigration(shots: WsShot[]): boolean {
  const ids = shots.map((shot) => shot.id).filter(Boolean) as string[];
  return ids.length !== shots.length || new Set(ids).size !== ids.length;
}

function cloneWorkshopData(data: WorkshopData): WorkshopData {
  return {
    ...data,
    breakdownSourceEvidence: data.breakdownSourceEvidence
      ? [...data.breakdownSourceEvidence]
      : data.breakdownSourceEvidence,
    episodes: (data.episodes ?? []).map((item) => ({ ...item })),
    productionRuns: data.productionRuns?.map((run) => ({ ...run })),
    narrativeBeats: data.narrativeBeats?.map((beat) => ({
      ...beat,
      shotNos: beat.shotNos ? [...beat.shotNos] : beat.shotNos,
    })),
    characterHandoffs: data.characterHandoffs?.map((handoff) => ({
      ...handoff,
      shotIds: [...handoff.shotIds],
      visualHandoff: handoff.visualHandoff ? { ...handoff.visualHandoff } : handoff.visualHandoff,
      identityHandoff: handoff.identityHandoff ? { ...handoff.identityHandoff } : handoff.identityHandoff,
    })),
    directorReport: data.directorReport ? {
      ...data.directorReport,
      hook: { ...data.directorReport.hook, shotNos: [...data.directorReport.hook.shotNos] },
      informationProgression: { ...data.directorReport.informationProgression, shotNos: [...data.directorReport.informationProgression.shotNos] },
      escalation: { ...data.directorReport.escalation, shotNos: [...data.directorReport.escalation.shotNos] },
      // shotFocus 是后加的报告项；旧项目存档里不存在，必须保持向后兼容，
      // 否则克隆/读取会因 undefined.shotNos 抛出异常，令整个拆解页失去响应。
      shotFocus: data.directorReport.shotFocus
        ? { ...data.directorReport.shotFocus, shotNos: [...data.directorReport.shotFocus.shotNos] }
        : { status: 'warning', summary: '本报告生成于镜头重点检查加入之前，请重新拆解以刷新该检查。', shotNos: [] },
      shotDensity: { ...data.directorReport.shotDensity, shotNos: [...data.directorReport.shotDensity.shotNos] },
      soundIntent: { ...data.directorReport.soundIntent, shotNos: [...data.directorReport.soundIntent.shotNos] },
    } : data.directorReport,
    steps: { ...data.steps },
    changelog: (data.changelog ?? []).map((item) => ({ ...item })),
    characters: (data.characters ?? []).map((item) => ({
      ...item,
      lifecycleStages: item.lifecycleStages?.map((stage) => ({ ...stage })),
      candidates: cloneCandidates(item.candidates),
      assetReviews: item.assetReviews?.map((review) => ({ ...review })),
      assetProductionBinding: item.assetProductionBinding ? { ...item.assetProductionBinding } : undefined,
    })),
    scenes: (data.scenes ?? []).map((item) => ({
      ...item,
      selectedImagePaths: item.selectedImagePaths ? [...item.selectedImagePaths] : item.selectedImagePaths,
      candidates: cloneCandidates(item.candidates),
      assetReviews: item.assetReviews?.map((review) => ({ ...review })),
      assetProductionBinding: item.assetProductionBinding ? { ...item.assetProductionBinding } : undefined,
    })),
    props: (data.props ?? []).map((item) => ({
      ...item,
      candidates: cloneCandidates(item.candidates),
      assetReviews: item.assetReviews?.map((review) => ({ ...review })),
      assetProductionBinding: item.assetProductionBinding ? { ...item.assetProductionBinding } : undefined,
    })),
    colorPalettes: (data.colorPalettes ?? []).map((item) => ({
      ...item,
      colors: item.colors?.map((color) => ({ ...color })),
      candidates: cloneCandidates(item.candidates),
      assetReviews: item.assetReviews?.map((review) => ({ ...review })),
      assetProductionBinding: item.assetProductionBinding ? { ...item.assetProductionBinding } : undefined,
    })),
    shots: (data.shots ?? []).map((shot) => ({
      ...shot,
      characterIds: [...(shot.characterIds ?? [])],
      propIds: shot.propIds ? [...shot.propIds] : shot.propIds,
      sceneImagePaths: shot.sceneImagePaths ? [...shot.sceneImagePaths] : shot.sceneImagePaths,
      extraRefImages: shot.extraRefImages ? [...shot.extraRefImages] : shot.extraRefImages,
      transitionPlan: shot.transitionPlan ? { ...shot.transitionPlan } : shot.transitionPlan,
      actionTimeline: shot.actionTimeline ? { ...shot.actionTimeline, segments: shot.actionTimeline.segments.map((segment) => ({ ...segment })) } : shot.actionTimeline,
      videoStartFrameReferencePaths: shot.videoStartFrameReferencePaths ? [...shot.videoStartFrameReferencePaths] : shot.videoStartFrameReferencePaths,
      videoStartFrameReferenceLabels: shot.videoStartFrameReferenceLabels ? [...shot.videoStartFrameReferenceLabels] : shot.videoStartFrameReferenceLabels,
      videoEndFrameReferencePaths: shot.videoEndFrameReferencePaths ? [...shot.videoEndFrameReferencePaths] : shot.videoEndFrameReferencePaths,
      videoEndFrameReferenceLabels: shot.videoEndFrameReferenceLabels ? [...shot.videoEndFrameReferenceLabels] : shot.videoEndFrameReferenceLabels,
      videoCandidates: cloneCandidates(shot.videoCandidates, { projectId: data.projectId, shotNo: shot.shotNo }),
      videoReviews: shot.videoReviews?.map((review) => ({ ...review })),
      videoProductionBinding: shot.videoProductionBinding ? { ...shot.videoProductionBinding } : shot.videoProductionBinding,
      lastProductionPacket: normalizeShotProductionPacket(
        shot.lastProductionPacket,
        { projectId: data.projectId, shotNo: shot.shotNo },
      ),
      storyboardFrames: shot.storyboardFrames?.map((frame) => ({
        ...frame,
        refImagePaths: frame.refImagePaths ? [...frame.refImagePaths] : frame.refImagePaths,
        candidates: cloneCandidates(frame.candidates),
      })),
      storyboardBoards: shot.storyboardBoards?.map((board) => ({
        ...board,
        frameIds: asArray(board.frameIds),
      })),
      directorConstraintCard: shot.directorConstraintCard
        ? {
            ...shot.directorConstraintCard,
            candidates: cloneCandidates(shot.directorConstraintCard.candidates),
          }
        : undefined,
      voiceCharacterIds: [...(shot.voiceCharacterIds ?? [])],
      audioPrompts: shot.audioPrompts?.map((item) => ({ ...item })),
      generatedAudios: shot.generatedAudios?.map((item) => ({ ...item })),
      audioCandidates: shot.audioCandidates?.map((item) => ({ ...item })),
      audioReviews: shot.audioReviews?.map((item) => ({ ...item })),
      audioProductionBinding: shot.audioProductionBinding ? { ...shot.audioProductionBinding } : shot.audioProductionBinding,
    })),
    bibles: data.bibles
      ? {
          ...data.bibles,
          director: data.bibles.director ? {
            ...data.bibles.director,
            cameraRules: asArray(data.bibles.director.cameraRules),
            lightingRules: asArray(data.bibles.director.lightingRules),
            colorRules: asArray(data.bibles.director.colorRules),
            pacingRules: asArray(data.bibles.director.pacingRules),
            forbidden: asArray(data.bibles.director.forbidden),
          } : undefined,
          character: data.bibles.character ? (() => {
            const normalized = normalizeCharacterBibleRules(
              data.bibles.character.rules as unknown,
              data.characters ?? [],
              data.bibles.character.globalRules,
            );
            return {
              ...data.bibles.character,
              rules: normalized.rules,
              globalRules: normalized.globalRules,
            };
          })() : undefined,
          scene: data.bibles.scene ? {
            ...data.bibles.scene,
            // Persisted legacy values are validated as unknown at this boundary.
            rules: normalizeSceneRules(data.bibles.scene.rules as unknown),
            globalRules: asArray(data.bibles.scene.globalRules),
          } : undefined,
          continuity: data.bibles.continuity ? {
            ...data.bibles.continuity,
            lockedItems: asArray(data.bibles.continuity.lockedItems),
            blockingContinuity: asArray(data.bibles.continuity.blockingContinuity),
            referenceOrderRules: asArray(data.bibles.continuity.referenceOrderRules),
            costumeContinuity: asArray(data.bibles.continuity.costumeContinuity),
            propContinuity: asArray(data.bibles.continuity.propContinuity),
            lightingContinuity: asArray(data.bibles.continuity.lightingContinuity),
            editContinuity: asArray(data.bibles.continuity.editContinuity),
          } : undefined,
        }
      : data.bibles,
    style: data.style ? { ...data.style } : data.style,
  };
}

function shotRefContext(data: WorkshopData) {
  return {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
}

/**
 * 全局资产换图后同步所有受影响分镜。编号按资产语义身份重排，
 * 不再依赖旧文件路径碰运气；未受影响的分镜保持原引用，避免全表抖动。
 */
function reconcileAssetReferenceChange(oldData: WorkshopData, nextData: WorkshopData): WorkshopData {
  const oldCtx = shotRefContext(oldData);
  const nextCtx = shotRefContext(nextData);
  const shots = nextData.shots.map((nextShot) => {
    const oldShot = oldData.shots.find((shot) => (shot.id && shot.id === nextShot.id) || shot.shotNo === nextShot.shotNo);
    if (!oldShot) return nextShot;
    if (shotReferenceSignature(oldShot, oldCtx) === shotReferenceSignature(nextShot, nextCtx)) return nextShot;
    return {
      ...nextShot,
      ...remapShotPromptRefs(oldShot, nextShot, oldCtx, nextCtx),
      promptNeedsRefresh: true,
    };
  });
  return { ...nextData, shots };
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * 受影响分镜的引用字段反向补丁：只存 stripAssetFromShots 实际改动过的字段，
 * 未改动的字段不进 patch（undo 自然不碰）。undo 把被删项逐项合并回分镜当前值，
 * 不整组覆盖——删除后用户对同一分镜的后续编辑因此保留。
 */
interface ShotDeletePatch {
  /** 优先使用稳定身份；shotNo 仅用于兼容旧撤销记录。 */
  shotId?: string;
  shotNo: string;
  /** strip 清空了 sceneId 时记录旧值（即被删资产 id） */
  sceneId?: string;
  /** strip 从对应数组移除的 id 及原下标（恒为被删资产 id 一项） */
  characterIds?: RemovedId[];
  propIds?: RemovedId[];
  voiceCharacterIds?: RemovedId[];
  /** strip 按 characterId 匹配移除的配音条目（删除前拷贝） */
  audioPrompts?: WsShot['audioPrompts'];
  generatedAudios?: GeneratedAudio[];
  audioCandidates?: AudioCandidate[];
  /** strip 把它从 false/undefined 翻成 true 时记录 true 标记；undo 据此保守保持 true */
  promptNeedsRefresh?: boolean;
}

/** 被 strip 移除的 id 及其在原数组中的下标（undo 按原位插回，保持数组相对顺序） */
interface RemovedId {
  id: string;
  index: number;
}

interface LastDeleteBase {
  id: string;
  name: string;
  affectedShots: number;
  /** 被删资产在原数组中的下标（undo 按原位插回，越界则 push） */
  assetIndex: number;
  /** 每个受影响分镜的反向补丁（只含 strip 实际改动的字段） */
  shotPatches: ShotDeletePatch[];
}

/** 最近一次资产级联删除的局部反向补丁（内存态，可撤销一次，不落盘） */
type LastDelete =
  | (LastDeleteBase & { kind: 'character'; asset: WsCharacter })
  | (LastDeleteBase & { kind: 'scene'; asset: WsScene })
  | (LastDeleteBase & { kind: 'prop'; asset: WsProp });

/**
 * 级联清理资产引用：从所有分镜的 characterIds/propIds/voiceCharacterIds 剔除 id，
 * sceneId === id 的置空；配音数据 audioPrompts/generatedAudios/audioCandidates 按 characterId 匹配剔除。
 * 被清理且已有提示词的分镜标记 promptNeedsRefresh。
 * 同时返回每个受影响分镜的反向补丁（只含本次实际改动的字段），供 undoLastDelete 逐项合并。
 */
function stripAssetFromShots(shots: WsShot[], id: string): { shots: WsShot[]; affected: number; patches: ShotDeletePatch[] } {
  let affected = 0;
  const patches: ShotDeletePatch[] = [];
  const next = shots.map((shot) => {
    const inChars = shot.characterIds.includes(id);
    const inProps = shot.propIds?.includes(id) ?? false;
    const inVoices = shot.voiceCharacterIds?.includes(id) ?? false;
    const inScene = shot.sceneId === id;
    const inAudioPrompts = shot.audioPrompts?.some((a) => a.characterId === id) ?? false;
    const inGenAudios = shot.generatedAudios?.some((a) => a.characterId === id) ?? false;
    const inAudioCandidates = shot.audioCandidates?.some((a) => a.characterId === id) ?? false;
    if (!inChars && !inProps && !inVoices && !inScene && !inAudioPrompts && !inGenAudios && !inAudioCandidates) return shot;
    affected += 1;
    // 只记录本函数实际改动的字段；id 数组记录原下标供 undo 原位插回，拷贝移除的条目避免与 state 共享引用
    const patch: ShotDeletePatch = { shotId: shot.id, shotNo: shot.shotNo };
    if (inScene) patch.sceneId = id;
    if (inChars) patch.characterIds = [{ id, index: shot.characterIds.indexOf(id) }];
    if (inProps) patch.propIds = [{ id, index: shot.propIds!.indexOf(id) }];
    if (inVoices) patch.voiceCharacterIds = [{ id, index: shot.voiceCharacterIds!.indexOf(id) }];
    if (inAudioPrompts) {
      patch.audioPrompts = shot.audioPrompts!.filter((a) => a.characterId === id).map((a) => ({ ...a }));
    }
    if (inGenAudios) {
      patch.generatedAudios = shot.generatedAudios!.filter((a) => a.characterId === id).map((a) => ({ ...a }));
    }
    if (inAudioCandidates) {
      patch.audioCandidates = shot.audioCandidates!.filter((a) => a.characterId === id).map((a) => ({ ...a }));
    }
    const patched: WsShot = {
      ...shot,
      characterIds: inChars ? shot.characterIds.filter((c) => c !== id) : shot.characterIds,
      propIds: inProps ? shot.propIds!.filter((p) => p !== id) : shot.propIds,
      voiceCharacterIds: inVoices ? shot.voiceCharacterIds!.filter((c) => c !== id) : shot.voiceCharacterIds,
      sceneId: inScene ? undefined : shot.sceneId,
      audioPrompts: inAudioPrompts ? shot.audioPrompts!.filter((a) => a.characterId !== id) : shot.audioPrompts,
      generatedAudios: inGenAudios ? shot.generatedAudios!.filter((a) => a.characterId !== id) : shot.generatedAudios,
      audioCandidates: inAudioCandidates ? shot.audioCandidates!.filter((a) => a.characterId !== id) : shot.audioCandidates,
    };
    if (patched.imagePrompt || patched.videoPrompt) {
      // 仅从 false/undefined 翻成 true 才记录 true 标记，否则 patch 不存该字段（undo 不碰）
      if (!shot.promptNeedsRefresh) patch.promptNeedsRefresh = true;
      patched.promptNeedsRefresh = true;
    }
    patches.push(patch);
    return patched;
  });
  return { shots: next, affected, patches };
}

/** 按原位插回资产；下标越界时 clamp 到末尾（等价 push） */
function insertAt<T>(list: T[], item: T, index: number): T[] {
  const idx = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, idx), item, ...list.slice(idx)];
}

/**
 * 把被移除的 id 按原下标插回当前数组（insertAt clamp 到 min(原下标, 当前长度)，已存在则跳过；
 * 全部已存在时原样返回，保留原引用）。保持数组相对顺序——参考图编号 @图片N 按
 * characterIds/propIds 数组顺序生成，append 到末尾会改变编号对应关系。
 */
function mergeBackIds(current: string[] | undefined, removed: RemovedId[]): string[] {
  let next = current ?? [];
  for (const { id, index } of removed) {
    if (next.includes(id)) continue;
    next = insertAt(next, id, index);
  }
  return next;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface WorkshopState {
  project: AigcProject | null;
  data: WorkshopData | null;
  loading: boolean;
  ideaDraft: string;
  ideaAutoGenerate: boolean;

  openProject: (id: string) => Promise<void>;
  createAndOpen: (name: string) => Promise<void>;
  save: (strict?: boolean) => Promise<void>;
  commitNow: () => Promise<void>;
  reloadCurrent: () => Promise<void>;
  scheduleSave: () => void;
  close: () => void;
  setIdeaDraft: (idea: string) => void;
  requestIdeaGeneration: (idea: string) => void;
  clearIdeaGenerationRequest: () => void;

  setCurrentStep: (s: WorkshopStepId) => void;
  markStepStatus: (s: WorkshopStepId, status: 'pending' | 'in-progress' | 'done') => void;
  /** 从持久化产物统一重算步骤状态，不依赖步骤页面是否挂载。 */
  reconcileStepStates: () => void;
  restoreAdoptedVideoCandidatesFromCanvas: () => Promise<number>;
  /** 上游变更后把下游已完成步骤标 stale */
  invalidateDownstream: (from: WorkshopStepId) => void;
  logChange: (step: WorkshopStepId, summary: string) => void;

  setSynopsis: (text: string) => void;
  recordScriptRevision: (revision: Omit<ScriptRevision, 'id' | 'fingerprint' | 'createdAt'>) => void;
  activateScriptRevision: (revisionId: string) => void;
  recordScriptReview: (review: ScriptReviewReceipt) => void;
  clearScriptReview: () => void;
  setEpisodes: (eps: WorkshopData['episodes']) => void;
  setEpisodeScript: (episodeNo: string, patch: Partial<WorkshopData['episodes'][number]>) => boolean;
  setCreativeSpec: (spec: NonNullable<WorkshopData['creativeSpec']>) => void;
  setNarrativeBeats: (beats: WsNarrativeBeat[]) => void;
  upsertCharacters: (chars: WsCharacter[]) => void;
  removeCharacter: (id: string) => void;
  upsertScenes: (scenes: WsScene[]) => void;
  removeScene: (id: string) => void;
  upsertProps: (props: WsProp[]) => void;
  removeProp: (id: string) => void;
  /** 最近一次资产级联删除的局部反向补丁（内存态，可撤销一次，不落盘） */
  lastDelete: LastDelete | null;
  /** 撤销最近一次资产删除：资产按 assetIndex 插回原数组；受影响分镜把被删项逐项合并回当前值，不整组覆盖 */
  undoLastDelete: () => void;
  /** 删除前查询资产影响范围：shots=引用该资产的分镜数，voices=其中引用其音色的分镜数 */
  getAssetRefInfo: (kind: 'character' | 'scene' | 'prop', id: string) => { shots: number; voices: number; name: string };
  setShots: (shots: WsShot[], mode?: 'replace' | 'merge') => void;
  updateShot: (shotNo: string, patch: Partial<WsShot>) => void;
  refreshShotReferenceBindings: () => Promise<{ changed: number }>;
  updateShotById: (shotId: string, patch: Partial<WsShot>) => boolean;
  upsertProductionRun: (run: ProductionRun) => void;
  updateProductionRunStatus: (runId: string, status: ProductionRunStatus) => void;
  removeShot: (shotNo: string) => void;
  /** 写入资产提示词：engine='mj' 写 assetPromptMj，否则写 assetPrompt */
  setAssetPrompt: (kind: WorkshopAssetKind, id: string, prompt: string, engine?: 'gpt' | 'mj') => void;
  setAssetImage: (kind: WorkshopAssetKind, id: string, absPath: string) => void;
  /** 追加候选图（永不删除），select=true 时同时设为最终图 */
  addAssetCandidate: (kind: WorkshopAssetKind, id: string, candidate: AssetCandidate, select?: boolean) => void;
  /** 从候选集中选定最终图 */
  selectAssetCandidate: (kind: WorkshopAssetKind, id: string, path: string) => void;
  setSceneSelectedImages: (id: string, paths: string[]) => void;
  setShotSceneImages: (shotNo: string, paths?: string[], markRefresh?: boolean) => void;
  setAssetEngine: (kind: WorkshopAssetKind, id: string, engineId: string) => void;
  setAssetResolution: (kind: WorkshopAssetKind, id: string, resolution: string) => void;
  setAssetAspectRatio: (kind: WorkshopAssetKind, id: string, aspectRatio: string) => void;
  upsertColorPalette: (palette: WsColorPalette) => void;
  removeColorPalette: (id: string) => void;
  setGlobalColorPalette: (id?: string) => void;
  setColorPaletteUsagePrompt: (id: string, usagePrompt: string) => void;
  updateColorPaletteColors: (id: string, colors: PaletteColor[]) => void;
  setCharacterVoice: (characterId: string, voicePath: string, source: 'upload' | 'canvas' | 'tts', options?: { engineId: string; speaker?: string }) => void;
  removeCharacterVoice: (characterId: string) => void;
  setStyle: (style: WorkshopData['style']) => void;
  setBibles: (bibles: WorkshopProjectBibles) => void;
  /** 设置全局视频比例（分镜未单独设置时 fallback） */
  setVideoRatio: (ratio: string) => void;
  /** 设置全局视频模型（分镜未单独设置时 fallback） */
  getH3InputMode: () => SglangH3Task;
  setH3InputMode: (task: SglangH3Task) => void;
  setVideoModel: (model: string) => void;
  /** 设置全局视频提示词模板（分镜未单独设置时 fallback） */
  setVideoPromptTemplate: (template: 'legacy' | 'universal') => void;
  addRenderCandidate: (candidate: ProductionCandidate) => void;
  acceptRenderCandidate: (candidateId: string, expectedFingerprint: string, actor?: string, note?: string) => { review: ProductionReviewReceipt; binding: ProductionBinding };
  reconcileProductionRuns: (jobs: Array<{ id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' }>) => void;
  removeQualityLearningRule: (code: QualityIssueCode) => void;
  removeQualityPromptExample: (id: string) => void;
  resetQualityLearning: () => void;

  generateAsset: (kind: WorkshopAssetKind, id: string, engineId?: string) => Promise<void>;
  generateSceneVariants: (id: string) => Promise<void>;
  generateShot: (
    shotNo: string,
    kind: 'image' | 'video',
    options?: {
      skipPromptValidation?: boolean;
      forceBoundaryFrames?: boolean;
      boundaryFramesOnly?: boolean;
      boundaryFrameRole?: 'both' | 'start' | 'end';
    },
  ) => Promise<void>;
  generateAll: (kind: 'image' | 'video', onlyMissing?: boolean) => Promise<void>;
  /** 将视频候选原子绑定为当前正式视频。 */
  selectVideoCandidate: (shotNo: string, path: string, expectedFingerprint: string, review?: { note?: string; criteria?: import('@/lib/workshop/types').VideoReviewCriteria }) => void;
  cancelShot: (shotNo: string) => void;

  getStateSummary: () => string;
}

/** 把生成产物拷贝进项目目录，返回绝对路径 */
async function copyIntoProject(projectId: string, srcAbs: string, relDir: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = srcAbs.includes('.') ? srcAbs.slice(srcAbs.lastIndexOf('.')) : '';
  const rel = `.gdream/aigc-memory/projects/${projectId}/${relDir}`;
  await createDir(rel, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  const destRel = `${rel}/${baseName}${ext}`;
  await copyFile(srcAbs, destRel, { dir: BaseDirectory.Home });
  return `${home}${destRel}`;
}

/** Extract the actual last image of a completed shot for the next shot's start frame. */
async function extractVideoTailFrame(videoPath: string, projectId: string, shotNo: string, version: string | number = Date.now()): Promise<string | undefined> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) return undefined;
  const home = await homeDir();
  const relDir = `.gdream/aigc-memory/projects/${projectId}/shots`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  const output = `${home}${relDir}/${safeName(shotNo)}-video-tail-${version}.png`;
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const scan = await invoke<{ exit_code: number; stdout?: string; stderr?: string }>('execute_command', {
    command: `${ffmpeg} -hide_banner -i ${quote(videoPath)} -map 0:v:0 -vf showinfo -an -f null - 2>&1`,
    timeoutMs: 30000,
  });
  if (scan.exit_code !== 0) return undefined;
  const scanOutput = `${scan.stdout ?? ''}\n${scan.stderr ?? ''}`;
  const frameNumbers = [...scanOutput.matchAll(/\bn:\s*(\d+)/g)].map((match) => Number(match[1]));
  const lastFrame = frameNumbers.length > 0 ? frameNumbers[frameNumbers.length - 1] : undefined;
  if (lastFrame == null || !Number.isFinite(lastFrame)) return undefined;
  const result = await invoke<{ exit_code: number; stderr?: string }>('execute_command', {
    command: `${ffmpeg} -hide_banner -y -i ${quote(videoPath)} -map 0:v:0 -vf "select='eq(n,${lastFrame})'" -vsync 0 -frames:v 1 -q:v 2 ${quote(output)}`,
    timeoutMs: 30000,
  });
  return result.exit_code === 0 && await exists(output).catch(() => false) ? output : undefined;
}

/** 安全文件名（shotNo 可能含 ①②/中文） */
function safeName(s: string): string {
  return s.replace(/[^\w一-龥-]+/g, '_');
}

async function attachDefaultPaletteImages(data: WorkshopData): Promise<void> {
  const home = await homeDir();
  for (const p of data.colorPalettes ?? []) {
    if (p.source !== 'default' || p.assetImagePath) continue;
    const rel = `.gdream/default-palettes/${p.id}.png`;
    const ok = await exists(rel, { dir: BaseDirectory.Home }).catch(() => false);
    if (!ok) continue;
    const abs = `${home}${rel}`;
    p.assetImagePath = abs;
    p.candidates = p.candidates?.some((c) => c.path === abs)
      ? p.candidates
      : [...(p.candidates ?? []), { path: abs, source: 'default', prompt: p.assetPrompt, createdAt: p.createdAt || Date.now() }];
  }
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  project: null,
  data: null,
  loading: false,
  ideaDraft: '',
  ideaAutoGenerate: false,
  lastDelete: null,

  openProject: async (id) => {
    // 旧项目还有 800ms debounce 内未落盘的编辑时先 flush——否则定时器在
    // 新项目打开后才触发，save() 拿到的是新项目 state，旧项目最后一笔编辑丢失
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const prev = get();
      if (prev.project && prev.data) {
        await get().save().catch((err) => console.warn('[workshop] 切换项目前保存旧项目失败:', err));
      }
    }
    set({ loading: true });
    try {
      const project = await readProject(id);
      if (!project) return;
      const raw = await readProjectFile(id, WORKSHOP_FILE);
      const migration = normalizeLegacyWorkshopData(safeParse<WorkshopData>(raw), id);
      const data = migration.data;
      if (!data.h3InputMode) {
        data.h3InputMode = resolveWorkshopH3Task(data, useSettingsStore.getState().customVideoGenericH3Task);
        migration.changed = true;
      }
      // 旧项目只把运行映射写在镜头 packet 中；打开时一次性物化为项目级
      // ProductionRun，之后新的任务和恢复线程都会更新同一条记录。
      const existingRuns = new Map((data.productionRuns ?? []).map((run) => [run.runId, run]));
      for (const shot of data.shots ?? []) {
        const packets = [shot.lastProductionPacket, ...(shot.videoCandidates ?? []).map((candidate) => candidate.productionPacket)]
          .filter((packet): packet is NonNullable<typeof packet> => Boolean(packet));
        for (const packet of packets) {
          if (!packet.jobId || !packet.productionRunId || !packet.inputFingerprint) continue;
          if (existingRuns.has(packet.productionRunId)) continue;
          let run = createProductionRun({
            projectId: id,
            shotNo: shot.shotNo,
            kind: 'video',
            inputFingerprint: packet.inputFingerprint,
            jobId: packet.jobId,
            runId: packet.productionRunId,
            now: packet.createdAt,
          });
          const successful = (shot.videoCandidates ?? []).some((candidate) => candidate.productionPacket?.productionRunId === packet.productionRunId);
          if (successful) run = updateProductionRunStatus(run, 'succeeded', packet.createdAt);
          existingRuns.set(run.runId, run);
        }
      }
      data.productionRuns = [...existingRuns.values()];
      // 旧文件缺字段兜底
      if (!data.changelog) data.changelog = [];
      data.colorPalettes = ensureDefaultColorPalettes(data.colorPalettes);
      // 迁移：有 assetImagePath 但无 candidates 的补一条
      const backfill = <T extends WsCharacter | WsScene | WsProp>(item: T): T =>
        item.assetImagePath && !item.candidates?.length
          ? { ...item, candidates: [{ path: item.assetImagePath, source: 'upload' as const, createdAt: Date.now() }] }
          : item;
      const backfillPalette = (item: WsColorPalette): WsColorPalette =>
        item.assetImagePath && !item.candidates?.length
          ? { ...item, candidates: [{ path: item.assetImagePath, source: item.source === 'default' ? 'default' : 'upload', createdAt: item.createdAt || Date.now() }] }
          : item;
      data.characters = (data.characters ?? []).map(backfill);
      data.scenes = (data.scenes ?? []).map(backfill);
      data.props = (data.props ?? []).map(backfill);
      data.colorPalettes = data.colorPalettes.map(backfillPalette);
      await attachDefaultPaletteImages(data);
      data.characters = data.characters.map(backfillAssetAcceptance);
      data.scenes = data.scenes.map(backfillAssetAcceptance);
      data.props = data.props.map(backfillAssetAcceptance);
      data.colorPalettes = data.colorPalettes.map(backfillAssetAcceptance);
      const migratedSingleScenes = migrateSingleSceneReferences(data);
      const migrateShotIds = migration.changed || shotsNeedIdMigration(data.shots ?? []);
      data.shots = ensureShotIds((data.shots ?? []).map((s) => ({
        ...s,
        characterIds: s.characterIds ?? [],
        propIds: s.propIds ?? [],
        voiceCharacterIds: s.voiceCharacterIds ?? [],
        description: s.description ?? '',
      })), project.id);
      data.directorReport = undefined;
      if (migrateShotIds || migratedSingleScenes) {
        await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
      }
      // Reopening a project must retain live queue ownership, not erase its spinner.
      const home = await homeDir();
      for (const shot of data.shots) {
        const tasks = useCanvasTaskStore.getState().tasks;
        const ownedTask = shotGenerationTask(shot, project.id, tasks);
        Object.assign(shot, restoreShotGenerationState(shot, project.id, tasks));
        if (shot.genStatus === 'failed' && !ownedTask) {
          let fileFound = false;
          for (const p of [shot.imagePath, shot.videoStartFramePath, shot.videoEndFramePath, shot.videoPath]) {
            if (p) {
              try {
                const rel = p.startsWith(home) ? p.slice(home.length) : p;
                fileFound = await exists(rel, { dir: BaseDirectory.Home });
              } catch { /* ignore */ }
              if (fileFound) break;
            }
          }
          if (fileFound) {
            shot.genStatus = 'done';
            shot.genError = undefined;
          }
        }
      }
      data.productionRuns = reconcileProductionRunsFromJobs(data.productionRuns ?? [], useRenderQueueStore.getState().jobs);
      const reconciled = reconcileWorkshopSteps(data, project);
      const stepStateChanged = JSON.stringify(reconciled.steps) !== JSON.stringify(data.steps)
        || reconciled.currentStep !== data.currentStep;
      Object.assign(data, reconciled);
      const needsIdeaRevision = !project.sources?.length
        && !data.currentScriptRevisionId
        && Boolean(ideaRevisionContent(data));
      set({ project, data: cloneWorkshopData(data), ideaDraft: data.ideaDraft ?? '', ideaAutoGenerate: false, lastDelete: null });
      void get().restoreAdoptedVideoCandidatesFromCanvas();
      if (stepStateChanged) void writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
      // 兼容旧的 Idea 项目：此前 Idea 生成只写入拆解字段，没有创建
      // revision。打开项目时把已有规划补登记为正式 Idea revision，避免
      // 用户必须重新生成一遍故事才能继续。
      if (needsIdeaRevision) {
        const current = get().data;
        const content = current ? ideaRevisionContent(current) : '';
        if (content) {
          get().recordScriptRevision({ sourceNames: ['Idea 故事规划'], sourceKind: 'idea', content });
          get().markStepStatus('script', 'done');
          await get().commitNow();
        }
      }
      const checksumPaths = assetPathsMissingChecksum(data);
      if (checksumPaths.length > 0) {
        void Promise.all(checksumPaths.map(async (path) => [path, await computeAssetChecksum(path)] as const)).then((entries) => {
          const current = get().data;
          if (!current || current.projectId !== id) return;
          const next = entries.reduce((value, [path, checksum]) => (
            checksum ? applyAssetChecksum(value, path, checksum) : value
          ), current);
          if (next !== current) {
            set({ data: next });
            get().scheduleSave();
          }
        });
      }
    } finally {
      set({ loading: false });
    }
  },

  createAndOpen: async (name) => {
    set({ loading: true });
    try {
      const project = await createProject(name);
      const data = emptyWorkshopData(project.id);
      data.h3InputMode = 'ref2va';
      data.colorPalettes = ensureDefaultColorPalettes(data.colorPalettes);
      await attachDefaultPaletteImages(data);
      set({ project, data: cloneWorkshopData(data), ideaDraft: data.ideaDraft ?? '', ideaAutoGenerate: false, lastDelete: null });
      await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
    } finally {
      set({ loading: false });
    }
  },

  save: async (strict = false) => {
    const { project, data } = get();
    if (!project || !data) return;
    // 保险丝：state 读取时序异常时绝不把 A 项目数据写进 B 的 workshop.json
    if (data.projectId && data.projectId !== project.id) {
      console.error(`[workshop] save 中止：data.projectId(${data.projectId}) 与当前项目(${project.id})不符`);
      return;
    }
    await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2), strict && data.creativeSpec?.workKind === 'product-ad');
    // 回写 index 统计，记忆库项目列表共享
    const stats = {
      shots: data.shots.length,
      scenes: data.scenes.length,
      assets: data.characters.filter((c) => c.assetImagePath).length
        + data.scenes.filter((s) => s.assetImagePath).length
        + (data.colorPalettes ?? []).filter((p) => p.assetImagePath).length,
      videosCompleted: data.shots.filter((s) => s.videoPath).length,
    };
    await writeProject({ ...project, stats });
  },

  commitNow: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // 所有写入路径本身都做不可变更新。这里不再深拷贝整份项目：
    // 大项目下每次 Agent 工具提交都会让所有分镜、图片和提示词组件重渲染。
    // save 是纯数据落盘（workshop.json + 项目元数据），不等 requestAnimationFrame；
    // 期间每个 IPC await 都会让出事件循环，React 有机会提交帧。
    await get().save(true);
  },

  reloadCurrent: async () => {
    const { project } = get();
    if (!project) return;
    // 先 flush 内存里未落盘的编辑（800ms debounce 窗口），否则从磁盘读回
    // 旧数据会静默回滚用户刚才的修改
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await get().save().catch(() => {});
    }
    const raw = await readProjectFile(project.id, WORKSHOP_FILE);
    const parsed = safeParse<WorkshopData>(raw);
    if (!parsed) return;
    const identity = reconcileCharacterIdentity(parsed);
    const data = identity.data;
    data.projectId = project.id;
    if (!data.changelog) data.changelog = [];
    data.colorPalettes = ensureDefaultColorPalettes(data.colorPalettes);
    await attachDefaultPaletteImages(data);
    const migrateShotIds = shotsNeedIdMigration(data.shots ?? []);
    data.shots = ensureShotIds((data.shots ?? []).map((s) => ({
      ...s,
      characterIds: s.characterIds ?? [],
      propIds: s.propIds ?? [],
      voiceCharacterIds: s.voiceCharacterIds ?? [],
      description: s.description ?? '',
    })), project.id);
    data.shots = data.shots.map((shot) => restoreShotGenerationState(shot, project.id, useCanvasTaskStore.getState().tasks));
    data.directorReport = undefined;
    const reconciled = reconcileWorkshopSteps(data, project);
    const stepStateChanged = JSON.stringify(reconciled.steps) !== JSON.stringify(data.steps)
      || reconciled.currentStep !== data.currentStep;
    Object.assign(data, reconciled);
    if (migrateShotIds || stepStateChanged || identity.changed) {
      await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
    }
    set({ data: cloneWorkshopData(data), ideaDraft: data.ideaDraft ?? '' });
  },

  scheduleSave: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void get().save(); }, 800);
  },

  close: () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    void get().save();
    set({ project: null, data: null, ideaDraft: '', ideaAutoGenerate: false, lastDelete: null });
  },

  setIdeaDraft: (idea) => {
    const { data } = get();
    set({ ideaDraft: idea, ...(data ? { data: { ...data, ideaDraft: idea } } : {}) });
    if (data) get().scheduleSave();
  },
  requestIdeaGeneration: (idea) => {
    get().setIdeaDraft(idea);
    set({ ideaAutoGenerate: true });
  },
  clearIdeaGenerationRequest: () => set({ ideaAutoGenerate: false }),

  setCurrentStep: (s) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, currentStep: s } });
    get().scheduleSave();
  },

  markStepStatus: (s, status) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        steps: { ...data.steps, [s]: { ...data.steps[s], status, updatedAt: Date.now() } },
      },
    });
    get().scheduleSave();
  },

  reconcileStepStates: () => {
    const { data, project } = get();
    if (!data) return;
    const next = reconcileWorkshopSteps(data, project);
    if (next.currentStep === data.currentStep
      && JSON.stringify(next.steps) === JSON.stringify(data.steps)) return;
    set({ data: next });
    get().scheduleSave();
  },

  restoreAdoptedVideoCandidatesFromCanvas: async () => {
    const snapshot = get().data;
    if (!snapshot?.canvasProjectId || !/^[\w-]+$/.test(snapshot.canvasProjectId)
      || !snapshot.shots.some((shot) => shot.videoPath && shot.videoProductionBinding
        && !shot.videoCandidates?.some((candidate) => candidate.path === shot.videoPath))) return 0;
    try {
      const raw = await readTextFile(`.gdream/projects/${snapshot.canvasProjectId}/canvas.json`, { dir: BaseDirectory.Home });
      const canvas = JSON.parse(raw);
      if (!Array.isArray(canvas?.nodes)) return 0;
      const candidates = adoptedVideoRecoveryCandidates(snapshot, canvas.nodes);
      const checksums = new Map(await Promise.all(candidates.map(async ({ candidate }) => (
        [candidate.path, await computeAssetChecksum(candidate.path)] as const
      ))));
      const current = get().data;
      if (!current || current.projectId !== snapshot.projectId || current.canvasProjectId !== snapshot.canvasProjectId) return 0;
      const verified = adoptedVideoRecoveryCandidates(current, canvas.nodes)
        .filter(({ candidate }) => checksums.get(candidate.path) === candidate.checksum);
      for (const { shotNo, candidate } of verified) {
        const shot = get().data!.shots.find((item) => item.shotNo === shotNo)!;
        get().updateShot(shotNo, { videoCandidates: [...(shot.videoCandidates ?? []), candidate] });
      }
      if (verified.length) await get().commitNow();
      return verified.length;
    } catch {
      // Unverifiable or unavailable evidence remains visible as an audit blocker.
      return 0;
    }
  },

  invalidateDownstream: (from) => {
    const { data } = get();
    if (!data) return;
    const fromIdx = STEP_ORDER.indexOf(from);
    const steps = { ...data.steps };
    for (const id of STEP_ORDER.slice(fromIdx + 1)) {
      if (steps[id].status === 'done') {
        steps[id] = { ...steps[id], status: 'stale', updatedAt: Date.now() };
      }
    }
    set({ data: { ...data, steps } });
    get().scheduleSave();
  },

  logChange: (step, summary) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        changelog: [...data.changelog.slice(-99), { at: Date.now(), step, summary }],
      },
    });
    get().scheduleSave();
  },

  removeQualityLearningRule: (code) => {
    const { data } = get();
    if (!data) return;
    const qualityLearning = removeQualityLearningRuleState(data.qualityLearning, code);
    if (qualityLearning === data.qualityLearning) return;
    set({ data: { ...data, qualityLearning } });
    get().logChange('handoff', `删除质量规避规则：${code}`);
  },

  removeQualityPromptExample: (id) => {
    const { data } = get();
    if (!data) return;
    const qualityLearning = removeQualityPromptExampleState(data.qualityLearning, id);
    if (qualityLearning === data.qualityLearning) return;
    set({ data: { ...data, qualityLearning } });
    get().logChange('handoff', '删除一条高分提示词样例');
  },

  resetQualityLearning: () => {
    const { data } = get();
    if (!data) return;
    if (!(data.qualityLearning?.avoidanceRules.length || data.qualityLearning?.highScorePrompts.length)) return;
    set({ data: { ...data, qualityLearning: emptyQualityLearning() } });
    get().logChange('handoff', '重置项目质量学习记录');
  },

  setSynopsis: (text) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, synopsis: text } });
    get().invalidateDownstream('breakdown');
  },

  recordScriptRevision: (revision) => {
    const { data } = get();
    if (!data) return;
    const source = [revision.sourceKind, ...revision.sourceNames, revision.content ?? ''].join('|');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const id = `script-revision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next = {
      ...revision,
      id,
      fingerprint: `script-${(hash >>> 0).toString(36)}`,
      createdAt: Date.now(),
      sourceNames: [...revision.sourceNames],
    };
    const shots = data.shots.map((shot) => invalidateShotProductionOutputs({ ...shot, planningReview: undefined }, true));
    set({
      data: {
        ...data,
        scriptRevisions: [...(data.scriptRevisions ?? []), next],
        currentScriptRevisionId: id,
        scriptReview: undefined,
        shots,
      },
    });
    get().invalidateDownstream('script');
    get().logChange('script', `切换剧本 revision：${next.fingerprint}`);
    get().scheduleSave();
  },

  activateScriptRevision: (revisionId) => {
    const { data } = get();
    if (!data || revisionId === data.currentScriptRevisionId) return;
    const revision = (data.scriptRevisions ?? []).find((item) => item.id === revisionId);
    if (!revision) return;
    const shots = data.shots.map((shot) => invalidateShotProductionOutputs({ ...shot, planningReview: undefined }, true));
    set({
      data: {
        ...data,
        currentScriptRevisionId: revision.id,
        scriptReview: undefined,
        shots,
      },
    });
    get().invalidateDownstream('script');
    get().logChange('script', `切换当前剧本 revision：${revision.fingerprint}`);
    get().scheduleSave();
  },

  recordScriptReview: (review) => {
    const { data } = get();
    if (!data || review.revisionId !== data.currentScriptRevisionId) return;
    set({
      data: {
        ...data,
        scriptReview: { ...review, issues: [...review.issues] },
        steps: {
          ...data.steps,
          breakdown: { ...data.steps.breakdown, status: review.status === 'passed' ? 'in-progress' : 'stale', updatedAt: Date.now() },
        },
      },
    });
    get().scheduleSave();
  },

  clearScriptReview: () => {
    const { data } = get();
    if (!data?.scriptReview) return;
    set({ data: { ...data, scriptReview: undefined } });
    get().scheduleSave();
  },

  setEpisodes: (eps) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, episodes: eps } });
    get().invalidateDownstream('breakdown');
  },

  setEpisodeScript: (episodeNo, patch) => {
    const { data } = get();
    if (!data) return false;
    const index = data.episodes.findIndex((episode) => episode.no === episodeNo);
    if (index < 0) return false;
    const episodes = [...data.episodes];
    episodes[index] = { ...episodes[index], ...patch };
    set({ data: { ...data, episodes } });
    get().invalidateDownstream('breakdown');
    get().scheduleSave();
    return true;
  },

  setCreativeSpec: (creativeSpec) => {
    const { data } = get();
    if (!data) return;
    set({ data: reconcileAssetReferenceChange(data, applyCreativeSpecUpdate(data, creativeSpec)) });
    get().scheduleSave();
  },

  setNarrativeBeats: (beats) => {
    const { data } = get();
    if (!data) return;
    const previousBeats = data.narrativeBeats ?? [];
    const renamed = new Map<string, string>();
    for (const beat of previousBeats) {
      const nextBeat = beats.find((item) => item.id === beat.id);
      if (nextBeat && nextBeat.title.trim() && nextBeat.title !== beat.title) {
        renamed.set(`${beat.sceneId}|${beat.title}`, nextBeat.title.trim());
      }
    }
    const nextShots = data.shots.map((shot) => {
      const nextTitle = shot.sceneId && shot.narrativeBeat
        ? renamed.get(`${shot.sceneId}|${shot.narrativeBeat}`)
        : undefined;
      return nextTitle ? { ...shot, narrativeBeat: nextTitle } : shot;
    });
    set({
      data: {
        ...data,
        shots: nextShots,
        narrativeBeats: beats.map((beat) => ({
          ...beat,
          shotNos: beat.shotNos ? [...beat.shotNos] : beat.shotNos,
        })),
        steps: {
          ...data.steps,
          breakdown: { ...data.steps.breakdown, status: 'in-progress', updatedAt: Date.now() },
        },
      },
    });
    get().invalidateDownstream('breakdown');
    get().scheduleSave();
  },

  upsertCharacters: (chars) => {
    const { data } = get();
    if (!data) return;
    set({ data: reconcileCharacterIdentity(data, chars).data });
    get().scheduleSave();
  },

  removeCharacter: (id) => {
    const { data } = get();
    if (!data) return;
    const assetIndex = data.characters.findIndex((c) => c.id === id);
    if (assetIndex < 0) return;
    const target = data.characters[assetIndex];
    // 只存局部反向补丁（资产 + 受影响分镜的引用字段），undo 不覆盖用户后续编辑
    const { shots, affected, patches } = stripAssetFromShots(data.shots, id);
    set({
      data: { ...data, characters: data.characters.filter((c) => c.id !== id), shots },
      lastDelete: { kind: 'character', id, name: target.name, affectedShots: affected, asset: target, assetIndex, shotPatches: patches },
    });
    get().scheduleSave();
  },

  upsertScenes: (scenes) => {
    const { data } = get();
    if (!data) return;
    const map = new Map(data.scenes.map((s) => [s.id, s]));
    for (const s of scenes) map.set(s.id, { ...map.get(s.id), ...s });
    set({ data: { ...data, scenes: [...map.values()] } });
    get().scheduleSave();
  },

  removeScene: (id) => {
    const { data } = get();
    if (!data) return;
    const assetIndex = data.scenes.findIndex((s) => s.id === id);
    if (assetIndex < 0) return;
    const target = data.scenes[assetIndex];
    // 只存局部反向补丁（资产 + 受影响分镜的引用字段），undo 不覆盖用户后续编辑
    const { shots, affected, patches } = stripAssetFromShots(data.shots, id);
    set({
      data: { ...data, scenes: data.scenes.filter((s) => s.id !== id), shots },
      lastDelete: { kind: 'scene', id, name: target.name, affectedShots: affected, asset: target, assetIndex, shotPatches: patches },
    });
    get().scheduleSave();
  },

  upsertProps: (props) => {
    const { data } = get();
    if (!data) return;
    const map = new Map((data.props ?? []).map((p) => [p.id, p]));
    for (const p of props) map.set(p.id, { ...map.get(p.id), ...p });
    set({ data: { ...data, props: [...map.values()] } });
    get().scheduleSave();
  },

  removeProp: (id) => {
    const { data } = get();
    if (!data) return;
    const assetIndex = (data.props ?? []).findIndex((p) => p.id === id);
    if (assetIndex < 0) return;
    const target = (data.props ?? [])[assetIndex];
    // 只存局部反向补丁（资产 + 受影响分镜的引用字段），undo 不覆盖用户后续编辑
    const { shots, affected, patches } = stripAssetFromShots(data.shots, id);
    set({
      data: { ...data, props: (data.props ?? []).filter((p) => p.id !== id), shots },
      lastDelete: { kind: 'prop', id, name: target.name, affectedShots: affected, asset: target, assetIndex, shotPatches: patches },
    });
    get().scheduleSave();
  },

  undoLastDelete: () => {
    const { data, lastDelete } = get();
    if (!data || !lastDelete) return;
    // 逐字段把被删项合并回分镜当前值（不整组覆盖）：删除后用户对同一分镜的后续编辑保留
    const patchById = new Map(lastDelete.shotPatches.filter((p) => p.shotId).map((p) => [p.shotId!, p]));
    const legacyPatchByShotNo = new Map(lastDelete.shotPatches.filter((p) => !p.shotId).map((p) => [p.shotNo, p]));
    const shots = data.shots.map((shot) => {
      const patch = (shot.id ? patchById.get(shot.id) : undefined) ?? legacyPatchByShotNo.get(shot.shotNo);
      if (!patch) return shot; // 分镜已被删或不受影响，跳过
      const merged: WsShot = { ...shot };
      // string[]：被删 id 不在当前数组才按原下标插回（保持参考图编号顺序），用户后续新增的其他 id 保留
      if (patch.characterIds) merged.characterIds = mergeBackIds(shot.characterIds, patch.characterIds);
      if (patch.propIds) merged.propIds = mergeBackIds(shot.propIds, patch.propIds);
      if (patch.voiceCharacterIds) merged.voiceCharacterIds = mergeBackIds(shot.voiceCharacterIds, patch.voiceCharacterIds);
      // sceneId：仅当分镜当前未另选场景时才恢复旧值；用户已另选则保留用户的
      if (patch.sceneId !== undefined && shot.sceneId === undefined) merged.sceneId = patch.sceneId;
      // 配音条目：按 characterId 去重加回；同角色已有新条目（用户重新生成）则跳过
      if (patch.audioPrompts) {
        const existing = new Set((shot.audioPrompts ?? []).map((a) => a.characterId));
        const back = patch.audioPrompts.filter((a) => !existing.has(a.characterId));
        if (back.length) merged.audioPrompts = [...(shot.audioPrompts ?? []), ...back.map((a) => ({ ...a }))];
      }
      if (patch.generatedAudios) {
        const existing = new Set((shot.generatedAudios ?? []).map((a) => a.characterId));
        const back = patch.generatedAudios.filter((a) => !existing.has(a.characterId));
        if (back.length) merged.generatedAudios = [...(shot.generatedAudios ?? []), ...back.map((a) => ({ ...a }))];
      }
      if (patch.audioCandidates) {
        const existing = new Set((shot.audioCandidates ?? []).map((a) => a.candidateId));
        const back = patch.audioCandidates.filter((a) => !existing.has(a.candidateId));
        if (back.length) merged.audioCandidates = [...(shot.audioCandidates ?? []), ...back.map((a) => ({ ...a }))];
      }
      // promptNeedsRefresh：不恢复删除前的旧值——若用户窗口期改过/重新生成过提示词，撤销资产后
      // 提示词再次失效。strip 翻转过的分镜保守置 true；patch 没存说明与本删除无关，不碰
      if (patch.promptNeedsRefresh) merged.promptNeedsRefresh = true;
      return merged;
    });
    const next: WorkshopData = { ...data, shots };
    // 资产按 assetIndex 插回原数组；同 id 已存在（窗口期内被重建）则不重复插入
    if (lastDelete.kind === 'character') {
      next.characters = data.characters.some((c) => c.id === lastDelete.id)
        ? data.characters
        : insertAt(data.characters, lastDelete.asset, lastDelete.assetIndex);
    } else if (lastDelete.kind === 'scene') {
      next.scenes = data.scenes.some((s) => s.id === lastDelete.id)
        ? data.scenes
        : insertAt(data.scenes, lastDelete.asset, lastDelete.assetIndex);
    } else {
      next.props = (data.props ?? []).some((p) => p.id === lastDelete.id)
        ? data.props
        : insertAt(data.props ?? [], lastDelete.asset, lastDelete.assetIndex);
    }
    set({ data: next, lastDelete: null });
    get().scheduleSave();
  },

  getAssetRefInfo: (kind, id) => {
    const { data } = get();
    if (!data) return { shots: 0, voices: 0, name: '' };
    const list = kind === 'character' ? data.characters : kind === 'scene' ? data.scenes : (data.props ?? []);
    const name = list.find((x) => x.id === id)?.name ?? '';
    let shots = 0;
    let voices = 0;
    for (const s of data.shots) {
      // 配音引用：voiceCharacterIds 音色资产 + audioPrompts/generatedAudios 配音数据（均按 characterId 匹配）
      const refVoice = (s.voiceCharacterIds?.includes(id) ?? false)
        || (s.audioPrompts?.some((a) => a.characterId === id) ?? false)
        || (s.generatedAudios?.some((a) => a.characterId === id) ?? false);
      const refVisual = s.sceneId === id || s.characterIds.includes(id) || (s.propIds?.includes(id) ?? false);
      if (refVisual || refVoice) shots += 1;
      if (refVoice) voices += 1;
    }
    return { shots, voices, name };
  },

  setShots: (shots, mode = 'replace') => {
    const { data } = get();
    if (!data) return;
    shots = remapCharacterReferences(shots, data.characterIdAliases);
    let next: WsShot[];
    if (mode === 'merge') {
      const map = new Map(data.shots.map((s) => [s.shotNo, s]));
      for (const s of shots) {
        const existing = map.get(s.shotNo);
        map.set(s.shotNo, {
          ...existing,
          ...s,
          id: s.id ?? existing?.id ?? createShotId(data.projectId),
          characterIds: s.characterIds ?? existing?.characterIds ?? [],
          voiceCharacterIds: s.voiceCharacterIds ?? existing?.voiceCharacterIds ?? [],
          sourceScriptRevisionId: s.sourceScriptRevisionId ?? existing?.sourceScriptRevisionId ?? data.currentScriptRevisionId,
        });
      }
      next = [...map.values()];
    } else {
      const oldByShotNo = new Map(data.shots.map((s) => [s.shotNo, s]));
      next = shots.map((s) => ({
        ...s,
        id: s.id ?? oldByShotNo.get(s.shotNo)?.id ?? createShotId(data.projectId),
        characterIds: s.characterIds ?? [],
        voiceCharacterIds: s.voiceCharacterIds ?? [],
        sourceScriptRevisionId: s.sourceScriptRevisionId ?? data.currentScriptRevisionId,
      }));
    }
    next = next.map(shot => ({...shot, productReferenceImages: data.creativeSpec?.workKind === 'product-ad' ? data.creativeSpec.adSpec?.productImages ?? [] : []}));
    const invalidated = invalidateChangedShotChains(ensureShotIds(next, data.projectId), data.shots);
    set({ data: { ...data, shots: invalidated, directorReport: undefined } });
    get().scheduleSave();
  },

  updateShot: (shotNo, patch) => {
    const { data } = get();
    if (!data) return;
    patch = remapCharacterReferences(patch, data.characterIdAliases);
    const touchesPlanning = SHOT_PLANNING_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    const nextShots = data.shots.map((s) => {
      if (s.shotNo !== shotNo) return s;
      const nextPatch = applyShotDeletionTombstones(s, patch);
      const effectiveModel = nextPatch.videoModel || s.videoModel || data.videoModel || '';
      const h3Task = get().getH3InputMode();
      const isH3Prompt = Boolean(
        nextPatch.universalVideoPrompt && (
          isMiniMaxH3Model(effectiveModel)
          || /\b(?:integrated_multimodal_description|subject_definitions|detailed_description|overall_soundscape|non_diegetic_music)\s*:/i.test(nextPatch.universalVideoPrompt)
        ),
      );
      return {
        ...s,
        ...nextPatch,
        ...(Object.prototype.hasOwnProperty.call(nextPatch, 'videoStartFramePath')
          && !Object.prototype.hasOwnProperty.call(nextPatch, 'videoStartFrameInheritance')
          ? { videoStartFrameInheritance: undefined } : {}),
        ...(isH3Prompt
          ? { universalVideoPrompt: sanitizeMiniMaxH3Prompt(nextPatch.universalVideoPrompt!, h3Task) }
          : {}),
      };
    });
    const invalidated = touchesPlanning ? invalidateChangedShotChains(nextShots, data.shots) : nextShots;
    set({
      data: {
        ...data,
        shots: invalidated,
        directorReport: undefined,
      },
    });
    get().scheduleSave();
  },

  refreshShotReferenceBindings: async () => {
    const { data } = get();
    if (!data) return { changed: 0 };
    let changed = 0;
    const ctx = { scenes: data.scenes, characters: data.characters, props: data.props ?? [], colorPalettes: data.colorPalettes ?? [], globalColorPaletteId: data.globalColorPaletteId };
    const shots = data.shots.map((shot) => {
      // characterIds represent physical opening entities, so resolve them from
      // entryState rather than later screen/broadcast mentions.
      const opening = shot.entryState?.characters ?? '';
      const physical = data.characters.filter((character) => {
        const tokens = (character.name ?? '').split(/[（(、，,；;\/]/u).map((x) => x.replace(/[）)]/gu, '').trim()).filter((x) => x.length >= 2);
        return tokens.some((token) => opening.includes(token));
      }).map((character) => character.id);
      const ids = physical.length > 0 ? [...new Set(physical)] : (shot.characterIds ?? []);
      const visibleIds = effectiveOpeningCharacterIds(shot, data.characters);
      const screenIds = visibleIds.filter((id) => !ids.includes(id));
      const factText = [shot.description, shot.entryState?.props, shot.exitState?.props].filter(Boolean).join(' ');
      const propMatches = (data.props ?? []).filter((prop) => {
        if (prop.id === 'prop-manuscript' && /夏至|设计稿|设计手稿|手稿/u.test(factText)) return true;
        const tokens = (prop.name ?? '').split(/[（(、，,；;\/]/u).map((x) => x.replace(/[）)]/gu, '').trim()).filter((x) => x.length >= 2);
        return tokens.some((token) => factText.includes(token) || (() => {
          const core = token.replace(/[系列手稿设计图纸]/gu, '');
          return core.length >= 2 && [...core].every((char) => factText.includes(char));
        })());
      }).map((prop) => prop.id);
      const propIds = propMatches.length > 0 ? [...new Set(propMatches)] : (shot.propIds ?? []);
      const extras = [...new Set(shot.extraRefImages ?? [])];
      const incidental = shot.entryState?.props?.trim() && propMatches.length === 0 ? [shot.entryState.props.trim()] : (shot.incidentalObjects ?? []);
      const next = {
        ...shot,
        characterIds: ids,
        physicalCharacterIds: ids,
        visibleCharacterIds: visibleIds,
        screenCharacterIds: screenIds,
        propIds,
        // An explicit subset (including []) is an authored reference choice,
        // not a request to add every named object back during refresh.
        assetPropIds: shot.assetPropIds ?? propIds,
        incidentalObjects: incidental,
        extraRefImages: extras,
        promptNeedsRefresh: true,
      };
      const remapped = remapShotPromptRefs(shot, next, ctx);
      if (JSON.stringify(ids) !== JSON.stringify(shot.characterIds ?? []) || JSON.stringify(propIds) !== JSON.stringify(shot.propIds ?? []) || remapped.imagePrompt !== shot.imagePrompt) changed += 1;
      return { ...next, ...remapped };
    });
    // Always write a fresh snapshot: reference numbering and UI thumbnails can
    // be stale even when the character ID array itself is unchanged.
    set({ data: { ...data, shots } });
    await get().commitNow();
    return { changed };
  },

  updateShotById: (shotId, patch) => {
    const { data } = get();
    if (!data) return false;
    const current = data.shots.find((shot) => shot.id === shotId);
    if (!current) return false;
    patch = applyShotDeletionTombstones(current, patch);
    const patched = patchShotById(data.shots, shotId, patch);
    if (!patched.applied) return false;
    const h3Task = get().getH3InputMode();
    const shotsWithCleanH3Prompts = patched.shots.map((shot) => {
      // Updating one shot must not reinterpret other shots' old-mode prompts.
      if (shot.id !== shotId || !Object.prototype.hasOwnProperty.call(patch, 'universalVideoPrompt')) return shot;
      const prompt = shot.universalVideoPrompt;
      const effectiveModel = shot.videoModel || data.videoModel || '';
      if (!prompt || (!isMiniMaxH3Model(effectiveModel) && !/\b(?:integrated_multimodal_description|subject_definitions|detailed_description|overall_soundscape|non_diegetic_music)\s*:/i.test(prompt))) {
        return shot;
      }
      return { ...shot, universalVideoPrompt: sanitizeMiniMaxH3Prompt(prompt, h3Task) };
    });
    const touchesPlanning = SHOT_PLANNING_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    const invalidated = touchesPlanning ? invalidateChangedShotChains(shotsWithCleanH3Prompts, data.shots) : shotsWithCleanH3Prompts;
    set({
      data: {
        ...data,
        shots: invalidated,
        directorReport: undefined,
      },
    });
    get().scheduleSave();
    return true;
  },

  upsertProductionRun: (run) => {
    const { data } = get();
    if (!data) return;
    const existing = data.productionRuns ?? [];
    const index = existing.findIndex((item) => item.runId === run.runId);
    const productionRuns = index < 0
      ? [...existing, { ...run }]
      : existing.map((item, itemIndex) => itemIndex === index ? { ...item, ...run } : item);
    set({ data: { ...data, productionRuns } });
    get().scheduleSave();
  },

  updateProductionRunStatus: (runId, status) => {
    const { data } = get();
    if (!data) return;
    const productionRuns = (data.productionRuns ?? []).map((run) => {
      if (run.runId !== runId) return run;
      try {
        return updateProductionRunStatus(run, status);
      } catch {
        return run;
      }
    });
    set({ data: { ...data, productionRuns } });
    get().scheduleSave();
  },

  reconcileProductionRuns: (jobs) => {
    const { data } = get();
    if (!data?.productionRuns?.length) return;
    const productionRuns = reconcileProductionRunsFromJobs(data.productionRuns, jobs);
    if (productionRuns.every((run, index) => run === data.productionRuns?.[index])) return;
    set({ data: { ...data, productionRuns } });
    get().scheduleSave();
  },

  removeShot: (shotNo) => {
    const { data } = get();
    if (!data) return;
    const invalidated = data.shots.filter((s) => s.shotNo !== shotNo);
    set({ data: { ...data, shots: invalidated, directorReport: undefined } });
    get().scheduleSave();
  },

  setAssetPrompt: (kind, id, prompt, engine = 'gpt') => {
    const { data } = get();
    if (!data) return;
    const key = engine === 'mj' ? 'assetPromptMj' as const : 'assetPrompt' as const;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, [key]: prompt } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, [key]: prompt } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetPrompt: prompt } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, [key]: prompt } : p) } });
    }
    get().scheduleSave();
  },

  setAssetImage: (kind, id, absPath) => {
    get().addAssetCandidate(kind, id, { path: absPath, source: 'upload', createdAt: Date.now() }, true);
  },

  addAssetCandidate: (kind, id, candidate, select = false) => {
    const { data } = get();
    if (!data) return;
    const normalizedCandidate: AssetCandidate = {
      ...candidate,
      candidateId: candidate.candidateId ?? `asset-${kind}-${id}-${candidate.createdAt}-${candidate.path}`,
    };
    const patch = <T extends AssetLineageItem>(item: T): T => {
      const candidates = item.candidates ?? [];
      const exists = candidates.some((c) => c.path === normalizedCandidate.path);
      const nextItem = {
        ...item,
        candidates: exists ? candidates : [...candidates, normalizedCandidate],
        ...(select ? { assetImagePath: normalizedCandidate.path } : {}),
      };
      return select ? acceptSelectedAsset(nextItem, normalizedCandidate.path) : nextItem;
    };
    let nextData: WorkshopData;
    if (kind === 'character') {
      nextData = { ...data, characters: data.characters.map((c) => c.id === id ? patch(c) as WsCharacter : c) };
    } else if (kind === 'scene') {
      const oldPath = data.scenes.find((scene) => scene.id === id)?.assetImagePath;
      nextData = {
        ...data,
        shots: select && oldPath && oldPath !== normalizedCandidate.path
          ? data.shots.map((shot) => shot.sceneId === id && shot.sceneImagePaths?.includes(oldPath)
            ? {
                ...shot,
                sceneImagePaths: shot.sceneImagePaths.map((path) => path === oldPath ? normalizedCandidate.path : path),
              }
            : shot)
          : data.shots,
        scenes: data.scenes.map((s) => s.id === id ? patch(s) as WsScene : s),
      };
    } else if (kind === 'colorPalette') {
      nextData = { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? patch(p) as WsColorPalette : p) };
    } else {
      nextData = { ...data, props: (data.props ?? []).map((p) => p.id === id ? patch(p) as WsProp : p) };
    }
    set({ data: select ? reconcileAssetReferenceChange(data, nextData) : nextData });
    if (select) {
      const d = get().data!;
      const allHaveImage =
        d.characters.every((c) => c.assetImagePath) &&
        d.scenes.every((s) => s.assetImagePath) &&
        (d.props ?? []).every((p) => p.assetImagePath);
      if (allHaveImage && d.steps.assets.status === 'in-progress') {
        get().markStepStatus('assets', 'done');
      }
      get().invalidateDownstream('assets');
    }
    else get().scheduleSave();
    if (!normalizedCandidate.checksum && normalizedCandidate.path && !/^https?:\/\//i.test(normalizedCandidate.path)) {
      void computeAssetChecksum(normalizedCandidate.path).then((checksum) => {
        if (!checksum) return;
        const current = get().data;
        if (!current) return;
        set({ data: applyAssetChecksum(current, normalizedCandidate.path, checksum) });
        get().scheduleSave();
      });
    }
  },

  selectAssetCandidate: (kind, id, path) => {
    const { data } = get();
    if (!data) return;
    let nextData: WorkshopData;
    if (kind === 'character') {
      nextData = { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetImagePath: path } : c) };
    } else if (kind === 'scene') {
      // 场景换图必须传播到已固化 sceneImagePaths 快照的分镜——快照存的是
      // 绝对路径值拷贝，不更新的话 getSceneReferencePaths 永远返回旧图，
      // 生成静默用过期场景（旧文件还在磁盘，无任何报错）。
      const oldPath = data.scenes.find((s) => s.id === id)?.assetImagePath;
      const shots = oldPath && oldPath !== path
        ? data.shots.map((shot) => {
            if (shot.sceneId !== id || !shot.sceneImagePaths?.includes(oldPath)) return shot;
            return {
              ...shot,
              sceneImagePaths: shot.sceneImagePaths.map((p) => (p === oldPath ? path : p)),
              promptNeedsRefresh: true,
            };
          })
        : data.shots;
      nextData = {
        ...data,
        shots,
        scenes: data.scenes.map((s) => s.id === id
          ? { ...s, assetImagePath: path }
          : s),
      };
    } else if (kind === 'colorPalette') {
      nextData = { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetImagePath: path } : p) };
    } else {
      nextData = { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetImagePath: path } : p) };
    }
    nextData = applyAssetSelectionReceipt(nextData, kind, id, path);
    set({ data: reconcileAssetReferenceChange(data, nextData) });
    get().invalidateDownstream('assets');
    const selectedCandidate = [
      ...(kind === 'character' ? data.characters : kind === 'scene' ? data.scenes : kind === 'colorPalette' ? data.colorPalettes ?? [] : data.props ?? []),
    ].find((item) => item.id === id)?.candidates?.find((candidate) => candidate.path === path);
    if (selectedCandidate && !selectedCandidate.checksum && !/^https?:\/\//i.test(path)) {
      void computeAssetChecksum(path).then((checksum) => {
        if (!checksum) return;
        const current = get().data;
        if (!current) return;
        set({ data: applyAssetChecksum(current, path, checksum) });
        get().scheduleSave();
      });
    }
  },

  setSceneSelectedImages: (id, paths) => {
    const { data } = get();
    if (!data) return;
    const clean = Array.from(new Set(paths.filter(Boolean)));
    const nextData: WorkshopData = {
      ...data,
      scenes: data.scenes.map((s) => s.id === id
        ? {
            ...s,
            selectedImagePaths: clean,
            sceneReferenceMode: clean.length > 0 ? 'multi' : undefined,
          }
        : s),
    };
    set({ data: reconcileAssetReferenceChange(data, nextData) });
    get().invalidateDownstream('assets');
  },

  setShotSceneImages: (shotNo, paths, markRefresh = true) => {
    const clean = paths ? Array.from(new Set(paths.filter(Boolean))) : undefined;
    const patch: Partial<WsShot> = {
      sceneImagePaths: clean,
      ...(markRefresh ? { promptNeedsRefresh: true } : {}),
    };
    get().updateShot(shotNo, patch);
  },

  setAssetEngine: (kind, id, engineId) => {
    const { data } = get();
    if (!data) return;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetEngine: engineId } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, assetEngine: engineId } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetEngine: engineId } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetEngine: engineId } : p) } });
    }
    get().scheduleSave();
  },

  setAssetResolution: (kind, id, resolution) => {
    const { data } = get();
    if (!data) return;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetResolution: resolution } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, assetResolution: resolution } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetResolution: resolution } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetResolution: resolution } : p) } });
    }
    get().scheduleSave();
  },

  setAssetAspectRatio: (kind, id, aspectRatio) => {
    const { data } = get();
    if (!data) return;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetAspectRatio: aspectRatio } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, assetAspectRatio: aspectRatio } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetAspectRatio: aspectRatio } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetAspectRatio: aspectRatio } : p) } });
    }
    get().scheduleSave();
  },

  upsertColorPalette: (palette) => {
    const { data } = get();
    if (!data) return;
    const exists = (data.colorPalettes ?? []).some((p) => p.id === palette.id);
    const normalized = {
      ...palette,
      assetPrompt: palette.assetPrompt ?? buildColorPalettePrompt(palette.name, palette.description ?? 'cinematic color system', palette.colors ?? []),
      usagePrompt: palette.usagePrompt ?? buildPaletteUsagePrompt(palette.name, palette.colors ?? []),
      assetEngine: palette.assetEngine ?? 'gpt-image-2',
      createdAt: palette.createdAt || Date.now(),
    };
    set({
      data: {
        ...data,
        colorPalettes: exists
          ? (data.colorPalettes ?? []).map((p) => p.id === palette.id ? { ...p, ...normalized } : p)
          : [...(data.colorPalettes ?? []), normalized],
      },
    });
    get().invalidateDownstream('assets');
  },

  removeColorPalette: (id) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        colorPalettes: (data.colorPalettes ?? []).filter((p) => p.id !== id),
        globalColorPaletteId: data.globalColorPaletteId === id ? undefined : data.globalColorPaletteId,
        shots: data.shots.map((s) => s.colorPaletteId === id ? { ...s, colorPaletteId: undefined } : s),
      },
    });
    get().invalidateDownstream('assets');
  },

  setGlobalColorPalette: (id) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, globalColorPaletteId: id || undefined } });
    get().invalidateDownstream('prompts');
  },

  setColorPaletteUsagePrompt: (id, usagePrompt) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, usagePrompt } : p) } });
    get().invalidateDownstream('prompts');
  },

  updateColorPaletteColors: (id, colors) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id
          ? {
              ...p,
              colors,
              assetPrompt: buildColorPalettePrompt(p.name, p.description ?? 'cinematic color system', colors),
              usagePrompt: buildPaletteUsagePrompt(p.name, colors),
            }
          : p),
      },
    });
    get().invalidateDownstream('assets');
  },

  setCharacterVoice: (characterId, voicePath, source, options) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        characters: data.characters.map((c) =>
          c.id === characterId ? { ...c, voicePath, voiceSource: source, voiceEngineId: options?.engineId, voiceSpeaker: options?.speaker } : c,
        ),
      },
    });
    get().scheduleSave();
  },

  removeCharacterVoice: (characterId) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        characters: data.characters.map((c) =>
          c.id === characterId ? { ...c, voicePath: undefined, voiceSource: undefined, voiceEngineId: undefined, voiceSpeaker: undefined } : c,
        ),
      },
    });
    get().scheduleSave();
  },

  setStyle: (style) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, style } });
    get().scheduleSave();
  },

  setBibles: (bibles) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, bibles } });
    get().logChange('breakdown', '更新项目四圣经');
  },

  setVideoRatio: (ratio) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, videoRatio: ratio || undefined } });
    get().scheduleSave();
  },

  getH3InputMode: () => resolveWorkshopH3Task(get().data, useSettingsStore.getState().customVideoGenericH3Task),

  setH3InputMode: (task) => {
    const { data } = get();
    if (!data) return;
    const next = changeWorkshopH3Task(data, task, get().getH3InputMode());
    if (next === data) return;
    set({ data: next });
    get().scheduleSave();
  },

  setVideoModel: (model) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, videoModel: model || undefined } });
    get().scheduleSave();
  },

  setVideoPromptTemplate: (template) => {
    const { data } = get();
    if (!data) return;
    writeGlobalVideoPromptTemplate(template);
    set({ data: { ...data, videoPromptTemplate: template } });
    get().scheduleSave();
  },

  addRenderCandidate: (candidate) => {
    if (candidate.kind !== 'render') throw new Error('只有 render candidate 可以写入工坊交付链');
    const { data } = get();
    if (!data) throw new Error('请先打开工坊项目');
    const candidates = (data.renderCandidates ?? []).filter((item) => item.candidateId !== candidate.candidateId);
    set({ data: { ...data, renderCandidates: [...candidates, candidate] } });
    get().scheduleSave();
  },

  acceptRenderCandidate: (candidateId, expectedFingerprint, actor, note) => {
    const { data } = get();
    if (!data) throw new Error('请先打开工坊项目');
    const accepted = acceptProductionCandidate({
      candidates: data.renderCandidates ?? [],
      candidateId,
      kind: 'render',
      expectedFingerprint,
      actor,
      note,
    });
    set({ data: {
      ...data,
      renderReviews: [...(data.renderReviews ?? []), accepted.review],
      renderProductionBinding: accepted.binding,
    } });
    get().scheduleSave();
    return accepted;
  },

  generateAsset: async (kind, id, engineId) => {
    const { project, data } = get();
    if (!project || !data) return;
    const adError = adMaterialsError(data.creativeSpec);
    if (adError) throw new Error(adError);
    const item = kind === 'character'
      ? data.characters.find((c) => c.id === id)
      : kind === 'scene'
        ? data.scenes.find((s) => s.id === id)
        : kind === 'colorPalette'
          ? (data.colorPalettes ?? []).find((p) => p.id === id)
          : (data.props ?? []).find((p) => p.id === id);
    if (!item) return;
    const engine = engineId ?? item.assetEngine ?? 'gpt-image-2';
    const isMj = engine.startsWith('midjourney');
    // 场景每次只生成一张空间母版；非场景资产保留主图一致性参考。
    // 先计算参考图，再把它交给共享提示词规划器，避免 UI 预览与实际请求分叉。
    const existingAssetReference = kind === 'scene' ? [] : (item.assetImagePath ? [item.assetImagePath] : []);
    const assetPromptPlan = await buildAssetPromptPlan({
      kind,
      item,
      engine,
      style: data.style,
      workKind: data.creativeSpec?.workKind,
      hasExistingReference: existingAssetReference.length > 0,
    });
    const prompt = assetPromptPlan.prompt;
    const imageResolution = item.assetResolution ?? '2k';
    const mjStyle = isMj ? getMidjourneyStyle(data.style?.midjourneyStyleId) : undefined;
    const mjVersion = normalizeMidjourneyVersion(
      data.style?.midjourneyVersion
      ?? mjStyle?.recommendedVersion
      ?? engine.match(/midjourney-(v?\d+(?:[.-]\d+)?)/i)?.[1]
      ?? MIDJOURNEY_DEFAULT_VERSION,
    );
    const resolvedMj = resolveMidjourneyStyleParameters(mjStyle, mjStyle?.creativityMode, {
      version: mjVersion,
      ...(data.style?.midjourneyStylize !== undefined ? { stylize: data.style.midjourneyStylize } : {}),
      ...(data.style?.midjourneyChaos !== undefined ? { chaos: data.style.midjourneyChaos } : {}),
      ...(data.style?.midjourneyRaw !== undefined ? { raw: data.style.midjourneyRaw } : {}),
      ...(data.style?.midjourneyStyleWeight !== undefined ? { styleWeight: data.style.midjourneyStyleWeight } : {}),
      ...(data.style?.midjourneyImageWeight !== undefined ? { imageWeight: data.style.midjourneyImageWeight } : {}),
      ...(data.style?.midjourneyWeird !== undefined ? { weird: data.style.midjourneyWeird } : {}),
      aspectRatio: item.assetAspectRatio ?? '16:9',
    });
    const mjStyleReference = isMj ? await ensureMidjourneyStyleReference(mjStyle) : undefined;
    const imageParams: RhtvParams = isMj
      ? {
          aspectRatio: resolvedMj.aspectRatio ?? '16:9',
          version: mjVersion,
          quality: '1',
          stylize: resolvedMj.stylize,
          chaos: resolvedMj.chaos,
          raw: resolvedMj.raw,
          iw: resolvedMj.imageWeight,
          sw: resolvedMj.styleWeight,
          weird: resolvedMj.weird,
          sv: 6,
          hd: false,
        }
      : { aspectRatio: item.assetAspectRatio ?? '16:9', resolution: imageResolution };
    const runAssetGeneration = (requestPrompt: string, referenceUrls = existingAssetReference) => runGeneration({
      engineId: engine,
      prompt: requestPrompt,
      referenceUrls: referenceUrls.length > 0 ? referenceUrls : undefined,
      styleReferenceUrls: mjStyleReference ? [mjStyleReference] : undefined,
      // 角色=三视图组合图（左正脸+右三视图）是宽幅构图
      params: imageParams,
    });
    const results = [await runAssetGeneration(prompt)];
    const assetGenerationInputFingerprint = assetInputFingerprint({
      kind,
      assetId: id,
      engineId: engine,
      prompt,
      referencePaths: [...existingAssetReference, ...(mjStyleReference ? [mjStyleReference] : [])],
      params: imageParams as unknown as Record<string, unknown>,
    });
    // 通道即使返回多张，也只采用第一张，不将批量结果误认为多视角。
    const resultPaths = results.filter((result) => result.success).flatMap((result) => result.resultPaths).slice(0, 1);
    const firstError = results.find((result) => result.error)?.error;
    if (resultPaths.length > 0) {
      // 资产刷新是直接替换：只采用第一张结果并清空旧候选，避免用户还要二次选择。
      // Copy failure must not lose a paid result — fall back to artifact path.
      const ts = Date.now();
      let dest = resultPaths[0];
      try {
        dest = await copyIntoProject(project.id, resultPaths[0], 'assets', `${kind}-${safeName(id)}-${ts}-0`);
      } catch (err) {
        console.warn('[workshop] 资产图入库失败，使用产物库路径:', err);
      }
      const replacement: AssetCandidate = {
        path: dest,
        source: 'generate',
        engineId: engine,
        prompt,
        inputFingerprint: assetGenerationInputFingerprint,
        createdAt: ts,
        candidateId: `asset-${kind}-${id}-${ts}-${dest}`,
      };
      // 先走统一选择逻辑，传播场景图路径到已绑定的分镜并使其提示词失效。
      get().addAssetCandidate(kind, id, replacement, true);
      const latest = get().data;
      if (latest) {
        const replaceCandidates = <T extends AssetLineageItem>(item: T): T => ({
          ...item,
          candidates: [replacement],
          assetImagePath: dest,
          ...(kind === 'scene' ? { selectedImagePaths: [dest], sceneReferenceMode: undefined } : {}),
        });
        const nextData: WorkshopData = kind === 'character'
          ? { ...latest, characters: latest.characters.map((item) => item.id === id ? replaceCandidates(item) as WsCharacter : item) }
          : kind === 'scene'
            ? {
                ...latest,
                // 更新场景和关联分镜，清掉旧多视角选择，但不删除历史图片文件。
                shots: latest.shots.map((shot) => shot.sceneId === id
                  ? { ...shot, sceneImagePaths: [dest], promptNeedsRefresh: true }
                  : shot),
                scenes: latest.scenes.map((item) => item.id === id ? replaceCandidates(item) as WsScene : item),
              }
            : kind === 'colorPalette'
              ? { ...latest, colorPalettes: (latest.colorPalettes ?? []).map((item) => item.id === id ? replaceCandidates(item) as WsColorPalette : item) }
              : { ...latest, props: (latest.props ?? []).map((item) => item.id === id ? replaceCandidates(item) as WsProp : item) };
        set({ data: nextData });
      }
      await get().commitNow();
    } else if (firstError) {
      throw new Error(firstError);
    }
  },

  generateSceneVariants: async (id) => {
    const { project, data } = get();
    if (!project || !data) return;
    const scene = data.scenes.find((s) => s.id === id);
    if (!scene?.assetImagePath) throw new Error('请先生成或上传一张场景默认图，再做场景迭代');
    // 统一走单图生成器，替换当前场景主图与关联分镜引用。
    await get().generateAsset('scene', id, scene.assetEngine ?? 'gpt-image-2');
  },

  generateShot: async (shotNo, kind, options) => {
    const { project, data } = get();
    if (!project || !data) return;
    const adError = adMaterialsError(data.creativeSpec);
    if (adError) throw new Error(adError);
    let shot = data.shots.find((s) => s.shotNo === shotNo);
    if (!shot) return;
    const pendingTask = shotGenerationTask(shot, project.id, useCanvasTaskStore.getState().tasks);
    if (pendingTask && pendingTask.status !== 'failed') {
      const { genStatus, genTaskId, genProgress, genError } = restoreShotGenerationState(shot, project.id, [pendingTask]);
      get().updateShot(shotNo, { genStatus, genTaskId, genProgress, genError });
      return;
    }
    // Drop unreadable reference paths immediately before generation so stale
    // files cannot reach the image provider. Reuse the shared remapper so
    // prompt numbering stays aligned with the submitted bindings.
    if (kind === 'image') {
      const readable = async (path: string) => /^(?:https?:|data:)/i.test(path) || await exists(path).catch(() => false);
      const staleExtras: string[] = [];
      for (const path of shot.extraRefImages ?? []) if (!path || !(await readable(path))) staleExtras.push(path);
      const staleScenes: string[] = [];
      for (const path of shot.sceneImagePaths ?? []) if (!path || !(await readable(path))) staleScenes.push(path);
      if (staleExtras.length || staleScenes.length) {
        const nextShot = {
          ...shot,
          extraRefImages: (shot.extraRefImages ?? []).filter((path) => !staleExtras.includes(path)),
          sceneImagePaths: shot.sceneImagePaths?.filter((path) => !staleScenes.includes(path)),
          promptNeedsRefresh: true,
        };
        const refRemap = remapShotPromptRefs(shot, nextShot, data);
        get().updateShot(shotNo, { ...refRemap, extraRefImages: nextShot.extraRefImages, sceneImagePaths: nextShot.sceneImagePaths, promptNeedsRefresh: true });
        shot = { ...nextShot, ...refRemap };
      }
    }
    if (data.currentScriptRevisionId && shot.sourceScriptRevisionId !== data.currentScriptRevisionId) {
      const message = `${shotNo} 来自旧剧本版本，当前剧本已更新；请先更新分镜后再生成。`;
      get().updateShot(shotNo, { genStatus: 'failed', genError: message, genTaskId: undefined, genProgress: undefined });
      return;
    }
    const continuityIssues = validateEpisodeContinuity(data.shots).filter((issue) => issue.shotNo === shotNo);
    if (continuityIssues.length) {
      const message = `生成已阻断：镜头连续性校验失败。\n${continuityIssues.map((issue) => `- ${issue.message}`).join('\n')}`;
      get().updateShot(shotNo, { genStatus: 'failed', genTaskId: undefined, genProgress: undefined, genError: message });
      return;
    }

    // 参考图顺序对齐提示词 referenceOrder：常规生成为场景参考组在前
    //（@图片一/二/三…），角色/道具随后按出场顺序继续编号。
    // 正式视频只有在故事板拼板的所有组成帧都已审核通过时才使用故事板板图；
    // 否则严格只提交镜头资产，避免未审核的策划产物污染模型输入。
    const refContext = {
      scenes: data.scenes,
      characters: data.characters,
      props: data.props ?? [],
      colorPalettes: data.colorPalettes ?? [],
      globalColorPaletteId: data.globalColorPaletteId,
    };
    const effectiveModel = shot.videoModel || data.videoModel || 'seedance-2.0';
    const isSeedance25 = kind === 'video' && effectiveModel === 'seedance-2.5';
    const h3TaskForRefs = kind === 'video'
      ? get().getH3InputMode()
      : undefined;
    const isH3Ref2va = kind === 'video' && isMiniMaxH3Model(effectiveModel) && h3TaskForRefs === 'ref2va';
    const requireApprovedStoryboardBoards = kind === 'video';
    const includeApprovedStoryboardBoards = kind === 'video'
      && !isSeedance25
      && !isH3Ref2va
      && (shot.storyboardBoards ?? []).some((board) => storyboardBoardIsApproved(shot, board));
    const refBindings = kind === 'video'
      ? buildVideoRefBindings(shot, refContext, {
          includeStoryboardBoards: includeApprovedStoryboardBoards,
          requireApprovedStoryboardBoards,
          includeDirectorConstraintCard: false,
        })
      : buildImageRefBindings(shot, refContext);
    const referenceErrors = validateShotReferenceBindings(shot, refBindings, refContext);
    if (referenceErrors.length) {
      const message = `生成已阻断：最终资产清单校验失败。\n${referenceErrors.map((error) => `- ${error}`).join('\n')}`;
      get().updateShot(shotNo, { genStatus: 'failed', genTaskId: undefined, genProgress: undefined, genError: message });
      return;
    }
    let refs = refBindings.map((ref) => ref.path);
    let refLabels = refBindings.map((ref) => ref.label);
    const paletteRefIndex = refBindings.find((ref) => ref.kind === 'palette')?.index ?? null;

    let audioRefs: string[] = [];
    const audioLabels: string[] = [];
    if (shot.audioInjected && shot.generatedAudios?.length) {
      for (const ga of shot.generatedAudios) {
        audioRefs.push(ga.trimmedPath || ga.path);
        audioLabels.push(ga.characterName);
      }
    } else {
      for (const cid of (shot.voiceCharacterIds ?? [])) {
        const c = data.characters.find((x) => x.id === cid);
        if (c?.voicePath) {
          audioRefs.push(c.voicePath);
          audioLabels.push(c.name);
        }
      }
    }
    if (kind === 'video' && shot.audioInjected && shot.generatedAudios?.length) {
      const audioPromptErrors = validateAudioPromptsAgainstShot({
        dialogue: shot.dialogue,
        characterIds: shot.characterIds,
        audioPrompts: shot.audioPrompts,
      });
      if (audioPromptErrors.length > 0) {
        get().updateShot(shotNo, {
          genStatus: 'failed',
          genTaskId: undefined,
          genProgress: undefined,
          genError: `视频生成已阻断：配音与剧本不一致。\n${audioPromptErrors.join('\n')}`,
        });
        return;
      }
    }

    const promptTemplate = 'universal';
    const prompt = kind === 'image'
      ? shot.imagePrompt
      : videoPromptForShot(shot, refContext, {
          template: promptTemplate,
          includeStoryboardBoards: includeApprovedStoryboardBoards,
          requireApprovedStoryboardBoards,
          includeDirectorConstraintCard: false,
          skipPlanningAugmentation: isMiniMaxH3Model(effectiveModel),
        });
    if (!prompt) {
      get().updateShot(shotNo, { genStatus: 'failed', genError: `缺少${kind === 'image' ? '生图' : '视频'}提示词，请先完成第④步` });
      return;
    }
    const paletteRefLabel = paletteRefIndex ? `@图片${numToCn(paletteRefIndex)}` : '';
    // 色卡图只要进了 refs 就必须在提示词里被 @图片N 点名（Seedance 校验按
    // refs.length 数）。但色卡是全局配色参考，只补一条末尾约束，避免每个镜头
    // 反复出现"画面配色严格参考..."。
    const promptWithPaletteRef = paletteRefLabel
      ? prompt.replace(/@色卡|色卡对应的@图片N|色卡对应的 @图片N/g, paletteRefLabel)
      : prompt;
    const paletteConstraint = kind === 'image'
      ? `画面配色严格参考 ${paletteRefLabel}（色卡），用于统一整体色彩。`
      : `全片画面配色严格参考 ${paletteRefLabel}（色卡），用于统一色彩风格。`;
    let finalPrompt = paletteRefLabel && !promptWithPaletteRef.includes(paletteRefLabel)
      ? `${promptWithPaletteRef}\n\n${paletteConstraint}`
      : promptWithPaletteRef;
    if (kind === 'video') finalPrompt = appendShotSoundIntent(finalPrompt, shot.soundIntent);
    if (kind === 'video') finalPrompt = appendQualityLearningGuidance(finalPrompt, data.qualityLearning);

    const effectiveRatio = shot.videoRatio || data.videoRatio;
    if (kind === 'video' && !effectiveRatio) {
      get().updateShot(shotNo, { genStatus: 'failed', genError: '请先在页面顶部设置全局视频比例，或在分镜单独选择比例' });
      return;
    }

    const isMini = effectiveModel === 'seedance-2.0-mini';
    // MiniMax H3 单端点多模态：有无参考图都用同一个引擎 id
    const isH3 = isMiniMaxH3Model(effectiveModel);
    const h3Task = isH3
      ? get().getH3InputMode()
      : undefined;
    if (kind === 'video' && isH3 && (shot.h3VideoPromptModeStale || (shot.h3VideoPromptTask && shot.h3VideoPromptTask !== h3Task))) {
      get().updateShot(shotNo, { genStatus: 'failed', genError: 'H3 输入方式已变化，请先按当前模式重写视频提示词；未提交视频生成。' });
      return;
    }
    // 万相 3.0 全能参考单端点：文生/图/视频/音频参考同引擎 id
    const isWan3 = effectiveModel === 'wan-3.0';
    const currentShotIndex = data.shots.findIndex((item) => item.shotNo === shotNo);
    const previousShot = currentShotIndex > 0 ? data.shots[currentShotIndex - 1] : undefined;
    const inheritsPrevious = shouldUsePreviousTail(shot, previousShot);
    if (kind === 'video' && isH3 && h3Task === 'ref2va') {
      const preflight = projectMiniMaxH3Ref2vaCapabilities({
        imageCount: refs.length + (inheritsPrevious && previousShot?.videoEndFramePath ? 1 : 0),
        audioCount: audioRefs.length,
        videoCount: 0,
      });
      if (!preflight.canSubmit) {
        get().updateShot(shotNo, {
          genStatus: 'idle',
          genTaskId: undefined,
          genProgress: preflight.summary,
          genError: undefined,
        });
        return;
      }
    }
    if (kind === 'video') {
      if (shot.promptNeedsRefresh) {
        // promptNeedsRefresh 是资产/分镜变更后的提示标记，不应单独阻断提交。
        // 上面的 videoPromptForShot 已按当前参考绑定重排 @图片编号。H3
        // 提交只读取已选帧，提示词变化不再触发隐式重绘。
        get().updateShot(shotNo, { promptNeedsRefresh: false });
      }
      const continuityErrors = validateShotContinuityForGeneration(shot, previousShot);
      if (continuityErrors.length > 0 && (!isH3 || h3Task === 'ref2va')) {
        get().updateShot(shotNo, {
          genStatus: 'failed',
          genTaskId: undefined,
          genProgress: undefined,
          genError: `视频生成已阻断：\n${continuityErrors.join('\n')}`,
        });
        return;
      }
    }
    const engineId = kind === 'image'
      ? 'gpt-image-2'
      : isSeedance25
        ? DREAMINA_SEEDANCE_25_ENGINE_ID
        : isH3
        ? 'minimax-hailuo-h3'
        : isWan3
          ? 'wan-3.0'
          : isMini
            ? (refs.length > 0 ? 'seedance-2.0-mini-i2v' : 'seedance-2.0-mini-t2v')
            : (refs.length > 0 ? 'seedance-2.0' : 'seedance-2.0-t2v');



    const generationToken = createGenerationToken();
    get().updateShot(shotNo, { genStatus: 'queued', genError: undefined, genTaskId: undefined, generationToken });
    await get().commitNow();
    // 跨项目守卫：生成中用户可能切换项目，shotNo（如"01-01"）在项目间高概率
    // 重复——所有 await 之后的回填必须确认还是发起时的项目，否则 A 的产物
    // 会写进 B 的同号分镜并落盘。不匹配时留给 useCanvasTaskRecovery 按
    // task.projectId 在切回后回填（该机制已存在）。
    const startProjectId = data.projectId;
    const sameProject = () => get().data?.projectId === startProjectId;
    const guardedUpdateShot = (no: string, patch: Partial<WsShot>) => {
      if (!sameProject()) {
        console.warn(`[workshop] 项目已切换（${startProjectId} → ${get().data?.projectId ?? 'none'}），跳过分镜 ${no} 回填，等待后台恢复`);
        return false;
      }
      const currentShot = get().data?.shots.find((item) => item.shotNo === no);
      if (currentShot?.generationToken !== generationToken) {
        console.warn(`[workshop] 分镜 ${no} 已进入新生成代次，跳过旧任务回填`);
        return false;
      }
      get().updateShot(no, patch);
      return true;
    };
    const recordQualityLearning = (review: import('@/lib/workshop/qualityReview').QualityReviewReport, reviewPrompt: string, reviewShotNo: string) => {
      const current = get().data;
      if (!current || current.projectId !== startProjectId) return false;
      set({
        data: {
          ...current,
          qualityLearning: updateQualityLearning({
            current: current.qualityLearning,
            report: review,
            prompt: reviewPrompt,
            shotNo: reviewShotNo,
          }),
        },
      });
      return true;
    };
    const updateBoundaryShot = (targetShot: WsShot, patch: Partial<WsShot>) => {
      if (!sameProject()) {
        console.warn(`[workshop] 项目已切换（${startProjectId} → ${get().data?.projectId ?? 'none'}），跳过边界帧回填 ${targetShot.shotNo}`);
        return false;
      }
      const currentTarget = get().data?.shots.find((item) => item.shotNo === targetShot.shotNo);
      if (!currentTarget) return false;
      if (targetShot.generationToken && currentTarget.generationToken !== targetShot.generationToken) {
        console.warn(`[workshop] 分镜 ${targetShot.shotNo} 已进入新生成代次，跳过旧边界帧回填`);
        return false;
      }
      get().updateShot(targetShot.shotNo, patch);
      return true;
    };
    const ensureBoundaryFrames = async (
      targetIndex: number,
      generateMissing: boolean,
      frameRole: 'both' | 'start' | 'end' = 'both',
    ): Promise<{ start: string; end: string }> => {
      const target = get().data?.shots[targetIndex];
      if (!target) throw new Error('无法定位连续性分镜');
      const jobKey = `${startProjectId}:${target.id ?? target.shotNo}`;
      const existingJob = boundaryFrameJobs.get(jobKey);
      if (existingJob) return existingJob;

      const job = (async () => {
        const latestTarget = get().data?.shots[targetIndex] ?? target;
        const previousShot = targetIndex > 0 ? get().data?.shots[targetIndex - 1] : undefined;
        const inheritsPrevious = shouldUsePreviousTail(latestTarget, previousShot);
        const previousVideoTail = inheritsPrevious && previousShot?.videoPath
          ? await extractVideoTailFrame(previousShot.videoPath, data.projectId, previousShot.shotNo, Date.now())
          : undefined;
        if (previousVideoTail && previousShot?.videoPath && get().data?.projectId === data.projectId
          && get().data?.shots.find(item => item.id === previousShot.id && item.shotNo === previousShot.shotNo)?.videoPath === previousShot.videoPath) {
          // Persist the extraction receipt independently of whichever planned end image is active.
          get().updateShot(previousShot.shotNo, { acceptedVideoTail: {
            videoPath: previousShot.videoPath, framePath: previousVideoTail, extractionId: previousVideoTail,
          } });
        }
        const previous = inheritsPrevious && !previousVideoTail
          ? await ensureBoundaryFrames(targetIndex - 1, true)
          : undefined;
        const targetBindings = getBoundaryFrameBindings(latestTarget, refContext);
        const targetVideoPrompt = videoPromptForShot(latestTarget, refContext, {
          template: 'universal',
          includeStoryboardBoards: false,
          requireApprovedStoryboardBoards: true,
          includeDirectorConstraintCard: false,
          skipPlanningAugmentation: isMiniMaxH3Model(latestTarget.videoModel || data.videoModel || 'seedance-2.0'),
        });
        if (!targetVideoPrompt.trim()) throw new Error(`${latestTarget.shotNo} 缺少视频提示词，无法生成首尾帧`);
        const targetVideoPromptWithLearning = appendQualityLearningGuidance(targetVideoPrompt, get().data?.qualityLearning);
        const boundarySegments = extractBoundaryFramePromptSegments(targetVideoPromptWithLearning);
        const boundaryAspectRatio = latestTarget.videoRatio || data.videoRatio || '16:9';
        const boundaryImageEngine = useSettingsStore.getState().chatImageModel || 'gpt-image-2';
        const assetReferenceInputs = targetBindings.map((binding) => ({
          path: binding.path,
          label: binding.label,
          kind: binding.kind === 'scene'
            || binding.kind === 'character'
            || binding.kind === 'prop'
            || binding.kind === 'extra'
            || binding.kind === 'palette'
            ? binding.kind
            : 'other' as const,
          sourceIndex: binding.index,
        }));
        const previousTailInput = (previousVideoTail || previous?.end)
          ? [{ path: previousVideoTail || previous!.end, label: '上一镜成片尾帧（跨镜连续性）', kind: 'previous-tail' as const }]
          : [];
        const startReferenceProjection = projectImageReferencesForProvider({
          engineId: boundaryImageEngine,
          references: [...assetReferenceInputs, ...previousTailInput],
        });
        const endReferenceProjection = projectImageReferencesForProvider({
          engineId: boundaryImageEngine,
          references: [
            { path: '__CURRENT_START_FRAME__', label: '当前镜首帧（最高优先级视觉主参考）', kind: 'start-frame', required: true },
            ...(data.creativeSpec?.workKind === 'product-ad' ? [] : [...assetReferenceInputs, ...previousTailInput]),
          ],
        });
        if (!startReferenceProjection.canSubmit || !endReferenceProjection.canSubmit) {
          throw new Error(`${latestTarget.shotNo} 首尾帧参考图配置超过生图模型能力：${!startReferenceProjection.canSubmit ? startReferenceProjection.summary : endReferenceProjection.summary}`);
        }
        const boundarySignature = shotBoundaryFrameSignature({
          videoPrompt: targetVideoPromptWithLearning,
          plannedStartFramePrompt: latestTarget.plannedStartFramePrompt,
          plannedEndFramePrompt: latestTarget.plannedEndFramePrompt,
          referencePaths: [
            ...startReferenceProjection.selected.map((item) => `start:${item.path}`),
            ...endReferenceProjection.selected.map((item) => `end:${item.path}`),
          ],
          previousTailPath: previousVideoTail || previous?.end,
          aspectRatio: boundaryAspectRatio,
          imageEngine: boundaryImageEngine,
        });
        const forceTargetBoundaryFrames = Boolean(options?.forceBoundaryFrames && targetIndex === currentShotIndex);
        const boundaryFramesCurrent = !forceTargetBoundaryFrames && frameRole === 'both'
          && latestTarget.videoBoundaryFrameSignature === boundarySignature;
        if (boundaryFramesCurrent && latestTarget.videoStartFramePath && latestTarget.videoEndFramePath) {
          return { start: latestTarget.videoStartFramePath, end: latestTarget.videoEndFramePath };
        }
        if (!generateMissing) {
          throw new Error(`${latestTarget.shotNo} 的首尾帧不存在或已因视频提示词、资产、比例变化而失效，请先点击“生成首尾帧”`);
        }
        if (frameRole === 'end' && !latestTarget.videoStartFramePath) {
          throw new Error(`${latestTarget.shotNo} 尚未生成首帧，无法单独生成尾帧；请先点击“生成首尾帧”`);
        }
        // H3 必须使用专用首帧。普通分镜图可能由其他比例生成，直接复用会导致
        // 首尾帧画幅不一致。多模态审核开启时，只有签名匹配且审核通过的帧对
        // 才能直接进入视频生成；失败后只重绘审核指出的边界帧，最多三次。
        const qualitySettings = useSettingsStore.getState();
        const qualityReviewEnabled = false;
        const maxReviewAttempts = qualitySettings.qualityReviewMaxFrameAttempts;
        const reviewerFingerprint = qualityReviewerFingerprint(
          qualitySettings.qualityReviewBaseUrl,
          qualitySettings.qualityReviewModel,
        );
        const existingReview = boundaryFramesCurrent
          && latestTarget.videoStartFramePath
          && latestTarget.videoEndFramePath
          && latestTarget.boundaryFrameQualityReviewSignature === boundarySignature
          && latestTarget.boundaryFrameQualityReview?.reviewerFingerprint === reviewerFingerprint
            ? latestTarget.boundaryFrameQualityReview
            : undefined;
        if (
          boundaryFramesCurrent
          && latestTarget.videoStartFramePath
          && latestTarget.videoEndFramePath
          && (!qualityReviewEnabled || existingReview?.passed)
        ) {
          return { start: latestTarget.videoStartFramePath, end: latestTarget.videoEndFramePath };
        }
        if (!generateMissing) {
          throw new Error(`${latestTarget.shotNo} 的首尾帧不存在、已失效或尚未通过质量审核，请先点击“生成首尾帧”`);
        }

        const remapBoundarySegments = (projection: ImageReferenceProjection) => {
          const indexMap = imageReferenceIndexMap(projection);
          return {
            start: remapImageReferenceMentions(boundarySegments.start, indexMap),
            end: remapImageReferenceMentions(boundarySegments.end, indexMap),
            timeline: remapImageReferenceMentions(boundarySegments.timeline, indexMap),
            spatialContext: remapImageReferenceMentions(boundarySegments.spatialContext, indexMap),
            cameraContext: remapImageReferenceMentions(boundarySegments.cameraContext, indexMap),
            endVerification: remapImageReferenceMentions(boundarySegments.endVerification, indexMap),
          };
        };

        const generateStartFrame = async (targetShot: WsShot, repairPatch: string): Promise<string> => {
          const submittedRefs = startReferenceProjection.selected;
          const remappedSegments = remapBoundarySegments(startReferenceProjection);
          const plannedFrameDescription = latestTarget.plannedStartFramePrompt?.trim()
            ? remapImageReferenceMentions(
                latestTarget.plannedStartFramePrompt.trim(),
                imageReferenceIndexMap(startReferenceProjection),
              )
            : remappedSegments.start;
          const previousTailIndex = submittedRefs.findIndex((item) => item.kind === 'previous-tail');
          updateBoundaryShot(targetShot, { genProgress: `正在生成 ${targetShot.shotNo} 首帧（参考图 ${submittedRefs.length}/${startReferenceProjection.requested.length}）…` });
          const basePrompt = buildShotStartFramePrompt({
            frameDescription: plannedFrameDescription,
            timelineDescription: remappedSegments.timeline,
            spatialContext: remappedSegments.spatialContext,
            cameraContext: remappedSegments.cameraContext,
            aspectRatio: boundaryAspectRatio,
            previousTailIndex: previousTailIndex >= 0 ? previousTailIndex + 1 : undefined,
            previousExitState: previousShot?.exitState,
            entryState: targetShot.entryState,
            exitState: targetShot.exitState,
            assetReferences: submittedRefs.map((item, index) => ({ index: index + 1, label: item.label })),
            h3Task: h3Task as SglangH3Task | undefined,
          });
          const projectionNote = imageReferenceProjectionPrompt(startReferenceProjection);
          const modeNote = '首帧模式：资产参考。只使用场景、人物、道具等真实资产生成画面。';
          const submittedPrompt = data.creativeSpec?.workKind === 'product-ad'
            ? [buildAdBoundaryPrompt({description: plannedFrameDescription, role: 'start', aspectRatio: boundaryAspectRatio, references: submittedRefs}), repairPatch].filter(Boolean).join('\n')
            : [basePrompt, modeNote, projectionNote, repairPatch].filter(Boolean).join('\n\n');
          updateBoundaryShot(targetShot, {
            videoStartFramePrompt: submittedPrompt,
            videoStartFrameReferencePaths: submittedRefs.map((item) => item.path),
            videoStartFrameReferenceLabels: submittedRefs.map((item) => item.label),
          });
          const startResult = await runGeneration({
            engineId: boundaryImageEngine,
            prompt: submittedPrompt,
            referenceUrls: submittedRefs.map((item) => item.path),
            params: { aspectRatio: boundaryAspectRatio, resolution: '2k' },
            workshopShotNo: targetShot.shotNo,
            workshopShotKind: 'image',
            workshopShotFrameRole: 'video-start',
            workshopShotFrameSignature: boundarySignature,
            projectId: data.projectId,
            onTaskCreated: (taskId) => updateBoundaryShot(targetShot, {
              genStatus: 'generating',
              genTaskId: taskId,
              genProgress: `正在生成 ${targetShot.shotNo} 首帧…`,
            }),
          });
          const generated = startResult.resultPaths.find((path) => /\.(png|jpe?g|webp|gif|bmp)(?:\?|$)/i.test(path)) ?? startResult.resultPaths[0];
          if (!startResult.success || !generated) {
            throw new Error(`${targetShot.shotNo} H3 首帧生成失败（生图模型：${boundaryImageEngine}）：${startResult.error || '生图接口未返回图片'}`);
          }
          try {
            return await copyIntoProject(project.id, generated, 'shots', `${safeName(targetShot.shotNo)}-video-start-${Date.now()}`);
          } catch (error) {
            console.warn('[workshop] 视频首帧入库失败，使用产物库路径:', error);
            return generated;
          }
        };

        const generateEndFrame = async (targetShot: WsShot, startFrame: string, repairPatch: string): Promise<string> => {
          const submittedRefs = endReferenceProjection.selected.map((item) => (
            item.kind === 'start-frame' ? { ...item, path: startFrame } : item
          ));
          const remappedSegments = remapBoundarySegments(endReferenceProjection);
          const previousTailIndexForEnd = submittedRefs.findIndex((item) => item.kind === 'previous-tail');
          const startFrameIndex = submittedRefs.findIndex((item) => item.kind === 'start-frame');
          updateBoundaryShot(targetShot, { genProgress: `正在生成 ${targetShot.shotNo} 尾帧（参考图 ${submittedRefs.length}/${endReferenceProjection.requested.length}）…` });
          const basePrompt = buildShotEndFramePrompt({
            frameDescription: latestTarget.plannedEndFramePrompt?.trim() || remappedSegments.end,
            timelineDescription: remappedSegments.timeline,
            startDescription: remappedSegments.start,
            spatialContext: remappedSegments.spatialContext,
            cameraContext: remappedSegments.cameraContext,
            endVerification: remappedSegments.endVerification,
            aspectRatio: boundaryAspectRatio,
            previousTailIndex: previousTailIndexForEnd >= 0 ? previousTailIndexForEnd + 1 : undefined,
            startFrameIndex: startFrameIndex + 1,
            previousExitState: previousShot?.exitState,
            entryState: targetShot.entryState,
            exitState: targetShot.exitState,
            assetReferenceOffset: 0,
            assetReferences: submittedRefs.map((item, index) => ({ index: index + 1, label: item.label })),
          });
          const projectionNote = imageReferenceProjectionPrompt(endReferenceProjection);
          const submittedPrompt = data.creativeSpec?.workKind === 'product-ad'
            ? [buildAdBoundaryPrompt({
              description: latestTarget.plannedEndFramePrompt?.trim()
                ? remapImageReferenceMentions(latestTarget.plannedEndFramePrompt.trim(), imageReferenceIndexMap(endReferenceProjection))
                : remappedSegments.end,
              role: 'end', aspectRatio: boundaryAspectRatio, references: submittedRefs,
            }), repairPatch].filter(Boolean).join('\n')
            : [basePrompt, projectionNote, repairPatch].filter(Boolean).join('\n\n');
          updateBoundaryShot(targetShot, {
            videoEndFramePrompt: submittedPrompt,
            videoEndFrameReferencePaths: submittedRefs.map((item) => item.path),
            videoEndFrameReferenceLabels: submittedRefs.map((item) => item.label),
          });
          const endResult = await runGeneration({
            engineId: boundaryImageEngine,
            prompt: submittedPrompt,
            referenceUrls: submittedRefs.map((item) => item.path),
            params: { aspectRatio: boundaryAspectRatio, resolution: '2k' },
            workshopShotNo: targetShot.shotNo,
            workshopShotKind: 'image',
            workshopShotFrameRole: 'video-end',
            workshopShotFrameSignature: boundarySignature,
            projectId: data.projectId,
            onTaskCreated: (taskId) => updateBoundaryShot(targetShot, {
              genStatus: 'generating',
              genTaskId: taskId,
              genProgress: `正在生成 ${targetShot.shotNo} 尾帧…`,
            }),
          });
          const generated = endResult.resultPaths.find((path) => /\.(png|jpe?g|webp|gif|bmp)(?:\?|$)/i.test(path)) ?? endResult.resultPaths[0];
          if (!endResult.success || !generated) {
            throw new Error(`${targetShot.shotNo} H3 尾帧生成失败（生图模型：${boundaryImageEngine}）：${endResult.error || '生图接口未返回图片'}`);
          }
          try {
            return await copyIntoProject(project.id, generated, 'shots', `${safeName(targetShot.shotNo)}-video-end-${Date.now()}`);
          } catch (error) {
            console.warn('[workshop] 视频尾帧入库失败，使用产物库路径:', error);
            return generated;
          }
        };

        let startFrame = frameRole === 'end'
          ? latestTarget.videoStartFramePath
          : boundaryFramesCurrent ? latestTarget.videoStartFramePath : undefined;
        let endFrame = frameRole === 'both' && boundaryFramesCurrent ? latestTarget.videoEndFramePath : undefined;
        let review = existingReview;
        let attempt = existingReview?.attempt ?? 1;
        let repairPatch = review && !review.passed ? appendQualityRepairPatch('', review.issues) : '';

        while (attempt <= maxReviewAttempts) {
          const currentTarget = get().data?.shots[targetIndex] ?? latestTarget;
          if (!startFrame && frameRole !== 'end') startFrame = await generateStartFrame(currentTarget, repairPatch);
          if (!startFrame) throw new Error(`${currentTarget.shotNo} 缺少首帧，无法生成尾帧`);
          if (!endFrame && frameRole !== 'start') endFrame = await generateEndFrame(currentTarget, startFrame, repairPatch);
          if (!startFrame || (frameRole !== 'start' && !endFrame)) throw new Error(`${currentTarget.shotNo} 首尾帧生成结果不完整`);
          if (!updateBoundaryShot(currentTarget, {
            ...(frameRole === 'end' ? {} : { videoStartFramePath: startFrame }),
            ...(frameRole === 'start' ? {} : { videoEndFramePath: endFrame }),
            videoBoundaryFrameSignature: boundarySignature,
            ...(!review ? { boundaryFrameQualityReview: undefined, boundaryFrameQualityReviewSignature: undefined } : {}),
          })) throw new Error('项目已切换，首尾帧等待恢复回填');
          await get().commitNow();

          if (!qualityReviewEnabled) return { start: startFrame, end: endFrame ?? startFrame };
          if (!review) {
            updateBoundaryShot(currentTarget, { genProgress: `正在审核 ${currentTarget.shotNo} 首尾帧（第 ${attempt}/${maxReviewAttempts} 次）…` });
            review = await runQualityReview({
              kind: 'boundary-frames',
              prompt: targetVideoPromptWithLearning,
              startFramePath: startFrame,
              endFramePath: endFrame,
              attempt,
            });
            recordQualityLearning(review, targetVideoPromptWithLearning, currentTarget.shotNo);
            const latestHistory = get().data?.shots[targetIndex]?.qualityReviewHistory ?? [];
            if (!updateBoundaryShot(currentTarget, {
              boundaryFrameQualityReview: review,
              boundaryFrameQualityReviewSignature: boundarySignature,
              qualityReviewHistory: [...latestHistory, review],
            })) throw new Error('项目已切换，审核结果等待恢复回填');
            await get().commitNow();
          }
          if (review.passed) {
            updateBoundaryShot(currentTarget, { qualityReviewRequiresManualReview: false });
            await get().commitNow();
            return { start: startFrame, end: endFrame ?? startFrame };
          }
          if (!shouldRetryQualityReview(review, maxReviewAttempts)) {
            updateBoundaryShot(currentTarget, { qualityReviewRequiresManualReview: true });
            await get().commitNow();
            throw new Error(`首尾帧质量审核未通过（${review.score} 分）：${review.summary}。已达到最大 ${maxReviewAttempts} 次尝试，禁止提交视频，请人工复盘分镜或资产。`);
          }

          repairPatch = appendQualityRepairPatch('', review.issues);
          const { redrawStart } = boundaryFrameRedrawPlan(review);
          if (redrawStart) startFrame = undefined;
          endFrame = undefined;
          attempt += 1;
          review = undefined;
          if (!updateBoundaryShot(currentTarget, {
            videoStartFramePath: startFrame,
            videoEndFramePath: undefined,
            qualityReviewRequiresManualReview: false,
            genProgress: `审核发现问题，正在按缺陷最小重绘（第 ${attempt}/${maxReviewAttempts} 次）…`,
          })) throw new Error('项目已切换，重绘状态等待恢复回填');
          await get().commitNow();
        }
        guardedUpdateShot(latestTarget.shotNo, { qualityReviewRequiresManualReview: true });
        await get().commitNow();
        throw new Error(`首尾帧质量审核未通过，已达到最大 ${maxReviewAttempts} 次尝试`);
      })().finally(() => boundaryFrameJobs.delete(jobKey));
      boundaryFrameJobs.set(jobKey, job);
      return job;
    };
    let runtimePreviousTailPath: string | undefined;
    let runtimeStartFramePath: string | undefined;
    let runtimeEndFramePath: string | undefined;
    let runtimeVideoRefs: string[] = [];
    let productionRunIdForAttempt: string | undefined;
    try {
      if (kind === 'video' && isH3) {
        if (currentShotIndex < 0) throw new Error('无法定位当前分镜顺序');
        if (options?.boundaryFramesOnly) {
          await ensureBoundaryFrames(
            currentShotIndex,
            true,
            options?.boundaryFrameRole ?? 'both',
          );
          if (guardedUpdateShot(shotNo, {
            genStatus: 'idle',
            genTaskId: undefined,
            genError: undefined,
            genProgress: undefined,
          })) await get().commitNow();
          return;
        }
        const latestPreviousShot = currentShotIndex > 0 ? get().data?.shots[currentShotIndex - 1] : undefined;
        const previousTail = h3Task === 'i2va' || h3Task === 'ref2va'
          ? (canInheritAcceptedVideoTail(shot, latestPreviousShot) ? acceptedVideoTailPath(latestPreviousShot) : undefined)
          : h3Task === 't2va'
            ? undefined
            : shouldUsePreviousTail(shot, latestPreviousShot)
              ? (acceptedVideoTailPath(latestPreviousShot) ?? latestPreviousShot?.videoEndFramePath) : undefined;
        if (h3Task && sglangH3TaskUsesBoundaryFrames(h3Task)) {
          // Submitting a video is not consent to paid image generation. Only the
          // explicit boundaryFramesOnly branch above may create boundary frames.
          const boundary = await resolveExistingVideoFrames(
            get().data?.shots[currentShotIndex] ?? shot, h3Task, exists, latestPreviousShot,
          );
          const continuityPlan = buildShotContinuityReferencePlan({
            assetCount: 0,
            hasPreviousTail: false,
            previousExitState: latestPreviousShot?.exitState,
            entryState: shot.entryState,
            exitState: shot.exitState,
          });
          refs = boundary.refs;
          refLabels = h3Task === 'i2va' ? ['当前镜首帧'] : ['当前镜首帧', '当前镜尾帧'];
          audioRefs = [];
          runtimeVideoRefs = [];
          if (!isH3) finalPrompt = buildShotVideoContinuityPrompt(finalPrompt, continuityPlan);
          runtimePreviousTailPath = previousTail;
          runtimeStartFramePath = boundary.start;
          runtimeEndFramePath = h3Task === 'fl2va' ? boundary.end : undefined;
        } else if (h3Task && sglangH3TaskUsesReferenceAssets(h3Task)) {
          if (inheritsPrevious && latestPreviousShot?.videoPath && !previousTail) {
            throw new Error('上一镜已采用视频的真实尾帧尚未就绪。请先采用上一镜视频并等待截图完成；若截图失败，重新采用即可重试截帧，无需生成首尾帧。');
          }
          if (previousTail) {
            const previousTailIndex = refs.length + 1;
            refs = [...refs, previousTail];
            const previousTailAsFirstFrame = Boolean(shot.usePreviousTailAsFirstFrame);
            refLabels = [...refLabels, previousTailAsFirstFrame
              ? '上一镜首帧锚点（明确指定）'
              : '上一镜连续性参考（可选，不强制首尾帧）'];
            // H3 uses the edited prompt; authoring rules belong in the rewrite
            // stage, not a hidden prefix added at submission time.
            if (!isH3) {
              finalPrompt = buildPreviousTailContinuityPrompt(finalPrompt, previousTailIndex, {
                previousExitState: latestPreviousShot?.exitState,
                entryState: shot.entryState,
                exitState: shot.exitState,
              });
            }
            runtimePreviousTailPath = previousTail;
          }
        } else {
          refs = [];
          refLabels = [];
          audioRefs = [];
          runtimeVideoRefs = [];
        }
      } else if (kind === 'video' && inheritsPrevious && previousShot?.videoEndFramePath) {
        const previousTailIndex = refs.length + 1;
        refs = [...refs, previousShot.videoEndFramePath];
        refLabels = [...refLabels, '上一镜连续性参考（可选，不强制首尾帧）'];
        finalPrompt = buildPreviousTailContinuityPrompt(finalPrompt, previousTailIndex, {
          previousExitState: previousShot.exitState,
          entryState: shot.entryState,
          exitState: shot.exitState,
        });
        runtimePreviousTailPath = previousShot.videoEndFramePath;
        guardedUpdateShot(shotNo, { genProgress: '首尾帧已就绪，正在提交视频任务…' });
      }

      if (kind === 'video' && audioRefs.length > 0) {
        const { trimAudioPathsToFit } = await import('@/lib/doubaoSpeech/trim');
        // 上限跟分镜时长走：8s 的镜配 15s 音频，Seedance 收到超画面时长的
        // 音频会截断或拖节奏。Seedance 单镜硬上限 15s。
        const maxAudioSec = Math.min(isSeedance25 ? 30 : 15, shot.durationSec ?? (isSeedance25 ? 30 : 15));
        const prepared = await trimAudioPathsToFit(audioRefs, maxAudioSec, data.projectId, audioLabels);
        audioRefs = prepared.paths;
        if (prepared.trimmed) {
          console.info(`[workshop] ${shotNo} 音频资产总时长 ${prepared.totalDuration.toFixed(1)}s，已自动裁剪至 ${maxAudioSec}s 内`);
        }
      }
      if (kind === 'video' && isH3 && h3Task === 'ref2va') {
        validateRef2vaSubmission(finalPrompt, refs, runtimePreviousTailPath);
      }
      const capabilityProjection = projectProviderCapabilities({
        engineId: effectiveModel,
        imageCount: refs.length,
        audioCount: audioRefs.length,
        videoCount: runtimeVideoRefs.length,
      });
      if (!capabilityProjection.canSubmit) {
        throw new Error(`Provider 能力不支持本次提交：${capabilityProjection.summary}`);
      }
      // Freeze the exact provider input for both paid paths.  Previously only
      // videos received a packet, so a regenerated first frame could silently
      // use a different reference set or prompt than the UI displayed.
      const productionPacket = (kind === 'video' || kind === 'image')
        ? buildShotProductionPacket({
            projectId: data.projectId,
            shotNo,
            sourceScriptRevisionId: shot.sourceScriptRevisionId ?? data.currentScriptRevisionId,
            model: effectiveModel,
            engineId,
            prompt: finalPrompt,
            referencePaths: refs,
            referenceLabels: refLabels,
            referenceSignature: shotReferenceSignature(shot, refContext),
            audioPaths: audioRefs,
            videoPaths: runtimeVideoRefs,
            params: {
              ratio: effectiveRatio ?? '9:16',
              duration: shot.durationSec ?? 5,
              boundaryFrames: h3Task === 'fl2va',
              ...(h3Task ? { h3Task } : {}),
              promptTemplate,
            },
            continuityMode: shot.continuityMode,
            previousTailPath: runtimePreviousTailPath,
            startFramePath: runtimeStartFramePath,
            endFramePath: runtimeEndFramePath,
            actionTimeline: shot.actionTimeline,
            entryState: shot.entryState,
            exitState: shot.exitState,
            continuitySnapshot: shot.continuitySnapshot,
          })
        : undefined;
      const productionInputFingerprint = productionPacket?.inputFingerprint;
      if (productionPacket) {
        guardedUpdateShot(shotNo, { lastProductionPacket: productionPacket });
        await get().commitNow();
      }
      const result = await runGeneration({
        engineId,
        prompt: finalPrompt,
        inputFingerprint: productionInputFingerprint,
        referenceUrls: refs,
        h3Task,
        h3StartFramePath: runtimeStartFramePath,
        h3EndFramePath: runtimeEndFramePath,
        videoUrls: runtimeVideoRefs.length > 0
          ? runtimeVideoRefs
          : undefined,
        audioUrls: audioRefs.length > 0 ? audioRefs : undefined,
        params: kind === 'video'
          ? isSeedance25
            ? {
                resolution: '720p',
                duration: String(Math.min(30, Math.max(4, shot.durationSec ?? 5))),
                ratio: effectiveRatio!,
              }
          : isH3
            ? {
                // H3 只有 2K；时长枚举 5-15（4s 分镜提到 5s）；ratio 透传；
                // 不下发 generateAudio 等 Seedance 专有参数
                resolution: '2K',
                duration: String(Math.min(15, Math.max(5, shot.durationSec ?? 5))),
                ratio: effectiveRatio!,
              }
            : isWan3
              ? {
                  // 万相 3.0：480P/720P/1080P，时长 2-30
                  resolution: '720P',
                  duration: String(Math.min(30, Math.max(2, shot.durationSec ?? 5))),
                  ratio: effectiveRatio!,
                }
            : {
                duration: String(shot.durationSec ?? 5),
                ratio: effectiveRatio!,
                generateAudio: true,
                generate_audio: true,
              }
          : {},
        workshopShotNo: shotNo,
        workshopShotKind: kind,
        projectId: data.projectId,
        onTaskCreated: (taskId) => {
          if (productionPacket) {
            const run = createProductionRun({
              projectId: data.projectId,
              shotNo,
              kind: 'video',
              inputFingerprint: productionPacket.inputFingerprint,
              jobId: taskId,
            });
            productionRunIdForAttempt = run.runId;
            get().upsertProductionRun(run);
            useCanvasTaskStore.getState().updateTask(taskId, {
              workshopProductionPacket: {
                ...productionPacket,
                jobId: taskId,
                productionRunId: run.runId,
              },
            });
          }
          guardedUpdateShot(shotNo, {
            genStatus: 'generating',
            genTaskId: taskId,
            ...(productionPacket
              ? {
                  lastProductionPacket: {
                    ...productionPacket,
                    jobId: taskId,
                    productionRunId: productionRunIdForJob(taskId),
                  },
                }
              : {}),
          });
        },
      });
      const mediaPath = kind === 'video'
        ? result.resultPaths.find((p) => /\.(mp4|mov|webm|m4v|mkv|avi)(?:\?|$)/i.test(p))
        : result.resultPaths.find((p) => /\.(png|jpe?g|webp|gif|bmp)(?:\?|$)/i.test(p)) ?? result.resultPaths[0];
      if (result.success && mediaPath) {
        // Copy failure must not strand a finished generation as "generating".
        let dest = mediaPath;
        try {
          const ts = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace('T', '').slice(0, 15);
          dest = await copyIntoProject(project.id, mediaPath, 'shots', `${safeName(shotNo)}-${kind}-${ts}`);
        } catch (err) {
          console.warn('[workshop] 产物入库失败，使用产物库路径:', err);
        }
        const latestShot = get().data?.shots.find((item) => item.shotNo === shotNo);
        const candidateProductionPacket = kind === 'video' && productionPacket
          ? {
              ...productionPacket,
              jobId: result.taskId ?? productionPacket.jobId,
              productionRunId: productionRunIdForAttempt
                ?? productionPacket.productionRunId
                ?? (result.taskId ? productionRunIdForJob(result.taskId) : undefined),
            }
          : undefined;
        const videoCandidate = kind === 'video'
          ? {
              candidateId: `video-${shot.id}-${result.taskId ?? Date.now()}`,
              path: dest,
              source: 'generate' as const,
              engineId,
              prompt: finalPrompt,
              inputFingerprint: productionInputFingerprint,
              productionPacket: candidateProductionPacket,
              createdAt: Date.now(),
            }
          : undefined;
        const qualityReviewEnabled = false;
        const candidatePatch = kind === 'image'
          ? { imagePath: dest }
          : { videoCandidates: [...(latestShot?.videoCandidates ?? []).filter((candidate) => candidate.path !== dest), videoCandidate!] };
        if (!guardedUpdateShot(shotNo, {
          genStatus: qualityReviewEnabled ? 'generating' : 'done',
          genTaskId: undefined,
          genProgress: kind === 'video'
            ? qualityReviewEnabled ? '候选视频已生成，正在进行多模态终审…' : '候选视频已生成，等待评审采用'
            : undefined,
          ...candidatePatch,
        })) return;
        await get().commitNow();

        if (qualityReviewEnabled && videoCandidate) {
          try {
            const qualityReport = await runQualityReview({
              kind: 'video',
              prompt: finalPrompt,
              startFramePath: runtimeStartFramePath,
              endFramePath: runtimeEndFramePath,
              videoPath: videoCandidate.path,
              artifactFingerprint: videoCandidateFingerprint(videoCandidate),
              attempt: 1,
            });
            recordQualityLearning(qualityReport, finalPrompt, shotNo);
            const currentShot = get().data?.shots.find((item) => item.shotNo === shotNo);
            const history = currentShot?.qualityReviewHistory ?? [];
            const promptRepair = qualityReport.passed ? prompt : appendQualityRepairPatch(prompt, qualityReport.issues);
            const promptPatch = qualityReport.passed
              ? {}
              : isSeedance25
                ? { seedance25VideoPrompt: promptRepair }
                : promptTemplate === 'universal'
                  ? { universalVideoPrompt: promptRepair }
                  : { videoPrompt: promptRepair };
            guardedUpdateShot(shotNo, {
              videoQualityReview: qualityReport,
              qualityReviewHistory: [...history, qualityReport],
              genStatus: qualityReport.passed ? 'done' : 'failed',
              genProgress: qualityReport.passed ? '多模态终审通过，等待人工评审采用' : undefined,
              genError: qualityReport.passed
                ? undefined
                : `视频成片终审未通过（${qualityReport.score} 分）：${qualityReport.summary}。已按缺陷为本镜提示词追加最小修复补丁，请重新生成本镜。`,
              ...promptPatch,
            });
            await get().commitNow();
          } catch (error) {
            guardedUpdateShot(shotNo, {
              genStatus: 'failed',
              genProgress: undefined,
              genError: `候选视频已保存，但多模态终审调用失败：${error instanceof Error ? error.message : String(error)}。为避免未审核成片进入交付，已阻断采用。`,
            });
            await get().commitNow();
            flushCanvasTaskPersistence();
          }
        }

        if (productionRunIdForAttempt || productionPacket?.productionRunId || result.taskId) {
          get().updateProductionRunStatus(
            productionRunIdForAttempt ?? productionPacket?.productionRunId ?? productionRunIdForJob(result.taskId!),
            'succeeded',
          );
          // Candidate, production run and step evidence must reach the same
          // durable workshop snapshot before the foreground generation call
          // resolves. Otherwise a reload can show the video while the run is
          // still missing or pending in workshop.json.
          await get().commitNow();
          // Keep the terminal canvas receipt and workshop snapshot on the same
          // durable boundary for foreground generation as well as recovery.
          flushCanvasTaskPersistence();
        }
        if (videoCandidate && !/^https?:\/\//i.test(videoCandidate.path)) {
          void computeAssetChecksum(videoCandidate.path).then((checksum) => {
            if (!checksum) return;
            const current = get().data;
            if (!current || current.projectId !== project.id) return;
            set({ data: applyAssetChecksum(current, videoCandidate.path, checksum) });
            get().scheduleSave();
          });
        }
      } else {
        const activeTask = result.taskId
          ? useCanvasTaskStore.getState().tasks.find((t) => t.id === result.taskId)
          : undefined;
        const applied = activeTask && ['queued', 'uploading', 'running', 'downloading'].includes(activeTask.status)
          ? guardedUpdateShot(shotNo, {
              genStatus: 'generating',
              genTaskId: activeTask.id,
              genProgress: activeTask.progress,
              genError: result.error ? `${result.error}\n后台仍在继续查询结果。` : undefined,
            })
          : guardedUpdateShot(shotNo, { genStatus: 'failed', genError: result.error, genTaskId: undefined, genProgress: undefined });
        if (applied) {
          if (!activeTask && (productionRunIdForAttempt || productionPacket?.productionRunId || result.taskId)) {
            get().updateProductionRunStatus(
              productionRunIdForAttempt ?? productionPacket?.productionRunId ?? productionRunIdForJob(result.taskId!),
              'failed',
            );
          }
          await get().commitNow();
        }
      }
    } catch (err) {
      if (guardedUpdateShot(shotNo, {
        genStatus: 'failed',
        genError: err instanceof Error ? err.message : String(err),
        genTaskId: undefined,
        genProgress: undefined,
      })) {
        if (productionRunIdForAttempt) get().updateProductionRunStatus(productionRunIdForAttempt, 'failed');
        await get().commitNow();
        flushCanvasTaskPersistence();
      }
    }
  },

  generateAll: async (kind, onlyMissing = true) => {
    const { data } = get();
    if (!data) return;
    const busy = data.shots.some((s) => s.genStatus === 'queued' || s.genStatus === 'generating');
    if (busy) {
      console.warn('[workshop] generateAll skipped: shots already in progress');
      return;
    }
    const targets = data.shots.filter((s) => {
      if (!onlyMissing) return true;
      return kind === 'image' ? !s.imagePath : !s.videoPath;
    });
    if (kind === 'video') {
      for (const target of targets) await get().generateShot(target.shotNo, kind);
    } else {
      await Promise.allSettled(targets.map((s) => get().generateShot(s.shotNo, kind)));
    }
  },

  selectVideoCandidate: (shotNo, path, expectedFingerprint, review) => {
    const { data } = get();
    if (!data) return;
    const shot = data.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return;
    const candidate = (shot.videoCandidates ?? []).find((item) => item.path === path);
    if (!candidate || !videoCandidateMatchesProductionInput(candidate, shot.lastProductionPacket?.inputFingerprint)) {
      set({
        data: {
          ...data,
          shots: data.shots.map((item) => item.shotNo === shotNo
            ? {
                ...item,
                genStatus: 'failed',
                genError: '该视频候选缺少可验证的生产输入，或候选指纹与其冻结生产包不一致，已禁止采用。',
              }
            : item),
        },
      });
      get().scheduleSave();
      return;
    }
    const qualitySettings = useSettingsStore.getState();
    if (qualitySettings.qualityReviewEnabled) {
      const candidateFingerprint = videoCandidateFingerprint(candidate);
      const qualityReview = currentVideoQualityReview({
        reports: [shot.videoQualityReview, ...(shot.qualityReviewHistory ?? [])],
        candidatePath: path,
        candidateFingerprint,
        reviewerFingerprint: qualityReviewerFingerprint(
          qualitySettings.qualityReviewBaseUrl,
          qualitySettings.qualityReviewModel,
        ),
      });
      if (!qualityReview) {
        set({
          data: {
            ...data,
            shots: data.shots.map((item) => item.shotNo === shotNo
              ? {
                  ...item,
                  genStatus: 'failed',
                  genError: '该候选尚未完成与当前文件和候选指纹绑定的多模态终审，已禁止采用。',
                }
              : item),
          },
        });
        get().scheduleSave();
        return;
      }
    }
    const tailExtractionId = createGenerationToken();
    const accepted = acceptVideoCandidate({
      candidates: shot.videoCandidates ?? [],
      path,
      expectedFingerprint,
      note: review?.note,
      criteria: review?.criteria,
    });
    const shots = data.shots.map((item) => item.shotNo === shotNo
      ? {
          ...item,
          videoPath: path,
          acceptedVideoTail: { videoPath: path, extractionId: tailExtractionId },
          videoEndFramePath: undefined,
          videoThumbPath: undefined,
          videoReviews: [...(item.videoReviews ?? []), accepted.review],
          videoProductionBinding: accepted.binding,
          lastProductionPacket: candidate.productionPacket ?? item.lastProductionPacket,
          genStatus: 'done' as const,
          genError: undefined,
          genProgress: '视频已采用，正在精确截取成片最后一帧…',
        }
      : item);
    set({
      data: {
        ...data,
        shots,
        steps: { ...data.steps, generate: reconcileGenerationStepState(shots, data.steps.generate) },
      },
    });
    get().scheduleSave();
    // Only an explicitly accepted/formal video may become the next shot's
    // continuity source. Candidate generation must never affect this frame.
    const captureIsCurrent = () => {
      const current = get().data;
      const currentShot = current?.shots.find((item) => item.shotNo === shotNo);
      return current?.projectId === data.projectId && currentShot?.videoPath === path
        && currentShot.acceptedVideoTail?.extractionId === tailExtractionId;
    };
    const reportCaptureFailure = () => {
      if (!captureIsCurrent()) return;
      get().updateShot(shotNo, {
        genProgress: undefined,
        genError: '视频已采用，但无法截取成片最后一帧；下一镜暂不可自动承接。请检查 FFmpeg 和视频文件后重新采用该视频，无需重新生图。',
      });
      void get().commitNow();
    };
    void extractVideoTailFrame(path, data.projectId, shotNo, `${Date.now()}-${tailExtractionId}`).then((tailPath) => {
      if (!captureIsCurrent()) return;
      if (!tailPath) { reportCaptureFailure(); return; }
      get().updateShot(shotNo, {
        videoEndFramePath: tailPath,
        acceptedVideoTail: { videoPath: path, framePath: tailPath, extractionId: tailExtractionId },
        genProgress: undefined,
      });
      const current = get().data!;
      const shotIndex = current.shots.findIndex((item) => item.shotNo === shotNo);
      const acceptedShot = current.shots[shotIndex];
      const nextShot = current.shots[shotIndex + 1];
      if (nextShot && nextShot.genStatus !== 'queued' && nextShot.genStatus !== 'generating'
        && isMiniMaxH3Model(nextShot.videoModel || current.videoModel || '')) {
        const patch = inheritedStartFramePatch(nextShot, acceptedShot, get().getH3InputMode());
        if (patch) get().updateShot(nextShot.shotNo, patch);
        else if (get().getH3InputMode() === 'ref2va'
          && canInheritAcceptedVideoTail(nextShot, acceptedShot)) {
          get().updateShot(nextShot.shotNo, { promptNeedsRefresh: true });
        }
      }
      void get().commitNow();
    }).catch(reportCaptureFailure);
  },

  cancelShot: (shotNo) => {
    const { data } = get();
    const shot = data?.shots.find((s) => s.shotNo === shotNo);
    if (shot?.genTaskId) {
      abortCanvasTask(shot.genTaskId);
      // abort 只断前台 Promise——任务在 canvasTaskStore 里若仍 active，
      // 恢复线程稍后会把"已取消"的结果回填回来（取消形同虚设）。
      // 直接把任务标记为 failed 终态，恢复线程不再碰它。
      const task = useCanvasTaskStore.getState().tasks.find((t) => t.id === shot.genTaskId);
      if (task && ['queued', 'uploading', 'running', 'downloading'].includes(task.status)) {
        useCanvasTaskStore.getState().updateTask(task.id, {
          status: 'failed',
          error: '用户已取消',
          finishedAt: Date.now(),
        });
      }
    }
    get().updateShot(shotNo, { genStatus: 'idle', genTaskId: undefined, genProgress: undefined });
    void get().commitNow();
  },

  getStateSummary: () => {
    const { project, data } = get();
    if (!project || !data) return JSON.stringify({ open: false, hint: '当前没有打开的工坊项目' });
    const qualitySettings = useSettingsStore.getState();
    const audit = buildProductionAudit(data, {
      videoQualityReviewRequired: qualitySettings.qualityReviewEnabled,
      reviewerFingerprint: qualitySettings.qualityReviewEnabled
        ? qualityReviewerFingerprint(qualitySettings.qualityReviewBaseUrl, qualitySettings.qualityReviewModel)
        : undefined,
    });
    const selectedAssets = [
      ...data.characters,
      ...data.scenes,
      ...(data.props ?? []),
      ...(data.colorPalettes ?? []),
    ].filter((item) => item.assetImagePath);
    return JSON.stringify({
      open: true,
      project: { id: project.id, name: project.name },
      currentStep: data.currentStep,
      steps: Object.fromEntries(
        Object.entries(data.steps).map(([k, v]) => [k, { status: v.status }]),
      ),
      synopsis: data.synopsis.slice(0, 200),
      episodeCount: data.episodes.length,
      characterCount: data.characters.length,
      charactersWithVoice: data.characters.filter((c) => c.voicePath).length,
      sceneCount: data.scenes.length,
      propCount: (data.props ?? []).length,
      colorPaletteCount: (data.colorPalettes ?? []).length,
      globalColorPaletteId: data.globalColorPaletteId,
      bibles: {
        director: Boolean(data.bibles?.director),
        character: Boolean(data.bibles?.character),
        scene: Boolean(data.bibles?.scene),
        continuity: Boolean(data.bibles?.continuity),
      },
      shotCount: data.shots.length,
      characterHandoffCount: data.characterHandoffs?.length ?? 0,
      directorReport: data.directorReport ? {
        status: data.directorReport.status,
        totalShots: data.directorReport.totalShots,
        totalDurationSec: data.directorReport.totalDurationSec,
        checks: Object.fromEntries(Object.entries(data.directorReport).filter(([key]) => ['hook', 'informationProgression', 'escalation', 'shotFocus', 'shotDensity', 'soundIntent'].includes(key))),
      } : undefined,
      shotsWithImage: data.shots.filter((s) => s.imagePath).length,
      shotsWithVideo: data.shots.filter((s) => s.videoPath).length,
      assetReview: {
        selected: selectedAssets.length,
        withCurrentBinding: selectedAssets.filter((item) => {
          const candidate = item.candidates?.find((value) => value.path === item.assetImagePath);
          return Boolean(candidate && assetBindingIsCurrent({
            candidate,
            binding: item.assetProductionBinding,
            reviews: item.assetReviews,
          }));
        }).length,
      },
      productionAudit: {
        status: audit.status,
        blocked: audit.checks.filter((item) => item.status === 'blocked').map((item) => ({ id: item.id, label: item.label, detail: item.detail })),
        warnings: audit.checks.filter((item) => item.status === 'warn').map((item) => ({ id: item.id, label: item.label, detail: item.detail })),
      },
      qualityLearning: {
        highScorePromptCount: data.qualityLearning?.highScorePrompts.length ?? 0,
        avoidanceRuleCount: data.qualityLearning?.avoidanceRules.length ?? 0,
        topRules: data.qualityLearning?.avoidanceRules.slice(0, 6).map((rule) => ({
          code: rule.code,
          rule: rule.rule,
          occurrences: rule.occurrences,
        })) ?? [],
      },
      productionRuns: (data.productionRuns ?? []).map((run) => ({
        runId: run.runId,
        shotNo: run.shotNo,
        kind: run.kind,
        jobId: run.jobId,
        status: run.status,
        inputFingerprint: run.inputFingerprint,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
      sources: project.sources.map((s) => s.name),
    });
  },
}));
