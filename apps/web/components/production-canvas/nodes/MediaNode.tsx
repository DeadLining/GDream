import {Handle,Position} from '@xyflow/react';
import {AudioLines,Clapperboard,Image as ImageIcon,ShieldCheck} from 'lucide-react';

const labels:Record<string,string>={'panel':'画面','speech-task':'语音','video-task':'视频','review':'审核'};
const icons:Record<string,typeof ImageIcon>={'panel':ImageIcon,'speech-task':AudioLines,'video-task':Clapperboard,'review':ShieldCheck};

export function MediaNode({id,data,type}:{id?:string;data:any;type?:string}){
  const nodeType=type??String(id??'').split(':')[0];
  const normalized=nodeType==='speech'?'speech-task':nodeType==='video'?'video-task':nodeType;
  const label=labels[normalized]??'生产节点';
  const Icon=icons[normalized]??ImageIcon;
  const complete=normalized==='review'?data.status==='approved':normalized==='speech-task'?Boolean(data.complete):Boolean(data.assetId);
  return <button className={`production-media-node ${data.zoom<.55?'semantic-compact':''}`} aria-label={`镜头 ${String(data.shotId).replace('shot-','').padStart(2,'0')} ${label}`} onClick={data.onSelect}>
    <Handle type="target" position={Position.Left}/>
    {data.mediaUrl?<img className="production-media-thumbnail" src={data.mediaUrl} alt=""/>:<span className="production-media-icon"><Icon size={20}/></span>}
    <span><strong>{label}</strong><small className={complete?'done':''}>{data.statusLabel??(complete?'已完成':'待处理')}</small></span>
    <Handle type="source" position={Position.Right}/>
  </button>;
}
