import type {EpisodeDetail, ProductionReadiness} from './types';

export type EpisodeOverviewData = {
  shotCount: number;
  dialogueCount: number;
  durationSeconds: number;
  panelProgress: {ready: number; total: number};
  speechProgress: {ready: number; total: number};
  reviewProgress: {ready: number; total: number};
  renderReady: boolean;
};

export function deriveEpisodeOverview(
  episode: EpisodeDetail,
  readiness: ProductionReadiness,
): EpisodeOverviewData {
  const shots = episode.scenes.flatMap(scene => scene.shots);

  return {
    shotCount: shots.length,
    dialogueCount: shots.flatMap(shot => shot.dialogue).length,
    durationSeconds: shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
    panelProgress: {ready: readiness.ready_counts.panels, total: readiness.totals.shots},
    speechProgress: {ready: readiness.ready_counts.speech, total: readiness.totals.dialogue},
    reviewProgress: {ready: readiness.ready_counts.approved, total: readiness.totals.shots},
    renderReady: readiness.video_ready ?? readiness.ready,
  };
}
