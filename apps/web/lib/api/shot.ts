// Auto-split from lib/api.ts — domain: shot
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { Asset, DialogueLine, DialoguePatch, Job, Shot, ShotPatch } from '../types';

export const updateShot = (id: string, data: ShotPatch) => apiRequest<Shot>(`/api/shots/${id}`, json('PATCH', data));
export const updateDialogue = (id: string, data: DialoguePatch) => apiRequest<DialogueLine>(`/api/dialogue/${id}`, json('PATCH', data));
export const getAsset = (id: string) => apiRequest<Asset>(`/api/assets/${id}`);
export const startPlanning = (episodeId: string) => apiRequest<Job>(`/api/episodes/${episodeId}/plan`, json('POST'));
export const startPanelGeneration = (shotId: string, activate = true) => apiRequest<{job_id: string; status: string}>(`/api/shots/${shotId}/panels?${new URLSearchParams({activate: String(activate)})}`, json('POST'));
export const listPanelVersions = (shotId: string) => apiRequest<Asset[]>(`/api/shots/${shotId}/panels`);
export const activatePanel = (shotId: string, assetId: string) => apiRequest<Shot>(`/api/shots/${shotId}/panels/${assetId}/active`, json('PUT'));
export const startVideoGeneration = (shotId:string,activate=true) => apiRequest<{job_id:string;status:string}>(`/api/shots/${shotId}/videos?${new URLSearchParams({activate:String(activate)})}`,json('POST'));
export const listVideoVersions = (shotId:string) => apiRequest<Asset[]>(`/api/shots/${shotId}/videos`);
export const activateVideo = (shotId:string,assetId:string) => apiRequest<Shot>(`/api/shots/${shotId}/videos/${assetId}/active`,json('PUT'));
export const startSpeech = (dialogueId: string) => apiRequest<{job_id: string; status: string}>(`/api/dialogue/${dialogueId}/speech`, json('POST'));
export const startRender = (episodeId: string) => apiRequest<{job_id: string; status: string}>(`/api/episodes/${episodeId}/render`, json('POST'));
export const getJob = (jobId: string) => apiRequest<Job>(`/api/jobs/${jobId}`);
export const retryJob = (jobId: string) => apiRequest<Job>(`/api/jobs/${jobId}/retry`, json('POST'));
