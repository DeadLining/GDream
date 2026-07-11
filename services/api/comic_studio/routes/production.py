from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import schemas
from comic_studio.production import InvalidProductionTransition, ProductionStore
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


@router.post("/api/production-runs/{run_id}/pause", response_model=schemas.ProductionRunRead)
def pause_production_run(run_id: str, request: Request):
    with request.app.state.session_factory() as session:
        store=ProductionStore(session);run=store.get_run(run_id)
        if run is None: raise HTTPException(status_code=404,detail="Production run not found")
        if run.status=="paused": return run
        try: return store.transition_run(run_id,"paused")
        except InvalidProductionTransition as exc: raise HTTPException(status_code=409,detail=str(exc)) from exc


@router.post("/api/production-runs/{run_id}/continue", response_model=schemas.ProductionRunRead, status_code=status.HTTP_202_ACCEPTED)
def continue_production_run(run_id: str, request: Request, background_tasks: BackgroundTasks):
    with request.app.state.session_factory() as session:
        store=ProductionStore(session);run=store.get_run(run_id)
        if run is None: raise HTTPException(status_code=404,detail="Production run not found")
        if run.status=="paused": run=store.transition_run(run_id,"running")
        elif run.status not in {"queued","running"}: raise HTTPException(status_code=409,detail="Run cannot continue")
        response=schemas.ProductionRunRead.model_validate(run)
    coordinator=getattr(request.app.state,"production_coordinator",None)
    if coordinator is not None: background_tasks.add_task(coordinator.run,run_id)
    return response


@router.post("/api/production-runs/{run_id}/retry", response_model=schemas.ProductionRunRead, status_code=status.HTTP_202_ACCEPTED)
def retry_production_run(run_id: str, data: schemas.ProductionRetry, request: Request):
    with request.app.state.session_factory() as session:
        store=ProductionStore(session);run=store.get_run(run_id)
        if run is None: raise HTTPException(status_code=404,detail="Production run not found")
        if run.status not in {"completed_with_failures","paused"}: raise HTTPException(status_code=409,detail="Only failed or paused runs can retry")
        selected=set(data.item_ids or [item.id for item in store.list_items(run_id) if item.status=="failed"])
        for item in store.list_items(run_id):
            if item.id in selected and item.status=="failed": store.transition_item(item.id,"queued")
        if run.status=="completed_with_failures": store.transition_run(run_id,"running")
        return store.refresh_counters(run_id)
