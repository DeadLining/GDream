import {AlertCircle, ImageOff} from 'lucide-react';
import type {EpisodeDetail, ProductionReadiness} from '../lib/types';

export function ReviewPanel({
  episode,
  readiness,
  onSelectShot,
}: {
  episode: EpisodeDetail;
  readiness: ProductionReadiness;
  onSelectShot: (id: string) => void;
}) {
  const missingPanels = new Set(readiness.blockers.missing_panels);
  const unapprovedShots = new Set(readiness.blockers.unapproved_shots);
  const shots = episode.scenes
    .flatMap(scene => scene.shots.map(shot => ({shot, scenePosition: scene.position})))
    .filter(({shot}) => missingPanels.has(shot.id) || unapprovedShots.has(shot.id));

  return <main className="review-panel">
    <header className="review-panel-header">
      <div><span className="eyebrow">制作审核</span><h1>审核队列</h1></div>
      <span className="review-count">{shots.length} 个待处理镜头</span>
    </header>
    {shots.length ? <div className="review-queue">
      {shots.map(({shot, scenePosition}) => <button className="review-row" key={shot.id} onClick={() => onSelectShot(shot.id)}>
        <span className="review-shot-context"><strong>镜头 {shot.position}</strong><small>场景 {scenePosition} · {shot.composition}</small></span>
        <span className="review-blockers">
          {missingPanels.has(shot.id) && <span className="review-blocker missing"><ImageOff size={14} aria-hidden="true"/>缺少画面</span>}
          {unapprovedShots.has(shot.id) && <span className="review-blocker pending"><AlertCircle size={14} aria-hidden="true"/>待审核</span>}
        </span>
      </button>)}
    </div> : <p className="review-empty">当前没有需要处理的镜头。</p>}
  </main>;
}
