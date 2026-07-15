import type {DirectorObject,DirectorObjectOverride,Transform} from './types';

export function applyDirectorObjectOverrides(objects:DirectorObject[],overrides:Record<string,DirectorObjectOverride>):DirectorObject[]{
  return objects.map(object=>{
    const override=overrides[object.id];
    if(!override)return object;
    return {
      ...object,
      transform:override.transform??object.transform,
      visible:override.visible??object.visible,
      appearance:override.pose_preset
        ? {...object.appearance,pose_preset:override.pose_preset}
        : object.appearance,
    };
  });
}

export function mergeDirectorObjectOverride(overrides:Record<string,DirectorObjectOverride>,objectId:string,patch:DirectorObjectOverride):Record<string,DirectorObjectOverride>{
  return {...overrides,[objectId]:{...overrides[objectId],...patch}};
}

export function removeDirectorObjectOverride(overrides:Record<string,DirectorObjectOverride>,objectId:string):Record<string,DirectorObjectOverride>{
  return Object.fromEntries(Object.entries(overrides).filter(([id])=>id!==objectId));
}

export function setDirectorObjectOverrideTransform(overrides:Record<string,DirectorObjectOverride>,objectId:string,transform:Transform|null):Record<string,DirectorObjectOverride>{
  if(transform)return mergeDirectorObjectOverride(overrides,objectId,{transform});
  const current=overrides[objectId];
  if(!current)return overrides;
  const {transform:_removed,...remaining}=current;
  if(Object.keys(remaining).length)return {...overrides,[objectId]:remaining};
  return removeDirectorObjectOverride(overrides,objectId);
}
