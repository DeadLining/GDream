import {Pin,PinOff} from 'lucide-react';
import type {ProductionGraphShot,ProductionItem,ProductionWorkflowBinding} from '../../lib/types';
import type {ProductionCanvasNode} from '../../lib/production-canvas';

const labels:Record<string,string>={panel:'画面节点','speech-task':'语音节点','video-task':'视频节点',review:'审核节点'};

export function ProductionCanvasInspector({node,shot,workflows,items,pinned,onTogglePin}:{node:ProductionCanvasNode|null;shot:ProductionGraphShot|null;workflows:ProductionWorkflowBinding[];items:ProductionItem[];pinned:boolean;onTogglePin:()=>void}){
  if(!node)return <aside className="production-canvas-inspector" aria-label="生产节点检查器"><p>选择镜头或生产节点查看依赖</p></aside>;
  if(node.type==='scene-group')return <aside className="production-canvas-inspector" aria-label="生产节点检查器"><header><small>场景分组</small><h2>场景 {String(node.data.position).padStart(2,'0')}</h2></header><section><h3>{String(node.data.location)}</h3><p>{String(node.data.summary||'暂无场景说明')}</p></section><dl><div><dt>镜头数量</dt><dd>{String(node.data.shotCount)}</dd></div><div><dt>显示状态</dt><dd>{node.data.collapsed?'已折叠':'已展开'}</dd></div></dl></aside>;
  if(node.type==='asset')return <aside className="production-canvas-inspector" aria-label="生产节点检查器"><header><small>共享资产</small><h2>{String(node.data.label)}</h2></header><dl><div><dt>版本</dt><dd>v{String(node.data.version)}</dd></div><div><dt>状态</dt><dd>{String(node.data.status)}</dd></div><div><dt>使用镜头</dt><dd>{Array.isArray(node.data.shot_ids)?node.data.shot_ids.length:0}</dd></div></dl></aside>;
  if(!shot)return <aside className="production-canvas-inspector" aria-label="生产节点检查器"><p>当前节点缺少镜头上下文</p></aside>;
  const stage=node.type==='panel'?'panel':node.type==='speech-task'?'speech':node.type==='video-task'?'video':null;
  const targetIds=stage==='speech'?new Set(shot.dialogue_ids??[]):new Set([shot.id]);
  const task=stage?[...items].reverse().find(item=>targetIds.has(item.target_id)&&item.stage===stage):null;
  const capability=node.type==='panel'?'panel':node.type==='video-task'?'video':null;
  const binding=capability?workflows.find(item=>item.capability===capability&&item.enabled):null;
  if(node.type!=='shot')return <aside className="production-canvas-inspector" aria-label="生产节点检查器">
    <header><small>镜头 {String(shot.position).padStart(2,'0')}</small><h2>{labels[node.type]??'生产节点'}</h2></header>
    <dl><div><dt>状态</dt><dd>{task?.status??(node.data.assetId?'已生成':node.type==='review'?String(node.data.status):'待处理')}</dd></div>{Boolean(node.data.assetId)&&<div><dt>资产 ID</dt><dd className="production-inspector-id">{String(node.data.assetId)}</dd></div>}{task&&<div><dt>尝试次数</dt><dd>{task.attempt_count}</dd></div>}</dl>
    {binding&&<section><h3>执行工作流</h3><p>{binding.workflow_id} · v{binding.workflow_version}</p><small>输入映射 v{binding.input_mapping_version}</small></section>}
    {task?.error&&<section className="production-inspector-error"><h3>失败原因</h3><p>{task.error}</p></section>}
  </aside>;
  return <aside className="production-canvas-inspector" aria-label="生产节点检查器">
    <header><div><small>镜头检查器</small><h2>镜头 {String(shot.position).padStart(2,'0')}</h2></div><button type="button" aria-label={`${pinned?'取消固定':'固定'}镜头 ${String(shot.position).padStart(2,'0')}`} onClick={onTogglePin}>{pinned?<PinOff size={16}/>:<Pin size={16}/>}</button></header>
    <dl><div><dt>景别</dt><dd>{shot.shot_type}</dd></div><div><dt>时长</dt><dd>{shot.duration_seconds}s</dd></div><div><dt>画面状态</dt><dd>{shot.active_panel_asset_id?'已生成':'待生成'}</dd></div><div><dt>视频状态</dt><dd>{shot.active_video_asset_id?'已生成':'待生成'}</dd></div><div><dt>审核</dt><dd>{shot.review_status}</dd></div></dl>
    <section><h3>构图说明</h3><p>{shot.composition}</p></section>
    <section className="production-workflow-bindings"><h3>执行工作流</h3>{(['panel','video'] as const).map(capability=>{
      const binding=workflows.find(item=>item.capability===capability&&item.enabled);
      return <div key={capability}><span>{capability==='panel'?'画面':'视频'}</span><strong>{binding?`${binding.workflow_id} · v${binding.workflow_version}`:'未绑定'}</strong>{binding&&<small>输入映射 v{binding.input_mapping_version}</small>}</div>;
    })}</section>
  </aside>;
}
