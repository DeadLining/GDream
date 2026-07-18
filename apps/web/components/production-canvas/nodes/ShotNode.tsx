import {Handle,Position} from '@xyflow/react';

export function ShotNode({data}:{data:any}){
  return <button className={`production-shot-node ${data.zoom<.55?'semantic-compact':''}`} aria-label={`镜头 ${String(data.position).padStart(2,'0')}：${data.shot_type}`} onClick={data.onSelect}>
    <Handle type="target" position={Position.Left}/>
    {data.active_panel_media_url?<img className="production-node-thumbnail" src={data.active_panel_media_url} alt=""/>:<span className="production-node-placeholder">等待画面</span>}
    <span className="production-node-title"><strong>镜头 {String(data.position).padStart(2,'0')}</strong><small>{data.duration_seconds}s</small></span>
    <span className="production-node-meta">{data.shot_type}</span>
    <span className="production-stage-indicators" aria-label="生产阶段"><i className={data.active_panel_asset_id?'done':''} title="画面"/><i className={data.dialogue_count&&data.speech_ready_count===data.dialogue_count?'done':''} title="配音"/><i className={data.active_video_asset_id?'done':''} title="视频"/><i className={data.review_status==='approved'?'done':''} title="审核"/></span>
    <Handle id="production-main" type="source" position={Position.Right} style={{top:'32%'}}/>
    <Handle id="dialogue-branch" type="source" position={Position.Right} style={{top:'76%'}}/>
  </button>;
}
