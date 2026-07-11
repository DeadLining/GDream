import type {EpisodeDetail, ProductionReadiness} from '../lib/types';
import {ListChecks, Play} from 'lucide-react';
import {deriveEpisodeOverview} from '../lib/episode-overview';
import {ReadinessBlockers} from './ReadinessBlockers';
import {ShotCard} from './ShotCard';
import {StatusMetric} from './StatusMetric';

const EPISODE_STATUS: Record<string, string> = {
  planned: '已规划',
  draft: '草稿',
  completed: '已完成',
};

function episodeSequence(id: string) {
  const sequence = id.match(/(\d+)(?!.*\d)/)?.[1];
  return sequence ? `第 ${sequence.padStart(2, '0')} 集` : '剧集';
}

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
      <header className="episode-overview-header" aria-label="剧集信息">
        <div className="episode-overview-identity">
          <div className="episode-overview-meta">
            <span>{episodeSequence(episode.id)}</span>
            <span>{EPISODE_STATUS[episode.status] ?? episode.status}</span>
            <span>目标 {episode.target_duration_seconds} 秒</span>
          </div>
          <h1>{episode.title}</h1>
          <p>{episode.premise}</p>
        </div>
        <div className="episode-overview-header-actions">
          <span className={`episode-render-status ${overview.renderReady ? 'ready' : 'blocked'}`}>{overview.renderReady ? '可渲染' : '尚未就绪'}</span>
          <button type="button" onClick={onOpenProduction}><Play size={14}/>打开生产</button>
          <button type="button" onClick={onOpenReview}><ListChecks size={14}/>处理阻塞项</button>
        </div>
      </header>

      <section className="episode-overview-progress" aria-labelledby="overview-progress-heading">
        <h2 id="overview-progress-heading" className="visually-hidden">制作进度</h2>
        <StatusMetric label="画面进度" {...overview.panelProgress} />
        <StatusMetric label="配音进度" {...overview.speechProgress} />
        <StatusMetric label="审核进度" {...overview.reviewProgress} />
      </section>

      <ReadinessBlockers
        blockers={readiness.blockers}
        onOpenProduction={onOpenProduction}
        onOpenReview={onOpenReview}
        compact
      />

      <section className="episode-overview-shots" aria-labelledby="overview-shots-heading" aria-label="镜头墙">
        <header className="episode-overview-shots-heading">
          <h2 id="overview-shots-heading">镜头墙</h2>
          <p><span>{overview.shotCount} 个镜头</span><span>{overview.dialogueCount} 条对白</span><span>{overview.durationSeconds} 秒</span></p>
        </header>
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
