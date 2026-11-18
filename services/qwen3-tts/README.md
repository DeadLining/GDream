# GDream Qwen3-TTS CustomVoice service

This adapter serves the locally installed `Qwen3-TTS-12Hz-1.7B-CustomVoice`.
It supports nine preset speakers with an independent instruction string. It is
**not** VoiceDesign and does not clone voices. Spoken `input` and style
`instructions` are always passed to separate model arguments.

## Deployment

Use a CUDA-capable host with Python, qwen-tts, PyTorch, FastAPI, Uvicorn,
numpy and soundfile installed. Prepare the CustomVoice model weights locally
before starting; startup is offline and does not download model weights.
The adapter uses SDPA and does not require optional flash-attn.

From the repository root:

```bash
export QWEN3_TTS_MODEL_PATH="/path/to/Qwen3-TTS-12Hz-1.7B-CustomVoice"
# Optional: choose the Python interpreter in your prepared environment.
export QWEN3_TTS_PYTHON="/path/to/venv/bin/python"
bash services/qwen3-tts/run.sh
```

Deployment settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `QWEN3_TTS_MODEL_PATH` | `models/Qwen3-TTS-12Hz-1.7B-CustomVoice` beside `server.py` | Local model directory |
| `QWEN3_TTS_PYTHON` | `python3` from PATH | Python interpreter |
| `QWEN3_TTS_GPU` | `0` | Visible GPU |
| `QWEN3_TTS_HOST` | `127.0.0.1` | Listen address |
| `QWEN3_TTS_PORT` | `8815` | Listen port |

Run one worker per model instance. The service starts in the foreground and
binds to loopback by default. It has no authentication or browser CORS access;
use it on the same host or a trusted private network. Public deployment requires
authentication and TLS. Keep local model weights and service logs outside Git.

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
python3 -m unittest test_server.py -v
```
