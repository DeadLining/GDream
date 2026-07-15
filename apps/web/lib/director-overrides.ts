import type {DirectorAsset,DirectorObject,DirectorObjectOverride,Transform} from './types';

export function applyDirectorAssetModels(objects:DirectorObject[],assets:DirectorAsset[]):DirectorObject[]{
  const byCharacter=new Map<string,DirectorAsset>();
  for(const asset of assets){
    const characterId=typeof asset.metadata.character_id==='string'?asset.metadata.character_id:'';
    if(characterId&&asset.source_type==='model'&&asset.media_url)byCharacter.set(characterId,asset);
  }
  return objects.map(object=>{
    const characterId=typeof object.metadata.character_id==='string'?object.metadata.character_id:'';
    const asset=characterId?byCharacter.get(characterId):undefined;
    if(!asset)return object;
    return {
      ...object,
      source_type:'model',
      source_id:asset.source_id,
      appearance:{...object.appearance,model_url:asset.media_url},
      metadata:{...object.metadata,...asset.metadata,asset_id:asset.asset_id},
    };
  });
}

export function applyDirectorObjectOverrides(objects:DirectorObject[],overrides:Record<string,DirectorObjectOverride>):DirectorObject[]{
  return objects.map(object=>{
    const override=overrides[object.id];
    if(!override)return object;
    return {
      ...object,
      transform:override.transform??object.transform,
      visible:override.visible??object.visible,
      appearance:{
        ...object.appearance,
        ...(override.pose_preset?{pose_preset:override.pose_preset}:{}),
        ...(override.animation_clip?{animation_clip:override.animation_clip}:{}),
        ...(override.animation_playing!==undefined?{animation_playing:override.animation_playing}:{}),
      },
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
