// Auto-split from lib/api.ts — domain: episode
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { EpisodeCreate, EpisodeDeletionPreview, EpisodeDeletionResult, EpisodeDetail, EpisodePatch, EpisodeSummary } from '../types';

export const createEpisode = (projectId: string, data: EpisodeCreate) => apiRequest<EpisodeSummary>(`/api/projects/${projectId}/episodes`, json('POST', data));
export const getEpisode = (id: string) => apiRequest<EpisodeDetail>(`/api/episodes/${id}`);
export const updateEpisode = (id: string, data: EpisodePatch) => apiRequest<EpisodeSummary>(`/api/episodes/${id}`, json('PATCH', data));
export const previewEpisodeDeletion=(id:string)=>apiRequest<EpisodeDeletionPreview>(`/api/episodes/${id}/deletion-preview`);
export const deleteEpisode=(id:string)=>apiRequest<EpisodeDeletionResult>(`/api/episodes/${id}`,{method:'DELETE'});
