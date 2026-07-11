from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from comic_studio import models
from comic_studio.jobs import JobStore
from comic_studio.services.speech import SpeechService


router = APIRouter(tags=["speech"])


async def run_speech_job(app, job_id: str, dialogue_id: str) -> None:
    with app.state.session_factory() as session:
        jobs = JobStore(session)
        jobs.transition(job_id, "running", progress=5)
        settings = app.state.settings
        try:
            provider = app.state.provider_factory.create_tts()
            asset = await SpeechService(
                session, settings.data_root, provider
            ).synthesize_dialogue(dialogue_id)
            jobs.transition(
                job_id,
                "succeeded",
                result_metadata={
                    "asset_id": asset.id,
                    "dialogue_id": dialogue_id,
                    "media_url": f"/media/{asset.local_path}",
                },
            )
        except Exception as exc:
            jobs.transition(job_id, "failed", error=f"{type(exc).__name__}: {exc}")


@router.post(
    "/api/dialogue/{dialogue_id}/speech", status_code=status.HTTP_202_ACCEPTED
)
def synthesize_dialogue(
    dialogue_id: str, request: Request, background_tasks: BackgroundTasks
):
    with request.app.state.session_factory() as session:
        if session.get(models.DialogueLine, dialogue_id) is None:
            raise HTTPException(status_code=404, detail="Dialogue line not found")
        job = JobStore(session).create(
            "synthesize_dialogue", "dialogue", dialogue_id, {}
        )
    background_tasks.add_task(
        run_speech_job, request.app, job.id, dialogue_id
    )
    return {"job_id": job.id, "status": job.status}
