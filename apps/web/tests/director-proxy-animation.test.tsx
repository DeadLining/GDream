import {act,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useDirectorProxyAnimationTime} from '../components/director/useDirectorProxyAnimationTime';

const frame=vi.hoisted(()=>({callback:null as null|((_state:unknown,delta:number)=>void)}));
vi.mock('@react-three/fiber',()=>({useFrame:(callback:(_state:unknown,delta:number)=>void)=>{frame.callback=callback;}}));

afterEach(()=>{frame.callback=null;vi.clearAllMocks();});

it('seeks, advances, pauses on the visible frame, and resets procedural animation time',()=>{
  const applyTime=vi.fn();
  const view=renderHook(
    ({playing,timeSeconds}:{playing:boolean;timeSeconds:number})=>useDirectorProxyAnimationTime({
      animation:'walk',
      durationSeconds:2,
      playing,
      timeSeconds,
      applyTime,
    }),
    {initialProps:{playing:false,timeSeconds:.5}},
  );

  expect(applyTime).toHaveBeenLastCalledWith(.5);
  view.rerender({playing:true,timeSeconds:.5});
  act(()=>frame.callback?.({},.25));
  expect(applyTime).toHaveBeenLastCalledWith(.75);

  const callsAtPause=applyTime.mock.calls.length;
  view.rerender({playing:false,timeSeconds:.5});
  expect(applyTime).toHaveBeenLastCalledWith(.75);
  expect(applyTime).toHaveBeenCalledTimes(callsAtPause);

  view.rerender({playing:false,timeSeconds:1.25});
  expect(applyTime).toHaveBeenLastCalledWith(1.25);
  view.rerender({playing:false,timeSeconds:0});
  expect(applyTime).toHaveBeenLastCalledWith(0);
});
