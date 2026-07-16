'use client';

import {useEffect,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import type {DirectorAnimationClip} from '../../lib/types';

const normalizedTime=(time:number,duration:number)=>{
  const safeDuration=Number.isFinite(duration)&&duration>0?duration:0;
  const safeTime=Number.isFinite(time)?Math.max(0,time):0;
  return safeDuration?Math.min(safeDuration,safeTime):0;
};

export function useDirectorProxyAnimationTime({animation,durationSeconds,playing,timeSeconds,applyTime,renderKey=''}:{animation:DirectorAnimationClip;durationSeconds:number;playing:boolean;timeSeconds:number;applyTime:(time:number)=>void;renderKey?:string}){
  const applyRef=useRef(applyTime);
  const currentTimeRef=useRef(normalizedTime(timeSeconds,durationSeconds));
  const seekRef=useRef<{animation:DirectorAnimationClip;durationSeconds:number;timeSeconds:number;renderKey:string}|null>(null);
  applyRef.current=applyTime;

  useEffect(()=>{
    const previous=seekRef.current;
    if(previous&&previous.animation===animation&&previous.durationSeconds===durationSeconds&&previous.timeSeconds===timeSeconds&&previous.renderKey===renderKey)return;
    const next=normalizedTime(timeSeconds,durationSeconds);
    currentTimeRef.current=next;
    seekRef.current={animation,durationSeconds,timeSeconds,renderKey};
    applyRef.current(next);
  },[animation,durationSeconds,renderKey,timeSeconds]);

  useFrame((_state,delta)=>{
    if(!playing)return;
    const duration=Number.isFinite(durationSeconds)&&durationSeconds>0?durationSeconds:0;
    const elapsed=currentTimeRef.current+Math.max(0,delta);
    const next=duration?elapsed%duration:0;
    currentTimeRef.current=next;
    applyRef.current(next);
  });
}
