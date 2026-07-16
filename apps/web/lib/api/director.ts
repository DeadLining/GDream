// Auto-split from lib/api.ts — domain: director
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { Asset, DirectorApplyField, DirectorAsset, DirectorObject, DirectorRevision, DirectorStage, DirectorSuggestion, DirectorSuggestionKind, Shot, ShotCamera } from '../types';
import type { Transform } from '../types';

export const createDirectorStage=(sceneId:string)=>apiRequest<DirectorStage>(`/api/scenes/${sceneId}/director-stage`,json('POST'));
export const getDirectorStage=(sceneId:string)=>apiRequest<DirectorStage>(`/api/scenes/${sceneId}/director-stage`);
export const updateDirectorStage=(stageId:string,expectedVersion:number,environment:Record<string,unknown>)=>apiRequest<DirectorStage>(`/api/director-stages/${stageId}`,json('PATCH',{expected_version:expectedVersion,stage:{environment}}));
export const listDirectorRevisions=(stageId:string)=>apiRequest<DirectorRevision[]>(`/api/director-stages/${stageId}/revisions`);
export const restoreDirectorRevision=(stageId:string,revisionId:string,expectedVersion:number)=>apiRequest<DirectorStage>(`/api/director-stages/${stageId}/revisions/${revisionId}/restore`,json('POST',{expected_version:expectedVersion}));
export const createDirectorObject=(stageId:string,expectedVersion:number,object:{kind:DirectorObject['kind'];source_type:DirectorObject['source_type'];source_id?:string|null;label:string;transform?:Transform;appearance?:Record<string,unknown>;metadata?:Record<string,unknown>;visible?:boolean})=>apiRequest<DirectorObject>(`/api/director-stages/${stageId}/objects`,json('POST',{expected_version:expectedVersion,object}));
export const getDirectorAssets=(stageId:string,shotId?:string)=>apiRequest<DirectorAsset[]>(`/api/director-stages/${stageId}/assets${shotId?`?shot_id=${encodeURIComponent(shotId)}`:''}`);
export const syncDirectorAssets=(stageId:string,expectedVersion:number,assetKeys:string[])=>apiRequest<DirectorStage>(`/api/director-stages/${stageId}/assets/sync`,json('POST',{expected_version:expectedVersion,asset_keys:assetKeys}));
export const updateDirectorObject=(objectId:string,expectedVersion:number,object:Partial<Pick<DirectorObject,'label'|'transform'|'appearance'|'metadata'|'visible'>>)=>apiRequest<DirectorObject>(`/api/director-objects/${objectId}`,json('PATCH',{expected_version:expectedVersion,object}));
export async function deleteDirectorObject(objectId:string,expectedVersion:number):Promise<void>{await apiRequest(`/api/director-objects/${objectId}`,json('DELETE',{expected_version:expectedVersion}));}
export const updateDirectorCamera=(stageId:string,shotId:string,expectedVersion:number,camera:Partial<Omit<ShotCamera,'id'|'stage_id'|'shot_id'|'version'|'preview_asset_id'>>)=>apiRequest<ShotCamera>(`/api/director-stages/${stageId}/shots/${shotId}/camera`,json('PUT',{expected_version:expectedVersion,camera}));
export const createDirectorSuggestion=(stageId:string,shotId:string|null,kind:DirectorSuggestionKind)=>apiRequest<DirectorSuggestion>(`/api/director-stages/${stageId}/suggestions`,json('POST',{shot_id:shotId,kind}));
export const applyDirectorSuggestionToShot=(stageId:string,shotId:string,suggestionId:string,fields:DirectorApplyField[])=>apiRequest<Shot>(`/api/director-stages/${stageId}/shots/${shotId}/apply-to-shot`,json('POST',{suggestion_id:suggestionId,fields}));
export async function uploadDirectorPreview(cameraId:string,preview:Blob):Promise<Asset>{
  const form=new FormData();form.set('file',preview,'preview.png');
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/director-cameras/${cameraId}/preview`,{method:'POST',body:form});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'预览上传失败');throw new ApiError(detail,response.status,detail);}
  return response.json() as Promise<Asset>;
}
