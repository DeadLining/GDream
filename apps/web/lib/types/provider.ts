// Auto-split from lib/types.ts — domain: provider
// Do not edit manually; regenerate via the split script if types.ts changes.

import type {JobStatus} from './common';

export type ProviderHealthKind = 'llm' | 'image' | 'tts' | 'video' | 'model3d';
export type ProviderHealthItem = {
  status: 'ok' | 'failed' | 'disabled';
  model: string;
  host: string;
  elapsed_ms: number;
  check_scope: 'model' | 'endpoint' | 'audio';
  error: string | null;
};
export type ProviderHealth = Record<ProviderHealthKind, ProviderHealthItem>;
export type ProviderChannelKind = 'llm' | 'image' | 'tts' | 'video' | 'model3d';
export type ProviderChannelRead = {
  name: string;
  enabled: boolean;
  base_url: string;
  model: string;
  ssh_host: string;
  api_key_configured: boolean;
  api_key_masked: string;
};
export type ProviderChannelsRead = Record<ProviderChannelKind, ProviderChannelRead> & {
  persistence: {status: 'defaults' | 'saved'; file_path: string};
  reloaded_at: string;
};
export type ProviderChannelUpdate = {
  name: string;
  enabled: boolean;
  base_url: string;
  model: string;
  api_key: string;
  clear_api_key: boolean;
  ssh_host: string;
};
export type ProviderChannelUpdateRead = {channel: ProviderChannelRead; current: ProviderChannelsRead};
export type ProviderChannelTestResult = {
  status: 'ok' | 'failed';
  model: string;
  host: string;
  elapsed_ms: number;
  check_scope: 'model' | 'endpoint' | 'audio';
  error: string | null;
};
export type ModelCapability = 'text' | 'image' | 'speech' | 'video' | 'model3d';
export type ModelRuntimeCapabilityHealth = {
  status: 'healthy' | 'unavailable' | 'disabled';
  model: string;
  host: string;
  elapsed_ms: number;
  last_invocation_elapsed_ms: number | null;
  error: string | null;
};
export type ModelRuntimeHealth = {
  capabilities: Record<ModelCapability, ModelRuntimeCapabilityHealth>;
  infrastructure: {
    api: {status: string};
    mock_ssh: {state: string; error?: string | null};
    queue: {queued: number; running: number};
    persistence: {status: string};
  };
  checked_at: string;
};
export type ModelInvocation = {
  id: string;
  capability: ModelCapability;
  provider: string;
  model: string;
  target_type: string;
  target_id: string;
  job_id: string | null;
  status: 'running' | 'succeeded' | 'failed';
  elapsed_ms: number;
  error_code: string;
  retryable: boolean;
  created_at: string;
  updated_at?: string;
};
export type ModelRuntimeJob = {job_id: string; capability: ModelCapability; status: JobStatus};
export type MockSshHost = {id: string; name: string; type: string};
export type MockSshState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
export type MockSshStatus = {
  desired_running: boolean;
  state: MockSshState;
  host_id: string | null;
  alias: string | null;
  port: number | null;
  error: string | null;
  reused: boolean;
};
export type MockSshStart = {host_id: string; alias: string};
