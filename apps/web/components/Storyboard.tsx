import {Box, LoaderCircle} from 'lucide-react';
import {mediaUrl} from '../lib/api';
import type {EpisodeDetail, Job, Shot} from '../lib/types';
import {ShotCard} from './ShotCard';

export function Storyboard({episode, selectedId, onSelect, onPlan, onOpenDirector, job, planStarting = false}: {episode: EpisodeDetail | null; selectedId: string | null; onSelect: (shot: Shot) => void; onPlan: () => void; onOpenDirector?: (shotId: string) => void; job: Job | null; planStarting?: boolean}) {
  if (!episode) return <main className="storyboard center-state"><h1>新建剧集</h1><p>从左侧创建本系列的第一集。</p></main>;
  const planning = planStarting || job?.status === 'queued' || job?.status === 'running';
  const planningLabel = planStarting ? '正在启动' : job?.status === 'queued' ? '规划排队中' : `规划中 ${job?.progress ?? 0}%`;
  return <main className="storyboard">
    <div className="storyboard-header">
      <div><span className="eyebrow">制作剧集</span><h1>{episode.title}</h1><p>{episode.premise}</p></div>
      <div className="storyboard-header-actions">{onOpenDirector && <button className="command-button storyboard-director-action" onClick={() => onOpenDirector(selectedId ?? '')}><Box size={15} aria-hidden="true"/>打开 3D 导演台</button>}<div className="duration-readout"><strong>{episode.target_duration_seconds}s</strong><span>目标时长</span></div></div>
    </div>
    {!episode.scenes.length ? <section className="episode-empty"><h2>尚未生成分镜</h2><p>根据本集标题、剧情设定和项目角色生成场景、镜头与对白。</p><button className="primary-action planning-action" aria-label={planStarting ? '正在启动分镜规划' : undefined} disabled={planning} onClick={onPlan}>{planning && <LoaderCircle aria-label="分镜规划启动中" className="planning-spinner" size={16}/>}<span>{planning ? planningLabel : '根据本集设定生成分镜'}</span></button>{job?.status === 'failed' && <p className="form-error">{job.error}</p>}</section> : episode.scenes.map(scene => <section className="scene-section" key={scene.id}>
      <header className={`scene-heading ${scene.reference_media_url?'has-reference':''}`}>{scene.reference_media_url&&<img src={mediaUrl(scene.reference_media_url)} alt={`${scene.location}场景参考图`}/>}<span>场景 {scene.position}</span><h2>{scene.location}</h2><p>{scene.summary}</p><time>{scene.estimated_duration_seconds}s</time></header>
      <div className="shots-grid">{scene.shots.map((shot, index) => {
        const nextShot = scene.shots[index + 1];
        const isTailSource = Boolean(
          nextShot?.previous_shot_tail_asset_id && nextShot.previous_shot_tail_asset_id === shot.active_panel_asset_id
        );
        return <ShotCard
          key={shot.id}
          shot={shot}
          selected={selectedId === shot.id}
          onSelect={() => onSelect(shot)}
          isTailSource={isTailSource}
        />;
      })}</div>
    </section>)}
  </main>;
}
