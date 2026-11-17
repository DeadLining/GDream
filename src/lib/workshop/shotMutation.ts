import type { AssetCandidate, VideoProductionBinding, WsShot } from './types.ts';
import { videoCandidateFingerprint } from './productionLifecycle.ts';

export function shotStableSelectionId(shot: Pick<WsShot, 'id' | 'shotNo'>): string {
  return shot.id ?? `shot-no:${shot.shotNo}`;
}

export function filterDeletedVideoCandidates(
  candidates: AssetCandidate[] | undefined,
  deletedPaths: string[] | undefined,
  deletedIds: string[] | undefined = undefined,
  deletedNodeIds: string[] | undefined = undefined,
  adoptedBinding?: VideoProductionBinding,
): AssetCandidate[] | undefined {
  if (!candidates) return candidates;
  if (!deletedPaths?.length && !deletedIds?.length && !deletedNodeIds?.length) return candidates;
  const deletedPathSet = new Set(deletedPaths ?? []);
  const deletedIdSet = new Set(deletedIds ?? []);
  const deletedNodeIdSet = new Set(deletedNodeIds ?? []);
  return candidates.filter((candidate) => (
    !deletedPathSet.has(candidate.path)
    && ((candidate.path === adoptedBinding?.path
      && videoCandidateFingerprint(candidate) === adoptedBinding.candidateFingerprint)
      || (!(candidate.candidateId && deletedIdSet.has(candidate.candidateId))
        && !(candidate.originNodeId && deletedNodeIdSet.has(candidate.originNodeId))))
  ));
}

export function applyShotDeletionTombstones(
  current: WsShot,
  patch: Partial<WsShot>,
): Partial<WsShot> {
  if (!Object.prototype.hasOwnProperty.call(patch, 'videoCandidates')) return patch;
  const deletedPaths = patch.deletedVideoCandidatePaths ?? current.deletedVideoCandidatePaths;
  const deletedIds = patch.deletedVideoCandidateIds ?? current.deletedVideoCandidateIds;
  const deletedNodeIds = patch.deletedVideoCandidateNodeIds ?? current.deletedVideoCandidateNodeIds;
  return {
    ...patch,
    videoCandidates: filterDeletedVideoCandidates(patch.videoCandidates, deletedPaths, deletedIds, deletedNodeIds,
      current.videoProductionBinding?.path === current.videoPath ? current.videoProductionBinding : undefined),
  };
}

export function patchShotById(
  shots: WsShot[],
  shotId: string,
  patch: Partial<WsShot>,
): { shots: WsShot[]; applied: boolean } {
  let applied = false;
  const nextShots = shots.map((shot) => {
    if (applied || shot.id !== shotId) return shot;
    applied = true;
    return { ...shot, ...patch };
  });
  return { shots: nextShots, applied };
}

export function shotRewriteTargetIsCurrent(input: {
  requestedProjectId: string;
  requestedShotId: string;
  currentProjectId?: string;
  currentShots?: WsShot[];
}): boolean {
  return input.currentProjectId === input.requestedProjectId
    && Boolean(input.currentShots?.some((shot) => shot.id === input.requestedShotId));
}
