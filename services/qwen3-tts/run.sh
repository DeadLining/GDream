#!/usr/bin/env bash
set -euo pipefail
# One worker = one model copy. Do not expose publicly.
cd "$(dirname "${BASH_SOURCE[0]}")"
export CUDA_VISIBLE_DEVICES="${QWEN3_TTS_GPU:-0}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export TOKENIZERS_PARALLELISM=false
exec "${QWEN3_TTS_PYTHON:-python3}" -m uvicorn server:app \
  --host "${QWEN3_TTS_HOST:-127.0.0.1}" --port "${QWEN3_TTS_PORT:-8815}" --workers 1
