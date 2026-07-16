'use client';

import {useEffect,useState} from 'react';
import {AlignCenter,ArrowDownToLine,Copy,Magnet,Move3D,Pause,Play,Rotate3D,RotateCcw,Save,Scaling,Trash2} from 'lucide-react';
import {DIRECTOR_ANIMATION_CLIPS} from '../../lib/director-animations';
import {DIRECTOR_POSE_PRESETS} from '../../lib/director-poses';
import {DIRECTOR_PROXY_RIGS,isAnimatedDirectorProxy,resolveDirectorProxyRig} from '../../lib/director-proxies';
import type {DirectorEnvironmentSettings} from '../../lib/director-environment';
import type {DirectorAnimationClip,DirectorObject,DirectorPosePreset,DirectorProxyRig,DirectorTransformMode,ShotCamera,Transform,Vector3} from '../../lib/types';
import {DirectorEnvironmentControls} from './DirectorEnvironmentControls';

const transformTools=[
  {mode:'translate' as const,label:'平移对象',icon:Move3D},
  {mode:'rotate' as const,label:'旋转对象',icon:Rotate3D},
  {mode:'scale' as const,label:'缩放对象',icon:Scaling},
];

const axes=['X','Y','Z'] as const;
type TransformDraft={position:[string,string,string];rotation:[string,string,string];scale:[string,string,string]};

const formatNumber=(value:number,precision=4)=>String(Number(value.toFixed(precision)));
const createDraft=(transform:Transform):TransformDraft=>({
  position:transform.position.map(value=>formatNumber(value)) as TransformDraft['position'],
  rotation:transform.rotation.map(value=>formatNumber(value*180/Math.PI,2)) as TransformDraft['rotation'],
  scale:transform.scale.map(value=>formatNumber(value)) as TransformDraft['scale'],
});

function TransformEditor({transform,onCommit}:{transform:Transform;onCommit:(transform:Transform)=>void}){
  const [draft,setDraft]=useState<TransformDraft>(()=>createDraft(transform));
  useEffect(()=>setDraft(createDraft(transform)),[transform]);
  const update=(kind:keyof TransformDraft,index:number,value:string)=>setDraft(current=>({...current,[kind]:current[kind].map((item,itemIndex)=>itemIndex===index?value:item) as TransformDraft[typeof kind]}));
  const commit=(kind:keyof TransformDraft,index:number)=>{
    const parsed=Number(draft[kind][index]);
    if(!Number.isFinite(parsed)||(kind==='scale'&&parsed<=0)){setDraft(createDraft(transform));return;}
    const value=kind==='rotation'?parsed*Math.PI/180:parsed;
    const vector=transform[kind].map((item,itemIndex)=>itemIndex===index?value:item) as Vector3;
    const next:Transform={...transform,[kind]:vector};
    if(JSON.stringify(next)!==JSON.stringify(transform))onCommit(next);
  };
  const rows:[keyof TransformDraft,string,number][]=[['position','位置',.01],['rotation','旋转',1],['scale','缩放',.01]];
  return <div className="director-transform-editor">
    {rows.map(([kind,label,step])=><div className="director-transform-row" key={kind}>
      <span>{label}</span>
      {axes.map((axis,index)=><label key={axis}><small>{axis}</small><input type="number" aria-label={`${label} ${axis}`} min={kind==='scale'?0.01:undefined} step={step} value={draft[kind][index]} onChange={event=>update(kind,index,event.target.value)} onBlur={()=>commit(kind,index)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>)}
    </div>)}
  </div>;
}

export function DirectorInspector({
  object,
  environment,
  environmentSaving,
  sceneVisible,
  camera,
  cameraMode,
  transformMode,
  snapEnabled,
  hasShotOverride,
  onTransformModeChange,
  onSnapEnabledChange,
  onGroundObject,
  onCenterObject,
  onObjectTransformChange,
  onCameraChange,
  onSaveCamera,
  onPoseChange,
  onBodyProfileChange,
  onProxyRigChange,
  onAnimationChange,
  onAnimationPlayingChange,
  onShotVisibilityChange,
  onSceneVisibilityChange,
  onRenameObject,
  onDuplicateObject,
  onSaveEnvironment,
  onResetShotOverride,
  onDeleteObject,
}:{
  object:DirectorObject|null;
  environment:Record<string,unknown>;
  environmentSaving:boolean;
  sceneVisible:boolean;
  camera:ShotCamera;
  cameraMode:boolean;
  transformMode:DirectorTransformMode;
  snapEnabled:boolean;
  hasShotOverride:boolean;
  onTransformModeChange:(mode:DirectorTransformMode)=>void;
  onSnapEnabledChange:(enabled:boolean)=>void;
  onGroundObject:()=>void;
  onCenterObject:()=>void;
  onObjectTransformChange:(transform:Transform)=>void;
  onCameraChange:(value:number)=>void;
  onSaveCamera:()=>void;
  onPoseChange:(pose:DirectorPosePreset)=>void;
  onBodyProfileChange:(key:'proxy_height'|'proxy_shoulder_width'|'proxy_body_width',value:number)=>void;
  onProxyRigChange:(rig:DirectorProxyRig)=>void;
  onAnimationChange:(clip:DirectorAnimationClip)=>void;
  onAnimationPlayingChange:(playing:boolean)=>void;
  onShotVisibilityChange:(visible:boolean)=>void;
  onSceneVisibilityChange:(visible:boolean)=>void;
  onRenameObject:(label:string)=>void;
  onDuplicateObject:()=>void;
  onSaveEnvironment:(settings:DirectorEnvironmentSettings)=>void;
  onResetShotOverride:()=>void;
  onDeleteObject:()=>void;
}){
  const [labelDraft,setLabelDraft]=useState(object?.label??'');
  useEffect(()=>setLabelDraft(object?.label??''),[object?.id,object?.label]);
  const pose=(typeof object?.appearance.pose_preset==='string'?object.appearance.pose_preset:'neutral') as DirectorPosePreset;
  const animation=(typeof object?.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip;
  const animationPlaying=object?.appearance.animation_playing===true;
  const modelUrl=typeof object?.appearance.model_url==='string'?object.appearance.model_url.trim():'';
  const proxyRig=object?resolveDirectorProxyRig(object):'prop_box';
  const usesProxy=Boolean(object&&!modelUrl&&object.kind!=='background'&&object.kind!=='light');
  const humanoidProxy=usesProxy&&proxyRig==='standard_humanoid';
  const animatedProxy=usesProxy&&isAnimatedDirectorProxy(proxyRig);
  const poseable=Boolean(object?.kind==='character'&&(humanoidProxy||(object.source_type==='model'&&object.metadata.has_skeleton)));
  const bodyControls=[
    ['proxy_height','角色身高',.75,1.3],
    ['proxy_shoulder_width','肩宽',.7,1.35],
    ['proxy_body_width','体型',.7,1.4],
  ] as const;
  return <aside className="director-inspector">
    <header><strong>{object?.label??'镜头相机'}</strong></header>
    {!cameraMode&&<DirectorEnvironmentControls environment={environment} saving={environmentSaving} onSave={onSaveEnvironment}/>}
    {object&&<section>
      <div className="director-object-name"><input aria-label="对象名称" value={labelDraft} onChange={event=>setLabelDraft(event.target.value)}/><button type="button" className="command-button" aria-label="保存对象名称" disabled={!labelDraft.trim()||labelDraft.trim()===object.label} onClick={()=>onRenameObject(labelDraft.trim())}><Save size={14}/></button></div>
      <div className="director-transform-tools" role="toolbar" aria-label="对象变换工具">
        {transformTools.map(({mode,label,icon:Icon})=><button key={mode} type="button" aria-label={label} title={label} aria-pressed={transformMode===mode} onClick={()=>onTransformModeChange(mode)}><Icon size={15}/></button>)}
        <button type="button" aria-label="对象落地" title="对象落地" onClick={onGroundObject}><ArrowDownToLine size={15}/></button>
        <button type="button" aria-label="场景居中" title="场景居中" onClick={onCenterObject}><AlignCenter size={15}/></button>
        <button type="button" aria-label="网格吸附" title="网格吸附" aria-pressed={snapEnabled} onClick={()=>onSnapEnabledChange(!snapEnabled)}><Magnet size={15}/></button>
      </div>
      <TransformEditor transform={object.transform} onCommit={onObjectTransformChange}/>
      {!cameraMode&&usesProxy&&<><label htmlFor="director-proxy-rig">3D 代理模板</label><select id="director-proxy-rig" value={proxyRig} onChange={event=>onProxyRigChange(event.target.value as DirectorProxyRig)}>{DIRECTOR_PROXY_RIGS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></>}
      {!cameraMode&&humanoidProxy&&<div className="director-body-profile">
        {bodyControls.map(([key,label,min,max])=><label key={`${object.id}-${key}`}><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step="0.05" defaultValue={typeof object.appearance[key]==='number'?object.appearance[key] as number:1} onBlur={event=>{const value=Number(event.currentTarget.value);if(Number.isFinite(value))onBodyProfileChange(key,Math.min(max,Math.max(min,value)));}}/></label>)}
      </div>}
      {cameraMode&&poseable&&<>
        <label htmlFor="director-pose">角色姿态</label>
        <select id="director-pose" value={pose} onChange={event=>onPoseChange(event.target.value as DirectorPosePreset)}>
          {DIRECTOR_POSE_PRESETS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </>}
      {cameraMode&&animatedProxy&&<div className="director-animation-controls">
        <label htmlFor="director-animation">动画片段</label>
        <div><select id="director-animation" value={animation} onChange={event=>onAnimationChange(event.target.value as DirectorAnimationClip)}>{DIRECTOR_ANIMATION_CLIPS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><button type="button" className="command-button" aria-label={animationPlaying?'暂停动画':'播放动画'} onClick={()=>onAnimationPlayingChange(!animationPlaying)}>{animationPlaying?<Pause size={14}/>:<Play size={14}/>}</button></div>
      </div>}
      {cameraMode&&<>
        <label className="director-checkbox"><input type="checkbox" aria-label="本镜头显示" checked={object.visible} onChange={event=>onShotVisibilityChange(event.target.checked)}/><span>本镜头显示</span></label>
        <button className="command-button" disabled={!hasShotOverride} onClick={onResetShotOverride}><RotateCcw size={14}/>重置本镜头覆盖</button>
      </>}
      {!cameraMode&&<label className="director-checkbox"><input type="checkbox" aria-label="场景显示" checked={sceneVisible} onChange={event=>onSceneVisibilityChange(event.target.checked)}/><span>场景显示</span></label>}
      {!cameraMode&&<button className="command-button" onClick={onDuplicateObject}><Copy size={14}/>复制场景对象</button>}
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
