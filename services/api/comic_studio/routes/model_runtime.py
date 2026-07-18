import json

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from comic_studio.model_runtime.contracts import (
    AssetVariantSuggestion,
    AssetVariantSuggestionRequest,
    Capability,
    ImageRuntimeRequest,
    RuntimeJobRead,
    SpeechRuntimeRequest,
    TextStreamRequest,
    VideoRuntimeRequest,
)
from comic_studio.model_runtime.errors import ModelRuntimeError, RuntimeErrorCode
from comic_studio.schemas import ProviderChannelUpdate
from comic_studio.services.asset_requirements import (
    ShotGenerationNotReady,
    require_image_target_ready,
)


router = APIRouter(prefix="/api/model-runtime", tags=["model-runtime"])


def _error_response(error: ModelRuntimeError) -> JSONResponse:
    status_code = {
        RuntimeErrorCode.CONFIGURATION_ERROR: 422,
        RuntimeErrorCode.PROVIDER_UNAVAILABLE: 503,
        RuntimeErrorCode.PROVIDER_TIMEOUT: 503,
        RuntimeErrorCode.INVALID_RESPONSE: 502,
        RuntimeErrorCode.RUNTIME_INTERRUPTED: 409,
    }[error.code]
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": error.code.value,
                "message": error.message,
                "retryable": error.retryable,
                "capability": error.capability.value,
                "provider": error.provider,
            }
        },
    )


@router.get("/channels")
def channels(request: Request):
    return request.app.state.model_runtime.read_channels()


@router.put("/channels/{capability}")
def update_channel(
    capability: Capability, update: ProviderChannelUpdate, request: Request
):
    try:
        return request.app.state.model_runtime.update_channel(capability, update)
    except ModelRuntimeError as error:
        return _error_response(error)


@router.post("/channels/{capability}/test")
async def test_channel(
    capability: Capability, update: ProviderChannelUpdate, request: Request
):
    try:
        return await request.app.state.model_runtime.test_channel(capability, update)
    except ModelRuntimeError as error:
        return _error_response(error)


@router.get("/health")
async def health(request: Request):
    return await request.app.state.model_runtime.health()


@router.get("/invocations")
def invocations(request: Request, limit: int = Query(default=50, ge=1, le=200)):
    return request.app.state.model_runtime.list_invocations(limit)


@router.post("/text/stream")
def text_stream(payload: TextStreamRequest, request: Request):
    async def events():
        try:
            async for chunk in request.app.state.model_runtime.stream_text(payload):
                yield f"event: chunk\ndata: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {\"finish_reason\":\"stop\"}\n\n"
        except ModelRuntimeError as error:
            body = {"message": error.message, "code": error.code.value}
            yield f"event: error\ndata: {json.dumps(body, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/asset-variant/suggest",
    response_model=AssetVariantSuggestion,
)
async def suggest_asset_variant(
    payload: AssetVariantSuggestionRequest,
    request: Request,
):
    try:
        return await request.app.state.model_runtime.suggest_asset_variant(
            payload.model_dump()
        )
    except ModelRuntimeError as error:
        return _error_response(error)


def _create_media_job(
    request: Request,
    background_tasks: BackgroundTasks,
    capability: Capability,
    target_type: str,
    target_id: str,
    payload: dict,
):
    try:
        job = request.app.state.model_runtime.create_media_job(
            capability, target_type, target_id, payload
        )
    except ModelRuntimeError as error:
        return _error_response(error)
    background_tasks.add_task(
        request.app.state.model_runtime.run_media_job, job.id
    )
    return RuntimeJobRead(
        job_id=job.id, capability=capability, status=job.status
    )


@router.post("/image", status_code=status.HTTP_202_ACCEPTED)
def image(
    payload: ImageRuntimeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    with request.app.state.session_factory() as session:
        try:
            require_image_target_ready(session, payload.target_type, payload.target_id)
        except ShotGenerationNotReady as exc:
            raise HTTPException(status_code=409, detail=exc.detail) from exc
    return _create_media_job(
        request,
        background_tasks,
        Capability.IMAGE,
        payload.target_type,
        payload.target_id,
        {
            "activate": payload.activate,
            "reference_type": payload.reference_type,
            "label": payload.label,
            "mode": payload.mode,
        },
    )


@router.post("/speech", status_code=status.HTTP_202_ACCEPTED)
def speech(
    payload: SpeechRuntimeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    return _create_media_job(
        request,
        background_tasks,
        Capability.SPEECH,
        "dialogue",
        payload.dialogue_id,
        {},
    )


@router.post("/video", status_code=status.HTTP_202_ACCEPTED)
def video(
    payload: VideoRuntimeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    return _create_media_job(
        request,
        background_tasks,
        Capability.VIDEO,
        "shot",
        payload.shot_id,
        {"activate": payload.activate},
    )


@router.get("/jobs/{job_id}")
def job(job_id: str, request: Request):
    return request.app.state.model_runtime.get_job(job_id)


@router.post("/jobs/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry(job_id: str, request: Request, background_tasks: BackgroundTasks):
    job = request.app.state.model_runtime.retry_job(job_id)
    background_tasks.add_task(
        request.app.state.model_runtime.run_media_job, job.id
    )
    return RuntimeJobRead(
        job_id=job.id,
        capability=Capability(job.request_payload["capability"]),
        status=job.status,
    )
