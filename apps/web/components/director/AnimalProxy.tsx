'use client';

import {useRef} from 'react';
import type {Group} from 'three';
import {directorAnimationDuration,directorAnimationMotion} from '../../lib/director-animations';
import type {DirectorAnimationClip,DirectorObject} from '../../lib/types';
import {useDirectorProxyAnimationTime} from './useDirectorProxyAnimationTime';

const colorFor=(object:DirectorObject)=>typeof object.appearance.color==='string'?object.appearance.color:'#c4784f';

export function QuadrupedProxy({object}:{object:DirectorObject}){
  const rootRef=useRef<Group>(null);
  const legs=[useRef<Group>(null),useRef<Group>(null),useRef<Group>(null),useRef<Group>(null)];
  const animation=(typeof object.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip;
  const playing=object.appearance.animation_playing===true;
  const animationTime=typeof object.appearance.animation_time_seconds==='number'&&Number.isFinite(object.appearance.animation_time_seconds)?object.appearance.animation_time_seconds:0;
  const color=colorFor(object);
  const apply=(time:number)=>{
    const motion=directorAnimationMotion(animation,time);
    if(rootRef.current?.position)rootRef.current.position.y=motion.rootY;
    rootRef.current?.rotation?.set(0,motion.rootYaw,0);
    const swings=[motion.leftLeg,motion.rightLeg,motion.rightLeg,motion.leftLeg];
    legs.forEach((ref,index)=>ref.current?.rotation?.set(swings[index],0,0));
  };
  useDirectorProxyAnimationTime({animation,durationSeconds:directorAnimationDuration(animation),playing,timeSeconds:animationTime,applyTime:apply});
  const leg=(index:number,position:[number,number,number])=><group ref={legs[index]} position={position}><mesh position={[0,-.28,0]} castShadow><capsuleGeometry args={[.07,.42,5,8]}/><meshStandardMaterial color={color} roughness={.76}/></mesh></group>;
  return <group ref={rootRef} name={`quadruped-rig-${object.id}`} userData={{rigType:'quadruped'}}>
    <mesh position={[0,.68,0]} castShadow><boxGeometry args={[.54,.42,1.05]}/><meshStandardMaterial color={color} roughness={.76}/></mesh>
    <group position={[0,.82,.68]}><mesh castShadow><sphereGeometry args={[.28,12,10]}/><meshStandardMaterial color={color}/></mesh><mesh position={[0,-.02,.28]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[.13,.28,8]}/><meshStandardMaterial color="#8b5a3c"/></mesh></group>
    {leg(0,[.2,.52,.38])}{leg(1,[-.2,.52,.38])}{leg(2,[.2,.52,-.38])}{leg(3,[-.2,.52,-.38])}
    <mesh position={[0,.78,-.7]} rotation={[-.55,0,0]}><capsuleGeometry args={[.045,.42,5,8]}/><meshStandardMaterial color={color}/></mesh>
  </group>;
}

export function BirdProxy({object}:{object:DirectorObject}){
  const rootRef=useRef<Group>(null);
  const leftWingRef=useRef<Group>(null);
  const rightWingRef=useRef<Group>(null);
  const animation=(typeof object.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip;
  const playing=object.appearance.animation_playing===true;
  const animationTime=typeof object.appearance.animation_time_seconds==='number'&&Number.isFinite(object.appearance.animation_time_seconds)?object.appearance.animation_time_seconds:0;
  const color=colorFor(object);
  const apply=(time:number)=>{
    const motion=directorAnimationMotion(animation,time);
    if(rootRef.current?.position)rootRef.current.position.y=motion.rootY;
    rootRef.current?.rotation?.set(0,motion.rootYaw,0);
    leftWingRef.current?.rotation?.set(0,0,-.35-motion.leftArm);
    rightWingRef.current?.rotation?.set(0,0,.35+motion.rightArm);
  };
  useDirectorProxyAnimationTime({animation,durationSeconds:directorAnimationDuration(animation),playing,timeSeconds:animationTime,applyTime:apply});
  return <group ref={rootRef} name={`bird-rig-${object.id}`} position={[0,.15,0]} userData={{rigType:'bird'}}>
    <mesh position={[0,.62,0]} scale={[.72,1,.72]} castShadow><sphereGeometry args={[.34,12,10]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>
    <mesh position={[0,1,.18]} castShadow><sphereGeometry args={[.2,12,10]}/><meshStandardMaterial color={color}/></mesh>
    <mesh position={[0,1,.43]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[.09,.28,8]}/><meshStandardMaterial color="#d2a132"/></mesh>
    <group ref={leftWingRef} position={[.28,.72,0]} rotation={[0,0,-.35]}><mesh position={[.25,0,0]} scale={[1.5,.22,.72]}><sphereGeometry args={[.25,10,8]}/><meshStandardMaterial color={color}/></mesh></group>
    <group ref={rightWingRef} position={[-.28,.72,0]} rotation={[0,0,.35]}><mesh position={[-.25,0,0]} scale={[1.5,.22,.72]}><sphereGeometry args={[.25,10,8]}/><meshStandardMaterial color={color}/></mesh></group>
    <mesh position={[.1,.22,0]}><capsuleGeometry args={[.035,.32,4,6]}/><meshStandardMaterial color="#6c5848"/></mesh><mesh position={[-.1,.22,0]}><capsuleGeometry args={[.035,.32,4,6]}/><meshStandardMaterial color="#6c5848"/></mesh>
  </group>;
}
