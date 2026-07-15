'use client';

import {Canvas,useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import {useEffect,useRef} from 'react';
import type {DirectorObject as DirectorObjectDto,DirectorTransformMode,ShotCamera,Transform} from '../../lib/types';
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

export function DirectorCanvas({objects,camera,selectedObjectId,mode,transformMode='translate',snapEnabled=false,onSelectObject,onTransform,onCameraChange,editable=true}:{objects:DirectorObjectDto[];camera:ShotCamera;selectedObjectId:string|null;mode:DirectorCanvasMode;transformMode?:DirectorTransformMode;snapEnabled?:boolean;onSelectObject?:(id:string|null)=>void;onTransform:(id:string,transform:Transform)=>void;onCameraChange?:(camera:DirectorCameraPose)=>void;editable?:boolean}){
  return <div className="director-canvas-shell">
    <Canvas shadows dpr={[1,2]} camera={{position:camera.position,near:camera.near,far:camera.far,fov:Math.max(12,Math.min(80,2*Math.atan(36/(2*camera.focal_length_mm))*180/Math.PI))}} fallback={<DirectorFallback/>} gl={{preserveDrawingBuffer:true,alpha:false}} onPointerMissed={()=>onSelectObject?.(null)}>
      <color attach="background" args={['#263238']}/>
      <ambientLight intensity={0.85}/><directionalLight castShadow position={[4,7,5]} intensity={1.4}/>
      <gridHelper args={[24,24,'#66808a','#40545c']}/>
      <mesh receiveShadow rotation={[-Math.PI/2,0,0]}><planeGeometry args={[24,24]}/><shadowMaterial opacity={0.18}/></mesh>
      {objects.map(object=><DirectorObject key={object.id} object={object} selected={object.id===selectedObjectId} editable={editable} transformMode={transformMode} snapEnabled={snapEnabled} onSelect={()=>onSelectObject?.(object.id)} onTransform={transform=>onTransform(object.id,transform)}/>)}
      <CameraNavigation shotCamera={camera} mode={mode} onCameraChange={onCameraChange}/>
    </Canvas>
    <div className="director-frame-guide" aria-hidden="true"/>
  </div>;
}
