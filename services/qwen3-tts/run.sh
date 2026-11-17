#!/usr/bin/env bash
set -euo pipefail
# Run from this directory; one worker = one model copy. Do not expose publicly.
export CUDA_VISIBLE_DEVICES="${QWEN3_TTS_GPU:-0}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export TOKENIZERS_PARALLELISM=false
exec "${QWEN3_TTS_PYTHON:-/gpu3/guhj/envs/speech-llm/bin/python}" -m uvicorn server:app \
  --host "${QWEN3_TTS_HOST:-127.0.0.1}" --port "${QWEN3_TTS_PORT:-8815}" --workers 1
