'use client';

import {Canvas,useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import {useEffect,useRef} from 'react';
import type {DirectorObject as DirectorObjectDto,DirectorTransformMode,ShotCamera,Transform} from '../../lib/types';
import {resolveDirectorEnvironment} from '../../lib/director-environment';
import {captureDirectorDepth,captureDirectorObjectMask,captureDirectorSilhouette,renderDirectorSkeletonGuidance,type DirectorGuidanceCapture} from '../../lib/director-guidance';
import {DirectorFallback} from './DirectorFallback';
import {DirectorObject} from './DirectorObject';

export type DirectorCanvasMode='world'|'camera';
export type DirectorCameraPose=Pick<ShotCamera,'position'|'target'|'rotation'>;

function CameraNavigation({shotCamera,mode,onCameraChange}:{shotCamera:ShotCamera;mode:DirectorCanvasMode;onCameraChange?:(camera:DirectorCameraPose)=>void}){
  const threeCamera=useThree(state=>state.camera);
  const controlsRef=useRef<any>(null);
  const fov=Math.max(12,Math.min(80,2*Math.atan(36/(2*shotCamera.focal_length_mm))*180/Math.PI));
  useEffect(()=>{
    threeCamera.position.set(...shotCamera.position);
    threeCamera.rotation.set(...shotCamera.rotation);
    const controls=controlsRef.current;
    controls?.target.set(...shotCamera.target);
    controls?.update();
  },[threeCamera,shotCamera.id,shotCamera.position,shotCamera.rotation,shotCamera.target,mode]);
  useEffect(()=>{
    if('fov' in threeCamera){threeCamera.fov=fov;threeCamera.updateProjectionMatrix();}
  },[threeCamera,fov]);
  const handleEnd=(event:unknown)=>{
    if(mode!=='camera'||!onCameraChange)return;
    const controls=(event as {target?:any})?.target??controlsRef.current;
    const source=controls?.object??threeCamera;
    const target=controls?.target;
    if(!target)return;
    onCameraChange({
      position:[source.position.x,source.position.y,source.position.z],
      target:[target.x,target.y,target.z],
      rotation:[source.rotation.x,source.rotation.y,source.rotation.z],
    });
  };
  return <OrbitControls ref={controlsRef} enabled target={shotCamera.target} makeDefault onEnd={handleEnd}/>;
}

function GuidanceCaptureRegistration({onReady}:{onReady?:(capture:DirectorGuidanceCapture|null)=>void}){
  const scene=useThree(state=>state.scene);
  const camera=useThree(state=>state.camera);
  const gl=useThree(state=>state.gl);
  useEffect(()=>{
    if(!onReady)return;
    const capture:DirectorGuidanceCapture=kind=>{
      if(kind==='silhouette')return captureDirectorSilhouette({scene,camera,renderer:gl});
      if(kind==='skeleton_pose')return renderDirectorSkeletonGuidance(scene,camera,gl.domElement.width,gl.domElement.height);
      if(kind==='depth')return captureDirectorDepth({scene,camera,renderer:gl});
      return captureDirectorObjectMask({scene,camera,renderer:gl});
    };
    onReady(capture);
    return()=>onReady(null);
  },[camera,gl,onReady,scene]);
  return null;
}

export function DirectorCanvas({objects,camera,environment={},selectedObjectId,mode,transformMode='translate',snapEnabled=false,onSelectObject,onTransform,onCameraChange,onGuidanceCaptureReady,editable=true}:{objects:DirectorObjectDto[];camera:ShotCamera;environment?:Record<string,unknown>;selectedObjectId:string|null;mode:DirectorCanvasMode;transformMode?:DirectorTransformMode;snapEnabled?:boolean;onSelectObject?:(id:string|null)=>void;onTransform:(id:string,transform:Transform)=>void;onCameraChange?:(camera:DirectorCameraPose)=>void;onGuidanceCaptureReady?:(capture:DirectorGuidanceCapture|null)=>void;editable?:boolean}){
  const settings=resolveDirectorEnvironment(environment);
  return <div className="director-canvas-shell">
    <Canvas shadows dpr={[1,2]} camera={{position:camera.position,near:camera.near,far:camera.far,fov:Math.max(12,Math.min(80,2*Math.atan(36/(2*camera.focal_length_mm))*180/Math.PI))}} fallback={<DirectorFallback/>} gl={{preserveDrawingBuffer:true,alpha:false}} onPointerMissed={()=>onSelectObject?.(null)}>
      <color attach="background" args={[settings.background_color]}/>
      <ambientLight intensity={settings.ambient_light}/><directionalLight castShadow position={[4,7,5]} color={settings.key_light_color} intensity={settings.key_light_intensity}/>
      {settings.ground==='grid'&&<gridHelper args={[24,24,'#66808a',settings.ground_color]}/>}
      {settings.ground!=='none'&&<mesh name="director-ground" receiveShadow rotation={[-Math.PI/2,0,0]}><planeGeometry args={[24,24]}/>{settings.ground==='solid'?<meshStandardMaterial color={settings.ground_color} roughness={.9}/>:<shadowMaterial opacity={0.18}/>}</mesh>}
      {objects.map(object=><DirectorObject key={object.id} object={object} selected={object.id===selectedObjectId} editable={editable} transformMode={transformMode} snapEnabled={snapEnabled} onSelect={()=>onSelectObject?.(object.id)} onTransform={transform=>onTransform(object.id,transform)}/>)}
      <CameraNavigation shotCamera={camera} mode={mode} onCameraChange={onCameraChange}/>
      <GuidanceCaptureRegistration onReady={onGuidanceCaptureReady}/>
    </Canvas>
    <div className="director-frame-guide" aria-hidden="true"/>
  </div>;
}
