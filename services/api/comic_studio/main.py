from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from comic_studio.config import get_settings
from comic_studio.db import create_session_factory, create_tables
from comic_studio.routes.episodes import router as episodes_router
from comic_studio.routes.assets import router as assets_router
from comic_studio.routes.jobs import router as jobs_router
from comic_studio.routes.speech import router as speech_router
from comic_studio.routes.providers import router as providers_router
from comic_studio.routes.renders import router as renders_router
from comic_studio.routes.projects import character_router, router as projects_router
from comic_studio.routes.production import router as production_router


def create_app() -> FastAPI:
    settings = get_settings()
    session_factory = create_session_factory(settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        settings.data_root.mkdir(parents=True, exist_ok=True)
        create_tables(session_factory)
        yield

    app = FastAPI(title="AI Comic Studio", lifespan=lifespan)
    app.state.session_factory = session_factory
    app.state.settings = settings
    app.include_router(projects_router)
    app.include_router(character_router)
    app.include_router(episodes_router)
    app.include_router(jobs_router)
    app.include_router(assets_router)
    app.include_router(speech_router)
    app.include_router(providers_router)
    app.include_router(renders_router)
    app.include_router(production_router)
    app.mount("/media", StaticFiles(directory=settings.data_root, check_dir=False), name="media")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    return app


app = create_app()
