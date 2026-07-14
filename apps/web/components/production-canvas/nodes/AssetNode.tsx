import {Handle,Position} from '@xyflow/react';

export function AssetNode({data}:{data:any}){
  return <button className={`production-asset-node ${data.zoom<.55?'semantic-compact':''}`} aria-label={data.label} onClick={data.onSelect}>
    {data.media_url?<img className="production-node-thumbnail" src={data.media_url} alt=""/>:<span className="production-node-placeholder">资产</span>}
    <span className="production-node-title"><strong>{data.label}</strong><small>v{data.version}</small></span><span className="production-node-meta">{data.status}</span>
    <Handle type="source" position={Position.Right}/>
  </button>;
}
