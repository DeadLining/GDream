import type {Object3D} from 'three';
import type {DirectorFacialExpression} from './types';

export const DIRECTOR_FACIAL_EXPRESSIONS:Array<{id:DirectorFacialExpression;label:string}>=[
  {id:'neutral',label:'中性'},
  {id:'happy',label:'开心'},
  {id:'sad',label:'悲伤'},
  {id:'angry',label:'愤怒'},
  {id:'surprised',label:'惊讶'},
];

export type DirectorExpressionFace={eyeScaleY:number;leftBrowRotation:number;rightBrowRotation:number;mouthScaleX:number;mouthScaleY:number;mouthY:number};

export function directorExpressionFace(expression:DirectorFacialExpression):DirectorExpressionFace{
  const neutral:DirectorExpressionFace={eyeScaleY:1,leftBrowRotation:0,rightBrowRotation:0,mouthScaleX:1,mouthScaleY:1,mouthY:.055};
  if(expression==='happy')return {...neutral,eyeScaleY:.45,leftBrowRotation:.12,rightBrowRotation:-.12,mouthScaleX:1.35,mouthScaleY:.65,mouthY:.06};
  if(expression==='sad')return {...neutral,leftBrowRotation:-.18,rightBrowRotation:.18,mouthScaleX:.85,mouthScaleY:.65,mouthY:.045};
  if(expression==='angry')return {...neutral,eyeScaleY:.7,leftBrowRotation:-.3,rightBrowRotation:.3,mouthScaleX:1.1,mouthScaleY:.45,mouthY:.05};
  if(expression==='surprised')return {...neutral,eyeScaleY:1.35,leftBrowRotation:.08,rightBrowRotation:-.08,mouthScaleX:.55,mouthScaleY:1.8,mouthY:.045};
  return neutral;
}

export function applyDirectorMorphTargetWeights(root:Object3D,weights:Record<string,number>){
  root.traverse(object=>{
    const target=object as Object3D&{morphTargetDictionary?:Record<string,number>;morphTargetInfluences?:number[]};
    if(!target.morphTargetDictionary||!target.morphTargetInfluences)return;
    for(const [name,index] of Object.entries(target.morphTargetDictionary)){
      const value=weights[name]??0;
      target.morphTargetInfluences[index]=Math.min(1,Math.max(0,Number.isFinite(value)?value:0));
    }
  });
}
