// Auto-split from lib/api.ts — domain: provider
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { ProviderChannelKind, ProviderChannelTestResult, ProviderChannelUpdate, ProviderChannelUpdateRead, ProviderChannelsRead, ProviderHealth } from '../types';

export const getProviderHealth = () => apiRequest<ProviderHealth>('/api/providers/health');
export const getProviderChannels = (signal?: AbortSignal) => apiRequest<ProviderChannelsRead>('/api/provider-channels', {signal});
export const updateProviderChannel = (kind: ProviderChannelKind, update: ProviderChannelUpdate) =>
  apiRequest<ProviderChannelUpdateRead>(`/api/provider-channels/${kind}`, json('PUT', update));
export const testProviderChannel = (kind: ProviderChannelKind, candidate: ProviderChannelUpdate) =>
  apiRequest<ProviderChannelTestResult>(`/api/provider-channels/${kind}/test`, json('POST', candidate));
