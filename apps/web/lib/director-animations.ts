import type {DirectorAnimationClip} from './types';

export const DIRECTOR_ANIMATION_CLIPS:Array<{id:DirectorAnimationClip;label:string}>=[
  {id:'idle',label:'待机'},
  {id:'walk',label:'行走'},
  {id:'run',label:'奔跑'},
  {id:'talk',label:'说话'},
  {id:'turn',label:'转身'},
  {id:'injured',label:'负伤移动'},
];

export type DirectorAnimationMotion={
  rootY:number;
  rootYaw:number;
  chestYaw:number;
  headYaw:number;
  leftArm:number;
  rightArm:number;
  leftLeg:number;
  rightLeg:number;
};

export function directorAnimationMotion(clip:DirectorAnimationClip,time:number):DirectorAnimationMotion{
  const wave=(speed:number)=>Math.sin(time*Math.PI*2*speed);
  const base:DirectorAnimationMotion={rootY:0,rootYaw:0,chestYaw:0,headYaw:0,leftArm:0,rightArm:0,leftLeg:0,rightLeg:0};
  if(clip==='idle')return {...base,rootY:wave(.5)*.012,chestYaw:wave(.25)*.018};
  if(clip==='walk'){
    const stride=wave(1.2);
    return {...base,rootY:Math.abs(wave(2.4))*.025,leftArm:stride*.42,rightArm:-stride*.42,leftLeg:-stride*.48,rightLeg:stride*.48};
  }
  if(clip==='run'){
    const stride=wave(2);
    return {...base,rootY:Math.abs(wave(4))*.055,leftArm:stride*.72,rightArm:-stride*.72,leftLeg:-stride*.82,rightLeg:stride*.82,chestYaw:stride*.06};
  }
  if(clip==='talk')return {...base,rootY:wave(.8)*.008,chestYaw:wave(.45)*.07,headYaw:-wave(.45)*.1,leftArm:wave(.9)*.18,rightArm:-wave(.65)*.12};
  if(clip==='turn')return {...base,rootYaw:wave(.25)*.5,chestYaw:wave(.25)*.18,headYaw:wave(.25)*.22};
  const limp=wave(.75);
  return {...base,rootY:Math.abs(limp)*.018,chestYaw:.1+limp*.03,leftArm:limp*.12,rightArm:-limp*.2,leftLeg:-limp*.18,rightLeg:limp*.34};
}
