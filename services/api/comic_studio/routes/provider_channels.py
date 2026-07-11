from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from comic_studio.provider_channels import (
    ProviderChannel,
    ProviderChannels,
    ProviderChannelState,
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
    ProviderChannelTestingService,
    default_client_factory,
)


router = APIRouter(prefix="/api/provider-channels", tags=["provider-channels"])
provider_testing_client_factory = default_client_factory


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
    state: ProviderChannelState | None = None,
) -> ProviderChannelsRead:
    settings = request.app.state.settings
    path = settings.provider_channels_path
    state = state or request.app.state.provider_channel_store.state
    snapshot = state.channels
    return ProviderChannelsRead(
        llm=channel_read(snapshot.llm),
        image=channel_read(snapshot.image),
        tts=channel_read(snapshot.tts),
        persistence={
            "status": "saved" if state.persisted else "defaults",
            "file_path": display_path(path, settings.data_root),
        },
        reloaded_at=state.reloaded_at,
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
    if kind != "tts" and update.ssh_host:
        raise HTTPException(status_code=422, detail="ssh_host is only valid for tts")

    def merge(snapshot: ProviderChannels) -> ProviderChannels:
        current = getattr(snapshot, kind)
        replacement_key = update.api_key.get_secret_value()
        effective_key = (
            None if update.clear_api_key else replacement_key or current.api_key_value
        )
        if kind in {"llm", "image"} and update.enabled and not effective_key:
            raise HTTPException(
                status_code=422,
                detail=f"Enabled {kind} channel requires an api_key",
            )
        updated_channel = ProviderChannel(
            name=update.name,
            enabled=update.enabled,
            base_url=str(update.base_url),
            model=update.model,
            api_key=effective_key,
            ssh_host=update.ssh_host or None if kind == "tts" else None,
        )
        return ProviderChannels.model_validate(
            snapshot.model_copy(update={kind: updated_channel}).model_dump(
                mode="python"
            )
        )

    store = request.app.state.provider_channel_store
    try:
        committed = store.update(merge)
    except HTTPException:
        raise
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
        channel=channel_read(getattr(committed.channels, kind)),
        current=current_read,
    )


@router.post("/{kind:path}/test", response_model=ProviderChannelTestRead)
async def test_provider_channel(
    kind: ProviderChannelKind,
    candidate: ProviderChannelUpdate,
    request: Request,
) -> ProviderChannelTestRead:
    if kind != "tts" and candidate.ssh_host:
        raise HTTPException(status_code=422, detail="ssh_host is only valid for tts")

    store = request.app.state.provider_channel_store
    service = ProviderChannelTestingService(
        stored_channel=lambda channel_kind: getattr(store.snapshot, channel_kind),
        client_factory=provider_testing_client_factory,
    )
    return await service.test(kind, candidate)
