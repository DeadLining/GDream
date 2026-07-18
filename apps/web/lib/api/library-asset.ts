import {API_BASE,ApiError,apiRequest,json} from './core';
import type {LibraryAsset,LibraryAssetCreate,LibraryAssetPatch} from '../types';
import type {AssetRequirement,GenerationAssetTarget} from '../shot-generation-readiness';

export const listLibraryAssets=(projectId:string)=>apiRequest<LibraryAsset[]>(`/api/projects/${projectId}/library-assets`);
export const listSceneLibraryAssets=(sceneId:string)=>apiRequest<LibraryAsset[]>(`/api/scenes/${sceneId}/library-assets`);
export const listAssetRequirements=(projectId:string,kind?:GenerationAssetTarget)=>apiRequest<AssetRequirement[]>(`/api/projects/${projectId}/asset-requirements${kind?`?kind=${encodeURIComponent(kind)}`:''}`);
export const syncAssetRequirements=(projectId:string)=>apiRequest<AssetRequirement[]>(`/api/projects/${projectId}/asset-requirements/sync`,json('POST'));
export const createLibraryAsset=(projectId:string,data:LibraryAssetCreate)=>apiRequest<LibraryAsset>(`/api/projects/${projectId}/library-assets`,json('POST',data));
export const updateLibraryAsset=(id:string,data:LibraryAssetPatch)=>apiRequest<LibraryAsset>(`/api/library-assets/${id}`,json('PATCH',data));
export async function uploadLibraryAssetMedia(id:string,file:Blob,filename='media'):Promise<LibraryAsset>{
  const form=new FormData();form.append('file',file,filename);
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/library-assets/${id}/media`,{method:'POST',body:form});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'上传资产媒体失败');throw new ApiError(detail,response.status,detail);}
  return response.json() as Promise<LibraryAsset>;
}
export const bindLibraryAssetToScene=(sceneId:string,assetId:string)=>mutateSceneLibraryAsset(sceneId,assetId,'PUT');
export const unbindLibraryAssetFromScene=(sceneId:string,assetId:string)=>mutateSceneLibraryAsset(sceneId,assetId,'DELETE');

async function mutateSceneLibraryAsset(sceneId:string,assetId:string,method:'PUT'|'DELETE'):Promise<void>{
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/scenes/${sceneId}/library-assets/${assetId}`,{method});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'更新场景资产失败');throw new ApiError(detail,response.status,detail);}
}

export async function deleteLibraryAsset(id:string):Promise<void>{
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/library-assets/${id}`,{method:'DELETE'});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除资产失败');throw new ApiError(detail,response.status,detail);}
}
