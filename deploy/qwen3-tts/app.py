import io
import importlib.util
import os
from contextlib import asynccontextmanager

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel


MODEL_ID = os.environ.get(
    "QWEN_TTS_MODEL_ID", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
)
MODEL_NAME = MODEL_ID.rsplit("/", 1)[-1]


class SpeechRequest(BaseModel):
    model: str = MODEL_NAME
    text: str = Field(min_length=1, max_length=4000)
    speaker: str = Field(min_length=1)
    language: str = "Chinese"
    instruct: str = ""
    response_format: str = "wav"


@asynccontextmanager
async def lifespan(app: FastAPI):
    attention = (
        "flash_attention_2"
        if importlib.util.find_spec("flash_attn") is not None
        else "sdpa"
    )
    app.state.model = Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation=attention,
    )
    app.state.speakers = list(app.state.model.get_supported_speakers())
    app.state.languages = list(app.state.model.get_supported_languages())
    app.state.attention = attention
    yield
    del app.state.model


app = FastAPI(title="Qwen3 TTS Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": "cuda:0",
        "attention": app.state.attention,
    }


@app.get("/v1/voices")
def voices():
    return {
        "model": MODEL_NAME,
        "speakers": app.state.speakers,
        "languages": app.state.languages,
    }


@app.post("/v1/audio/speech")
def synthesize(request: SpeechRequest):
    if request.model != MODEL_NAME:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {request.model}")
    if request.response_format != "wav":
        raise HTTPException(status_code=400, detail="Only WAV output is supported")
    supported_speakers = {speaker.lower() for speaker in app.state.speakers}
    supported_languages = {language.lower() for language in app.state.languages}
    if request.speaker.lower() not in supported_speakers:
        raise HTTPException(status_code=400, detail=f"Unsupported speaker: {request.speaker}")
    if request.language.lower() not in supported_languages:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {request.language}")

    wavs, sample_rate = app.state.model.generate_custom_voice(
        text=request.text,
        language=request.language,
        speaker=request.speaker,
        instruct=request.instruct,
    )
    buffer = io.BytesIO()
    sf.write(buffer, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buffer.getvalue(), media_type="audio/wav")
