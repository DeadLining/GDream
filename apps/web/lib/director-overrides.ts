import type {DirectorObject,DirectorObjectOverride} from './types';

export function applyDirectorObjectOverrides(objects:DirectorObject[],overrides:Record<string,DirectorObjectOverride>):DirectorObject[]{
  return objects.map(object=>{
    const override=overrides[object.id];
    if(!override)return object;
    return {...object,transform:override.transform??object.transform,visible:override.visible??object.visible};
  });
}

export function mergeDirectorObjectOverride(overrides:Record<string,DirectorObjectOverride>,objectId:string,patch:DirectorObjectOverride):Record<string,DirectorObjectOverride>{
  return {...overrides,[objectId]:{...overrides[objectId],...patch}};
}

export function removeDirectorObjectOverride(overrides:Record<string,DirectorObjectOverride>,objectId:string):Record<string,DirectorObjectOverride>{
  return Object.fromEntries(Object.entries(overrides).filter(([id])=>id!==objectId));
}
