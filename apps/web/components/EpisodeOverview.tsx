import type {EpisodeDetail, ProductionReadiness} from '../lib/types';
import {deriveEpisodeOverview} from '../lib/episode-overview';
import {ReadinessBlockers} from './ReadinessBlockers';
import {ShotCard} from './ShotCard';
import {StatusMetric} from './StatusMetric';

export function EpisodeOverview({
  episode,
  readiness,
  onSelectShot,
  onOpenProduction,
  onOpenReview,
}: {
  episode: EpisodeDetail;
  readiness: ProductionReadiness;
  onSelectShot: (id: string) => void;
  onOpenProduction: () => void;
  onOpenReview: () => void;
}) {
  const overview = deriveEpisodeOverview(episode, readiness);
  const shots = episode.scenes.flatMap(scene => scene.shots);

  return (
    <main className="episode-overview">
      <header className="episode-overview-header">
        <div>
          <span className="eyebrow">剧集总览</span>
          <h1>{episode.title}</h1>
          <p>{episode.premise}</p>
        </div>
        <p className="episode-render-status">{overview.renderReady ? '可渲染' : '尚未就绪'}</p>
      </header>

      <section className="episode-overview-facts" aria-label="剧集指标">
        <span>{overview.shotCount} 个镜头</span>
        <span>{overview.dialogueCount} 条对白</span>
        <span>{overview.durationSeconds} 秒</span>
      </section>

      <section className="episode-overview-progress" aria-labelledby="overview-progress-heading">
        <h2 id="overview-progress-heading">制作进度</h2>
        <StatusMetric label="画面进度" {...overview.panelProgress} />
        <StatusMetric label="配音进度" {...overview.speechProgress} />
        <StatusMetric label="审核进度" {...overview.reviewProgress} />
      </section>

      <ReadinessBlockers
        blockers={readiness.blockers}
        onOpenProduction={onOpenProduction}
        onOpenReview={onOpenReview}
      />

      <section className="episode-overview-shots" aria-labelledby="overview-shots-heading">
        <h2 id="overview-shots-heading">镜头</h2>
        <div className="shots-grid">
          {shots.map(shot => (
            <ShotCard
              key={shot.id}
              shot={shot}
              selected={false}
              onSelect={() => onSelectShot(shot.id)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
