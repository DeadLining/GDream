from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import models
from comic_studio.jobs import JobStore
from comic_studio.services.rendering import RenderingService


router = APIRouter(tags=["renders"])


def run_render_job(app, job_id: str, episode_id: str) -> None:
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        settings = app.state.settings
        episode = session.get(models.Episode, episode_id)
        if episode is None:
            jobs.transition(job_id, "failed", error="Episode was deleted before rendering")
            return
        output = (
            settings.data_root
            / "projects"
            / episode.project_id
            / "episodes"
            / episode_id
            / "renders"
            / f"{job_id}.mp4"
        )
        try:
            report = RenderingService(
                session,
                settings.data_root,
                Path(settings.compositor_root),
            ).render(episode_id, output)
            jobs.transition(
                job_id,
                "succeeded",
                result_metadata={
                    "episode_id": episode_id,
                    "output_path": str(output.relative_to(settings.data_root)),
                    "probe": report,
                },
            )
        except Exception as exc:
            jobs.transition(job_id, "failed", error=f"{type(exc).__name__}: {exc}")


@router.post(
    "/api/episodes/{episode_id}/render", status_code=status.HTTP_202_ACCEPTED
)
def render_episode(
    episode_id: str, request: Request, background_tasks: BackgroundTasks
):
    with request.app.state.session_factory() as session:
        if session.get(models.Episode, episode_id) is None:
            raise HTTPException(status_code=404, detail="Episode not found")
        job = JobStore(session).create("render_episode", "episode", episode_id, {})
    background_tasks.add_task(run_render_job, request.app, job.id, episode_id)
    return {"job_id": job.id, "status": job.status}
