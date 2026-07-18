'use client';
import type {Shot,ShotGenerationReadiness} from '../../lib/types';

export function DirectorShotStrip({shots,selectedId,readinessByShot,dirtyShotId=null,disabled=false,onSelect}:{shots:Shot[];selectedId:string;readinessByShot:Record<string,ShotGenerationReadiness>;dirtyShotId?:string|null;disabled?:boolean;onSelect:(id:string)=>void}){
  return <nav className="director-shot-strip" aria-label="导演镜头">{shots.map(shot=>{
    const selected=shot.id===selectedId;
    const number=String(shot.position).padStart(2,'0');
    const readiness=readinessByShot[shot.id];
    const cameraDirty=shot.id===dirtyShotId;
    const cameraReady=Boolean(readiness?.camera_ready)&&!cameraDirty;
    const cameraLabel=cameraDirty?'预览待更新':cameraReady?'预览已保存':'预览未保存';
    const states=[['资',readiness?.asset_ready,readiness?.asset_ready?'资产已就绪':'资产未就绪'],['位',readiness?.blocking_ready,readiness?.blocking_ready?'站位已就绪':'站位未就绪'],['预',cameraReady,cameraLabel]] as const;
    return <div key={shot.id} className={`director-shot-item${selected?' active':''}`}>
      <button type="button" className="director-shot-select" aria-label={`镜头 ${number}：${shot.shot_type.replaceAll('_',' ')}`} aria-pressed={selected} disabled={disabled} onClick={()=>onSelect(shot.id)}>
        <span>{number}</span><strong>{shot.shot_type.replaceAll('_',' ')}</strong>
      </button>
      <span className="director-shot-status" role="status" aria-label={`镜头 ${number} 就绪状态`}>
        {states.map(([short,ready,label])=><span key={short} className={ready?'ready':''} aria-label={`镜头 ${number} ${label}`} title={label}>{short}</span>)}
      </span>
    </div>;
  })}</nav>;
}
