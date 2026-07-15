from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import models, schemas
from comic_studio.assets import AssetStore
from comic_studio.jobs import JobStore
from comic_studio.services.panel_freshness import PanelFreshnessService


router = APIRouter(tags=["assets"])


def asset_response(
    asset: models.Asset,
    *,
    is_stale: bool = False,
    stale_reason: str | None = None,
) -> schemas.AssetRead:
    return schemas.AssetRead(
        id=asset.id,
        kind=asset.kind,
        media_url=f"/media/{asset.local_path}",
        media_type=asset.media_type,
        provider=asset.provider,
        model=asset.model,
        generation_attempt=asset.generation_attempt,
        review_status=asset.review_status,
        width=asset.width,
        height=asset.height,
        duration_seconds=asset.duration_seconds,
        created_at=asset.created_at,
        is_stale=is_stale,
        stale_reason=stale_reason,
    )


@router.get("/api/assets/{asset_id}", response_model=schemas.AssetRead)
def get_asset(asset_id: str, request: Request):
    with request.app.state.session_factory() as session:
        asset = session.get(models.Asset, asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return asset_response(asset)


async def run_panel_job(app, job_id: str, shot_id: str, activate: bool) -> None:
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        try:
            asset = await app.state.model_runtime.execute_image(
                "shot", shot_id, {"activate": activate}
            )
            jobs.transition(
                job_id,
                "succeeded",
                result_metadata={
                    "asset_id": asset.id,
                    "shot_id": shot_id,
                    "media_url": f"/media/{asset.local_path}",
                },
            )
        except Exception as exc:
            jobs.transition(job_id, "failed", error=f"{type(exc).__name__}: {exc}")


@router.post("/api/shots/{shot_id}/panels", status_code=status.HTTP_202_ACCEPTED)
def generate_panel(
    shot_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    activate: bool = False,
):
    with request.app.state.session_factory() as session:
        if session.get(models.Shot, shot_id) is None:
            raise HTTPException(status_code=404, detail="Shot not found")
        job = JobStore(session).create(
            "generate_panel", "shot", shot_id, {"activate": activate}
        )
    background_tasks.add_task(run_panel_job, request.app, job.id, shot_id, activate)
    return {"job_id": job.id, "status": job.status}


@router.get(
    "/api/shots/{shot_id}/panels", response_model=list[schemas.AssetRead]
)
def list_panel_versions(shot_id: str, request: Request):
    with request.app.state.session_factory() as session:
        if session.get(models.Shot, shot_id) is None:
            raise HTTPException(status_code=404, detail="Shot not found")
        assets = AssetStore(session, request.app.state.settings.data_root).list_panel_versions(
            shot_id
        )
        freshness = PanelFreshnessService(session).inspect_many(shot_id, assets)
        return [
            asset_response(
                asset,
                is_stale=freshness[asset.id].is_stale,
                stale_reason=freshness[asset.id].reason,
            )
            for asset in assets
        ]


@router.put(
    "/api/shots/{shot_id}/panels/{asset_id}/active",
    response_model=schemas.ShotRead,
)
def activate_panel(shot_id: str, asset_id: str, request: Request):
    with request.app.state.session_factory() as session:
        shot = AssetStore(
            session, request.app.state.settings.data_root
        ).activate_panel(shot_id, asset_id)
        if shot is None:
            raise HTTPException(
                status_code=422, detail="Asset is not a panel version for this shot"
            )
        return schemas.ShotRead.model_validate(shot)
