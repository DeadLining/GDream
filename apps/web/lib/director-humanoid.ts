import type {DirectorPosePreset,Vector3} from './types';

export type HumanoidBoneId=
  |'Hips'|'Spine'|'Chest'|'Neck'|'Head'
  |'LeftUpperArm'|'LeftLowerArm'|'LeftHand'
  |'RightUpperArm'|'RightLowerArm'|'RightHand'
  |'LeftUpperLeg'|'LeftLowerLeg'|'LeftFoot'
  |'RightUpperLeg'|'RightLowerLeg'|'RightFoot';

export const HUMANOID_BONES:Array<{id:HumanoidBoneId;parent:HumanoidBoneId|null}>=[
  {id:'Hips',parent:null},{id:'Spine',parent:'Hips'},{id:'Chest',parent:'Spine'},{id:'Neck',parent:'Chest'},{id:'Head',parent:'Neck'},
  {id:'LeftUpperArm',parent:'Chest'},{id:'LeftLowerArm',parent:'LeftUpperArm'},{id:'LeftHand',parent:'LeftLowerArm'},
  {id:'RightUpperArm',parent:'Chest'},{id:'RightLowerArm',parent:'RightUpperArm'},{id:'RightHand',parent:'RightLowerArm'},
  {id:'LeftUpperLeg',parent:'Hips'},{id:'LeftLowerLeg',parent:'LeftUpperLeg'},{id:'LeftFoot',parent:'LeftLowerLeg'},
  {id:'RightUpperLeg',parent:'Hips'},{id:'RightLowerLeg',parent:'RightUpperLeg'},{id:'RightFoot',parent:'RightLowerLeg'},
];

const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');

export function mapHumanoidBoneName(name:string):HumanoidBoneId|null{
  const bone=normalized(name);
  const left=bone.includes('left')||/(^|[^a-z])l$/.test(name.toLowerCase())||bone.endsWith('l');
  const right=bone.includes('right')||/(^|[^a-z])r$/.test(name.toLowerCase())||bone.endsWith('r');
  const sided=(leftId:HumanoidBoneId,rightId:HumanoidBoneId)=>left?leftId:right?rightId:null;
  if(/forearm|lowerarm/.test(bone))return sided('LeftLowerArm','RightLowerArm');
  if(/upperarm|shoulder|arm/.test(bone))return sided('LeftUpperArm','RightUpperArm');
  if(/hand|wrist/.test(bone))return sided('LeftHand','RightHand');
  if(/lowerleg|calf|shin/.test(bone))return sided('LeftLowerLeg','RightLowerLeg');
  if(/upperleg|thigh/.test(bone))return sided('LeftUpperLeg','RightUpperLeg');
  if(/foot|ankle|toe/.test(bone))return sided('LeftFoot','RightFoot');
  if(/head/.test(bone))return 'Head';
  if(/neck/.test(bone))return 'Neck';
  if(/chest|upperchest/.test(bone))return 'Chest';
  if(/spine/.test(bone))return 'Spine';
  if(/hips|pelvis|root/.test(bone))return 'Hips';
  return null;
}

export function humanoidPoseRotation(preset:DirectorPosePreset,bone:HumanoidBoneId):Vector3{
  const left=bone.startsWith('Left');
  const right=bone.startsWith('Right');
  const side=left?1:right?-1:0;
  if(preset==='dialogue'){
    if(bone==='Spine'||bone==='Chest')return [0,.08,0];
    if(bone==='Head'||bone==='Neck')return [0,-.08,0];
    if(bone.endsWith('UpperArm'))return [0,0,.28*side];
    if(bone.endsWith('LowerArm'))return [-.35,0,.12*side];
  }
  if(preset==='action'){
    if(bone==='Spine'||bone==='Chest')return [-.16,.12,0];
    if(bone==='Head'||bone==='Neck')return [.08,-.12,0];
    if(bone.endsWith('UpperArm'))return [-.25,0,.65*side];
    if(bone.endsWith('LowerArm'))return [-.55,.18*side,0];
    if(bone.endsWith('UpperLeg'))return [.18*side,0,.08*side];
    if(bone.endsWith('LowerLeg'))return [left ? .2 : 0,0,0];
  }
  if(preset==='injured'){
    if(bone==='Spine'||bone==='Chest')return [.1,0,.18];
    if(bone==='Head'||bone==='Neck')return [.08,0,-.12];
    if(bone==='LeftUpperArm')return [.35,0,.2];
    if(bone==='LeftLowerArm')return [-.45,0,.1];
  }
  return [0,0,0];
}
