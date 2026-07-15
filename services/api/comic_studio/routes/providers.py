import asyncio
from urllib.parse import urlparse

from fastapi import APIRouter, Request

from comic_studio.provider_channels import ProviderChannels
from comic_studio.routes import provider_channels as provider_channels_route
from comic_studio.schemas import (
    ProviderChannelKind,
    ProviderHealthRead,
    ProviderHealthStatusRead,
)
from comic_studio.services.provider_channel_testing import (
    ProviderChannelTestingService,
)


router = APIRouter(prefix="/api/providers", tags=["providers"])
PROVIDER_KINDS: tuple[ProviderChannelKind, ...] = ("llm", "image", "tts", "video", "model3d")
sanitize_provider_error = ProviderChannelTestingService._sanitize_error


def provider_entry(
    *,
    kind: ProviderChannelKind,
    model: str,
    base_url: str,
) -> ProviderHealthStatusRead:
    parsed = urlparse(base_url)
    return ProviderHealthStatusRead(
        status="disabled",
        model=model,
        host=parsed.hostname or "local",
        elapsed_ms=0,
        check_scope="audio" if kind == "tts" else "model",
        error=None,
    )


async def test_provider(
    request: Request,
    kind: ProviderChannelKind,
    snapshot: ProviderChannels,
) -> ProviderHealthStatusRead:
    channel = getattr(snapshot, kind)
    if not channel.enabled:
        return provider_entry(
            kind=kind,
            model=channel.model,
            base_url=channel.base_url,
        )

    try:
        prefer_ssh = False
        if kind in {"tts", "video"} and channel.ssh_host:
            try:
                prefer_ssh = bool(
                    await asyncio.to_thread(
                        request.app.state.mock_ssh_manager.owns_running_alias,
                        channel.ssh_host,
                    )
                )
            except Exception:
                prefer_ssh = False

        service = ProviderChannelTestingService(
            stored_channel=lambda channel_kind: getattr(snapshot, channel_kind),
            client_factory=provider_channels_route.provider_testing_client_factory,
            prefer_ssh_for_host=lambda _ssh_host: prefer_ssh,
            total_timeout_seconds=(
                provider_channels_route.provider_testing_tts_timeout_seconds
                if kind == "tts"
                else provider_channels_route.provider_testing_video_timeout_seconds
                if kind == "video"
                else provider_channels_route.provider_testing_total_timeout_seconds
            ),
        )
        result = await service.test(kind, channel)
        return ProviderHealthStatusRead.model_validate(result.model_dump())
    except Exception as error:
        return ProviderHealthStatusRead(
            status="failed",
            model=channel.model,
            host=urlparse(channel.base_url).hostname or "local",
            elapsed_ms=0,
            check_scope="audio" if kind == "tts" else "model",
            error=sanitize_provider_error(error),
        )


@router.get("/health", response_model=ProviderHealthRead)
async def provider_health(request: Request) -> ProviderHealthRead:
    request.app.state.model_runtime.mock_ssh_manager = request.app.state.mock_ssh_manager
    runtime = await request.app.state.model_runtime.health()
    capability_names = {"llm": "text", "image": "image", "tts": "speech", "video": "video", "model3d": "model3d"}
    results = {}
    for kind, capability in capability_names.items():
        item = runtime["capabilities"][capability]
        results[kind] = ProviderHealthStatusRead(
            status={"healthy": "ok", "unavailable": "failed", "disabled": "disabled"}[item["status"]],
            model=item["model"],
            host=item["host"],
            elapsed_ms=item["elapsed_ms"],
            check_scope="audio" if kind == "tts" else "model",
            error=item["error"],
        )
    return ProviderHealthRead(**results)
