'use client';

import {Canvas} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import type {DirectorObject as DirectorObjectDto,ShotCamera,Transform} from '../../lib/types';
import {DirectorFallback} from './DirectorFallback';
import {DirectorObject} from './DirectorObject';

export type DirectorCanvasMode='world'|'camera';

export function DirectorCanvas({objects,camera,selectedObjectId,mode,onTransform,editable=true}:{objects:DirectorObjectDto[];camera:ShotCamera;selectedObjectId:string|null;mode:DirectorCanvasMode;onTransform:(id:string,transform:Transform)=>void;editable?:boolean}){
  return <div className="director-canvas-shell">
    <Canvas shadows dpr={[1,2]} camera={{position:camera.position,near:camera.near,far:camera.far,fov:Math.max(12,Math.min(80,2*Math.atan(36/(2*camera.focal_length_mm))*180/Math.PI))}} fallback={<DirectorFallback/>} gl={{preserveDrawingBuffer:true,alpha:false}}>
      <color attach="background" args={['#263238']}/>
      <ambientLight intensity={0.85}/><directionalLight castShadow position={[4,7,5]} intensity={1.4}/>
      <gridHelper args={[24,24,'#66808a','#40545c']}/>
      <mesh receiveShadow rotation={[-Math.PI/2,0,0]}><planeGeometry args={[24,24]}/><shadowMaterial opacity={0.18}/></mesh>
      {objects.map(object=><DirectorObject key={object.id} object={object} selected={object.id===selectedObjectId} editable={editable} onTransform={transform=>onTransform(object.id,transform)}/>)}
      <OrbitControls enabled={mode==='world'} target={camera.target} makeDefault/>
    </Canvas>
    <div className="director-frame-guide" aria-hidden="true"/>
  </div>;
}
