import {describe,expect,it} from 'vitest';
import {DIRECTOR_FACIAL_EXPRESSIONS,applyDirectorMorphTargetWeights,directorExpressionFace} from '../lib/director-expressions';

describe('director facial expressions',()=>{
  it('defines visibly distinct expression presets for the humanoid proxy',()=>{
    expect(DIRECTOR_FACIAL_EXPRESSIONS.map(item=>item.id)).toEqual(['neutral','happy','sad','angry','surprised']);
    expect(directorExpressionFace('happy').eyeScaleY).toBeLessThan(directorExpressionFace('neutral').eyeScaleY);
    expect(directorExpressionFace('surprised').mouthScaleY).toBeGreaterThan(directorExpressionFace('neutral').mouthScaleY);
    expect(directorExpressionFace('angry').leftBrowRotation).not.toBe(directorExpressionFace('neutral').leftBrowRotation);
  });

  it('applies clamped morph weights and clears unspecified targets',()=>{
    const node={morphTargetDictionary:{Smile:0,Blink:1},morphTargetInfluences:[.2,.3]};
    const root={traverse:(visit:(object:unknown)=>void)=>visit(node)};
    applyDirectorMorphTargetWeights(root as never,{Smile:.75});
    expect(node.morphTargetInfluences).toEqual([.75,0]);
    applyDirectorMorphTargetWeights(root as never,{Smile:2,Blink:-1});
    expect(node.morphTargetInfluences).toEqual([1,0]);
  });
});
