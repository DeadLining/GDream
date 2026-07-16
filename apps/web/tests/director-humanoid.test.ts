import {describe,expect,it} from 'vitest';
import {DIRECTOR_ANIMATION_CLIPS,directorAnimationMotion} from '../lib/director-animations';
import {directorHeadRotation} from '../lib/director-head-gaze';
import {HUMANOID_BONES,humanoidPoseRotation} from '../lib/director-humanoid';

describe('standard humanoid director rig',()=>{
  it('defines a deterministic parent hierarchy for the composition proxy',()=>{
    expect(HUMANOID_BONES.map(item=>item.id)).toEqual([
      'Hips','Spine','Chest','Neck','Head',
      'LeftUpperArm','LeftLowerArm','LeftHand',
      'RightUpperArm','RightLowerArm','RightHand',
      'LeftUpperLeg','LeftLowerLeg','LeftFoot',
      'RightUpperLeg','RightLowerLeg','RightFoot',
    ]);
    expect(HUMANOID_BONES.find(item=>item.id==='Head')?.parent).toBe('Neck');
    expect(HUMANOID_BONES.find(item=>item.id==='LeftHand')?.parent).toBe('LeftLowerArm');
  });

  it('maps pose presets onto standard bones without changing the rig contract',()=>{
    expect(humanoidPoseRotation('neutral','LeftUpperArm')).toEqual([0,0,0]);
    expect(humanoidPoseRotation('dialogue','LeftLowerArm')).not.toEqual([0,0,0]);
    expect(humanoidPoseRotation('action','Spine')).not.toEqual([0,0,0]);
    expect(humanoidPoseRotation('injured','LeftUpperArm')).not.toEqual(
      humanoidPoseRotation('injured','RightUpperArm'),
    );
  });

  it('defines the standard procedural animation clips used by shot overrides',()=>{
    expect(DIRECTOR_ANIMATION_CLIPS.map(item=>item.id)).toEqual([
      'idle','walk','run','talk','turn','injured',
    ]);
    expect(DIRECTOR_ANIMATION_CLIPS.every(item=>item.duration_seconds===2)).toBe(true);
    expect(directorAnimationMotion('walk',.25).leftArm).toBeCloseTo(
      -directorAnimationMotion('walk',.25).rightArm,
    );
    expect(directorAnimationMotion('run',.25).leftLeg).not.toBe(
      directorAnimationMotion('walk',.25).leftLeg,
    );
    expect(directorAnimationMotion('idle',0).rootY).not.toBe(
      directorAnimationMotion('idle',.5).rootY,
    );
  });

  it('combines explicit head direction with a world-space gaze target',()=>{
    expect(directorHeadRotation({
      headYawDegrees:30,
      headPitchDegrees:-10,
      gazeTarget:null,
      objectPosition:[0,0,0],
      objectRotation:[0,0,0],
      headHeight:1.6,
    })).toEqual([-(10*Math.PI/180),30*Math.PI/180,0]);

    const gaze=directorHeadRotation({
      headYawDegrees:0,
      headPitchDegrees:0,
      gazeTarget:[2,1.6,2],
      objectPosition:[0,0,0],
      objectRotation:[0,0,0],
      headHeight:1.6,
    });
    expect(gaze[0]).toBeCloseTo(0);
    expect(gaze[1]).toBeCloseTo(Math.PI/4);
  });
});
