'use client';

import {Clone,useGLTF} from '@react-three/drei';
import {Component,Suspense,type ErrorInfo,type ReactNode} from 'react';

class ModelBoundary extends Component<{children:ReactNode;fallback:ReactNode;resetKey:string},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(_error:Error,_info:ErrorInfo){}
  componentDidUpdate(previous:{resetKey:string}){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:false});}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

function LoadedGlb({url,scale,offsetY}:{url:string;scale:number;offsetY:number}){
  const {scene}=useGLTF(url);
  return <group position={[0,offsetY,0]} scale={scale}><Clone object={scene}/></group>;
}

export function GlbModel({url,scale=1,offsetY=0,fallback}:{url:string;scale?:number;offsetY?:number;fallback:ReactNode}){
  return <ModelBoundary resetKey={url} fallback={fallback}><Suspense fallback={fallback}><LoadedGlb url={url} scale={scale} offsetY={offsetY}/></Suspense></ModelBoundary>;
}
