import { deliveryReviewStatus } from './deliveryReviewStatus.ts';
import type { WsShot } from './types';
import {
  bindingIsCurrent,
  productionCandidateFingerprint,
  type ProductionBinding,
  type ProductionCandidate,
  type ProductionReviewReceipt,
} from '../production/lifecycle.ts';
import type { ProductionRun } from '../production/run.ts';
import { videoCandidateFingerprint, boundVideoReview } from './productionLifecycle.ts';
import { currentVideoQualityReview } from './qualityReview.ts';

export interface DeliveryManifestShot {
  shotNo: string;
  episode?: string;
  path: string;
  checksum: string;
  jobId?: string;
  productionRunId?: string;
  candidateFingerprint?: string;
  reviewFingerprint?: string;
  productionPacketFingerprint?: string;
  productionPacketCreatedAt?: number;
  sourceScriptRevisionId?: string;
  qualityReview?: {
    score: number;
    summary: string;
    model: string;
    reviewedAt: number;
    artifactFingerprint: string;
  };
  boundaryFrames?: {
    startPath: string;
    endPath: string;
    inputSignature: string;
    score: number;
    summary: string;
    model: string;
    reviewedAt: number;
  };
  videoValidation?: {
    valid: boolean;
    reason?: string;
  };
  audio?: {
    path: string;
    checksum: string;
    candidateId?: string;
    candidateFingerprint?: string;
  }[];
}

export interface DeliveryManifest {
  schemaVersion: 3;
  generatedAt: number;
  status: 'ready' | 'blocked';
  projectId: string;
  videoQualityReviewRequired: boolean;
  reason?: string;
  shots: DeliveryManifestShot[];
  episodes: {
    episode: string;
    shotNos: string[];
  }[];
  render?: {
    path: string;
    checksum: string;
    jobId?: string;
    productionRunId?: string;
    inputFingerprint?: string;
    runStatus?: ProductionRun['status'];
    candidateId: string;
    candidateFingerprint: string;
    reviewFingerprint: string;
    videoValidation?: {
      valid: boolean;
      reason?: string;
    };
  };
}

function videoBindingIsCurrent(shot: WsShot): boolean {
  const binding = shot.videoProductionBinding;
  if (!binding || !shot.videoPath) return false;
  const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
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

function shotRequiresBoundaryFrameReview(shot: WsShot): boolean {
  const packet = formalVideoPacket(shot);
  const h3Task = String(packet?.params?.h3Task ?? '').trim();
  return h3Task === 'fl2va' || (!h3Task && packet?.params?.boundaryFrames === true);
}

function currentBoundaryFrameReview(shot: WsShot, reviewerFingerprint?: string) {
  if (!shotRequiresBoundaryFrameReview(shot)) return undefined;
  const report = shot.boundaryFrameQualityReview;
  if (!shot.videoStartFramePath
    || !shot.videoEndFramePath
    || !shot.videoBoundaryFrameSignature
    || !report?.passed
    || (reviewerFingerprint && report.reviewerFingerprint !== reviewerFingerprint)
    || shot.boundaryFrameQualityReviewSignature !== shot.videoBoundaryFrameSignature) return undefined;
  return report;
}

export function buildDeliveryManifest(input: {
  projectId: string;
  shots: WsShot[];
  checksums: Record<string, string>;
  currentScriptRevisionId?: string;
  renderCandidate?: ProductionCandidate;
  renderReviews?: ProductionReviewReceipt[];
  renderBinding?: ProductionBinding;
  productionRuns?: ProductionRun[];
  videoValidations?: Record<string, { valid: boolean; reason?: string }>;
  renderVideoValidation?: { valid: boolean; reason?: string };
  reviewerFingerprint?: string;
  videoQualityReviewRequired?: boolean;
  now?: number;
}): DeliveryManifest {
  const qualityReviewForShot = (shot: WsShot) => {
    if (!shot.videoPath) return undefined;
    const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
    if (!candidate) return undefined;
    return currentVideoQualityReview({
      reports: [shot.videoQualityReview, ...(shot.qualityReviewHistory ?? [])],
      candidatePath: candidate.path,
      candidateFingerprint: videoCandidateFingerprint(candidate),
      reviewerFingerprint: input.reviewerFingerprint,
    });
  };
  const shots = input.shots
    .filter((shot) => Boolean(shot.videoPath))
    .map((shot) => {
      const qualityReview = qualityReviewForShot(shot);
      const boundaryReview = currentBoundaryFrameReview(shot, input.reviewerFingerprint);
      const packet = formalVideoPacket(shot);
      return ({
      shotNo: shot.shotNo,
      ...(shot.episode?.trim() ? { episode: shot.episode.trim() } : {}),
      path: shot.videoPath!,
      checksum: input.checksums[shot.videoPath!] ?? '',
      jobId: packet?.jobId,
      productionRunId: packet?.productionRunId,
      candidateFingerprint: shot.videoProductionBinding?.candidateFingerprint,
      reviewFingerprint: shot.videoProductionBinding?.reviewFingerprint,
      productionPacketFingerprint: packet?.inputFingerprint,
      productionPacketCreatedAt: packet?.createdAt,
      sourceScriptRevisionId: packet?.sourceScriptRevisionId,
      qualityReview: qualityReview
        ? {
            score: qualityReview.score,
            summary: qualityReview.summary,
            model: qualityReview.model,
            reviewedAt: qualityReview.reviewedAt,
            artifactFingerprint: qualityReview.artifactFingerprint!,
          }
        : undefined,
      boundaryFrames: boundaryReview
        ? {
            startPath: shot.videoStartFramePath!,
            endPath: shot.videoEndFramePath!,
            inputSignature: shot.videoBoundaryFrameSignature!,
            score: boundaryReview.score,
            summary: boundaryReview.summary,
            model: boundaryReview.model,
            reviewedAt: boundaryReview.reviewedAt,
          }
        : undefined,
      videoValidation: input.videoValidations?.[shot.videoPath!],
      audio: shot.audioInjected
        ? (shot.generatedAudios ?? []).map((audio) => {
            const candidate = shot.audioCandidates?.find((item) => item.characterId === audio.characterId && item.path === audio.path);
            const review = candidate
              ? shot.audioReviews?.find((item) => item.candidateId === candidate.candidateId && item.verdict === 'accepted')
              : undefined;
            return {
              path: audio.trimmedPath || audio.path,
              checksum: input.checksums[audio.trimmedPath || audio.path] ?? '',
              candidateId: candidate?.candidateId,
              candidateFingerprint: review?.candidateFingerprint,
            };
          })
        : undefined,
      });
    });
  const missing = input.shots.filter((shot) => !shot.videoPath).map((shot) => shot.shotNo);
  const unbound = input.shots.filter((shot) => {
    if (!shot.videoPath) return false;
    return !videoBindingIsCurrent(shot);
  }).map((shot) => shot.shotNo);
  const stalePackets = input.shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
    const packet = formalVideoPacket(shot);
    return !packet
      || !candidate?.inputFingerprint
      || packet.inputFingerprint !== candidate.inputFingerprint
      || packet.projectId !== input.projectId
      || packet.shotNo !== shot.shotNo
      || Boolean(input.currentScriptRevisionId && packet.sourceScriptRevisionId !== input.currentScriptRevisionId);
  }).map((shot) => shot.shotNo);
  const missingRunMappings = input.shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const packet = formalVideoPacket(shot);
    return !packet?.jobId || !packet.productionRunId || packet.productionRunId !== `production-run-${packet.jobId}`;
  }).map((shot) => shot.shotNo);
  const invalidVideos = input.shots.filter((shot) => {
    if (!shot.videoPath) return false;
    const validation = input.videoValidations?.[shot.videoPath];
    return validation && !validation.valid;
  }).map((shot) => shot.shotNo);
  const missingQualityReviews = input.shots
    .filter((shot) => input.videoQualityReviewRequired !== false && shot.videoPath && !qualityReviewForShot(shot))
    .map((shot) => shot.shotNo);
  const missingBoundaryReviews = input.shots
    .filter((shot) => shotRequiresBoundaryFrameReview(shot) && !currentBoundaryFrameReview(shot))
    .map((shot) => shot.shotNo);
  const missingAudioChecksums = input.shots.filter((shot) => {
    if (!shot.videoPath || !shot.audioInjected) return false;
    return (shot.generatedAudios ?? []).some((audio) => !input.checksums[audio.trimmedPath || audio.path]);
  }).map((shot) => shot.shotNo);
  const render = input.renderCandidate && input.renderBinding && bindingIsCurrent({
    candidate: input.renderCandidate,
    binding: input.renderBinding,
    reviews: input.renderReviews,
  }) ? {
    path: input.renderCandidate.path,
    checksum: input.checksums[input.renderCandidate.path] ?? '',
    jobId: typeof input.renderCandidate.metadata?.jobId === 'string' ? input.renderCandidate.metadata.jobId : undefined,
    productionRunId: (() => {
      const jobId = typeof input.renderCandidate?.metadata?.jobId === 'string' ? input.renderCandidate.metadata.jobId : undefined;
      return input.productionRuns?.find((run) => run.kind === 'render' && run.jobId === jobId && run.inputFingerprint === input.renderCandidate?.inputFingerprint)?.runId;
    })(),
    inputFingerprint: input.renderCandidate.inputFingerprint,
    runStatus: (() => {
      const jobId = typeof input.renderCandidate?.metadata?.jobId === 'string' ? input.renderCandidate.metadata.jobId : undefined;
      return input.productionRuns?.find((run) => run.kind === 'render' && run.jobId === jobId && run.inputFingerprint === input.renderCandidate?.inputFingerprint)?.status;
    })(),
    candidateId: input.renderCandidate.candidateId,
    candidateFingerprint: productionCandidateFingerprint(input.renderCandidate),
    reviewFingerprint: input.renderBinding.reviewFingerprint,
    videoValidation: input.renderVideoValidation,
  } : undefined;
  const reason = missing.length > 0
    ? `缺少正式视频：${missing.join('、')}`
      : unbound.length > 0
      ? `存在未经过评审绑定的视频：${unbound.join('、')}`
      : missingBoundaryReviews.length > 0
        ? `存在 fl2va 首尾帧缺失、未通过审核或审核结果已过期：${missingBoundaryReviews.join('、')}`
      : missingQualityReviews.length > 0
        ? `存在未通过多模态终审或审核结果已过期的视频：${input.shots.filter(s => missingQualityReviews.includes(s.shotNo)).map(s => `${s.shotNo}（${deliveryReviewStatus(s, input.reviewerFingerprint).label}）`).join('；')}`
      : input.shots.some((shot) => shot.videoPath && !input.checksums[shot.videoPath])
        ? '部分视频未能计算 SHA-256 checksum'
        : input.renderCandidate && !render
          ? '存在未经过评审绑定的渲染候选'
          : stalePackets.length > 0
            ? `正式视频缺少当前提交输入包：${stalePackets.join('、')}`
            : missingRunMappings.length > 0
              ? `正式视频缺少运行任务映射：${missingRunMappings.join('、')}`
              : invalidVideos.length > 0
                ? `视频文件未通过容器校验：${invalidVideos.join('、')}`
                : missingAudioChecksums.length > 0
                  ? `注入音频缺少 checksum：${missingAudioChecksums.join('、')}`
              : input.renderCandidate && input.renderVideoValidation && !input.renderVideoValidation.valid
                ? '最终渲染文件未通过视频容器校验'
              : input.renderCandidate && !input.checksums[input.renderCandidate.path]
              ? '渲染候选未能计算 SHA-256 checksum'
              : input.renderCandidate && input.productionRuns && (!render?.productionRunId || render.runStatus !== 'succeeded')
              ? '最终渲染缺少成功的 ProductionRun 映射'
              : undefined;
  const episodes = shots.reduce<DeliveryManifest['episodes']>((groups, shot) => {
    const episode = shot.episode ?? '(未分集)';
    const group = groups.find((item) => item.episode === episode);
    if (group) group.shotNos.push(shot.shotNo);
    else groups.push({ episode, shotNos: [shot.shotNo] });
    return groups;
  }, []);
  return {
    schemaVersion: 3,
    generatedAt: input.now ?? Date.now(),
    status: reason ? 'blocked' : 'ready',
    projectId: input.projectId,
    videoQualityReviewRequired: input.videoQualityReviewRequired !== false,
    reason,
    shots,
    episodes,
    ...(render ? { render } : {}),
  };
}
