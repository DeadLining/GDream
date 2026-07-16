import {Bone,Group} from 'three';
import {describe,expect,it} from 'vitest';
import {applyDirectorPose,cloneDirectorModelWithPose} from '../lib/director-poses';
import {applyDirectorHeadRotation} from '../lib/director-head-gaze';

describe('applyDirectorPose',()=>{
  it('applies a preset to common humanoid bones and restores the bind pose',()=>{
    const root=new Group();
    const spine=new Bone();spine.name='mixamorigSpine';
    const leftArm=new Bone();leftArm.name='mixamorigLeftArm';
    root.add(spine,leftArm);

    applyDirectorPose(root,'action');
    expect(spine.rotation.x).not.toBe(0);
    expect(leftArm.rotation.z).not.toBe(0);

    applyDirectorPose(root,'neutral');
    expect(spine.rotation.toArray().slice(0,3)).toEqual([0,0,0]);
    expect(leftArm.rotation.toArray().slice(0,3)).toEqual([0,0,0]);
  });

  it('creates independent posed clones without mutating the shared GLB scene',()=>{
    const source=new Group();
    const spine=new Bone();spine.name='mixamorigSpine';
    const leftArm=new Bone();leftArm.name='mixamorigLeftArm';
    source.add(spine,leftArm);

    const action=cloneDirectorModelWithPose(source,'action');
    const dialogue=cloneDirectorModelWithPose(source,'dialogue');
    const actionSpine=action.getObjectByName('mixamorigSpine') as Bone;
    const dialogueSpine=dialogue.getObjectByName('mixamorigSpine') as Bone;

    expect(source.getObjectByName('mixamorigSpine')?.rotation.x).toBe(0);
    expect(actionSpine.rotation.x).not.toBe(dialogueSpine.rotation.x);
    expect(actionSpine).not.toBe(dialogueSpine);
  });

  it('applies head and neck direction without accumulating over a paused frame',()=>{
    const root=new Group();
    const neck=new Bone();neck.name='mixamorigNeck';
    const head=new Bone();head.name='mixamorigHead';
    root.add(neck);neck.add(head);
    head.rotation.y=.2;

    applyDirectorHeadRotation(root,[.1,.4,0]);
    const first=[head.rotation.x,head.rotation.y,neck.rotation.x,neck.rotation.y];
    applyDirectorHeadRotation(root,[.1,.4,0]);

    expect([head.rotation.x,head.rotation.y,neck.rotation.x,neck.rotation.y]).toEqual(first);
    expect(head.rotation.y).toBeGreaterThan(.2);
    expect(neck.rotation.y).toBeGreaterThan(0);
  });
});
