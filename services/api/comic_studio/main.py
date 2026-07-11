from fastapi import FastAPI

from comic_studio.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="AI Comic Studio")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    return app


app = create_app()
