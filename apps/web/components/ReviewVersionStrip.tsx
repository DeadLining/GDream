'use client';

import {useEffect,useState} from 'react';
import {Check,Clock3} from 'lucide-react';
import {listPanelVersions,mediaUrl} from '../lib/api';
import type {Asset} from '../lib/types';

export function ReviewVersionStrip({shotId,activeAssetId,selectedAssetId,candidateAssetIds,onSelectAsset}:{shotId:string;activeAssetId:string|null;selectedAssetId?:string|null;candidateAssetIds:string[];onSelectAsset?:(asset:Asset)=>void}){
  const [versions,setVersions]=useState<Asset[]>([]);
  useEffect(()=>{let current=true;listPanelVersions(shotId).then(items=>{if(current)setVersions(items);}).catch(()=>{if(current)setVersions([]);});return()=>{current=false;};},[shotId,candidateAssetIds.join(',')]);
  const candidates=new Set(candidateAssetIds);
  return <footer className="review-version-strip" aria-label="真实画面版本记录"><div><span>版本记录</span><strong>{versions.length} 个真实版本</strong></div>{versions.map(asset=>{const active=asset.id===activeAssetId;const selected=asset.id===(selectedAssetId??activeAssetId);const candidate=candidates.has(asset.id);const suffix=candidate?'，审阅候选':active?'，当前版本':'';return <button type="button" key={asset.id} className={candidate?'candidate':active?'current':''} aria-label={`画面版本 V${asset.generation_attempt}${suffix}`} aria-pressed={selected} onClick={()=>onSelectAsset?.(asset)}><span><img src={mediaUrl(asset.media_url)} alt=""/></span><small>V{asset.generation_attempt}{candidate?' 候选':active?' 当前':''}</small>{active?<Check size={12}/>:<Clock3 size={12}/>}</button>;})}</footer>;
}
