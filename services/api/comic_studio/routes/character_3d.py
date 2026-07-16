from fastapi import APIRouter, HTTPException, Request, status

from comic_studio import schemas
from comic_studio.services.character_3d import (
    Character3DRepresentationError,
    Character3DRepresentationService,
)


router = APIRouter(tags=["character-3d"])


def _response(representation) -> schemas.Character3DRepresentationRead:
    return schemas.Character3DRepresentationRead(
        id=representation.id,
        character_id=representation.character_id,
        variant_id=representation.variant_id,
        state_id=representation.state_id,
        asset_id=representation.asset_id,
        label=representation.label,
        format=representation.format,
        version=representation.version,
        is_active=representation.is_active,
        review_status=representation.review_status,
        model_url=f"/media/{representation.asset.local_path}",
        mesh_count=representation.mesh_count,
        triangle_count=representation.triangle_count,
        material_count=representation.material_count,
        has_skeleton=representation.has_skeleton,
        bounds=representation.bounds,
        metadata=representation.representation_metadata,
        created_at=representation.created_at,
        updated_at=representation.updated_at,
    )


@router.get(
    "/api/characters/{character_id}/3d-representations",
    response_model=list[schemas.Character3DRepresentationRead],
)
def list_representations(character_id: str, request: Request):
    with request.app.state.session_factory() as session:
        try:
            return [
                _response(item)
                for item in Character3DRepresentationService(
                    session, request.app.state.settings.data_root
                ).list(character_id)
            ]
        except KeyError as exc:
            raise HTTPException(404, "Character not found") from exc


@router.post(
    "/api/characters/{character_id}/3d-representations",
    response_model=schemas.Character3DRepresentationRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_representation(character_id: str, request: Request):
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(422, "file_required")
    with request.app.state.session_factory() as session:
        try:
            representation = Character3DRepresentationService(
                session, request.app.state.settings.data_root
            ).upload(
                character_id,
                await upload.read(),
                label=str(form.get("label", "")),
                variant_id=str(form.get("variant_id") or "") or None,
                state_id=str(form.get("state_id") or "") or None,
            )
            return _response(representation)
        except KeyError as exc:
            raise HTTPException(404, "Character not found") from exc
        except Character3DRepresentationError as exc:
            raise HTTPException(
                413 if str(exc) == "glb_too_large" else 422, str(exc)
            ) from exc
