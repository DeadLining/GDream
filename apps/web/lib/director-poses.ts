import type {Object3D} from 'three';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {DirectorPosePreset} from './types';

export const DIRECTOR_POSE_PRESETS:Array<{id:DirectorPosePreset;label:string}>=[
  {id:'neutral',label:'中性站姿'},
  {id:'dialogue',label:'对话表演'},
  {id:'action',label:'动作姿态'},
  {id:'injured',label:'受伤姿态'},
];

type Rotation=[number,number,number];
const baselineKey='directorPoseBaseline';
const normalized=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
const side=(name:string)=>name.includes('left')||name.endsWith('l')?1:name.includes('right')||name.endsWith('r')?-1:0;

function adjustment(preset:DirectorPosePreset,name:string):Rotation{
  const bone=normalized(name);
  const boneSide=side(bone);
  const spine=/spine|chest/.test(bone);
  const head=/head|neck/.test(bone);
  const upperArm=/upperarm|shoulder|leftarm|rightarm/.test(bone)&&!/forearm|lowerarm|hand/.test(bone);
  const forearm=/forearm|lowerarm/.test(bone);
  if(preset==='dialogue'){
    if(spine)return [0,.08,0];
    if(head)return [0,-.08,0];
    if(upperArm)return [0,0,.28*boneSide];
    if(forearm)return [-.35,0,.12*boneSide];
  }
  if(preset==='action'){
    if(spine)return [-.16,.12,0];
    if(head)return [.08,-.12,0];
    if(upperArm)return [-.25,0,.65*boneSide];
    if(forearm)return [-.55,.18*boneSide,0];
  }
  if(preset==='injured'){
    if(spine)return [.1,0,.18];
    if(head)return [.08,0,-.12];
    if(upperArm&&boneSide===1)return [.35,0,.2];
    if(forearm&&boneSide===1)return [-.45,0,.1];
  }
  return [0,0,0];
}

export function applyDirectorPose(root:Object3D,preset:DirectorPosePreset){
  root.traverse(object=>{
    if(!('isBone' in object)||!object.isBone)return;
    const userData=object.userData as Record<string,unknown>;
    const stored=userData[baselineKey];
    const baseline=Array.isArray(stored)?stored as number[]:[object.rotation.x,object.rotation.y,object.rotation.z];
    if(!Array.isArray(stored))userData[baselineKey]=baseline;
    const [x,y,z]=adjustment(preset,object.name);
    object.rotation.set(baseline[0]+x,baseline[1]+y,baseline[2]+z);
  });
}

export function cloneDirectorModelWithPose<T extends Object3D>(root:T,preset:DirectorPosePreset):T{
  const model=cloneSkeleton(root) as T;
  applyDirectorPose(model,preset);
  return model;
}
