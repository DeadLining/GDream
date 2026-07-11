from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from comic_studio.config import get_settings
from comic_studio.db import create_session_factory, create_tables
from comic_studio.provider_channels import (
    ProviderChannelStore,
    provider_channel_defaults,
)
from comic_studio.provider_factory import ProviderFactory
from comic_studio.redaction import is_sensitive_key, normalize_field_name, redact
from comic_studio.routes.episodes import router as episodes_router
from comic_studio.routes.assets import router as assets_router
from comic_studio.routes.jobs import router as jobs_router
from comic_studio.routes.speech import router as speech_router
from comic_studio.routes.providers import router as providers_router
from comic_studio.routes.renders import router as renders_router
from comic_studio.routes.projects import character_router, router as projects_router
from comic_studio.routes.production import router as production_router
from comic_studio.routes.provider_channels import router as provider_channels_router
from comic_studio import models
from comic_studio.production import ProductionStore
from comic_studio.services.production_coordinator import ProductionCoordinator
from comic_studio.services.panels import PanelService
from comic_studio.services.speech import SpeechService


def _normalize_validation_field(value: str) -> str:
    return normalize_field_name(value)


def _validation_field_is_sensitive(value: str) -> bool:
    return is_sensitive_key(value)


def _validation_location_is_secret(location: tuple | list) -> bool:
    return any(
        isinstance(part, str) and _validation_field_is_sensitive(part)
        for part in location
    )


def _validation_error_contains_root_input(item: dict) -> bool:
    location = item.get("loc", ())
    normalized_location = [
        _normalize_validation_field(part)
        for part in location
        if isinstance(part, str)
    ]
    return item.get("type") == "json_invalid" or normalized_location in (
        ["body"],
        ["body", "root"],
    )


def _sanitize_validation_value(value):
    if isinstance(value, dict):
        return {
            key: (
                "[REDACTED]"
                if isinstance(key, str) and _validation_field_is_sensitive(key)
                else _sanitize_validation_value(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_validation_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_validation_value(item) for item in value)
    return redact(value)


def _sanitized_validation_errors(error: RequestValidationError) -> list[dict]:
    sanitized = []
    for item in error.errors():
        safe_item = _sanitize_validation_value(dict(item))
        if _validation_location_is_secret(
            item.get("loc", ())
        ) or _validation_error_contains_root_input(item) or item.get(
            "type"
        ) == "extra_forbidden":
            safe_item["input"] = "[REDACTED]"
            safe_item.pop("ctx", None)
        sanitized.append(safe_item)
    return sanitized


def create_app() -> FastAPI:
    settings = get_settings()
    session_factory = create_session_factory(settings.database_url)
    provider_channel_store = ProviderChannelStore(
        settings.provider_channels_path,
        provider_channel_defaults(settings),
    )
    provider_channel_store.load()
    provider_factory = ProviderFactory(provider_channel_store)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        settings.data_root.mkdir(parents=True, exist_ok=True)
        create_tables(session_factory)
        recover_production_runs()
        yield

    app = FastAPI(title="AI Comic Studio", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def sanitized_validation_error_handler(
        _request,
        error: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "detail": jsonable_encoder(_sanitized_validation_errors(error))
            },
        )

    app.state.session_factory = session_factory
    app.state.settings = settings
    app.state.provider_channel_store = provider_channel_store
    app.state.provider_factory = provider_factory

    def recover_production_runs():
        recovered = []
        with session_factory() as session:
            store = ProductionStore(session)
            runs = list(
                session.query(models.ProductionRun).filter(
                    models.ProductionRun.status == "running"
                )
            )
            for run in runs:
                for item in store.list_items(run.id):
                    if item.status == "running":
                        store.transition_item(item.id, "queued")
                store.transition_run(run.id, "paused")
                store.refresh_counters(run.id)
                recovered.append(run.id)
        return recovered

    app.state.recover_production_runs = recover_production_runs

    async def produce_panel(item):
        with session_factory() as session:
            provider = app.state.provider_factory.create_image()
            asset = await PanelService(
                session, settings.data_root, provider
            ).generate_panel(item.target_id, activate=True)
            return {
                "asset_id": asset.id,
                "media_url": f"/media/{asset.local_path}",
            }

    async def produce_speech(item):
        with session_factory() as session:
            provider = app.state.provider_factory.create_tts()
            asset = await SpeechService(
                session, settings.data_root, provider
            ).synthesize_dialogue(item.target_id)
            return {
                "asset_id": asset.id,
                "media_url": f"/media/{asset.local_path}",
            }

    app.state.production_coordinator = ProductionCoordinator(
        session_factory,
        {"panel": produce_panel, "speech": produce_speech},
    )
    app.include_router(projects_router)
    app.include_router(character_router)
    app.include_router(episodes_router)
    app.include_router(jobs_router)
    app.include_router(assets_router)
    app.include_router(speech_router)
    app.include_router(providers_router)
    app.include_router(renders_router)
    app.include_router(production_router)
    app.include_router(provider_channels_router)
    app.mount("/media", StaticFiles(directory=settings.data_root, check_dir=False), name="media")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    return app


app = create_app()
