import {LoaderCircle} from 'lucide-react';
import type {EpisodeDetail, Job, Shot} from '../lib/types';
import {ShotCard} from './ShotCard';

export function Storyboard({episode, selectedId, onSelect, onPlan, job, planStarting = false}: {episode: EpisodeDetail | null; selectedId: string | null; onSelect: (shot: Shot) => void; onPlan: () => void; job: Job | null; planStarting?: boolean}) {
  if (!episode) return <main className="storyboard center-state"><h1>新建剧集</h1><p>从左侧创建本系列的第一集。</p></main>;
  const planning = planStarting || job?.status === 'queued' || job?.status === 'running';
  const planningLabel = planStarting ? '正在启动' : job?.status === 'queued' ? '规划排队中' : `规划中 ${job?.progress ?? 0}%`;
  const replacePlan = () => {
    if (!window.confirm('重新生成会替换当前场景、镜头和对白，并可能使已有生产素材失效。确定继续吗？')) return;
    onPlan();
  };
  return <main className="storyboard">
    <div className="storyboard-header">
      <div><span className="eyebrow">制作剧集</span><h1>{episode.title}</h1><p>{episode.premise}</p></div>
      <div className="storyboard-header-actions"><div className="duration-readout"><strong>{episode.target_duration_seconds}s</strong><span>目标时长</span></div>{episode.scenes.length>0&&<button className="command-button" disabled={planning} onClick={replacePlan}>{planning?planningLabel:'重新生成分镜'}</button>}</div>
    </div>
    {!episode.scenes.length ? <section className="episode-empty"><h2>尚未生成分镜</h2><p>使用 MiniMax-M3 根据项目设定生成场景、镜头和对白。</p><button className="primary-action planning-action" aria-label={planStarting ? '正在启动剧本规划' : undefined} disabled={planning} onClick={onPlan}>{planning && <LoaderCircle aria-label="剧本规划启动中" className="planning-spinner" size={16}/>}<span>{planning ? planningLabel : '生成剧本与分镜'}</span></button>{job?.status === 'failed' && <p className="form-error">{job.error}</p>}</section> : episode.scenes.map(scene => <section className="scene-section" key={scene.id}>
      <header className="scene-heading"><span>场景 {scene.position}</span><h2>{scene.location}</h2><p>{scene.summary}</p><time>{scene.estimated_duration_seconds}s</time></header>
      <div className="shots-grid">{scene.shots.map(shot => <ShotCard key={shot.id} shot={shot} selected={selectedId === shot.id} onSelect={() => onSelect(shot)}/>)}</div>
    </section>)}
  </main>;
}
