import {Handle,Position} from '@xyflow/react';
import {AudioLines,Box,Clapperboard,Image as ImageIcon,MessageSquareText,ScanEye,Video} from 'lucide-react';

const presentation:Record<string,{label:string;icon:typeof ImageIcon;className:string}>={
  director:{label:'3D 导演',icon:Box,className:'director'},
  'panel-render':{label:'分镜渲染',icon:ImageIcon,className:'panel-render'},
  dialogue:{label:'对白',icon:MessageSquareText,className:'dialogue'},
  tts:{label:'Qwen TTS',icon:AudioLines,className:'tts'},
  'video-render':{label:'视频渲染',icon:Video,className:'video-render'},
  'visual-review':{label:'视觉审阅',icon:ScanEye,className:'visual-review'},
};

const shotLabel=(shotId:unknown)=>String(shotId??'').replace(/^shot-/,'').padStart(2,'0');

export function DomainNode({id,data,type}:{id?:string;data:any;type?:string}){
  const nodeType=type??String(id??'').split(':')[0];
  const view=presentation[nodeType]??{label:'生产节点',icon:Clapperboard,className:'generic'};
  const Icon=view.icon;
  const blocked=Boolean(data.blocked);
  const complete=!blocked&&(nodeType==='visual-review'?data.status==='approved':nodeType==='tts'?Boolean(data.complete):Boolean(data.assetId));
  const detail=data.blockedReason??data.detail??data.statusLabel??'等待输入';
  return <button className={`production-domain-node type-${view.className} ${blocked?'blocked':''} ${data.optional?'optional':''} ${data.zoom<.55?'semantic-compact':''}`} aria-label={`镜头 ${shotLabel(data.shotPosition??data.shotId)} ${view.label}`} onClick={data.onSelect}>
    <Handle id="production-main" type="target" position={Position.Left} style={{top:nodeType==='panel-render'?'38%':'50%'}}/>
    {nodeType==='panel-render'&&<Handle id="director-branch" type="target" position={Position.Left} style={{top:'72%'}}/>}
    <span className="production-domain-node-header"><Icon size={13}/><strong>{view.label}</strong>{data.executorLabel&&<small>{data.executorLabel}</small>}</span>
    {data.mediaUrl?<img className="production-domain-thumbnail" src={data.mediaUrl} alt=""/>:<span className="production-domain-detail">{detail}</span>}
    <span className={`production-domain-status ${complete?'done':''} ${blocked?'blocked':''}`}>{data.statusLabel??(complete?'已完成':'待处理')}</span>
    {data.workflowLabel&&<span className="production-domain-workflow">{data.workflowLabel}</span>}
    <Handle id="production-main" type="source" position={Position.Right}/>
  </button>;
}
