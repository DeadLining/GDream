from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from comic_studio import models, schemas
from comic_studio.db import get_session
from comic_studio.jobs import JobStore
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


@router.patch("/api/episodes/{episode_id}", response_model=schemas.EpisodeRead)
def update_episode(
    episode_id: str, data: schemas.EpisodePatch, session: SessionDependency
):
    episode = EpisodeRepository(session).update(episode_id, data)
    if episode is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    return episode


@router.patch("/api/shots/{shot_id}", response_model=schemas.ShotRead)
def update_shot(shot_id: str, data: schemas.ShotPatch, session: SessionDependency):
    shot = EpisodeRepository(session).update_shot(shot_id, data)
    if shot is None:
        raise HTTPException(status_code=404, detail="Shot not found")
    return shot


@router.patch("/api/dialogue/{dialogue_id}", response_model=schemas.DialogueRead)
def update_dialogue(
    dialogue_id: str, data: schemas.DialoguePatch, session: SessionDependency
):
    dialogue = session.get(models.DialogueLine, dialogue_id)
    if dialogue is None:
        raise HTTPException(status_code=404, detail="Dialogue line not found")
    if "character_id" in data.model_fields_set and data.character_id is not None:
        character = session.get(models.Character, data.character_id)
        project_id = dialogue.shot.scene.episode.project_id
        if character is None or character.project_id != project_id:
            raise HTTPException(
                status_code=422,
                detail="Dialogue character must belong to the episode project",
            )
    dialogue = EpisodeRepository(session).update_dialogue(dialogue_id, data)
    return dialogue


async def run_planning_job(app, job_id: str, episode_id: str) -> None:
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        try:
            provider = app.state.provider_factory.create_llm()
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
    episode = EpisodeRepository(session).get(episode_id)
    if episode is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    if episode.scenes:
        raise HTTPException(
            status_code=409,
            detail="Storyboard already exists for this episode",
        )
    job = JobStore(session).create("plan_episode", "episode", episode_id, {})
    background_tasks.add_task(run_planning_job, request.app, job.id, episode_id)
    return job
