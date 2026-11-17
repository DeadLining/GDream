"""LAN-only Qwen3-TTS CustomVoice adapter. No provider fallback or remote weights."""
import io
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

MODEL_NAME = "Qwen3-TTS-12Hz-1.7B-CustomVoice"
MODEL_PATH = os.environ.get("QWEN3_TTS_MODEL_PATH", "/gpu3/guhj/models/" + MODEL_NAME)
SPEAKERS = ("vivian", "serena", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee")
model = None
inference_lock = threading.Lock()
logger = logging.getLogger("qwen3-tts")


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=300)
    instructions: str = Field(default="", max_length=2000)
    voice: str = "dylan"
    language: Literal["Chinese", "English", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian", "Auto"] = "Chinese"
    response_format: Literal["wav"] = "wav"

    @field_validator("input")
    @classmethod
    def nonempty_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("input must contain spoken text")
        return value.strip()

    @field_validator("voice")
    @classmethod
    def preset_voice(cls, value: str) -> str:
        name = value.strip().lower()
        if name not in SPEAKERS:
            raise ValueError("voice must be a supported CustomVoice preset")
        return name


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    import torch
    from qwen_tts import Qwen3TTSModel
    model = Qwen3TTSModel.from_pretrained(
        MODEL_PATH, device_map="cuda:0", dtype=torch.bfloat16,
        attn_implementation="sdpa", local_files_only=True,
    )
    logger.info("Loaded %s on configured CUDA device", MODEL_NAME)
    yield
    model = None


app = FastAPI(title="GDream Qwen3-TTS CustomVoice", lifespan=lifespan)


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(503, "Model not ready")
    return {"status": "ok", "model": MODEL_NAME, "task": "custom_voice", "speakers": list(SPEAKERS), "response_format": "wav"}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    if model is None:
        raise HTTPException(503, "Model not ready")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(429, "Qwen3-TTS is busy; wait for the current generation to finish")
    try:
        import numpy as np
        import soundfile as sf
        import torch
        with torch.inference_mode():
            wavs, sample_rate = model.generate_custom_voice(
                text=request.input, language=request.language, speaker=request.voice,
                instruct=request.instructions, max_new_tokens=2048,
            )
        audio = np.asarray(wavs[0], dtype=np.float32)
        if audio.size == 0 or not np.isfinite(audio).all():
            raise RuntimeError("Invalid generated waveform")
        output = io.BytesIO()
        sf.write(output, audio, sample_rate, format="WAV", subtype="PCM_16")
        return Response(output.getvalue(), media_type="audio/wav", headers={
            "X-Audio-Sample-Rate": str(sample_rate),
            "X-Audio-Duration": str(round(len(audio) / sample_rate, 3)),
            "Cache-Control": "no-store",
        })
    except Exception:
        logger.exception("Synthesis failed")
        raise HTTPException(500, "Qwen3-TTS synthesis failed; inspect the service log") from None
    finally:
        inference_lock.release()
