from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import models, schemas
from comic_studio.assets import AssetStore
from comic_studio.jobs import JobStore
from comic_studio.routes.assets import asset_response
from comic_studio.services.videos import VideoService


router = APIRouter(tags=["videos"])


async def run_video_job(app, job_id, shot_id, activate):
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        try:
            asset = await VideoService(
                session,
                app.state.settings.data_root,
                app.state.provider_factory.create_video(),
            ).generate(shot_id, activate=activate)
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
        shot = AssetStore(session, request.app.state.settings.data_root).activate_video(
            shot_id, asset_id
        )
        if shot is None:
            raise HTTPException(422, "Asset is not a video version for this shot")
        return schemas.ShotRead.model_validate(shot)
