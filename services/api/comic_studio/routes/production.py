from fastapi import APIRouter, HTTPException, Request, status

from comic_studio import schemas
from comic_studio.production import ProductionStore
from comic_studio.services.readiness import ReadinessService
from comic_studio.services.production_runs import ProductionRunService


router = APIRouter(tags=["production"])


@router.get("/api/episodes/{episode_id}/production-readiness")
def production_readiness(episode_id: str, request: Request):
    with request.app.state.session_factory() as session:
        report = ReadinessService(session).inspect(episode_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Episode not found")
        return report


@router.post("/api/episodes/{episode_id}/production-runs", response_model=schemas.ProductionRunRead, status_code=status.HTTP_202_ACCEPTED)
def create_production_run(episode_id: str, data: schemas.ProductionRunCreate, request: Request):
    with request.app.state.session_factory() as session:
        try:
            run = ProductionRunService(session).create(episode_id, data)
        except RuntimeError as exc:
            if str(exc) == "active_run":
                raise HTTPException(status_code=409, detail="Episode already has an active production run") from exc
            raise
        if run is None: raise HTTPException(status_code=404, detail="Episode not found")
        return schemas.ProductionRunRead.model_validate(run)


@router.get("/api/production-runs/{run_id}", response_model=schemas.ProductionRunRead)
def get_production_run(run_id: str, request: Request):
    with request.app.state.session_factory() as session:
        run = ProductionStore(session).get_run(run_id)
        if run is None: raise HTTPException(status_code=404, detail="Production run not found")
        return schemas.ProductionRunRead.model_validate(run)


@router.get("/api/production-runs/{run_id}/items", response_model=list[schemas.ProductionItemRead])
def list_production_items(run_id: str, request: Request):
    with request.app.state.session_factory() as session:
        store = ProductionStore(session)
        if store.get_run(run_id) is None: raise HTTPException(status_code=404, detail="Production run not found")
        return [schemas.ProductionItemRead.model_validate(item) for item in store.list_items(run_id)]
