'use client';

import {Box,Image as ImageIcon,Plus,RefreshCw,UserRound} from 'lucide-react';
import type {DirectorAsset,DirectorObject} from '../../lib/types';

export function DirectorObjectTree({objects,assets,selectedId,syncing,onSelect,onAdd,onSync}:{objects:DirectorObject[];assets:DirectorAsset[];selectedId:string|null;syncing:boolean;onSelect:(id:string)=>void;onAdd:()=>void;onSync:()=>void}){
  const synced=new Set(objects.map(item=>String(item.metadata.catalog_key??'')));
  return <aside className="director-object-tree">
    <header><strong>场景对象</strong><button className="icon-button" aria-label="添加占位物" title="添加占位物" onClick={onAdd}><Plus size={16}/></button></header>
    <div className="director-object-list">{objects.length?objects.map(item=>{
      const needsModel=Boolean(item.kind!=='background'&&item.metadata.requires_3d_model);
      return <button key={item.id} className={selectedId===item.id?'active':''} title={needsModel?'当前为 3D 占位物，等待模型':undefined} onClick={()=>onSelect(item.id)}>{item.kind==='character'?<UserRound size={15}/>:<Box size={15}/>}<span>{item.label}</span>{needsModel&&<small>待建模</small>}</button>;
    }):<p>场景中还没有对象</p>}</div>
    <header><strong>可用资产</strong><button className="icon-button" aria-label="同步可用资产" title="同步可用资产" disabled={syncing||!assets.length} onClick={onSync}><RefreshCw size={15}/></button></header>
    <div className="director-asset-list"><p>已同步 {assets.filter(item=>synced.has(item.key)).length} / {assets.length}</p>{assets.map(item=>{
      const model=item.media_type==='model/gltf-binary';
      const needsModel=item.kind!=='background'&&!model;
      return <div key={item.key} className={synced.has(item.key)?'synced':''}>{item.media_url&&!model?<img src={item.media_url} alt=""/>:model?<Box size={15}/>:item.kind==='character'?<UserRound size={15}/>:<ImageIcon size={15}/>}<span>{item.label}</span><small>{synced.has(item.key)?needsModel?'已同步 · 待生成 3D':'已同步':model?'3D 模型':needsModel?'待生成 3D':item.media_url?'背景图片':'场景上下文'}</small></div>;
    })}</div>
  </aside>;
}
