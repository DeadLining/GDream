from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from comic_studio.provider_channels import (
    ProviderChannel,
)
from comic_studio.schemas import (
    ProviderChannelKind,
    ProviderChannelRead,
    ProviderChannelTestRead,
    ProviderChannelsRead,
    ProviderChannelUpdate,
    ProviderChannelUpdateRead,
)
from comic_studio.services.provider_channel_testing import (
    ProviderTestError,
    TOTAL_TIMEOUT_SECONDS,
    default_client_factory,
)
from comic_studio.model_runtime.contracts import Capability


router = APIRouter(prefix="/api/provider-channels", tags=["provider-channels"])
provider_testing_client_factory = default_client_factory
provider_testing_total_timeout_seconds = TOTAL_TIMEOUT_SECONDS
provider_testing_tts_timeout_seconds = 60
provider_testing_video_timeout_seconds = 30


def mask_api_key(api_key: str | None) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 4:
        return "*" * len(api_key)
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:3]}****{api_key[-4:]}"


def channel_read(channel: ProviderChannel) -> ProviderChannelRead:
    api_key = channel.api_key_value
    return ProviderChannelRead(
        name=channel.name,
        enabled=channel.enabled,
        base_url=channel.base_url,
        model=channel.model,
        ssh_host=channel.ssh_host or "",
        api_key_configured=bool(api_key),
        api_key_masked=mask_api_key(api_key),
    )


def display_path(path: Path, data_root: Path) -> str:
    for root in (data_root, data_root.parent):
        try:
            return path.relative_to(root).as_posix()
        except ValueError:
            continue
    return path.name


def channels_read(
    request: Request,
    runtime: dict | None = None,
) -> ProviderChannelsRead:
    settings = request.app.state.settings
    path = settings.provider_channels_path
    runtime = runtime or request.app.state.model_runtime.read_channels()
    return ProviderChannelsRead(
        llm=ProviderChannelRead.model_validate(runtime["text"]),
        image=ProviderChannelRead.model_validate(runtime["image"]),
        tts=ProviderChannelRead.model_validate(runtime["speech"]),
        video=ProviderChannelRead.model_validate(runtime["video"]),
        persistence={
            "status": runtime["persistence"]["status"],
            "file_path": display_path(path, settings.data_root),
        },
        reloaded_at=runtime["reloaded_at"],
    )


@router.get("", response_model=ProviderChannelsRead)
def get_provider_channels(request: Request) -> ProviderChannelsRead:
    return channels_read(request)


@router.put("/{kind:path}", response_model=ProviderChannelUpdateRead)
def update_provider_channel(
    kind: ProviderChannelKind,
    update: ProviderChannelUpdate,
    request: Request,
) -> ProviderChannelUpdateRead:
    if kind not in {"tts", "video"} and update.ssh_host:
        raise HTTPException(status_code=422, detail="ssh_host is only valid for tts and video")

    capability = {"llm": Capability.TEXT, "image": Capability.IMAGE, "tts": Capability.SPEECH, "video": Capability.VIDEO}[kind]
    try:
        committed = request.app.state.model_runtime.update_channel(capability, update)
    except (TypeError, ValueError, ValidationError) as error:
        raise HTTPException(
            status_code=422,
            detail="Invalid provider channel configuration",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Unable to save provider channel configuration",
        ) from error

    current_read = channels_read(request, committed)
    return ProviderChannelUpdateRead(
        channel=getattr(current_read, kind),
        current=current_read,
    )


@router.post("/{kind:path}/test", response_model=ProviderChannelTestRead)
async def test_provider_channel(
    kind: ProviderChannelKind,
    candidate: ProviderChannelUpdate,
    request: Request,
) -> ProviderChannelTestRead:
    if kind not in {"tts", "video"} and candidate.ssh_host:
        raise HTTPException(status_code=422, detail="ssh_host is only valid for tts and video")

    capability = {"llm": Capability.TEXT, "image": Capability.IMAGE, "tts": Capability.SPEECH, "video": Capability.VIDEO}[kind]
    try:
        result = await request.app.state.model_runtime.test_channel(capability, candidate)
    except (ProviderTestError, ValidationError) as error:
        detail = (
            str(error)
            if isinstance(error, ProviderTestError)
            else "Invalid provider channel configuration"
        )
        raise HTTPException(status_code=422, detail=detail) from error
    return ProviderChannelTestRead.model_validate(result)
