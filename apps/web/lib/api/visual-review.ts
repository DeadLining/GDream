// Auto-split from lib/api.ts — domain: visual-review
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { VisualReviewCandidate, VisualReviewMessage, VisualReviewThread } from '../types';

export const listVisualReviewThreads=(shotId:string)=>apiRequest<VisualReviewThread[]>(`/api/shots/${shotId}/visual-review-threads`);
export const createVisualReviewThread=(shotId:string,data:{source_asset_id:string|null;title:string;modification_scope:'shot'|'episode'|'master'})=>apiRequest<VisualReviewThread>(`/api/shots/${shotId}/visual-review-threads`,json('POST',data));
export const updateVisualReviewThread=(id:string,data:{modification_scope:'shot'|'episode'|'master'})=>apiRequest<VisualReviewThread>(`/api/visual-review-threads/${id}`,json('PATCH',data));
export const createVisualReviewMessage=(id:string,data:{author_kind:'user'|'assistant'|'system';content:string})=>apiRequest<VisualReviewMessage>(`/api/visual-review-threads/${id}/messages`,json('POST',data));
export const createVisualAnnotation=(id:string,data:{kind:'circle'|'rectangle'|'path';geometry:Record<string,unknown>;color:string;label:string})=>apiRequest<VisualReviewThread['annotations'][number]>(`/api/visual-review-threads/${id}/annotations`,json('POST',data));
export const updateVisualAnnotation=(id:string,data:Partial<Pick<VisualReviewThread['annotations'][number],'kind'|'geometry'|'color'|'label'>>)=>apiRequest<VisualReviewThread['annotations'][number]>(`/api/visual-annotations/${id}`,json('PATCH',data));
export async function deleteVisualAnnotation(id:string):Promise<void>{const response=await fetch(`${API_BASE}/api/visual-annotations/${id}`,{method:'DELETE'});if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'删除视觉圈点失败');throw new ApiError(detail,response.status,detail);}}
export const createVisualReviewCandidate=(id:string,data:{asset_id:string;generation_metadata:Record<string,unknown>})=>apiRequest<VisualReviewCandidate>(`/api/visual-review-threads/${id}/candidates`,json('POST',data));
export const acceptVisualReviewCandidate=(id:string)=>apiRequest<VisualReviewCandidate>(`/api/visual-review-candidates/${id}/accept`,json('POST'));
export const rejectVisualReviewCandidate=(id:string)=>apiRequest<VisualReviewCandidate>(`/api/visual-review-candidates/${id}/reject`,json('POST'));
