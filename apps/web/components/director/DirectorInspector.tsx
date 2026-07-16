'use client';

import {useEffect,useState} from 'react';
import {AlignCenter,ArrowDownToLine,Copy,Magnet,Move3D,Pause,Play,Rotate3D,RotateCcw,Save,Scaling,Trash2} from 'lucide-react';
import {DIRECTOR_ANIMATION_CLIPS,directorAnimationDuration} from '../../lib/director-animations';
import {DIRECTOR_FACIAL_EXPRESSIONS} from '../../lib/director-expressions';
import {DIRECTOR_POSE_PRESETS} from '../../lib/director-poses';
import {DIRECTOR_PROXY_RIGS,isAnimatedDirectorProxy,resolveDirectorProxyRig} from '../../lib/director-proxies';
import type {DirectorEnvironmentSettings} from '../../lib/director-environment';
import type {DirectorAnimationClip,DirectorFacialExpression,DirectorObject,DirectorPosePreset,DirectorProxyRig,DirectorTransformMode,ShotCamera,Transform,Vector3} from '../../lib/types';
import {DirectorEnvironmentControls} from './DirectorEnvironmentControls';

const transformTools=[
  {mode:'translate' as const,label:'平移对象',icon:Move3D},
  {mode:'rotate' as const,label:'旋转对象',icon:Rotate3D},
  {mode:'scale' as const,label:'缩放对象',icon:Scaling},
];

const axes=['X','Y','Z'] as const;
type TransformDraft={position:[string,string,string];rotation:[string,string,string];scale:[string,string,string]};
type ImportedAnimationClip={name:string;duration_seconds:number};

const formatNumber=(value:number,precision=4)=>String(Number(value.toFixed(precision)));
const createDraft=(transform:Transform):TransformDraft=>({
  position:transform.position.map(value=>formatNumber(value)) as TransformDraft['position'],
  rotation:transform.rotation.map(value=>formatNumber(value*180/Math.PI,2)) as TransformDraft['rotation'],
  scale:transform.scale.map(value=>formatNumber(value)) as TransformDraft['scale'],
});
const importedAnimationClips=(object:DirectorObject|null):ImportedAnimationClip[]=>{
  const clips=Array.isArray(object?.metadata.animation_clips)?object.metadata.animation_clips:[];
  return clips.flatMap(item=>{
    if(!item||typeof item!=='object')return[];
    const clip=item as Record<string,unknown>;
    if(typeof clip.name!=='string'||!clip.name.trim()||typeof clip.duration_seconds!=='number'||!Number.isFinite(clip.duration_seconds)||clip.duration_seconds<0)return[];
    return[{name:clip.name,duration_seconds:clip.duration_seconds}];
  });
};

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
  animationSaving,
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
  onHeadDirectionChange,
  onGazeTargetChange,
  onFacialExpressionChange,
  onMorphTargetWeightChange,
  onMorphTargetReset,
  onBodyProfileChange,
  onProxyRigChange,
  onAnimationChange,
  onImportedAnimationChange,
  onAnimationPlayingChange,
  onAnimationTimeChange,
  onAnimationReset,
  onShotVisibilityChange,
  onSceneVisibilityChange,
  onRenameObject,
  onDuplicateObject,
  onSaveEnvironment,
  onResetShotOverride,
  onDeleteObject,
}:{
  object:DirectorObject|null;
  animationSaving:boolean;
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
  onHeadDirectionChange:(key:'head_yaw_degrees'|'head_pitch_degrees',value:number)=>void;
  onGazeTargetChange:(target:Vector3|null)=>void;
  onFacialExpressionChange:(expression:DirectorFacialExpression)=>void;
  onMorphTargetWeightChange:(name:string,weight:number)=>void;
  onMorphTargetReset:()=>void;
  onBodyProfileChange:(key:'proxy_height'|'proxy_shoulder_width'|'proxy_body_width',value:number)=>void;
  onProxyRigChange:(rig:DirectorProxyRig)=>void;
  onAnimationChange:(clip:DirectorAnimationClip)=>void;
  onImportedAnimationChange:(clip:string)=>void;
  onAnimationPlayingChange:(playing:boolean)=>void;
  onAnimationTimeChange:(timeSeconds:number)=>void;
  onAnimationReset:()=>void;
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
  const facialExpression=(typeof object?.appearance.facial_expression==='string'?object.appearance.facial_expression:'neutral') as DirectorFacialExpression;
  const animation=(typeof object?.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip;
  const animationPlaying=object?.appearance.animation_playing===true;
  const storedAnimationTime=typeof object?.appearance.animation_time_seconds==='number'&&Number.isFinite(object.appearance.animation_time_seconds)?object.appearance.animation_time_seconds:0;
  const proxyAnimationDuration=directorAnimationDuration(animation);
  const proxyAnimationTime=Math.min(proxyAnimationDuration,Math.max(0,storedAnimationTime));
  const modelUrl=typeof object?.appearance.model_url==='string'?object.appearance.model_url.trim():'';
  const proxyRig=object?resolveDirectorProxyRig(object):'prop_box';
  const usesProxy=Boolean(object&&!modelUrl&&object.kind!=='background'&&object.kind!=='light');
  const humanoidProxy=usesProxy&&proxyRig==='standard_humanoid';
  const animatedProxy=usesProxy&&isAnimatedDirectorProxy(proxyRig);
  const importedClips=importedAnimationClips(object);
  const storedImportedAnimation=typeof object?.appearance.animation_clip==='string'?object.appearance.animation_clip:'';
  const importedAnimation=importedClips.some(item=>item.name===storedImportedAnimation)?storedImportedAnimation:importedClips[0]?.name??'';
  const importedDuration=importedClips.find(item=>item.name===importedAnimation)?.duration_seconds??0;
  const importedAnimationTime=Math.min(importedDuration,Math.max(0,storedAnimationTime));
  const importedMorphTargets=Array.from(new Set((Array.isArray(object?.metadata.morph_targets)?object.metadata.morph_targets:[]).filter((name):name is string=>typeof name==='string'&&Boolean(name.trim())).map(name=>name.trim())));
  const morphTargetWeights=object?.appearance.morph_target_weights&&typeof object.appearance.morph_target_weights==='object'?object.appearance.morph_target_weights as Record<string,unknown>:{};
  const poseable=Boolean(object?.kind==='character'&&(humanoidProxy||(object.source_type==='model'&&object.metadata.has_skeleton)));
  const headYaw=typeof object?.appearance.head_yaw_degrees==='number'&&Number.isFinite(object.appearance.head_yaw_degrees)?Math.min(90,Math.max(-90,object.appearance.head_yaw_degrees)):0;
  const headPitch=typeof object?.appearance.head_pitch_degrees==='number'&&Number.isFinite(object.appearance.head_pitch_degrees)?Math.min(60,Math.max(-60,object.appearance.head_pitch_degrees)):0;
  const storedGaze=object?.appearance.gaze_target;
  const gazeTarget=Array.isArray(storedGaze)&&storedGaze.length===3&&storedGaze.every(value=>typeof value==='number'&&Number.isFinite(value))?storedGaze as Vector3:null;
  const defaultGazeTarget:Vector3=object?[object.transform.position[0],object.transform.position[1]+1.65,object.transform.position[2]+2]:[0,1.65,2];
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
        <div className="director-animation-controls">
          <span>头部与视线</span>
          <label htmlFor="director-head-yaw"><span>头部左右</span><input id="director-head-yaw" type="range" aria-label="头部左右" min="-90" max="90" step="1" value={headYaw} disabled={animationSaving} onChange={event=>onHeadDirectionChange('head_yaw_degrees',Number(event.target.value))}/><output>{formatNumber(headYaw,0)}°</output></label>
          <label htmlFor="director-head-pitch"><span>头部俯仰</span><input id="director-head-pitch" type="range" aria-label="头部俯仰" min="-60" max="60" step="1" value={headPitch} disabled={animationSaving} onChange={event=>onHeadDirectionChange('head_pitch_degrees',Number(event.target.value))}/><output>{formatNumber(headPitch,0)}°</output></label>
          <label className="director-checkbox"><input type="checkbox" aria-label="使用视线目标" checked={gazeTarget!==null} disabled={animationSaving} onChange={event=>onGazeTargetChange(event.target.checked?defaultGazeTarget:null)}/><span>使用视线目标</span></label>
          {gazeTarget&&<div className="director-transform-row" key={`${object.id}-${gazeTarget.join(',')}`}><span>视线目标</span>{axes.map((axis,index)=><label key={axis}><small>{axis}</small><input type="number" aria-label={`视线目标 ${axis}`} step="0.1" defaultValue={formatNumber(gazeTarget[index],2)} disabled={animationSaving} onBlur={event=>{const value=Number(event.currentTarget.value);if(Number.isFinite(value))onGazeTargetChange(gazeTarget.map((item,itemIndex)=>itemIndex===index?value:item) as Vector3);}}/></label>)}</div>}
        </div>
      </>}
      {cameraMode&&humanoidProxy&&<><label htmlFor="director-facial-expression">表情预设</label><select id="director-facial-expression" value={facialExpression} disabled={animationSaving} onChange={event=>onFacialExpressionChange(event.target.value as DirectorFacialExpression)}>{DIRECTOR_FACIAL_EXPRESSIONS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></>}
      {cameraMode&&modelUrl&&importedMorphTargets.length>0&&<div className="director-animation-controls">
        <span>模型表情</span>
        {importedMorphTargets.map((name,index)=>{const stored=morphTargetWeights[name];const value=typeof stored==='number'&&Number.isFinite(stored)?Math.min(1,Math.max(0,stored)):0;return <label key={name} htmlFor={`director-morph-${index}`}><span>{name}</span><input id={`director-morph-${index}`} type="range" aria-label={`表情 ${name}`} min="0" max="1" step="0.01" value={value} disabled={animationSaving} onChange={event=>onMorphTargetWeightChange(name,Number(event.target.value))}/><output>{formatNumber(value,2)}</output></label>;})}
        <button type="button" className="command-button" aria-label="重置模型表情" disabled={animationSaving} onClick={onMorphTargetReset}><RotateCcw size={14}/></button>
      </div>}
      {cameraMode&&animatedProxy&&<div className="director-animation-controls">
        <label htmlFor="director-animation">动画片段</label>
        <select id="director-animation" value={animation} disabled={animationSaving} onChange={event=>onAnimationChange(event.target.value as DirectorAnimationClip)}>{DIRECTOR_ANIMATION_CLIPS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <label htmlFor="director-proxy-animation-time">代理动画时间</label>
        <input id="director-proxy-animation-time" type="range" min="0" max={proxyAnimationDuration} step="0.01" value={proxyAnimationTime} disabled={animationSaving} onChange={event=>onAnimationTimeChange(Number(event.target.value))}/>
        <output>{formatNumber(proxyAnimationTime,2)} / {formatNumber(proxyAnimationDuration,2)} 秒</output>
        <div><button type="button" className="command-button" aria-label={animationPlaying?'暂停动画':'播放动画'} disabled={animationSaving} onClick={()=>onAnimationPlayingChange(!animationPlaying)}>{animationPlaying?<Pause size={14}/>:<Play size={14}/>}</button><button type="button" className="command-button" aria-label="重置代理动画" disabled={animationSaving} onClick={onAnimationReset}><RotateCcw size={14}/></button></div>
      </div>}
      {cameraMode&&modelUrl&&importedClips.length>0&&<div className="director-animation-controls">
        <label htmlFor="director-imported-animation">导入动画片段</label>
        <select id="director-imported-animation" value={importedAnimation} disabled={animationSaving} onChange={event=>onImportedAnimationChange(event.target.value)}>{importedClips.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select>
        <label htmlFor="director-animation-time">动画时间</label>
        <input id="director-animation-time" type="range" min="0" max={importedDuration} step="0.01" value={importedAnimationTime} disabled={animationSaving} onChange={event=>onAnimationTimeChange(Number(event.target.value))}/>
        <output>{formatNumber(importedAnimationTime,2)} / {formatNumber(importedDuration,2)} 秒</output>
        <div><button type="button" className="command-button" aria-label={animationPlaying?'暂停导入动画':'播放导入动画'} disabled={animationSaving} onClick={()=>onAnimationPlayingChange(!animationPlaying)}>{animationPlaying?<Pause size={14}/>:<Play size={14}/>}</button><button type="button" className="command-button" aria-label="重置导入动画" disabled={animationSaving} onClick={onAnimationReset}><RotateCcw size={14}/></button></div>
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
