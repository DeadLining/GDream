// Auto-split from lib/api.ts — domain: model-runtime
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { Job, ModelInvocation, ModelRuntimeHealth, ModelRuntimeJob } from '../types';

export const getModelRuntimeHealth = () => apiRequest<ModelRuntimeHealth>('/api/model-runtime/health');
export const getModelRuntimeInvocations = (limit = 50) => apiRequest<ModelInvocation[]>(`/api/model-runtime/invocations?${new URLSearchParams({limit: String(limit)})}`);
export const retryModelRuntimeJob = (jobId: string) => apiRequest<ModelRuntimeJob>(`/api/model-runtime/jobs/${jobId}/retry`, json('POST'));
export const generateModel3D = (targetType: 'character' | 'library_asset', targetId: string, referenceAssetId?: string | null) =>
  apiRequest<ModelRuntimeJob>('/api/model-runtime/model3d', json('POST', {target_type: targetType, target_id: targetId, reference_asset_id: referenceAssetId ?? null}));
export const getLatestModel3DJob = (targetType: 'character' | 'library_asset', targetId: string) =>
  apiRequest<Job | null>(`/api/model-runtime/model3d/latest?${new URLSearchParams({target_type: targetType, target_id: targetId})}`);
export const approveModel3DJob = (jobId: string) =>
  apiRequest<Record<string, unknown>>(`/api/model-runtime/model3d/jobs/${jobId}/approve`, json('POST'));
