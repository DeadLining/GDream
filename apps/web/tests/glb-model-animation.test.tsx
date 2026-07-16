import React from 'react';
import {Group} from 'three';
import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {GlbModel} from '../components/shared/GlbModel';

const animationAction=vi.hoisted(()=>({reset:vi.fn(),play:vi.fn(),paused:true,time:0}));
const useAnimations=vi.hoisted(()=>vi.fn(()=>({actions:{Walk:animationAction},mixer:{update:vi.fn()}})));

vi.mock('@react-three/fiber',()=>({useFrame:vi.fn()}));
vi.mock('@react-three/drei',()=>({
  Clone:()=> <div data-testid="animated-model"/>,
  useAnimations,
  useGLTF:()=>({scene:new Group(),animations:[{name:'Walk'}]}),
}));

afterEach(()=>{cleanup();vi.clearAllMocks();animationAction.paused=true;animationAction.time=0;});

it('plays and seeks an imported GLB animation action',()=>{
  const view=render(<GlbModel url="/media/linxia.glb" animationClip="Walk" animationPlaying animationTimeSeconds={1.25} fallback={<span>fallback</span>}/>);

  expect(useAnimations).toHaveBeenCalled();
  expect(animationAction.reset).toHaveBeenCalled();
  expect(animationAction.play).toHaveBeenCalled();
  expect(animationAction.paused).toBe(false);
  expect(animationAction.time).toBe(1.25);

  animationAction.time=1.75;
  view.rerender(<GlbModel url="/media/linxia.glb" animationClip="Walk" animationPlaying={false} animationTimeSeconds={1.25} fallback={<span>fallback</span>}/>);
  expect(animationAction.paused).toBe(true);
  expect(animationAction.time).toBe(1.75);

  view.rerender(<GlbModel url="/media/linxia.glb" animationClip="Walk" animationPlaying={false} animationTimeSeconds={2} fallback={<span>fallback</span>}/>);
  expect(animationAction.time).toBe(2);
});
