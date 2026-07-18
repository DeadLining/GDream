// Auto-split from lib/api.ts — domain: character
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { AssetImpact, AssetVariant, AssetVariantUsage, CharacterReference, CharacterReferenceType, ModelRuntimeJob, ReviewStatus } from '../types';

export const listCharacterReferences = (id:string) => apiRequest<CharacterReference[]>(`/api/characters/${id}/references`);
export const listAssetVariants = (id:string) => apiRequest<AssetVariant[]>(`/api/characters/${id}/variants`);
export const getCharacterImpact=(id:string)=>apiRequest<AssetImpact>(`/api/characters/${id}/impact`);
export const getAssetVariantImpact=(id:string)=>apiRequest<AssetImpact>(`/api/asset-variants/${id}/impact`);
export const getAssetVariantStateImpact=(id:string)=>apiRequest<AssetImpact>(`/api/asset-variant-states/${id}/impact`);
export const createAssetVariant=(characterId:string,data:{kind:'master'|'episode';label:string;episode_id:string|null;parent_variant_id:string|null;inherited_fields:string[];overrides:Record<string,unknown>})=>apiRequest<AssetVariant>(`/api/characters/${characterId}/variants`,json('POST',data));
export const createAssetVariantState=(variantId:string,data:{kind:'expression'|'outfit'|'injury'|'age'|'custom';label:string;overrides:Record<string,unknown>})=>apiRequest<AssetVariant['states'][number]>(`/api/asset-variants/${variantId}/states`,json('POST',data));
export const createAssetVariantUsage=(variantId:string,data:{state_id?:string|null;shot_id:string;asset_id?:string|null;usage_kind:'panel'|'video'|'reference'})=>apiRequest<AssetVariantUsage>(`/api/asset-variants/${variantId}/usages`,json('POST',data));
export const updateAssetVariant=(id:string,data:Partial<Pick<AssetVariant,'kind'|'label'|'episode_id'|'parent_variant_id'|'inherited_fields'|'overrides'>>)=>apiRequest<AssetVariant>(`/api/asset-variants/${id}`,json('PATCH',data));
export const updateAssetVariantState=(id:string,data:Partial<Pick<AssetVariant['states'][number],'kind'|'label'|'overrides'>>)=>apiRequest<AssetVariant['states'][number]>(`/api/asset-variant-states/${id}`,json('PATCH',data));
export async function deleteAssetVariant(id:string):Promise<void>{const response=await fetch(`${API_BASE}/api/asset-variants/${id}`,{method:'DELETE'});if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除资产变体失败');throw new ApiError(detail,response.status,detail);}}
export async function deleteAssetVariantState(id:string):Promise<void>{const response=await fetch(`${API_BASE}/api/asset-variant-states/${id}`,{method:'DELETE'});if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除资产状态失败');throw new ApiError(detail,response.status,detail);}}
export async function uploadCharacterReference(id:string,type:CharacterReferenceType,file:File,label=''):Promise<CharacterReference>{const form=new FormData();form.set('reference_type',type);form.set('label',label);form.set('file',file);const response=await fetch(`${API_BASE}/api/characters/${id}/references/upload`,{method:'POST',body:form});if(!response.ok){const body=await response.json() as {detail?:unknown};throw new ApiError(String(body.detail??'上传失败'),response.status,String(body.detail??''));}return response.json() as Promise<CharacterReference>;}

export const generateCharacterReference=(id:string,type:CharacterReferenceType,label='')=>apiRequest<ModelRuntimeJob>('/api/model-runtime/image',json('POST',{target_type:'character',target_id:id,reference_type:type,label,activate:true}));
export const generateCharacterReferenceSet=(id:string)=>apiRequest<ModelRuntimeJob>('/api/model-runtime/image',json('POST',{target_type:'character',target_id:id,mode:'reference_set',activate:true}));
export const updateCharacterReference=(id:string,data:{label?:string;review_status?:ReviewStatus})=>apiRequest<CharacterReference>(`/api/character-references/${id}`,json('PATCH',data));
export const activateCharacterReference=(characterId:string,referenceId:string)=>apiRequest<CharacterReference>(`/api/characters/${characterId}/references/${referenceId}/active`,json('PUT'));
export async function deleteCharacterReference(id:string):Promise<void>{const response=await fetch(`${API_BASE}/api/character-references/${id}`,{method:'DELETE'});if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除角色参考图失败');throw new ApiError(detail,response.status,detail);}}
