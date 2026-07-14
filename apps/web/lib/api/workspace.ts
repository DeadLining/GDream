// Auto-split from lib/api.ts — domain: workspace
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { DeliveryOutput, DeliveryPackage, EpisodeVersion, ProjectSearchResponse, TrashItem, TrashRestore, WorkspaceSummary } from '../types';

export const listEpisodeVersions=(episodeId:string)=>apiRequest<EpisodeVersion[]>(`/api/episodes/${episodeId}/versions`);
export const createEpisodeVersion=(episodeId:string,data:{label:string;source:'manual'|'autosave'|'checkpoint';author:string})=>apiRequest<EpisodeVersion>(`/api/episodes/${episodeId}/versions`,json('POST',data));
export const restoreEpisodeVersion=(id:string)=>apiRequest<EpisodeVersion>(`/api/episode-versions/${id}/restore`,json('POST'));
export const listDeliveryPackages=(episodeId:string)=>apiRequest<DeliveryPackage[]>(`/api/episodes/${episodeId}/delivery-packages`);
export const createDeliveryPackage=(episodeId:string,data:{release_candidate_id:string;preset_name:string;outputs:DeliveryOutput[]})=>apiRequest<DeliveryPackage>(`/api/episodes/${episodeId}/delivery-packages`,json('POST',data));
export const listTrashItems=(projectId:string)=>apiRequest<TrashItem[]>(`/api/projects/${projectId}/trash-items`);
export const restoreTrashItem=(id:string)=>apiRequest<TrashRestore>(`/api/trash-items/${id}/restore`,json('POST'));
export async function permanentlyDeleteTrashItem(id:string):Promise<void>{const response=await fetch(`${API_BASE}/api/trash-items/${id}`,{method:'DELETE'});if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'永久删除失败');throw new ApiError(detail,response.status,detail);}}
export const getWorkspaceSummary=()=>apiRequest<WorkspaceSummary>('/api/workspace/summary');
export const searchProject=(projectId:string,query:string)=>apiRequest<ProjectSearchResponse>(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
