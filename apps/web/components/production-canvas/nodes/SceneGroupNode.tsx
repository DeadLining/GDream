import {ChevronDown,ChevronUp} from 'lucide-react';

export function SceneGroupNode({data}:{data:any}){
  return <section className="production-scene-group" style={{width:data.width,height:data.height}} role="group" aria-label={`场景 ${String(data.position).padStart(2,'0')}：${data.location}`}>
    <header><div><strong>场景 {String(data.position).padStart(2,'0')}</strong><span>{data.location}</span><small>{data.shotCount} 个镜头</small></div><button type="button" aria-label={`${data.collapsed?'展开':'折叠'}场景 ${String(data.position).padStart(2,'0')}`} onClick={data.onToggleCollapse}>{data.collapsed?<ChevronDown size={15}/>:<ChevronUp size={15}/>}</button></header>
  </section>;
}
