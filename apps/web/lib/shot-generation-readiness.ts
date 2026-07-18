import type {ShotGenerationReadiness} from './types';
import {ApiError} from './api/core';

export type GenerationAssetTarget='character'|'scene'|'prop';
export type GenerationAssetRequest={target:GenerationAssetTarget;shotId:string;requirementIds:string[]};
export type AssetRequirement={
  id:string;project_id:string;script_revision_id:string;kind:GenerationAssetTarget;canonical_key:string;
  name:string;description:string;required:boolean;status:'missing'|'pending'|'ready';binding_type:string;
  binding_id:string|null;source_context:Record<string,unknown>;metadata:Record<string,unknown>;
  created_at:string;updated_at:string;
};

const blockerLabels:Record<string,string>={
  missing_character_reference:'缺少角色参考图',
  missing_background:'缺少场景背景',
  missing_required_prop:'缺少必要道具',
  blocking_not_initialized:'尚未建立镜头站位',
  director_preview_missing:'尚未保存导演预览',
};

export const shotGenerationBlockerLabel=(blocker:string)=>blockerLabels[blocker]??blocker;

export const shotGenerationBlockerLabels=(readiness:ShotGenerationReadiness|null)=>readiness?.blockers.map(shotGenerationBlockerLabel)??[];

const assetTargetByBlocker:Record<string,GenerationAssetTarget>={
  missing_character_reference:'character',
  missing_background:'scene',
  missing_required_prop:'prop',
};

export const generationAssetTargetForBlockers=(blockers:readonly string[]|null|undefined):GenerationAssetTarget=>{
  for(const blocker of blockers??[]){
    const target=assetTargetByBlocker[blocker];
    if(target)return target;
  }
  return 'character';
};

export const generationAssetRequest=(readiness:Pick<ShotGenerationReadiness,'shot_id'|'blockers'|'requirement_ids'>):GenerationAssetRequest=>({
  target:generationAssetTargetForBlockers(readiness.blockers),
  shotId:readiness.shot_id,
  requirementIds:readiness.requirement_ids,
});

export const shotGenerationConflictBlockers=(cause:unknown,shotId:string):string[]|null=>{
  if(!(cause instanceof ApiError)||cause.status!==409)return null;
  try{
    const detail=JSON.parse(cause.detail) as {code?:unknown;blocked_shots?:unknown};
    if(detail.code!=='shot_generation_not_ready'||!detail.blocked_shots||typeof detail.blocked_shots!=='object'||Array.isArray(detail.blocked_shots))return null;
    const blockers=(detail.blocked_shots as Record<string,unknown>)[shotId];
    return Array.isArray(blockers)?blockers.filter((item):item is string=>typeof item==='string'):null;
  }catch{return null;}
};

export const applyShotGenerationBlockers=(readiness:ShotGenerationReadiness,blockers:string[]):ShotGenerationReadiness=>({
  ...readiness,
  ready:false,
  asset_ready:!blockers.some(item=>['missing_character_reference','missing_background','missing_required_prop'].includes(item)),
  blocking_ready:!blockers.includes('blocking_not_initialized'),
  camera_ready:!blockers.includes('director_preview_missing'),
  blockers,
});
