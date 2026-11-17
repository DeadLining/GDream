export const QWEN3_TTS_DEFAULT_URL = 'http://127.0.0.1:8815';
export const QWEN3_TTS_ENGINE = 'qwen3-tts-custom-voice';
export const QWEN3_TTS_DEFAULT_SPEAKER = 'dylan';
export const QWEN3_TTS_SAMPLE_TEXT = '你好，很高兴认识你。接下来的故事，就由我来讲给你听。';
export const QWEN3_TTS_SPEAKERS = [
  { id: 'dylan', label: 'Dylan · 青年男声（北京）' },
  { id: 'uncle_fu', label: 'Uncle Fu · 低沉醇厚男声' },
  { id: 'eric', label: 'Eric · 明亮微哑男声（四川）' },
  { id: 'vivian', label: 'Vivian · 明亮青年女声' },
  { id: 'serena', label: 'Serena · 温柔女声' },
  { id: 'ryan', label: 'Ryan · 节奏鲜明男声（英语）' },
  { id: 'aiden', label: 'Aiden · 清晰中音男声（英语）' },
  { id: 'ono_anna', label: 'Ono Anna · 轻盈女声（日语）' },
  { id: 'sohee', label: 'Sohee · 温暖女声（韩语）' },
] as const;

export interface VoiceSampleInput {
  text: string;
  instructions: string;
  speaker?: string;
}

export function buildQwen3SpeechRequest(input: VoiceSampleInput) {
  const text = input.text.trim();
  const instructions = input.instructions.trim();
  const speaker = (input.speaker || QWEN3_TTS_DEFAULT_SPEAKER).trim().toLowerCase();
  if (!text || [...text].length > 300) throw new Error('试听台词需要 1–300 个字符。');
  if ([...instructions].length > 2000) throw new Error('音色风格描述不能超过 2000 个字符。');
  if (!QWEN3_TTS_SPEAKERS.some((item) => item.id === speaker)) throw new Error('请选择有效的 Qwen3-TTS 预设音色。');
  return { input: text, instructions, voice: speaker, language: 'Chinese', response_format: 'wav' };
}

export function qwen3SpeechEndpoint(baseUrl: string) {
  const url = new URL(baseUrl.trim() || QWEN3_TTS_DEFAULT_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Qwen3-TTS 服务地址需要是无凭证、无查询参数的 HTTP(S) 地址。');
  }
  return `${url.toString().replace(/\/+$/, '')}/v1/audio/speech`;
}

export function validateQwen3Wav(bytes: Uint8Array): Uint8Array {
  const tag = (start: number) => String.fromCharCode(...bytes.slice(start, start + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Qwen3-TTS 返回的不是有效 WAV 音频，未保存为角色音色。');
  }
  return bytes;
}
