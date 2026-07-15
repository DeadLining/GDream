import type {DirectorObject,DirectorProxyRig} from './types';

export const DIRECTOR_PROXY_RIGS:Array<{id:DirectorProxyRig;label:string}>=[
  {id:'standard_humanoid',label:'标准人形'},
  {id:'quadruped',label:'四足动物'},
  {id:'bird',label:'鸟类'},
  {id:'prop_box',label:'箱体道具'},
  {id:'prop_cylinder',label:'圆柱道具'},
  {id:'prop_sphere',label:'球形道具'},
];

const proxyIds=new Set<DirectorProxyRig>(DIRECTOR_PROXY_RIGS.map(item=>item.id));

export function resolveDirectorProxyRig(object:DirectorObject):DirectorProxyRig{
  const metadataRig=object.metadata.proxy_rig;
  if(typeof metadataRig==='string'&&proxyIds.has(metadataRig as DirectorProxyRig))return metadataRig as DirectorProxyRig;
  const appearanceRig=object.appearance.proxy_rig;
  if(typeof appearanceRig==='string'&&proxyIds.has(appearanceRig as DirectorProxyRig))return appearanceRig as DirectorProxyRig;
  return object.kind==='character'?'standard_humanoid':'prop_box';
}

export const isAnimatedDirectorProxy=(rig:DirectorProxyRig)=>rig==='standard_humanoid'||rig==='quadruped'||rig==='bird';
