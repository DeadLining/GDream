from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import models
from comic_studio.jobs import JobStore
from comic_studio.providers.gpt_image import GPTImageProvider
from comic_studio.services.panels import PanelService


router = APIRouter(tags=["assets"])


async def run_panel_job(app, job_id: str, shot_id: str, activate: bool) -> None:
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        settings = app.state.settings
        try:
            provider = GPTImageProvider(
                api_key=settings.gpt_image_key,
                model=settings.gpt_image_model,
                base_url=settings.gpt_image_base_url,
            )
            asset = await PanelService(
                session, settings.data_root, provider
            ).generate_panel(shot_id, activate=activate)
            jobs.transition(
                job_id,
                "succeeded",
                result_metadata={"asset_id": asset.id, "shot_id": shot_id},
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
