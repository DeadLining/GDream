# GDream Qwen3-TTS CustomVoice service

This adapter serves the locally installed `Qwen3-TTS-12Hz-1.7B-CustomVoice`.
It supports nine preset speakers with an independent instruction string. It is
**not** VoiceDesign and does not clone voices. Spoken `input` and style
`instructions` are always passed to separate model arguments.

## Local deployment

- Directory: `services/qwen3-tts` in your checkout.
- Model: `models/Qwen3-TTS-12Hz-1.7B-CustomVoice` relative to this service directory,
  or an explicit local directory set with `QWEN3_TTS_MODEL_PATH`.
- Python: `python3` from the active environment, or `QWEN3_TTS_PYTHON`.
- Address: `http://127.0.0.1:8815`
- GPU: `CUDA_VISIBLE_DEVICES=0` (one worker/model instance).
- Runtime requirements: qwen-tts, PyTorch, FastAPI, Uvicorn, numpy and soundfile;
  install them in your own environment. Uses SDPA, not optional flash-attn.
- Offline model loading: no weights downloaded on startup.

The running service is detached from the terminal. `server.pid` records the
process and `server.log` records startup/errors. Do not launch a second copy on
an occupied port or stop unrelated GPU processes. For a foreground manual start,
after checking the service is stopped:

```bash
cd services/qwen3-tts
bash run.sh
```

`QWEN3_TTS_GPU`, `QWEN3_TTS_PYTHON`, `QWEN3_TTS_MODEL_PATH`,
`QWEN3_TTS_HOST`, and `QWEN3_TTS_PORT` override deployment defaults.
This is **local/trusted-LAN only**, bound to loopback by default rather than all
interfaces, without authentication or browser CORS access. A LAN deployment
requires an explicit `QWEN3_TTS_HOST`. Do not expose it
on the public Internet. Authentication/TLS would be required for that use.

## Contract

`GET /health`: ready model, task, supported speakers and output format.

`POST /v1/audio/speech`:

```json
{
  "input": "你好，很高兴认识你。",
  "instructions": "清晰自然，语速明快，不要拖腔。",
  "voice": "dylan",
  "language": "Chinese",
  "response_format": "wav"
}
```

Returns PCM16 WAV bytes, with duration/sample-rate headers. Limits: 300 spoken
characters, 2,000 instruction characters, one inference at a time (429 when
busy). Invalid input is 422; model not ready is 503; model failure is 500. No
provider fallback or automatic resubmission. The app uses a 180-second timeout;
a timed-out inference may continue on the server, so it is not automatically
retried.

## Application integration

Workshop → Assets → role → **AI 生成音色** uses this service by default. Select
a base voice, describe the style, and separately enter the literal sample text.
Generated WAV files have unique filenames, and successful generation records
`voiceEngineId` and `voiceSpeaker` on the role. Switching project or changing
its current voice during generation does not overwrite the new selection.

Settings → 视频与语音 → **Qwen3-TTS 角色音色** changes the base URL. This does
not change shot dubbing, ASR, uploaded voices or existing H3 audio references.

## Tests

```bash
# App request contract (no network)
node --test src/lib/qwen3Tts/qwen3Tts.test.ts
# Service contract (fake model, no GPU inference)
cd services/qwen3-tts
"${QWEN3_TTS_PYTHON:-python3}" -m unittest test_server.py -v
```
