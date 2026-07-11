from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.jobs import JobStore
from comic_studio.routes.assets import run_panel_job
from comic_studio.routes.episodes import run_planning_job
from comic_studio.routes.renders import run_render_job
from comic_studio.routes.speech import run_speech_job


router = APIRouter(prefix="/api/jobs", tags=["jobs"])
SessionDependency = Annotated[Session, Depends(get_session)]


async def dispatch_panel_retry(app, job_id: str, target_id: str) -> None:
    with app.state.session_factory() as session:
        job = JobStore(session).get(job_id)
        activate = bool(job and job.request_payload.get("activate", False))
    await run_panel_job(app, job_id, target_id, activate)


JOB_DISPATCHERS = {
    "plan_episode": run_planning_job,
    "generate_panel": dispatch_panel_retry,
    "synthesize_dialogue": run_speech_job,
    "render_episode": run_render_job,
}


@router.get("/{job_id}", response_model=schemas.JobRead)
def get_job(job_id: str, session: SessionDependency):
    job = JobStore(session).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post(
    "/{job_id}/retry",
    response_model=schemas.JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_job(
    job_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDependency,
):
    store = JobStore(session)
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried")
    dispatcher = JOB_DISPATCHERS.get(job.operation)
    if dispatcher is None:
        raise HTTPException(status_code=422, detail="Unsupported job operation")
    retried = store.transition(job.id, "queued")
    background_tasks.add_task(
        dispatcher, request.app, retried.id, retried.target_id
    )
    return retried
