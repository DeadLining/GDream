import { buildQwen3SpeechRequest, qwen3SpeechEndpoint, validateQwen3Wav, type VoiceSampleInput } from './config.ts';

export type SpeechTransport = (
  url: string,
  body: ReturnType<typeof buildQwen3SpeechRequest>,
) => Promise<{ ok: boolean; status: number; data: number[] | Uint8Array }>;

/** Exactly one request: no hidden retries and no paid provider fallback. */
export async function requestQwen3VoiceSample(input: VoiceSampleInput, baseUrl: string, transport: SpeechTransport): Promise<Uint8Array> {
  const body = buildQwen3SpeechRequest(input);
  const endpoint = qwen3SpeechEndpoint(baseUrl);
  let response;
  try {
    response = await transport(endpoint, body);
  } catch {
    throw new Error('无法连接 Qwen3-TTS 服务，或请求已超时。请检查 95 服务与网络；服务可能仍在处理本次请求，不会自动重试或转到付费通道。');
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error('Qwen3-TTS 正在生成其他音频，请稍后再试。');
    throw new Error(`Qwen3-TTS 生成失败（HTTP ${response.status}），请检查服务日志。未切换其他语音通道。`);
  }
  return validateQwen3Wav(Uint8Array.from(response.data));
}
