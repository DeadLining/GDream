// Auto-split from lib/api.ts — domain: model-runtime
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { Job, ModelInvocation, ModelRuntimeHealth, ModelRuntimeJob } from '../types';

export const getModelRuntimeHealth = () => apiRequest<ModelRuntimeHealth>('/api/model-runtime/health');
export const getModelRuntimeInvocations = (limit = 50) => apiRequest<ModelInvocation[]>(`/api/model-runtime/invocations?${new URLSearchParams({limit: String(limit)})}`);
export const retryModelRuntimeJob = (jobId: string) => apiRequest<ModelRuntimeJob>(`/api/model-runtime/jobs/${jobId}/retry`, json('POST'));
export const generateLibraryAssetImage = (assetId: string) =>
  apiRequest<ModelRuntimeJob>('/api/model-runtime/image', json('POST', {target_type: 'library_asset', target_id: assetId, activate: true}));
export const generateModel3D = (targetType: 'character' | 'library_asset', targetId: string, referenceAssetId?: string | null, variantId?: string | null, stateId?: string | null, referenceAssetIds: string[] = []) =>
  apiRequest<ModelRuntimeJob>('/api/model-runtime/model3d', json('POST', {target_type: targetType, target_id: targetId, reference_asset_id: referenceAssetId ?? null, reference_asset_ids: referenceAssetIds, variant_id: variantId ?? null, state_id: stateId ?? null}));
export const getLatestModel3DJob = (targetType: 'character' | 'library_asset', targetId: string, variantId?: string | null, stateId?: string | null) =>{
  const params=new URLSearchParams({target_type:targetType,target_id:targetId});if(variantId)params.set('variant_id',variantId);if(stateId)params.set('state_id',stateId);
  return apiRequest<Job | null>(`/api/model-runtime/model3d/latest?${params}`);
};
export const approveModel3DJob = (jobId: string) =>
  apiRequest<Record<string, unknown>>(`/api/model-runtime/model3d/jobs/${jobId}/approve`, json('POST'));
