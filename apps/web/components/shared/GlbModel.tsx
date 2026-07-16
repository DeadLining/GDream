'use client';

import {useAnimations,useGLTF} from '@react-three/drei';
import {Component,Suspense,useEffect,useMemo,useRef,type ErrorInfo,type ReactNode} from 'react';
import {cloneDirectorModelWithPose} from '../../lib/director-poses';
import type {DirectorPosePreset} from '../../lib/types';

class ModelBoundary extends Component<{children:ReactNode;fallback:ReactNode;resetKey:string},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(_error:Error,_info:ErrorInfo){}
  componentDidUpdate(previous:{resetKey:string}){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:false});}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

function LoadedGlb({url,scale,offsetY,posePreset,animationClip,animationPlaying,animationTimeSeconds}:{url:string;scale:number;offsetY:number;posePreset:DirectorPosePreset;animationClip:string;animationPlaying:boolean;animationTimeSeconds:number}){
  const {scene,animations}=useGLTF(url);
  const posedScene=useMemo(()=>cloneDirectorModelWithPose(scene,posePreset),[scene,posePreset]);
  const {actions,mixer}=useAnimations(animations,posedScene);
  const action=animationClip?actions[animationClip]:undefined;
  const lastSeek=useRef<{action:unknown;time:number}|null>(null);
  useEffect(()=>{
    if(!action)return;
    action.reset();
    action.play();
  },[action]);
  useEffect(()=>{
    if(!action)return;
    action.paused=!animationPlaying;
  },[action,animationPlaying]);
  useEffect(()=>{
    if(!action)return;
    const time=Math.max(0,animationTimeSeconds);
    if(lastSeek.current?.action===action&&lastSeek.current.time===time)return;
    action.time=time;
    lastSeek.current={action,time};
    mixer.update(0);
  },[action,animationTimeSeconds,mixer]);
  return <group position={[0,offsetY,0]} scale={scale}><primitive object={posedScene}/></group>;
}

export function GlbModel({url,scale=1,offsetY=0,posePreset='neutral',animationClip='',animationPlaying=false,animationTimeSeconds=0,fallback}:{url:string;scale?:number;offsetY?:number;posePreset?:DirectorPosePreset;animationClip?:string;animationPlaying?:boolean;animationTimeSeconds?:number;fallback:ReactNode}){
  return <ModelBoundary resetKey={url} fallback={fallback}><Suspense fallback={fallback}><LoadedGlb url={url} scale={scale} offsetY={offsetY} posePreset={posePreset} animationClip={animationClip} animationPlaying={animationPlaying} animationTimeSeconds={animationTimeSeconds}/></Suspense></ModelBoundary>;
}
