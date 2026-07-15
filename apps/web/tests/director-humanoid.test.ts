import {describe,expect,it} from 'vitest';
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
});
