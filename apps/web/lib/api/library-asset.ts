import {API_BASE,ApiError,apiRequest,json} from './core';
import type {LibraryAsset,LibraryAssetCreate,LibraryAssetPatch} from '../types';

export const listLibraryAssets=(projectId:string)=>apiRequest<LibraryAsset[]>(`/api/projects/${projectId}/library-assets`);
export const createLibraryAsset=(projectId:string,data:LibraryAssetCreate)=>apiRequest<LibraryAsset>(`/api/projects/${projectId}/library-assets`,json('POST',data));
export const updateLibraryAsset=(id:string,data:LibraryAssetPatch)=>apiRequest<LibraryAsset>(`/api/library-assets/${id}`,json('PATCH',data));
export async function deleteLibraryAsset(id:string):Promise<void>{
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/library-assets/${id}`,{method:'DELETE'});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除资产失败');throw new ApiError(detail,response.status,detail);}
}
