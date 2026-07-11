from urllib.parse import urlparse

from fastapi import APIRouter, Request


router = APIRouter(prefix="/api/providers", tags=["providers"])


def provider_entry(*, model: str, base_url: str, configured: bool) -> dict:
    parsed = urlparse(base_url)
    return {
        "status": "configured" if configured else "missing_configuration",
        "model": model,
        "host": parsed.hostname or "local",
        "port": parsed.port,
    }


@router.get("/health")
def provider_health(request: Request):
    settings = request.app.state.settings
    return {
        "llm": provider_entry(
            model=settings.minimax_model,
            base_url=settings.minimax_base_url,
            configured=bool(settings.minimax_api_key),
        ),
        "image": provider_entry(
            model=settings.gpt_image_model,
            base_url=settings.gpt_image_base_url,
            configured=bool(settings.gpt_image_key),
        ),
        "tts": provider_entry(
            model=settings.qwen_tts_model,
            base_url=settings.qwen_tts_base_url,
            configured=True,
        ),
    }
