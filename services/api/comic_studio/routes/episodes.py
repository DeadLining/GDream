from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.jobs import JobStore
from comic_studio.providers.minimax import MiniMaxProvider
from comic_studio.repositories import EpisodeRepository
from comic_studio.services.planning import PlanningService


router = APIRouter(tags=["episodes"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/api/projects/{project_id}/episodes",
    response_model=schemas.EpisodeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_episode(
    project_id: str, data: schemas.EpisodeCreate, session: SessionDependency
):
    episode = EpisodeRepository(session).create(project_id, data)
    if episode is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return episode


@router.get("/api/episodes/{episode_id}", response_model=schemas.EpisodeDetail)
def get_episode(episode_id: str, session: SessionDependency):
    episode = EpisodeRepository(session).get(episode_id)
    if episode is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    return episode


async def run_planning_job(app, job_id: str, episode_id: str) -> None:
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        settings = app.state.settings
        try:
            provider = MiniMaxProvider(
                api_key=settings.minimax_api_key,
                model=settings.minimax_model,
                base_url=settings.minimax_base_url,
            )
            await PlanningService(session, provider).plan_episode(episode_id)
            jobs.transition(job_id, "succeeded", result_metadata={"episode_id": episode_id})
        except Exception as exc:
            jobs.transition(job_id, "failed", error=f"{type(exc).__name__}: {exc}")


@router.post(
    "/api/episodes/{episode_id}/plan",
    response_model=schemas.JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def plan_episode(
    episode_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDependency,
):
    if EpisodeRepository(session).get(episode_id) is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    job = JobStore(session).create("plan_episode", "episode", episode_id, {})
    background_tasks.add_task(run_planning_job, request.app, job.id, episode_id)
    return job
