import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildQwen3SpeechRequest, QWEN3_TTS_DEFAULT_URL, QWEN3_TTS_SPEAKERS, qwen3SpeechEndpoint, validateQwen3Wav } from './config.ts';
import { requestQwen3VoiceSample } from './request.ts';

const input = { text: '这里只读台词。', instructions: '年轻、语速明快', speaker: 'Dylan' };
const wav = new Uint8Array(48);
wav.set(new TextEncoder().encode('RIFF'), 0);
wav.set(new TextEncoder().encode('WAVE'), 8);

test('CustomVoice separates literal speech from instructions and uses explicit preset', () => {
  assert.deepEqual(buildQwen3SpeechRequest(input), { input: input.text, instructions: input.instructions, voice: 'dylan', language: 'Chinese', response_format: 'wav' });
  assert.equal(QWEN3_TTS_SPEAKERS.length, 9);
  assert.equal(buildQwen3SpeechRequest({ text: '你好', instructions: '' }).voice, 'dylan');
});

test('request sizes and speaker names are validated before submitting', () => {
  for (const invalid of [{ ...input, text: '' }, { ...input, text: '字'.repeat(301) }, { ...input, instructions: '字'.repeat(2001) }, { ...input, speaker: 'someone' }]) {
    assert.throws(() => buildQwen3SpeechRequest(invalid));
  }
});

test('endpoint defaults to localhost, remains configurable and rejects credentials in URL', () => {
  assert.equal(qwen3SpeechEndpoint(''), `${QWEN3_TTS_DEFAULT_URL}/v1/audio/speech`);
  assert.equal(qwen3SpeechEndpoint('http://localhost:8000/'), 'http://localhost:8000/v1/audio/speech');
  for (const url of ['file:///secret', 'https://user:password@host/', 'https://host/?api_key=secret']) assert.throws(() => qwen3SpeechEndpoint(url));
});

test('binary WAV returns unchanged; HTML, JSON or empty success responses never become audio files', async () => {
  let requests = 0;
  const result = await requestQwen3VoiceSample(input, QWEN3_TTS_DEFAULT_URL, async (url, body) => {
    requests++;
    assert.equal(url, `${QWEN3_TTS_DEFAULT_URL}/v1/audio/speech`);
    assert.equal(body.input, input.text);
    assert.equal(body.instructions, input.instructions);
    return { ok: true, status: 200, data: wav };
  });
  assert.deepEqual(result, wav);
  assert.equal(requests, 1);
  assert.throws(() => validateQwen3Wav(new TextEncoder().encode('{"error":"no audio"}')));
  await assert.rejects(requestQwen3VoiceSample(input, '', async () => ({ ok: true, status: 200, data: [] })), /WAV/);
});

test('busy, failed and timed-out requests have no automatic retry/fallback', async () => {
  for (const status of [429, 500, 503]) {
    let calls = 0;
    await assert.rejects(requestQwen3VoiceSample(input, '', async () => { calls++; return { ok: false, status, data: [] }; }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(requestQwen3VoiceSample(input, '', async () => { calls++; throw new Error('timeout'); }), /不会自动重试/);
  assert.equal(calls, 1);
});

test('role voice button uses Qwen service without a Doubao key gate, saves WAV and protects changed projects', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const page = read('../../components/workshop/steps/StepAssets.tsx');
  const button = page.slice(page.indexOf('function AiVoiceButton('), page.indexOf('\n}', page.indexOf('function AiVoiceButton(')) + 2);
  assert.match(button, /generateQwen3VoiceSample\(\{ text: sampleText, instructions: desc, speaker \}\)/);
  assert.doesNotMatch(button, /doubaoSpeech|resolveApiKey|generateSpeech\(/);
  assert.match(button, /qwen3-\$\{nanoid\(8\)\}\.wav/);
  assert.match(button, /latest.project\?\.id !== project.id/);
  assert.match(button, /current.voicePath !== character.voicePath/);
  assert.match(button, /pending.current/);
  assert.match(button, /engineId: QWEN3_TTS_ENGINE, speaker/);
  assert.match(read('../../stores/settingsStore.ts'), /qwen3TtsBaseUrl: QWEN3_TTS_DEFAULT_URL/);
  assert.match(read('../workshop/workshopPrompts.ts'), /当前基础预设音色为 \$\{speaker\}/);
});
