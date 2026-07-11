from fastapi import APIRouter, HTTPException, Request

from comic_studio.services.readiness import ReadinessService


router = APIRouter(tags=["production"])


@router.get("/api/episodes/{episode_id}/production-readiness")
def production_readiness(episode_id: str, request: Request):
    with request.app.state.session_factory() as session:
        report = ReadinessService(session).inspect(episode_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Episode not found")
        return report
