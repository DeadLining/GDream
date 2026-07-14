'use client';

import {useEffect, useMemo, useState} from 'react';
import {ArrowRight, Clock3, Film, MapPin, Moon, Sun} from 'lucide-react';
import type {EpisodeDetail} from '../lib/types';

const timeLabel = (value: string) => ({night: '夜晚', day: '白天', dawn: '清晨', dusk: '黄昏'}[value] ?? (value || '未设定'));

export function SceneWorkspace({episode, onOpenShot}: {episode: EpisodeDetail; onOpenShot: (shotId: string) => void}) {
  const [sceneId, setSceneId] = useState(episode.scenes[0]?.id ?? '');
  useEffect(() => {
    if (!episode.scenes.some(scene => scene.id === sceneId)) setSceneId(episode.scenes[0]?.id ?? '');
  }, [episode, sceneId]);
  const scene = episode.scenes.find(item => item.id === sceneId) ?? episode.scenes[0];
  const dialogueCount = useMemo(() => scene?.shots.reduce((total, shot) => total + shot.dialogue.length, 0) ?? 0, [scene]);

  if (!scene) return <main className="scene-workspace scene-workspace-empty"><h1>尚未创建场景</h1><p>完成剧本规划后，场景会在这里形成制作节拍。</p></main>;

  return <main className="scene-workspace">
    <aside className="scene-rail" aria-label="场景列表">
      <header><span>本集场景</span><strong>{episode.scenes.length}</strong></header>
      {episode.scenes.map(item => <button key={item.id} type="button" className={item.id === scene.id ? 'active' : ''} aria-label={`场景 ${String(item.position).padStart(2, '0')} ${item.location}`} onClick={() => setSceneId(item.id)}>
        <span>{String(item.position).padStart(2, '0')}</span>
        <span><strong>{item.location}</strong><small>{item.shots.length} 镜头 · {item.estimated_duration_seconds}s</small></span>
      </button>)}
    </aside>

    <section className="scene-document">
      <header className="scene-document-header">
        <div><span className="eyebrow">场景 {String(scene.position).padStart(2, '0')}</span><h1>{scene.location}</h1><p>{scene.summary}</p></div>
        <div className="scene-metadata">
          <span><MapPin size={14}/>场景地点</span>
          <span>{scene.time_of_day === 'night' ? <Moon size={14}/> : <Sun size={14}/>} {timeLabel(scene.time_of_day)}</span>
          <span><Clock3 size={14}/>{scene.estimated_duration_seconds} 秒</span>
        </div>
      </header>

      <section className="scene-summary-band" aria-label="场景制作摘要">
        <div><span>镜头</span><strong>{scene.shots.length}</strong></div>
        <div><span>对白</span><strong>{dialogueCount}</strong></div>
        <div><span>连续性字段</span><strong>{Object.keys(scene.continuity_state).length}</strong></div>
      </section>

      <section className="scene-beats" aria-labelledby="scene-beats-heading">
        <header><div><h2 id="scene-beats-heading">视觉节拍</h2><p>按镜头顺序组织当前场景的表演与画面推进。</p></div><span>{scene.shots.length} 个节拍</span></header>
        <div className="scene-beat-track">
          {scene.shots.map((shot, index) => <article key={shot.id} className="scene-beat">
            <span className="scene-beat-index">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{shot.composition}</strong><p>{shot.shot_type.replaceAll('_', ' ')} · {shot.camera_motion.replaceAll('_', ' ')} · {shot.duration_seconds}s</p></div>
            <button type="button" aria-label={`打开镜头 ${String(shot.position).padStart(2, '0')}`} onClick={() => onOpenShot(shot.id)}><Film size={15}/><ArrowRight size={14}/></button>
          </article>)}
        </div>
      </section>

      <section className="scene-continuity" aria-labelledby="scene-continuity-heading">
        <h2 id="scene-continuity-heading">连续性状态</h2>
        {Object.keys(scene.continuity_state).length ? <dl>{Object.entries(scene.continuity_state).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl> : <p>当前场景没有额外连续性覆盖，继承本集设定。</p>}
      </section>
    </section>
  </main>;
}
