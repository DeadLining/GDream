'use client';

import {useRef} from 'react';
import type {Group} from 'three';
import {directorAnimationDuration,directorAnimationMotion} from '../../lib/director-animations';
import {humanoidPoseRotation,type HumanoidBoneId} from '../../lib/director-humanoid';
import type {DirectorAnimationClip,DirectorObject,DirectorPosePreset,Vector3} from '../../lib/types';
import {useDirectorProxyAnimationTime} from './useDirectorProxyAnimationTime';

const clamp=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;

export function HumanoidProxy({object}:{object:DirectorObject}){
  const appearance=object.appearance;
  const color=typeof appearance.color==='string'?appearance.color:'#d76b4b';
  const pose=(typeof appearance.pose_preset==='string'?appearance.pose_preset:'neutral') as DirectorPosePreset;
  const height=clamp(appearance.proxy_height,1,.75,1.3);
  const shoulders=clamp(appearance.proxy_shoulder_width,1,.7,1.35);
  const body=clamp(appearance.proxy_body_width,1,.7,1.4);
  const animation=(typeof appearance.animation_clip==='string'?appearance.animation_clip:'idle') as DirectorAnimationClip;
  const playing=appearance.animation_playing===true;
  const animationTime=typeof appearance.animation_time_seconds==='number'&&Number.isFinite(appearance.animation_time_seconds)?appearance.animation_time_seconds:0;
  const rotation=(bone:HumanoidBoneId)=>humanoidPoseRotation(pose,bone);
  const rootRef=useRef<Group>(null);
  const hipsRef=useRef<Group>(null);
  const chestRef=useRef<Group>(null);
  const headRef=useRef<Group>(null);
  const leftArmRef=useRef<Group>(null);
  const rightArmRef=useRef<Group>(null);
  const leftLegRef=useRef<Group>(null);
  const rightLegRef=useRef<Group>(null);
  const setRotation=(target:Group|null,base:Vector3,delta:Vector3)=>target?.rotation?.set(base[0]+delta[0],base[1]+delta[1],base[2]+delta[2]);
  const applyMotion=(time:number)=>{
    const motion=directorAnimationMotion(animation,time);
    if(rootRef.current?.position)rootRef.current.position.y=motion.rootY;
    setRotation(hipsRef.current,rotation('Hips'),[0,motion.rootYaw,0]);
    setRotation(chestRef.current,rotation('Chest'),[0,motion.chestYaw,0]);
    setRotation(headRef.current,rotation('Head'),[0,motion.headYaw,0]);
    setRotation(leftArmRef.current,rotation('LeftUpperArm'),[motion.leftArm,0,0]);
    setRotation(rightArmRef.current,rotation('RightUpperArm'),[motion.rightArm,0,0]);
    setRotation(leftLegRef.current,rotation('LeftUpperLeg'),[motion.leftLeg,0,0]);
    setRotation(rightLegRef.current,rotation('RightUpperLeg'),[motion.rightLeg,0,0]);
  };
  useDirectorProxyAnimationTime({animation,durationSeconds:directorAnimationDuration(animation),playing,timeSeconds:animationTime,applyTime:applyMotion,renderKey:pose});
  const joint=(radius=.055)=><mesh><sphereGeometry args={[radius,10,8]}/><meshStandardMaterial color="#263238"/></mesh>;
  const limb=(length:number,radius=.075)=><mesh position={[0,-length/2,0]} castShadow><capsuleGeometry args={[radius,Math.max(.01,length-radius*2),5,8]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>;
  return <group ref={rootRef} name={`humanoid-rig-${object.id}`} scale={[height,height,height]} userData={{rigType:'standard_humanoid'}}>
    <group ref={hipsRef} name="humanoid-bone-Hips" position={[0,.98,0]} rotation={rotation('Hips')}>
      {joint(.07)}<mesh castShadow><boxGeometry args={[.34*body,.18,.2*body]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>
      <group name="humanoid-bone-Spine" position={[0,.16,0]} rotation={rotation('Spine')}>
        {joint()}<mesh position={[0,.16,0]} castShadow><capsuleGeometry args={[.14*body,.22,5,8]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>
        <group ref={chestRef} name="humanoid-bone-Chest" position={[0,.34,0]} rotation={rotation('Chest')}>
          {joint(.065)}<mesh castShadow><boxGeometry args={[.42*shoulders,.26,.2*body]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>
          <group name="humanoid-bone-Neck" position={[0,.19,0]} rotation={rotation('Neck')}>
            {limb(.12,.045)}
            <group ref={headRef} name="humanoid-bone-Head" position={[0,.17,0]} rotation={rotation('Head')}>
              {joint(.06)}<mesh position={[0,.1,0]} castShadow><sphereGeometry args={[.16,12,10]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>
            </group>
          </group>
          <group ref={leftArmRef} name="humanoid-bone-LeftUpperArm" position={[.25*shoulders,.08,0]} rotation={rotation('LeftUpperArm')}>
            {joint()}{limb(.36)}
            <group name="humanoid-bone-LeftLowerArm" position={[0,-.36,0]} rotation={rotation('LeftLowerArm')}>
              {joint()}{limb(.32,.065)}
              <group name="humanoid-bone-LeftHand" position={[0,-.32,0]} rotation={rotation('LeftHand')}>{joint(.065)}</group>
            </group>
          </group>
          <group ref={rightArmRef} name="humanoid-bone-RightUpperArm" position={[-.25*shoulders,.08,0]} rotation={rotation('RightUpperArm')}>
            {joint()}{limb(.36)}
            <group name="humanoid-bone-RightLowerArm" position={[0,-.36,0]} rotation={rotation('RightLowerArm')}>
              {joint()}{limb(.32,.065)}
              <group name="humanoid-bone-RightHand" position={[0,-.32,0]} rotation={rotation('RightHand')}>{joint(.065)}</group>
            </group>
          </group>
        </group>
      </group>
      <group ref={leftLegRef} name="humanoid-bone-LeftUpperLeg" position={[.1*body,-.08,0]} rotation={rotation('LeftUpperLeg')}>
        {joint(.06)}{limb(.5,.09)}
        <group name="humanoid-bone-LeftLowerLeg" position={[0,-.5,0]} rotation={rotation('LeftLowerLeg')}>
          {joint(.06)}{limb(.48,.075)}
          <group name="humanoid-bone-LeftFoot" position={[0,-.48,.08]} rotation={rotation('LeftFoot')}>{joint(.06)}<mesh position={[0,-.02,.08]}><boxGeometry args={[.15,.1,.3]}/><meshStandardMaterial color={color}/></mesh></group>
        </group>
      </group>
      <group ref={rightLegRef} name="humanoid-bone-RightUpperLeg" position={[-.1*body,-.08,0]} rotation={rotation('RightUpperLeg')}>
        {joint(.06)}{limb(.5,.09)}
        <group name="humanoid-bone-RightLowerLeg" position={[0,-.5,0]} rotation={rotation('RightLowerLeg')}>
          {joint(.06)}{limb(.48,.075)}
          <group name="humanoid-bone-RightFoot" position={[0,-.48,.08]} rotation={rotation('RightFoot')}>{joint(.06)}<mesh position={[0,-.02,.08]}><boxGeometry args={[.15,.1,.3]}/><meshStandardMaterial color={color}/></mesh></group>
        </group>
      </group>
    </group>
  </group>;
}
