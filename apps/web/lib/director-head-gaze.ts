import {Euler,Quaternion,Vector3 as ThreeVector3,type Object3D} from 'three';
import {mapHumanoidBoneName} from './director-humanoid';
import type {DirectorObject,Vector3} from './types';

const degreesToRadians=Math.PI/180;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const finiteNumber=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;

export function directorHeadRotation({headYawDegrees,headPitchDegrees,gazeTarget,objectPosition,objectRotation,headHeight}:{headYawDegrees:number;headPitchDegrees:number;gazeTarget:Vector3|null;objectPosition:Vector3;objectRotation:Vector3;headHeight:number}):Vector3{
  let gazePitch=0;
  let gazeYaw=0;
  if(gazeTarget){
    const direction=new ThreeVector3(gazeTarget[0]-objectPosition[0],gazeTarget[1]-(objectPosition[1]+headHeight),gazeTarget[2]-objectPosition[2]);
    direction.applyQuaternion(new Quaternion().setFromEuler(new Euler(...objectRotation)).invert());
    const horizontal=Math.hypot(direction.x,direction.z);
    if(direction.lengthSq()>1e-8){
      gazeYaw=Math.atan2(direction.x,direction.z);
      gazePitch=-Math.atan2(direction.y,horizontal);
    }
  }
  return [
    clamp(gazePitch+headPitchDegrees*degreesToRadians,-Math.PI/3,Math.PI/3),
    clamp(gazeYaw+headYawDegrees*degreesToRadians,-Math.PI/2,Math.PI/2),
    0,
  ];
}

export function resolveDirectorHeadRotation(object:DirectorObject):Vector3{
  const gaze=object.appearance.gaze_target;
  const gazeTarget=Array.isArray(gaze)&&gaze.length===3&&gaze.every(value=>typeof value==='number'&&Number.isFinite(value))?gaze as Vector3:null;
  const proxyHeight=finiteNumber(object.appearance.proxy_height,1);
  return directorHeadRotation({
    headYawDegrees:clamp(finiteNumber(object.appearance.head_yaw_degrees),-90,90),
    headPitchDegrees:clamp(finiteNumber(object.appearance.head_pitch_degrees),-60,60),
    gazeTarget,
    objectPosition:object.transform.position,
    objectRotation:object.transform.rotation,
    headHeight:1.6*proxyHeight*object.transform.scale[1],
  });
}

type AppliedRotation={base:Vector3;output:Vector3};
const appliedKey='directorHeadRotationApplied';
const close=(left:Vector3,right:Vector3)=>left.every((value,index)=>Math.abs(value-right[index])<1e-6);

export function applyDirectorHeadRotation(root:Object3D,rotation:Vector3){
  root.traverse(object=>{
    if(!('isBone' in object)||!object.isBone)return;
    const mapped=mapHumanoidBoneName(object.name);
    if(mapped!=='Head'&&mapped!=='Neck')return;
    const weight=mapped==='Head' ? .65 : .35;
    const current:[number,number,number]=[object.rotation.x,object.rotation.y,object.rotation.z];
    const previous=object.userData[appliedKey] as AppliedRotation|undefined;
    const base=previous&&close(current,previous.output)?previous.base:current;
    const output:Vector3=[base[0]+rotation[0]*weight,base[1]+rotation[1]*weight,base[2]+rotation[2]*weight];
    object.rotation.set(...output);
    object.userData[appliedKey]={base,output} satisfies AppliedRotation;
  });
}
