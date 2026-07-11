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
from comic_studio import models
from comic_studio.production import ProductionStore
from comic_studio.services.production_coordinator import ProductionCoordinator
from comic_studio.providers.gpt_image import GPTImageProvider
from comic_studio.providers.qwen_tts import QwenTTSProvider
from comic_studio.services.panels import PanelService
from comic_studio.services.speech import SpeechService


def create_app() -> FastAPI:
    settings = get_settings()
    session_factory = create_session_factory(settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        settings.data_root.mkdir(parents=True, exist_ok=True)
        create_tables(session_factory)
        recover_production_runs()
        yield

    app = FastAPI(title="AI Comic Studio", lifespan=lifespan)
    app.state.session_factory = session_factory
    app.state.settings = settings

    def recover_production_runs():
        recovered=[]
        with session_factory() as session:
            store=ProductionStore(session)
            runs=list(session.query(models.ProductionRun).filter(models.ProductionRun.status=="running"))
            for run in runs:
                for item in store.list_items(run.id):
                    if item.status=="running": store.transition_item(item.id,"queued")
                store.transition_run(run.id,"paused");store.refresh_counters(run.id);recovered.append(run.id)
        return recovered

    app.state.recover_production_runs = recover_production_runs
    async def produce_panel(item):
        with session_factory() as session:
            provider=GPTImageProvider(api_key=settings.gpt_image_key,model=settings.gpt_image_model,base_url=settings.gpt_image_base_url)
            asset=await PanelService(session,settings.data_root,provider).generate_panel(item.target_id,activate=True)
            return {"asset_id":asset.id,"media_url":f"/media/{asset.local_path}"}

    async def produce_speech(item):
        with session_factory() as session:
            provider=QwenTTSProvider(base_url=settings.qwen_tts_base_url,model=settings.qwen_tts_model,ssh_host=settings.qwen_tts_ssh_host)
            asset=await SpeechService(session,settings.data_root,provider).synthesize_dialogue(item.target_id)
            return {"asset_id":asset.id,"media_url":f"/media/{asset.local_path}"}

    app.state.production_coordinator = ProductionCoordinator(
        session_factory,{"panel":produce_panel,"speech":produce_speech}
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
    app.mount("/media", StaticFiles(directory=settings.data_root, check_dir=False), name="media")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    return app


app = create_app()
