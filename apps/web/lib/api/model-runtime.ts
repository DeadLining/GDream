// Auto-split from lib/api.ts — domain: model-runtime
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { ModelInvocation, ModelRuntimeHealth, ModelRuntimeJob } from '../types';

export const getModelRuntimeHealth = () => apiRequest<ModelRuntimeHealth>('/api/model-runtime/health');
export const getModelRuntimeInvocations = (limit = 50) => apiRequest<ModelInvocation[]>(`/api/model-runtime/invocations?${new URLSearchParams({limit: String(limit)})}`);
export const retryModelRuntimeJob = (jobId: string) => apiRequest<ModelRuntimeJob>(`/api/model-runtime/jobs/${jobId}/retry`, json('POST'));
export const generateLibraryAssetImage = (assetId: string) =>
  apiRequest<ModelRuntimeJob>('/api/model-runtime/image', json('POST', {target_type: 'library_asset', target_id: assetId, activate: true}));
