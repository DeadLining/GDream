'use client';

import {useEffect,useState} from 'react';
import {AlignCenter,ArrowDownToLine,Magnet,Move3D,RotateCcw,Save,Trash2} from 'lucide-react';
import type {DirectorObject,ShotCamera,Transform,Vector3} from '../../lib/types';

const axes=['X','Y','Z'] as const;
const formatNumber=(value:number,precision=4)=>String(Number(value.toFixed(precision)));

function PositionEditor({transform,onCommit}:{transform:Transform;onCommit:(transform:Transform)=>void}){
  const [draft,setDraft]=useState<[string,string,string]>(()=>transform.position.map(value=>formatNumber(value)) as [string,string,string]);
  useEffect(()=>setDraft(transform.position.map(value=>formatNumber(value)) as [string,string,string]),[transform]);
  const commit=(index:number)=>{
    const value=Number(draft[index]);
    if(!Number.isFinite(value)){
      setDraft(transform.position.map(item=>formatNumber(item)) as [string,string,string]);
      return;
    }
    const position=transform.position.map((item,itemIndex)=>itemIndex===index?value:item) as Vector3;
    if(JSON.stringify(position)!==JSON.stringify(transform.position))onCommit({...transform,position});
  };
  return <div className="director-position-editor">
    <span>本镜头位置</span>
    <div className="director-transform-row">
      <span>位置</span>
      {axes.map((axis,index)=><label key={axis}><small>{axis}</small><input type="number" aria-label={`位置 ${axis}`} step="0.01" value={draft[index]} onChange={event=>setDraft(current=>current.map((item,itemIndex)=>itemIndex===index?event.target.value:item) as [string,string,string])} onBlur={()=>commit(index)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>)}
    </div>
  </div>;
}

function HorizontalFacingEditor({transform,onCommit}:{transform:Transform;onCommit:(transform:Transform)=>void}){
  const degrees=transform.rotation[1]*180/Math.PI;
  const [draft,setDraft]=useState(()=>formatNumber(degrees,1));
  useEffect(()=>setDraft(formatNumber(degrees,1)),[degrees]);
  const commit=()=>{
    const value=Number(draft);
    if(!Number.isFinite(value)){setDraft(formatNumber(degrees,1));return;}
    const rotation:[number,number,number]=[transform.rotation[0],value*Math.PI/180,transform.rotation[2]];
    if(JSON.stringify(rotation)!==JSON.stringify(transform.rotation))onCommit({...transform,rotation});
  };
  return <label className="director-facing-control"><span>水平朝向</span><input type="number" aria-label="水平朝向" min="-180" max="180" step="1" value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/><small>度</small></label>;
}

export function DirectorInspector({
  object,
  camera,
  snapEnabled,
  hasShotOverride,
  onSnapEnabledChange,
  onGroundObject,
  onCenterObject,
  onObjectTransformChange,
  onCameraChange,
  onSaveCamera,
  onShotVisibilityChange,
  onRenameObject,
  onResetShotOverride,
  onDeleteObject,
}:{
  object:DirectorObject|null;
  camera:ShotCamera;
  snapEnabled:boolean;
  hasShotOverride:boolean;
  onSnapEnabledChange:(enabled:boolean)=>void;
  onGroundObject:()=>void;
  onCenterObject:()=>void;
  onObjectTransformChange:(transform:Transform)=>void;
  onCameraChange:(value:number)=>void;
  onSaveCamera:()=>void;
  onShotVisibilityChange:(visible:boolean)=>void;
  onRenameObject:(label:string)=>void;
  onResetShotOverride:()=>void;
  onDeleteObject:()=>void;
}){
  const [labelDraft,setLabelDraft]=useState(object?.label??'');
  useEffect(()=>setLabelDraft(object?.label??''),[object?.id,object?.label]);
  return <aside className="director-inspector">
    <header><strong>{object?.label??'镜头相机'}</strong></header>
    {object&&<section>
      <div className="director-object-name"><input aria-label="对象名称" value={labelDraft} onChange={event=>setLabelDraft(event.target.value)}/><button type="button" className="command-button" aria-label="保存对象名称" disabled={!labelDraft.trim()||labelDraft.trim()===object.label} onClick={()=>onRenameObject(labelDraft.trim())}><Save size={14}/></button></div>
      <div className="director-transform-tools" role="toolbar" aria-label="实体位置工具">
        <button type="button" aria-label="移动对象" title="移动对象" aria-pressed="true"><Move3D size={15}/></button>
        <button type="button" aria-label="对象落地" title="对象落地" onClick={onGroundObject}><ArrowDownToLine size={15}/></button>
        <button type="button" aria-label="画面中心" title="画面中心" onClick={onCenterObject}><AlignCenter size={15}/></button>
        <button type="button" aria-label="网格吸附" title="网格吸附" aria-pressed={snapEnabled} onClick={()=>onSnapEnabledChange(!snapEnabled)}><Magnet size={15}/></button>
      </div>
      <PositionEditor transform={object.transform} onCommit={onObjectTransformChange}/>
      {object.kind==='character'&&<HorizontalFacingEditor transform={object.transform} onCommit={onObjectTransformChange}/>}
      <label className="director-checkbox"><input type="checkbox" aria-label="本镜头显示" checked={object.visible} onChange={event=>onShotVisibilityChange(event.target.checked)}/><span>本镜头显示</span></label>
      <button className="command-button" disabled={!hasShotOverride} onClick={onResetShotOverride}><RotateCcw size={14}/>重置本镜头位置</button>
      <button className="command-button director-danger" onClick={onDeleteObject}><Trash2 size={14}/>删除场景对象</button>
    </section>}
    <section>
      <span>镜头视角</span>
      <label htmlFor="director-focal">焦距</label>
      <input id="director-focal" aria-label="焦距" type="number" min="12" max="200" value={camera.focal_length_mm} onChange={event=>onCameraChange(Number(event.target.value))}/>
      <label>机位</label><div className="director-vector">{camera.position.map((value,index)=><output key={index}>{formatNumber(value,2)}</output>)}</div>
      <label>看向</label><div className="director-vector">{camera.target.map((value,index)=><output key={index}>{formatNumber(value,2)}</output>)}</div>
      <button className="command-button" aria-label="保存相机" onClick={onSaveCamera}><Save size={14}/>保存镜头视角</button>
    </section>
  </aside>;
}
