'use client';

import {Canvas} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import {GlbModel} from '../shared/GlbModel';

const proxy=<mesh position={[0,.9,0]} castShadow><capsuleGeometry args={[.32,1.15,8,16]}/><meshStandardMaterial color="#566b74"/></mesh>;

export function CharacterModelPreview({url}:{url:string}){
  return <div className="character-model-preview" aria-label="角色 3D 模型预览"><Canvas shadows dpr={[1,1.5]} camera={{position:[2.5,1.6,3.5],fov:38}}><color attach="background" args={['#263238']}/><ambientLight intensity={1}/><directionalLight position={[3,5,4]} intensity={1.6} castShadow/><gridHelper args={[8,8,'#647b85','#3d5058']}/><GlbModel url={url} fallback={proxy}/><OrbitControls makeDefault target={[0,.9,0]} enablePan={false}/></Canvas></div>;
}
