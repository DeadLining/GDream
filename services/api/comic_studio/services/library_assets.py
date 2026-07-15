from io import BytesIO
import hashlib
import os
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.services.character_3d import (
    Character3DRepresentationError,
    Character3DRepresentationService,
)


class DuplicateLibraryAssetError(RuntimeError):
    pass


class LibraryAssetSceneProjectMismatchError(RuntimeError):
    pass


class LibraryAssetMediaError(RuntimeError):
    pass


class LibraryAssetService:
    MAX_MEDIA_BYTES = 25 * 1024 * 1024
    IMAGE_FORMATS = {
        "PNG": ("image/png", ".png"),
        "JPEG": ("image/jpeg", ".jpg"),
        "WEBP": ("image/webp", ".webp"),
    }

    def __init__(self, session: Session):
        self.session = session

    def list(
        self,
        project_id: str,
        *,
        kind: schemas.LibraryAssetKind | None = None,
        query: str = "",
    ):
        if self.session.get(models.Project, project_id) is None:
            return None
        statement = (
            select(models.LibraryAsset)
            .options(selectinload(models.LibraryAsset.media_asset))
            .where(models.LibraryAsset.project_id == project_id)
        )
        if kind is not None:
            statement = statement.where(models.LibraryAsset.kind == kind)
        normalized = query.strip()
        if normalized:
            pattern = f"%{normalized}%"
            statement = statement.where(
                or_(
                    models.LibraryAsset.name.ilike(pattern),
                    models.LibraryAsset.description.ilike(pattern),
                )
            )
        return list(
            self.session.scalars(
                statement.order_by(
                    models.LibraryAsset.created_at, models.LibraryAsset.id
                )
            )
        )

    def create(self, project_id: str, data: schemas.LibraryAssetCreate):
        if self.session.get(models.Project, project_id) is None:
            return None
        payload = data.model_dump()
        metadata = payload.pop("metadata")
        asset = models.LibraryAsset(
            project_id=project_id, asset_metadata=metadata, **payload
        )
        self.session.add(asset)
        self._commit()
        self.session.refresh(asset)
        return asset

    def update(self, asset_id: str, data: schemas.LibraryAssetPatch):
        asset = self.session.get(models.LibraryAsset, asset_id)
        if asset is None:
            return None
        payload = data.model_dump(exclude_unset=True)
        if "metadata" in payload:
            asset.asset_metadata = payload.pop("metadata")
        for key, value in payload.items():
            setattr(asset, key, value)
        self._commit()
        self.session.refresh(asset)
        return asset

    def delete(self, asset_id: str) -> bool:
        asset = self.session.get(models.LibraryAsset, asset_id)
        if asset is None:
            return False
        self.session.delete(asset)
        self.session.commit()
        return True

    def upload_media(
        self,
        asset_id: str,
        content: bytes,
        *,
        filename: str,
        data_root: Path,
    ):
        library_asset = self.session.get(models.LibraryAsset, asset_id)
        if library_asset is None:
            return None
        if not content:
            raise LibraryAssetMediaError("empty_media")
        model_upload = Path(filename).suffix.lower() == ".glb" or content[:4] == b"glTF"
        max_bytes = (
            Character3DRepresentationService.MAX_BYTES
            if model_upload
            else self.MAX_MEDIA_BYTES
        )
        if len(content) > max_bytes:
            raise LibraryAssetMediaError("media_too_large")

        width = None
        height = None
        request_metadata = {
            "library_asset_id": library_asset.id,
            "original_filename": Path(filename).name,
        }
        if library_asset.kind == "sound":
            media_type, extension = self._audio_format(content)
            if media_type is None:
                raise LibraryAssetMediaError("sound_asset_requires_audio")
        elif model_upload:
            if library_asset.kind not in {"scene", "prop"}:
                raise LibraryAssetMediaError("asset_kind_does_not_support_glb")
            try:
                metrics = Character3DRepresentationService.inspect_glb(content)
            except Character3DRepresentationError as exc:
                raise LibraryAssetMediaError(str(exc)) from exc
            media_type, extension = "model/gltf-binary", ".glb"
            request_metadata["format"] = "glb"
            request_metadata["glb_metrics"] = metrics
        else:
            try:
                with Image.open(BytesIO(content)) as image:
                    image.load()
                    image_format = image.format or ""
                    width, height = image.size
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                raise LibraryAssetMediaError("visual_asset_requires_image") from exc
            media = self.IMAGE_FORMATS.get(image_format)
            if media is None:
                raise LibraryAssetMediaError("unsupported_image_format")
            media_type, extension = media

        media_asset = models.Asset(
            project_id=library_asset.project_id,
            kind="library-asset-media",
            local_path="",
            media_type=media_type,
            provider="upload",
            model="local",
            request_metadata=request_metadata,
            checksum=hashlib.sha256(content).hexdigest(),
            review_status="approved",
            width=width,
            height=height,
        )
        self.session.add(media_asset)
        self.session.flush()
        relative = (
            Path("projects")
            / library_asset.project_id
            / "library-assets"
            / library_asset.id
            / f"{media_asset.id}{extension}"
        )
        root = data_root.resolve()
        destination = (root / relative).resolve()
        if root not in destination.parents:
            raise LibraryAssetMediaError("asset_path_escape")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
            media_asset.local_path = str(relative)
            library_asset.media_asset_id = media_asset.id
            self.session.commit()
        except Exception:
            self.session.rollback()
            temporary.unlink(missing_ok=True)
            destination.unlink(missing_ok=True)
            raise
        self.session.refresh(library_asset)
        return library_asset

    @staticmethod
    def _audio_format(content: bytes) -> tuple[str | None, str]:
        if (
            len(content) >= 12
            and content[:4] == b"RIFF"
            and content[8:12] == b"WAVE"
        ):
            return "audio/wav", ".wav"
        if content.startswith(b"ID3") or (
            len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0
        ):
            return "audio/mpeg", ".mp3"
        return None, ""

    def list_for_scene(self, scene_id: str):
        if self.session.get(models.Scene, scene_id) is None:
            return None
        return list(
            self.session.scalars(
                select(models.LibraryAsset)
                .options(selectinload(models.LibraryAsset.media_asset))
                .join(models.LibraryAssetSceneBinding)
                .where(models.LibraryAssetSceneBinding.scene_id == scene_id)
                .order_by(
                    models.LibraryAssetSceneBinding.created_at,
                    models.LibraryAssetSceneBinding.id,
                )
            )
        )

    def bind_to_scene(self, scene_id: str, asset_id: str) -> bool:
        scene = self.session.get(models.Scene, scene_id)
        asset = self.session.get(models.LibraryAsset, asset_id)
        if scene is None or asset is None:
            return False
        if scene.episode.project_id != asset.project_id:
            raise LibraryAssetSceneProjectMismatchError
        existing = self.session.scalar(
            select(models.LibraryAssetSceneBinding).where(
                models.LibraryAssetSceneBinding.scene_id == scene_id,
                models.LibraryAssetSceneBinding.library_asset_id == asset_id,
            )
        )
        if existing is None:
            self.session.add(
                models.LibraryAssetSceneBinding(
                    scene_id=scene_id, library_asset_id=asset_id
                )
            )
            self.session.commit()
        return True

    def unbind_from_scene(self, scene_id: str, asset_id: str) -> bool:
        scene = self.session.get(models.Scene, scene_id)
        asset = self.session.get(models.LibraryAsset, asset_id)
        if scene is None or asset is None:
            return False
        if scene.episode.project_id != asset.project_id:
            raise LibraryAssetSceneProjectMismatchError
        binding = self.session.scalar(
            select(models.LibraryAssetSceneBinding).where(
                models.LibraryAssetSceneBinding.scene_id == scene_id,
                models.LibraryAssetSceneBinding.library_asset_id == asset_id,
            )
        )
        if binding is not None:
            self.session.delete(binding)
            self.session.commit()
        return True

    def _commit(self) -> None:
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicateLibraryAssetError from exc
