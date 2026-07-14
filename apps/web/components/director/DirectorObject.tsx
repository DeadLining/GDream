'use client';

import {useRef} from 'react';
import {Image as DreiImage,TransformControls} from '@react-three/drei';
import type {Group} from 'three';
import type {DirectorObject as DirectorObjectDto,Transform} from '../../lib/types';

function Placeholder({object}:{object:DirectorObjectDto}){
  const imageUrl=typeof object.appearance.image_url==='string'?object.appearance.image_url:'';
  if(imageUrl){const aspect=typeof object.appearance.aspect_ratio==='number'?object.appearance.aspect_ratio:.75;return <DreiImage url={imageUrl} position={[0,1,0]} scale={[aspect*1.8,1.8]} transparent toneMapped={false}/>;}
  const color=typeof object.appearance.color==='string'?object.appearance.color:object.kind==='character'?'#d76b4b':'#5b8ca8';
  if(object.kind==='character')return <mesh castShadow position={[0,0.9,0]}><capsuleGeometry args={[0.32,1.15,8,16]}/><meshStandardMaterial color={color}/></mesh>;
  if(object.kind==='background')return <mesh receiveShadow><planeGeometry args={[4,2.4]}/><meshStandardMaterial color={color}/></mesh>;
  return <mesh castShadow receiveShadow position={[0,0.5,0]}><boxGeometry args={[1,1,1]}/><meshStandardMaterial color={color}/></mesh>;
}

export function DirectorObject({object,selected,editable,onTransform}:{object:DirectorObjectDto;selected:boolean;editable:boolean;onTransform:(transform:Transform)=>void}){
  const ref=useRef<Group>(null);
  if(!object.visible)return null;
  const group=<group ref={ref} name={`director-object-${object.id}`} userData={{kind:object.kind,sourceType:object.source_type}} position={object.transform.position} rotation={object.transform.rotation} scale={object.transform.scale}><Placeholder object={object}/></group>;
  if(!selected||!editable)return group;
  return <TransformControls mode="translate" onObjectChange={()=>{const current=ref.current;if(!current)return;onTransform({position:[current.position.x,current.position.y,current.position.z],rotation:[current.rotation.x,current.rotation.y,current.rotation.z],scale:[current.scale.x,current.scale.y,current.scale.z]});}}>{group}</TransformControls>;
}
