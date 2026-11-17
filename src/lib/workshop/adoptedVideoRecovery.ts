import type { AssetCandidate, WorkshopData } from './types.ts';
import { videoAdoptionIsCurrent, videoCandidateFingerprint } from './productionLifecycle.ts';

interface RecoveryNode {
  data?: {
    workshopRef?: { projectId?: string; kind?: string; role?: string; id?: string; shotId?: string };
    assetVersions?: AssetCandidate[];
  };
}

/** Only recover an existing, explicitly adopted record; never invent candidate metadata. */
export function adoptedVideoRecoveryCandidates(data: WorkshopData, nodes: RecoveryNode[]): {
  shotNo: string;
  candidate: AssetCandidate;
}[] {
  return data.shots.flatMap((shot) => {
    if (!videoAdoptionIsCurrent(shot)
      || shot.videoCandidates?.some((candidate) => candidate.path === shot.videoPath)
      || shot.deletedVideoCandidatePaths?.includes(shot.videoPath!)) return [];
    for (const node of nodes) {
      const ref = node?.data?.workshopRef;
      if (ref?.projectId !== data.projectId || ref.kind !== 'shot' || ref.role !== 'shot-video') continue;
      if (ref.shotId ? ref.shotId !== shot.id : ref.id !== shot.shotNo) continue;
      const candidate = node.data?.assetVersions?.find((item) => item.path === shot.videoPath
        && item.checksum
        && videoCandidateFingerprint(item) === shot.videoProductionBinding!.candidateFingerprint);
      if (candidate) return [{ shotNo: shot.shotNo, candidate }];
    }
    return [];
  });
}
