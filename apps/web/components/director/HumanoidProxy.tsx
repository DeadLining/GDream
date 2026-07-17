'use client';

import type {DirectorObject} from '../../lib/types';

const PROXY_GRAY='#8b8f94';

function ProxyMaterial(){
  return <meshStandardMaterial color={PROXY_GRAY} roughness={.82}/>;
}

export function HumanoidProxy({object}:{object:DirectorObject}){
  return <group name={`humanoid-rig-${object.id}`} userData={{rigType:'standard_humanoid',proxyStyle:'solid-gray'}}>
    <mesh name="humanoid-proxy-head" position={[0,1.75,0]} castShadow receiveShadow>
      <sphereGeometry args={[.17,16,12]}/>
      <ProxyMaterial/>
    </mesh>
    <mesh name="humanoid-proxy-body" position={[0,1.18,0]} castShadow receiveShadow>
      <capsuleGeometry args={[.23,.5,8,16]}/>
      <ProxyMaterial/>
    </mesh>
    <mesh name="humanoid-proxy-left-arm" position={[.29,1.16,0]} rotation={[0,0,-.06]} castShadow receiveShadow>
      <capsuleGeometry args={[.085,.58,6,12]}/>
      <ProxyMaterial/>
    </mesh>
    <mesh name="humanoid-proxy-right-arm" position={[-.29,1.16,0]} rotation={[0,0,.06]} castShadow receiveShadow>
      <capsuleGeometry args={[.085,.58,6,12]}/>
      <ProxyMaterial/>
    </mesh>
    <mesh name="humanoid-proxy-left-leg" position={[.12,.42,0]} castShadow receiveShadow>
      <capsuleGeometry args={[.105,.55,6,12]}/>
      <ProxyMaterial/>
    </mesh>
    <mesh name="humanoid-proxy-right-leg" position={[-.12,.42,0]} castShadow receiveShadow>
      <capsuleGeometry args={[.105,.55,6,12]}/>
      <ProxyMaterial/>
    </mesh>
  </group>;
}
