from urllib.parse import urlparse

from fastapi import APIRouter, Request


router = APIRouter(prefix="/api/providers", tags=["providers"])


def provider_entry(*, model: str, base_url: str, enabled: bool) -> dict:
    parsed = urlparse(base_url)
    return {
        "status": "configured" if enabled else "disabled",
        "model": model,
        "host": parsed.hostname or "local",
        "port": parsed.port,
    }


@router.get("/health")
def provider_health(request: Request):
    snapshot = request.app.state.provider_channel_store.snapshot
    return {
        "llm": provider_entry(
            model=snapshot.llm.model,
            base_url=snapshot.llm.base_url,
            enabled=snapshot.llm.enabled,
        ),
        "image": provider_entry(
            model=snapshot.image.model,
            base_url=snapshot.image.base_url,
            enabled=snapshot.image.enabled,
        ),
        "tts": provider_entry(
            model=snapshot.tts.model,
            base_url=snapshot.tts.base_url,
            enabled=snapshot.tts.enabled,
        ),
    }
