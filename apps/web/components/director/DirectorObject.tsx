'use client';

import {useRef} from 'react';
import {Image as DreiImage,TransformControls} from '@react-three/drei';
import type {Group} from 'three';
import type {DirectorObject as DirectorObjectDto,DirectorPosePreset,DirectorTransformMode,Transform} from '../../lib/types';
import {GlbModel} from '../shared/GlbModel';

function Placeholder({object}:{object:DirectorObjectDto}){
  const modelUrl=typeof object.appearance.model_url==='string'?object.appearance.model_url:'';
  const modelScale=typeof object.appearance.model_scale==='number'?object.appearance.model_scale:1;
  const modelOffsetY=typeof object.appearance.model_offset_y==='number'?object.appearance.model_offset_y:0;
  const posePreset=(typeof object.appearance.pose_preset==='string'?object.appearance.pose_preset:'neutral') as DirectorPosePreset;
  const proxy=object.kind==='character'?<mesh castShadow position={[0,0.9,0]}><capsuleGeometry args={[0.32,1.15,8,16]}/><meshStandardMaterial color="#d76b4b"/></mesh>:<mesh castShadow receiveShadow position={[0,0.5,0]}><boxGeometry args={[1,1,1]}/><meshStandardMaterial color="#5b8ca8"/></mesh>;
  if(modelUrl)return <GlbModel url={modelUrl} scale={modelScale} offsetY={modelOffsetY} posePreset={posePreset} fallback={proxy}/>;
  const imageUrl=typeof object.appearance.image_url==='string'?object.appearance.image_url:'';
  if(imageUrl){const aspect=typeof object.appearance.aspect_ratio==='number'?object.appearance.aspect_ratio:.75;return <DreiImage url={imageUrl} position={[0,1,0]} scale={[aspect*1.8,1.8]} transparent toneMapped={false}/>;}
  const color=typeof object.appearance.color==='string'?object.appearance.color:object.kind==='character'?'#d76b4b':'#5b8ca8';
  if(object.kind==='character')return <mesh castShadow position={[0,0.9,0]}><capsuleGeometry args={[0.32,1.15,8,16]}/><meshStandardMaterial color={color}/></mesh>;
  if(object.kind==='background')return <mesh receiveShadow><planeGeometry args={[4,2.4]}/><meshStandardMaterial color={color}/></mesh>;
  return <mesh castShadow receiveShadow position={[0,0.5,0]}><boxGeometry args={[1,1,1]}/><meshStandardMaterial color={color}/></mesh>;
}

export function DirectorObject({object,selected,editable,transformMode,snapEnabled,onSelect,onTransform}:{object:DirectorObjectDto;selected:boolean;editable:boolean;transformMode:DirectorTransformMode;snapEnabled:boolean;onSelect:()=>void;onTransform:(transform:Transform)=>void}){
  const ref=useRef<Group>(null);
  const pendingTransform=useRef<Transform|null>(null);
  if(!object.visible)return null;
  const group=<group ref={ref} name={`director-object-${object.id}`} userData={{kind:object.kind,sourceType:object.source_type}} position={object.transform.position} rotation={object.transform.rotation} scale={object.transform.scale} onClick={event=>{event.stopPropagation();onSelect();}}><Placeholder object={object}/></group>;
  if(!selected||!editable)return group;
  return <TransformControls mode={transformMode} translationSnap={snapEnabled ? .25 : null} rotationSnap={snapEnabled ? Math.PI/12 : null} scaleSnap={snapEnabled ? .1 : null} onMouseDown={()=>{pendingTransform.current=null;}} onObjectChange={()=>{const current=ref.current;if(!current)return;pendingTransform.current={position:[current.position.x,current.position.y,current.position.z],rotation:[current.rotation.x,current.rotation.y,current.rotation.z],scale:[current.scale.x,current.scale.y,current.scale.z]};}} onMouseUp={()=>{const transform=pendingTransform.current;pendingTransform.current=null;if(transform)onTransform(transform);}}>{group}</TransformControls>;
}
