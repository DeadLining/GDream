'use client';
import type {Shot} from '../../lib/types';
export function DirectorShotStrip({shots,selectedId,onSelect}:{shots:Shot[];selectedId:string;onSelect:(id:string)=>void}){return <nav className="director-shot-strip" aria-label="导演镜头">{shots.map(shot=><button key={shot.id} className={shot.id===selectedId?'active':''} onClick={()=>onSelect(shot.id)}><span>{String(shot.position).padStart(2,'0')}</span><strong>{shot.shot_type.replaceAll('_',' ')}</strong></button>)}</nav>}
