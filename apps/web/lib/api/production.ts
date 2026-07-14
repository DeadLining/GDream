// Auto-split from lib/api.ts — domain: production
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { EpisodeProductionGraph, ProductionCanvasLayout, ProductionItem, ProductionReadiness, ProductionRun, ProductionRunCreate } from '../types';

export const getProductionReadiness = (episodeId:string) => apiRequest<ProductionReadiness>(`/api/episodes/${episodeId}/production-readiness`);
export const createProductionRun = (episodeId:string,data:ProductionRunCreate) => apiRequest<ProductionRun>(`/api/episodes/${episodeId}/production-runs`,json('POST',data));
export const getProductionRun = (runId:string) => apiRequest<ProductionRun>(`/api/production-runs/${runId}`);
export const listProductionItems = (runId:string) => apiRequest<ProductionItem[]>(`/api/production-runs/${runId}/items`);
export const pauseProductionRun = (runId:string) => apiRequest<ProductionRun>(`/api/production-runs/${runId}/pause`,json('POST'));
export const continueProductionRun = (runId:string) => apiRequest<ProductionRun>(`/api/production-runs/${runId}/continue`,json('POST'));
export const retryProductionRun = (runId:string,itemIds?:string[]) => apiRequest<ProductionRun>(`/api/production-runs/${runId}/retry`,json('POST',{item_ids:itemIds}));
export const getEpisodeProductionGraph=(episodeId:string)=>apiRequest<EpisodeProductionGraph>(`/api/episodes/${episodeId}/production-graph`);
export const getProductionCanvasLayout=(episodeId:string)=>apiRequest<{episode_id:string;version:number;layout:ProductionCanvasLayout;updated_at:string}>(`/api/episodes/${episodeId}/production-canvas-layout`);
export const putProductionCanvasLayout=(episodeId:string,layout:ProductionCanvasLayout)=>apiRequest<{episode_id:string;version:number;layout:ProductionCanvasLayout;updated_at:string}>(`/api/episodes/${episodeId}/production-canvas-layout`,json('PUT',layout));
