# Qwen3-TTS Deployment

The service exposes the fixed MVP contract used by AI Comic Studio:

- `GET /health`
- `GET /v1/voices`
- `POST /v1/audio/speech`

It loads `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` on one A800 GPU and returns PCM 16-bit WAV audio. The production deployment path is `/opt/ai-comic-studio/qwen3-tts` on HostBridge target `a800_94`.

On A800_94 the service venv inherits the existing CUDA/Torch runtime from `/gpu/anaconda3/envs/vllm_wyp` and installs Qwen-specific packages into its own environment. It uses FlashAttention 2 when available and PyTorch SDPA otherwise.

Model weights are downloaded from ModelScope into `/opt/ai-comic-studio/qwen3-tts/models/Qwen3-TTS-12Hz-1.7B-CustomVoice`; systemd loads that fixed local path rather than downloading during startup.

The service must remain behind the trusted LAN or an authenticated reverse proxy. It does not expose API credentials and does not accept arbitrary model IDs.
