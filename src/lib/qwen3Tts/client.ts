import { Body, fetch, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import type { VoiceSampleInput } from './config';
import { requestQwen3VoiceSample } from './request';

/** Character voice samples only. Shot dubbing/ASR routes remain unchanged. */
export function generateQwen3VoiceSample(input: VoiceSampleInput): Promise<Uint8Array> {
  return requestQwen3VoiceSample(input, useSettingsStore.getState().qwen3TtsBaseUrl, (endpoint, body) => fetch<number[]>(endpoint, {
    method: 'POST', body: Body.json(body), responseType: ResponseType.Binary,
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' }, timeout: 180,
  }));
}
