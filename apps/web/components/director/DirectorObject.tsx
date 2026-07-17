'use client';

import {useRef} from 'react';
import {Image as DreiImage,TransformControls} from '@react-three/drei';
import type {Group} from 'three';
import type {DirectorObject as DirectorObjectDto,DirectorPosePreset,DirectorTransformMode,Transform} from '../../lib/types';
import {resolveDirectorHeadRotation} from '../../lib/director-head-gaze';
import {GlbModel} from '../shared/GlbModel';
import {DirectorProxy} from './DirectorProxy';

type TransformSource={position:{x:number;y:number;z:number};rotation:{x:number;y:number;z:number};scale:{x:number;y:number;z:number}};

const readTransform=(source:TransformSource):Transform=>({
  position:[source.position.x,source.position.y,source.position.z],
  rotation:[source.rotation.x,source.rotation.y,source.rotation.z],
  scale:[source.scale.x,source.scale.y,source.scale.z],
});

const controlObject=(event:unknown):TransformSource|null=>(event as {target?:{object?:TransformSource|null}}|undefined)?.target?.object??null;

function Placeholder({object}:{object:DirectorObjectDto}){
  const modelUrl=typeof object.appearance.model_url==='string'?object.appearance.model_url:'';
  const modelScale=typeof object.appearance.model_scale==='number'?object.appearance.model_scale:1;
  const modelOffsetY=typeof object.appearance.model_offset_y==='number'?object.appearance.model_offset_y:0;
  const posePreset=(typeof object.appearance.pose_preset==='string'?object.appearance.pose_preset:'neutral') as DirectorPosePreset;
  const animationClip=typeof object.appearance.animation_clip==='string'?object.appearance.animation_clip:'';
  const animationPlaying=object.appearance.animation_playing===true;
  const animationTimeSeconds=typeof object.appearance.animation_time_seconds==='number'?object.appearance.animation_time_seconds:0;
  const morphTargetWeights=object.appearance.morph_target_weights&&typeof object.appearance.morph_target_weights==='object'?Object.fromEntries(Object.entries(object.appearance.morph_target_weights as Record<string,unknown>).flatMap(([name,value])=>typeof value==='number'&&Number.isFinite(value)?[[name,value]]:[])):undefined;
  const headRotation=resolveDirectorHeadRotation(object);
  const proxy=<DirectorProxy object={object}/>;
  if(modelUrl)return <GlbModel url={modelUrl} scale={modelScale} offsetY={modelOffsetY} posePreset={posePreset} morphTargetWeights={morphTargetWeights} headRotation={headRotation} animationClip={animationClip} animationPlaying={animationPlaying} animationTimeSeconds={animationTimeSeconds} fallback={proxy}/>;
  const imageUrl=typeof object.appearance.image_url==='string'?object.appearance.image_url:'';
  if(object.kind==='background'&&imageUrl){const aspect=typeof object.appearance.aspect_ratio==='number'?object.appearance.aspect_ratio:1.5;return <DreiImage url={imageUrl} position={[0,1,0]} scale={[aspect*1.8,1.8]} transparent toneMapped={false}/>;}
  const color=typeof object.appearance.color==='string'?object.appearance.color:object.kind==='character'?'#d76b4b':'#5b8ca8';
  if(object.kind!=='background'&&object.kind!=='light')return <DirectorProxy object={{...object,appearance:{...object.appearance,color}}}/>;
  if(object.kind==='background')return <mesh receiveShadow><planeGeometry args={[4,2.4]}/><meshStandardMaterial color={color}/></mesh>;
  return <DirectorProxy object={{...object,appearance:{...object.appearance,color}}}/>;
}

export function DirectorObject({object,selected,editable,transformMode,snapEnabled,onSelect,onTransform}:{object:DirectorObjectDto;selected:boolean;editable:boolean;transformMode:DirectorTransformMode;snapEnabled:boolean;onSelect:()=>void;onTransform:(transform:Transform)=>void}){
  const ref=useRef<Group>(null);
  const pendingTransform=useRef<Transform|null>(null);
  if(!object.visible)return null;
  const group=<group ref={ref} name={`director-object-${object.id}`} userData={{kind:object.kind,sourceType:object.source_type}} position={object.transform.position} rotation={object.transform.rotation} scale={object.transform.scale} onClick={event=>{event.stopPropagation();onSelect();}}><Placeholder object={object}/></group>;
  if(!selected||!editable)return group;
  return <TransformControls mode={transformMode} translationSnap={snapEnabled ? .25 : null} rotationSnap={snapEnabled ? Math.PI/12 : null} scaleSnap={snapEnabled ? .1 : null} onMouseDown={()=>{pendingTransform.current=null;}} onObjectChange={event=>{const current=controlObject(event)??ref.current;if(current)pendingTransform.current=readTransform(current);}} onMouseUp={event=>{const current=controlObject(event);const transform=current?readTransform(current):pendingTransform.current;pendingTransform.current=null;if(transform)onTransform(transform);}}>{group}</TransformControls>;
}
