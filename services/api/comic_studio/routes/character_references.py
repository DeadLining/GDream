from fastapi import APIRouter, HTTPException, Request, Response, status

from comic_studio import models, schemas
from comic_studio.routes.assets import asset_response
from comic_studio.services.character_references import (
    CharacterReferenceError,
    CharacterReferenceService,
)


router = APIRouter(tags=["character-references"])


def response_for(reference, asset):
    return schemas.CharacterReferenceRead(
        id=reference.id,
        character_id=reference.character_id,
        reference_type=reference.reference_type,
        label=reference.label,
        position=reference.position,
        is_active=reference.is_active,
        review_status=reference.review_status,
        created_at=reference.created_at,
        asset=asset_response(asset),
    )


@router.get(
    "/api/characters/{character_id}/references",
    response_model=list[schemas.CharacterReferenceRead],
)
def list_references(character_id: str, request: Request):
    with request.app.state.session_factory() as session:
        try:
            return [
                response_for(ref, asset)
                for ref, asset in CharacterReferenceService(
                    session, request.app.state.settings.data_root
                ).list(character_id)
            ]
        except KeyError as exc:
            raise HTTPException(404, "Character not found") from exc


@router.post(
    "/api/characters/{character_id}/references/upload",
    response_model=schemas.CharacterReferenceRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_reference(character_id: str, request: Request):
    form = await request.form()
    upload = form.get("file")
    reference_type = str(form.get("reference_type", ""))
    label = str(form.get("label", ""))
    if reference_type not in {
        "primary",
        "front",
        "three_quarter",
        "side",
        "back",
        "expression",
        "outfit",
    }:
        raise HTTPException(422, "invalid_reference_type")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(422, "file_required")
    with request.app.state.session_factory() as session:
        try:
            ref, asset = CharacterReferenceService(
                session, request.app.state.settings.data_root
            ).upload(character_id, await upload.read(), reference_type, label)
            return response_for(ref, asset)
        except KeyError as exc:
            raise HTTPException(404, "Character not found") from exc
        except CharacterReferenceError as exc:
            raise HTTPException(
                413 if str(exc) == "image_too_large" else 422, str(exc)
            ) from exc


@router.patch(
    "/api/character-references/{reference_id}",
    response_model=schemas.CharacterReferenceRead,
)
def patch_reference(
    reference_id: str, data: schemas.CharacterReferencePatch, request: Request
):
    with request.app.state.session_factory() as session:
        service = CharacterReferenceService(
            session, request.app.state.settings.data_root
        )
        try:
            ref = service.patch(reference_id, data)
            return response_for(ref, session.get(models.Asset, ref.asset_id))
        except KeyError as exc:
            raise HTTPException(404, "Reference not found") from exc


@router.put(
    "/api/characters/{character_id}/references/{reference_id}/active",
    response_model=schemas.CharacterReferenceRead,
)
def activate_reference(character_id: str, reference_id: str, request: Request):
    with request.app.state.session_factory() as session:
        service = CharacterReferenceService(
            session, request.app.state.settings.data_root
        )
        try:
            ref = service.activate(character_id, reference_id)
            return response_for(ref, session.get(models.Asset, ref.asset_id))
        except KeyError as exc:
            raise HTTPException(404, "Reference not found") from exc
        except CharacterReferenceError as exc:
            raise HTTPException(409, str(exc)) from exc


@router.delete(
    "/api/character-references/{reference_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_reference(reference_id: str, request: Request):
    with request.app.state.session_factory() as session:
        try:
            CharacterReferenceService(
                session, request.app.state.settings.data_root
            ).delete(reference_id)
            return Response(status_code=204)
        except KeyError as exc:
            raise HTTPException(404, "Reference not found") from exc
        except CharacterReferenceError as exc:
            raise HTTPException(409, str(exc)) from exc
