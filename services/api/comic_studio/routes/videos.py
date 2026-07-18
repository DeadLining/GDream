from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import models, schemas
from comic_studio.assets import AssetStore, StaleVideoVersionError
from comic_studio.jobs import JobStore
from comic_studio.routes.assets import asset_response


router = APIRouter(tags=["videos"])


async def run_video_job(app, job_id, shot_id, activate):
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        try:
            asset = await app.state.model_runtime.execute_video(
                shot_id, activate
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


@router.post("/api/shots/{shot_id}/videos", status_code=status.HTTP_202_ACCEPTED)
def generate_video(
    shot_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    activate: bool = False,
):
    with request.app.state.session_factory() as session:
        if session.get(models.Shot, shot_id) is None:
            raise HTTPException(404, "Shot not found")
        job = JobStore(session).create(
            "generate_video", "shot", shot_id, {"activate": activate}
        )
    background_tasks.add_task(run_video_job, request.app, job.id, shot_id, activate)
    return {"job_id": job.id, "status": job.status}


@router.get("/api/shots/{shot_id}/videos", response_model=list[schemas.AssetRead])
def list_videos(shot_id: str, request: Request):
    with request.app.state.session_factory() as session:
        if session.get(models.Shot, shot_id) is None:
            raise HTTPException(404, "Shot not found")
        return [
            asset_response(asset)
            for asset in AssetStore(
                session, request.app.state.settings.data_root
            ).list_video_versions(shot_id)
        ]


@router.put(
    "/api/shots/{shot_id}/videos/{asset_id}/active", response_model=schemas.ShotRead
)
def activate_video(shot_id: str, asset_id: str, request: Request):
    with request.app.state.session_factory() as session:
        try:
            shot = AssetStore(
                session, request.app.state.settings.data_root
            ).activate_video(shot_id, asset_id)
        except StaleVideoVersionError as exc:
            raise HTTPException(409, str(exc)) from exc
        if shot is None:
            raise HTTPException(422, "Asset is not a video version for this shot")
        return schemas.ShotRead.model_validate(shot)
