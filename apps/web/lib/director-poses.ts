import type {Object3D} from 'three';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {humanoidPoseRotation,mapHumanoidBoneName} from './director-humanoid';
import type {DirectorPosePreset} from './types';

export const DIRECTOR_POSE_PRESETS:Array<{id:DirectorPosePreset;label:string}>=[
  {id:'neutral',label:'中性站姿'},
  {id:'dialogue',label:'对话表演'},
  {id:'action',label:'动作姿态'},
  {id:'injured',label:'受伤姿态'},
];

const baselineKey='directorPoseBaseline';

export function applyDirectorPose(root:Object3D,preset:DirectorPosePreset){
  root.traverse(object=>{
    if(!('isBone' in object)||!object.isBone)return;
    const userData=object.userData as Record<string,unknown>;
    const stored=userData[baselineKey];
    const baseline=Array.isArray(stored)?stored as number[]:[object.rotation.x,object.rotation.y,object.rotation.z];
    if(!Array.isArray(stored))userData[baselineKey]=baseline;
    const mapped=mapHumanoidBoneName(object.name);
    const [x,y,z]=mapped?humanoidPoseRotation(preset,mapped):[0,0,0];
    object.rotation.set(baseline[0]+x,baseline[1]+y,baseline[2]+z);
  });
}

export function cloneDirectorModelWithPose<T extends Object3D>(root:T,preset:DirectorPosePreset):T{
  const model=cloneSkeleton(root) as T;
  applyDirectorPose(model,preset);
  return model;
}
