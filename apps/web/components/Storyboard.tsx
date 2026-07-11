import type {EpisodeDetail, Shot} from '../lib/types';
import {ShotCard} from './ShotCard';

export function Storyboard({episode, selectedId, onSelect}: {episode: EpisodeDetail; selectedId: string; onSelect: (shot: Shot) => void}) {
  return (
    <main className="storyboard">
      <div className="storyboard-header">
        <div><span className="eyebrow">第 1 集</span><h1>{episode.title}</h1><p>{episode.premise}</p></div>
        <div className="duration-readout"><strong>{episode.target_duration_seconds}s</strong><span>目标时长</span></div>
      </div>
      {episode.scenes.map((scene) => (
        <section className="scene-section" key={scene.id}>
          <div className="scene-heading"><span>场景 {scene.position}</span><h2>{scene.location}</h2><p>{scene.summary}</p><time>{scene.estimated_duration_seconds}s</time></div>
          <div className="shots-grid">
            {scene.shots.map((shot) => <ShotCard key={shot.id} shot={shot} selected={selectedId === shot.id} onSelect={() => onSelect(shot)} />)}
          </div>
        </section>
      ))}
    </main>
  );
}
