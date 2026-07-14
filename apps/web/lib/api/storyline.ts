// Auto-split from lib/api.ts — domain: storyline
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { Storyline, Volume } from '../types';

export const listVolumes = (projectId:string) => apiRequest<Volume[]>(`/api/projects/${projectId}/volumes`);
export const listStorylines = (projectId:string) => apiRequest<Storyline[]>(`/api/projects/${projectId}/storylines`);
export const createVolume = (projectId:string,data:{title:string;summary:string;position:number}) => apiRequest<Volume>(`/api/projects/${projectId}/volumes`,json('POST',data));
export const createStoryline = (projectId:string,data:{title:string;kind:Storyline['kind'];color:string;description:string}) => apiRequest<Storyline>(`/api/projects/${projectId}/storylines`,json('POST',data));
export const createStorylineEvent = (storylineId:string,data:{episode_id:string;scene_id:string|null;shot_id:string|null;position:number;stage:Storyline['events'][number]['stage'];title:string;description:string;setup_event_id:string|null;payoff_event_id:string|null;metadata:Record<string,unknown>}) => apiRequest<Storyline['events'][number]>(`/api/storylines/${storylineId}/events`,json('POST',data));
export const updateVolume=(id:string,data:Partial<Pick<Volume,'title'|'summary'|'position'>>)=>apiRequest<Volume>(`/api/volumes/${id}`,json('PATCH',data));
export const updateStoryline=(id:string,data:Partial<Pick<Storyline,'title'|'kind'|'color'|'description'>>)=>apiRequest<Storyline>(`/api/storylines/${id}`,json('PATCH',data));
export const updateStorylineEvent=(id:string,data:Partial<Pick<Storyline['events'][number],'episode_id'|'scene_id'|'shot_id'|'position'|'stage'|'title'|'description'|'setup_event_id'|'payoff_event_id'|'metadata'>>)=>apiRequest<Storyline['events'][number]>(`/api/storyline-events/${id}`,json('PATCH',data));
export async function deleteStorylineEvent(id:string):Promise<void>{
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/storyline-events/${id}`,{method:'DELETE'});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除故事线事件失败');throw new ApiError(detail,response.status,detail);}
}
