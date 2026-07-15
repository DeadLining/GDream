'use client';

import {AlignCenter,ArrowDownToLine,Move3D,Rotate3D,RotateCcw,Scaling,Trash2} from 'lucide-react';
import {DIRECTOR_POSE_PRESETS} from '../../lib/director-poses';
import type {DirectorObject,DirectorPosePreset,DirectorTransformMode,ShotCamera} from '../../lib/types';

const transformTools=[
  {mode:'translate' as const,label:'平移对象',icon:Move3D},
  {mode:'rotate' as const,label:'旋转对象',icon:Rotate3D},
  {mode:'scale' as const,label:'缩放对象',icon:Scaling},
];

export function DirectorInspector({
  object,
  camera,
  cameraMode,
  transformMode,
  hasShotOverride,
  onTransformModeChange,
  onGroundObject,
  onCenterObject,
  onCameraChange,
  onSaveCamera,
  onPoseChange,
  onShotVisibilityChange,
  onResetShotOverride,
  onDeleteObject,
}:{
  object:DirectorObject|null;
  camera:ShotCamera;
  cameraMode:boolean;
  transformMode:DirectorTransformMode;
  hasShotOverride:boolean;
  onTransformModeChange:(mode:DirectorTransformMode)=>void;
  onGroundObject:()=>void;
  onCenterObject:()=>void;
  onCameraChange:(value:number)=>void;
  onSaveCamera:()=>void;
  onPoseChange:(pose:DirectorPosePreset)=>void;
  onShotVisibilityChange:(visible:boolean)=>void;
  onResetShotOverride:()=>void;
  onDeleteObject:()=>void;
}){
  const pose=(typeof object?.appearance.pose_preset==='string'?object.appearance.pose_preset:'neutral') as DirectorPosePreset;
  const poseable=Boolean(object?.kind==='character'&&object.source_type==='model'&&object.metadata.has_skeleton);
  return <aside className="director-inspector">
    <header><strong>{object?.label??'镜头相机'}</strong></header>
    {object&&<section>
      <div className="director-transform-tools" role="toolbar" aria-label="对象变换工具">
        {transformTools.map(({mode,label,icon:Icon})=><button key={mode} type="button" aria-label={label} title={label} aria-pressed={transformMode===mode} onClick={()=>onTransformModeChange(mode)}><Icon size={15}/></button>)}
        <button type="button" aria-label="对象落地" title="对象落地" onClick={onGroundObject}><ArrowDownToLine size={15}/></button>
        <button type="button" aria-label="场景居中" title="场景居中" onClick={onCenterObject}><AlignCenter size={15}/></button>
      </div>
      <span>位置</span>
      <div className="director-vector">{object.transform.position.map((value,index)=><output key={index}>{value.toFixed(2)}</output>)}</div>
      {cameraMode&&object.kind==='character'&&object.source_type==='model'&&<>
        <label htmlFor="director-pose">角色姿态</label>
        <select id="director-pose" value={pose} disabled={!poseable} onChange={event=>onPoseChange(event.target.value as DirectorPosePreset)}>
          {DIRECTOR_POSE_PRESETS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </>}
      {cameraMode&&<>
        <label className="director-checkbox"><input type="checkbox" aria-label="本镜头显示" checked={object.visible} onChange={event=>onShotVisibilityChange(event.target.checked)}/><span>本镜头显示</span></label>
        <button className="command-button" disabled={!hasShotOverride} onClick={onResetShotOverride}><RotateCcw size={14}/>重置本镜头覆盖</button>
      </>}
      <button className="command-button director-danger" onClick={onDeleteObject}><Trash2 size={14}/>删除场景对象</button>
    </section>}
    <section>
      {cameraMode&&<>
        <span>机位</span><div className="director-vector" aria-label="相机位置">{camera.position.map((value,index)=><output key={index}>{value.toFixed(2)}</output>)}</div>
        <span>目标点</span><div className="director-vector" aria-label="相机目标点">{camera.target.map((value,index)=><output key={index}>{value.toFixed(2)}</output>)}</div>
      </>}
      <label htmlFor="director-focal">焦距</label>
      <input id="director-focal" type="number" min="12" max="300" value={camera.focal_length_mm} onChange={event=>onCameraChange(Number(event.target.value))}/>
      <button className="command-button" onClick={onSaveCamera}>保存相机</button>
    </section>
  </aside>;
}
