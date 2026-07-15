'use client';

import {Clone,useGLTF} from '@react-three/drei';
import {Component,Suspense,useMemo,type ErrorInfo,type ReactNode} from 'react';
import {cloneDirectorModelWithPose} from '../../lib/director-poses';
import type {DirectorPosePreset} from '../../lib/types';

class ModelBoundary extends Component<{children:ReactNode;fallback:ReactNode;resetKey:string},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(_error:Error,_info:ErrorInfo){}
  componentDidUpdate(previous:{resetKey:string}){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:false});}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

function LoadedGlb({url,scale,offsetY,posePreset}:{url:string;scale:number;offsetY:number;posePreset:DirectorPosePreset}){
  const {scene}=useGLTF(url);
  const posedScene=useMemo(()=>cloneDirectorModelWithPose(scene,posePreset),[scene,posePreset]);
  return <group position={[0,offsetY,0]} scale={scale}><Clone object={posedScene}/></group>;
}

export function GlbModel({url,scale=1,offsetY=0,posePreset='neutral',fallback}:{url:string;scale?:number;offsetY?:number;posePreset?:DirectorPosePreset;fallback:ReactNode}){
  return <ModelBoundary resetKey={url} fallback={fallback}><Suspense fallback={fallback}><LoadedGlb url={url} scale={scale} offsetY={offsetY} posePreset={posePreset}/></Suspense></ModelBoundary>;
}
