from typing import Annotated

from fastapi import APIRouter,Depends,HTTPException,Request,status
from sqlalchemy.orm import Session

from comic_studio import models,schemas
from comic_studio.db import get_session
from comic_studio.director import DirectorObjectCreateRequest,DirectorObjectRead,DirectorStageRead,DirectorSuggestionApplyRequest,DirectorSuggestionCreateRequest,DirectorSuggestionRead,ShotCameraRead,ShotCameraUpdateRequest
from comic_studio.providers.base import ProviderError
from comic_studio.routes.assets import asset_response
from comic_studio.services.director_previews import DirectorPreviewError,DirectorPreviewService
from comic_studio.services.director_stages import DirectorStageService,DirectorVersionConflict
from comic_studio.services.director_suggestions import DirectorSuggestionService


router=APIRouter(tags=["director"])
SessionDependency=Annotated[Session,Depends(get_session)]


def _conflict(exc:DirectorVersionConflict)->HTTPException:
    return HTTPException(status_code=409,detail={"code":"director_version_conflict","latest_version":exc.latest_version})


@router.post("/api/scenes/{scene_id}/director-stage",response_model=DirectorStageRead,status_code=status.HTTP_201_CREATED)
def create_director_stage(scene_id:str,session:SessionDependency):
    try:return DirectorStageService(session).get_or_create_stage(scene_id)
    except KeyError as exc:raise HTTPException(status_code=404,detail="Scene not found") from exc


@router.get("/api/scenes/{scene_id}/director-stage",response_model=DirectorStageRead)
def get_director_stage(scene_id:str,session:SessionDependency):
    from sqlalchemy import select
    from comic_studio import models
    stage=session.scalar(select(models.DirectorStage).where(models.DirectorStage.scene_id==scene_id))
    if stage is None:raise HTTPException(status_code=404,detail="Director stage not found")
    return DirectorStageService(session).get_stage(stage.id)


@router.post("/api/director-stages/{stage_id}/objects",response_model=DirectorObjectRead,status_code=status.HTTP_201_CREATED)
def create_director_object(stage_id:str,data:DirectorObjectCreateRequest,session:SessionDependency):
    try:return DirectorStageService(session).create_object(stage_id,data.expected_version,data.object)
    except KeyError as exc:raise HTTPException(status_code=404,detail="Director stage not found") from exc
    except DirectorVersionConflict as exc:raise _conflict(exc) from exc


@router.put("/api/director-stages/{stage_id}/shots/{shot_id}/camera",response_model=ShotCameraRead)
def update_shot_camera(stage_id:str,shot_id:str,data:ShotCameraUpdateRequest,session:SessionDependency):
    try:return DirectorStageService(session).update_camera(stage_id,shot_id,data.expected_version,data.camera)
    except KeyError as exc:raise HTTPException(status_code=404,detail="Director camera not found") from exc
    except DirectorVersionConflict as exc:raise _conflict(exc) from exc


@router.post("/api/director-cameras/{camera_id}/preview",status_code=status.HTTP_201_CREATED)
async def upload_camera_preview(camera_id:str,request:Request):
    form=await request.form();upload=form.get("file")
    if upload is None or not hasattr(upload,"read"):
        raise HTTPException(status_code=422,detail="file_required")
    with request.app.state.session_factory() as session:
        try:
            asset=DirectorPreviewService(session,request.app.state.settings.data_root).save(camera_id,await upload.read(),getattr(upload,"content_type","") or "")
            return asset_response(asset)
        except KeyError as exc:raise HTTPException(status_code=404,detail="Director camera not found") from exc
        except DirectorPreviewError as exc:raise HTTPException(status_code=413 if str(exc)=="preview_too_large" else 422,detail=str(exc)) from exc


@router.post("/api/director-stages/{stage_id}/suggestions",response_model=DirectorSuggestionRead,status_code=status.HTTP_201_CREATED)
async def create_director_suggestion(stage_id:str,data:DirectorSuggestionCreateRequest,request:Request):
    with request.app.state.session_factory() as session:
        try:
            provider=request.app.state.provider_factory.create_llm()
            return await DirectorSuggestionService(session,provider).create(stage_id,data.shot_id,data.kind)
        except KeyError as exc:raise HTTPException(status_code=404,detail="Director stage or shot not found") from exc
        except ValueError as exc:raise HTTPException(status_code=422,detail=str(exc)) from exc
        except ProviderError as exc:raise HTTPException(status_code=502,detail="Director suggestion failed") from exc


@router.post("/api/director-stages/{stage_id}/shots/{shot_id}/apply-to-shot",response_model=schemas.ShotRead)
def apply_director_suggestion_to_shot(stage_id:str,shot_id:str,data:DirectorSuggestionApplyRequest,session:SessionDependency):
    suggestion=session.get(models.DirectorSuggestion,data.suggestion_id)
    if suggestion is None or suggestion.stage_id!=stage_id or suggestion.shot_id!=shot_id:
        raise HTTPException(status_code=404,detail="Director suggestion not found")
    try:return DirectorSuggestionService(session,None).apply_to_shot(data.suggestion_id,set(data.fields))
    except KeyError as exc:raise HTTPException(status_code=404,detail="Director suggestion not found") from exc
    except ValueError as exc:raise HTTPException(status_code=422,detail=str(exc)) from exc
