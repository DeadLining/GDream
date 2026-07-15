'use client';

import {resolveDirectorProxyRig} from '../../lib/director-proxies';
import type {DirectorObject} from '../../lib/types';
import {BirdProxy,QuadrupedProxy} from './AnimalProxy';
import {HumanoidProxy} from './HumanoidProxy';

export function DirectorProxy({object}:{object:DirectorObject}){
  const rig=resolveDirectorProxyRig(object);
  if(rig==='standard_humanoid')return <HumanoidProxy object={object}/>;
  if(rig==='quadruped')return <QuadrupedProxy object={object}/>;
  if(rig==='bird')return <BirdProxy object={object}/>;
  const color=typeof object.appearance.color==='string'?object.appearance.color:'#5b8ca8';
  return <group name={`primitive-proxy-${object.id}`} data-proxy-shape={rig.replace('prop_','')} userData={{rigType:rig}}>
    <mesh castShadow receiveShadow position={[0,.5,0]}>
      {rig==='prop_cylinder'?<cylinderGeometry args={[.42,.5,1,16]}/>:rig==='prop_sphere'?<sphereGeometry args={[.55,16,12]}/>:<boxGeometry args={[1,1,1]}/>}<meshStandardMaterial color={color} roughness={.76}/>
    </mesh>
  </group>;
}
