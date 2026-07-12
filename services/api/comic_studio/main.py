from contextlib import asynccontextmanager
import logging
from typing import Any, Callable

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from comic_studio.config import get_settings
from comic_studio.db import create_session_factory, run_migrations
from comic_studio.provider_channels import (
    ProviderChannelStore,
    provider_channel_defaults,
)
from comic_studio.provider_factory import ProviderFactory
from comic_studio.model_runtime.adapters import CapabilityAdapterRegistry
from comic_studio.model_runtime.service import ModelRuntimeService
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
from comic_studio.routes.script_imports import router as script_imports_router
from comic_studio.routes.scripts import router as scripts_router
from comic_studio.routes.character_references import router as character_references_router
from comic_studio.routes.videos import router as videos_router
from comic_studio.routes.director import router as director_router
from comic_studio.routes.mock_ssh import router as mock_ssh_router
from comic_studio.routes.model_runtime import router as model_runtime_router
from comic_studio import models
from comic_studio.production import ProductionStore
from comic_studio.services.production_coordinator import ProductionCoordinator
from comic_studio.services.panels import PanelService
from comic_studio.services.speech import SpeechService
from comic_studio.services.videos import VideoService
from comic_studio.services.mock_ssh import MockSshManager, UnavailableMockSshManager


logger = logging.getLogger(__name__)


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


def _create_mock_ssh_manager(settings) -> MockSshManager:
    return MockSshManager(
        state_path=settings.mock_ssh_state_path,
        log_path=settings.mock_ssh_log_path,
        executable=settings.hostbridge_executable,
        daemon_socket=settings.hostbridge_daemon_socket,
    )


def create_app(
    *,
    mock_ssh_manager: Any | None = None,
    mock_ssh_manager_factory: Callable[[Any], Any] | None = None,
) -> FastAPI:
    settings = get_settings()
    factory = mock_ssh_manager_factory or _create_mock_ssh_manager
    injected_mock_ssh_manager = mock_ssh_manager
    session_factory = create_session_factory(settings.database_url)
    provider_channel_store = ProviderChannelStore(
        settings.provider_channels_path,
        provider_channel_defaults(settings),
    )
    provider_channel_store.load()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_root.mkdir(parents=True, exist_ok=True)
        mock_ssh_diagnostic = None
        manager = injected_mock_ssh_manager
        if manager is None:
            try:
                manager = factory(settings)
            except Exception:
                mock_ssh_diagnostic = "Mock SSH manager initialization failed"
                manager = UnavailableMockSshManager()
            app.state.mock_ssh_manager = manager
        app.state.model_runtime.mock_ssh_manager = app.state.mock_ssh_manager
        try:
            if not isinstance(manager, UnavailableMockSshManager):
                manager.restore()
        except Exception:
            mock_ssh_diagnostic = "Mock SSH manager restore failed"
            app.state.mock_ssh_manager = UnavailableMockSshManager(
                "Unable to restore mock SSH"
            )
            app.state.model_runtime.mock_ssh_manager = app.state.mock_ssh_manager
        if mock_ssh_diagnostic is not None:
            logger.warning(mock_ssh_diagnostic)
        run_migrations(settings.database_url)
        app.state.model_runtime.recover_interrupted_jobs()
        recover_production_runs()
        recover_script_imports()
        recover_script_generations()
        yield

    app = FastAPI(title="AI Comic Studio", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(?:127\.0\.0\.1|localhost):\d{1,5}",
        allow_credentials=False,
        allow_methods=["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

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
    app.state.mock_ssh_manager = (
        injected_mock_ssh_manager
        if injected_mock_ssh_manager is not None
        else UnavailableMockSshManager("Mock SSH has not started")
    )
    app.state.provider_factory = ProviderFactory(
        provider_channel_store,
        prefer_ssh_for_host=lambda ssh_host: app.state.mock_ssh_manager.owns_running_alias(
            ssh_host
        ),
    )
    app.state.model_runtime = ModelRuntimeService(
        provider_channel_store,
        session_factory,
        settings.data_root,
        CapabilityAdapterRegistry(lambda: app.state.provider_factory),
        mock_ssh_manager=app.state.mock_ssh_manager,
    )

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

    def recover_script_imports():
        recovered = []
        with session_factory() as session:
            imports = list(
                session.query(models.ScriptImport).filter(
                    models.ScriptImport.status.in_({"parsing", "applying"})
                )
            )
            for script_import in imports:
                script_import.status = "failed"
                script_import.error_category = "interrupted"
                script_import.error = "Import was interrupted and can be retried"
                recovered.append(script_import.id)
            session.commit()
        return recovered

    app.state.recover_script_imports = recover_script_imports

    def recover_script_generations():
        recovered = []
        with session_factory() as session:
            documents = list(
                session.query(models.ScriptDocument).filter(
                    models.ScriptDocument.status == "generating"
                )
            )
            for document in documents:
                document.status = "generation_failed"
                recovered.append(document.id)
            session.commit()
        return recovered

    app.state.recover_script_generations = recover_script_generations

    async def produce_panel(item):
        asset = await app.state.model_runtime.execute_image(
            "shot", item.target_id, {"activate": True}
        )
        return {
            "asset_id": asset.id,
            "media_url": f"/media/{asset.local_path}",
        }

    async def produce_speech(item):
        asset = await app.state.model_runtime.execute_speech(item.target_id)
        return {
            "asset_id": asset.id,
            "media_url": f"/media/{asset.local_path}",
        }

    async def produce_video(item):
        asset = await app.state.model_runtime.execute_video(item.target_id, True)
        return {"asset_id": asset.id, "media_url": f"/media/{asset.local_path}", "provider_task_id": asset.request_metadata.get("provider_task_id")}

    app.state.production_coordinator = ProductionCoordinator(
        session_factory,
        {"panel": produce_panel, "speech": produce_speech, "video": produce_video},
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
    app.include_router(script_imports_router)
    app.include_router(scripts_router)
    app.include_router(character_references_router)
    app.include_router(videos_router)
    app.include_router(director_router)
    app.include_router(mock_ssh_router)
    app.include_router(model_runtime_router)
    app.mount("/media", StaticFiles(directory=settings.data_root, check_dir=False), name="media")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    return app


app = create_app()
