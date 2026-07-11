from contextlib import asynccontextmanager

from fastapi import FastAPI

from comic_studio.config import get_settings
from comic_studio.db import create_session_factory, create_tables
from comic_studio.routes.episodes import router as episodes_router
from comic_studio.routes.assets import router as assets_router
from comic_studio.routes.jobs import router as jobs_router
from comic_studio.routes.projects import router as projects_router


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
    app.include_router(episodes_router)
    app.include_router(jobs_router)
    app.include_router(assets_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    return app


app = create_app()
