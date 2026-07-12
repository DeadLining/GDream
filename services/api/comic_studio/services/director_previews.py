from __future__ import annotations

import hashlib
import os
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models


MAX_DIRECTOR_PREVIEW_BYTES = 5 * 1024 * 1024


class DirectorPreviewError(ValueError):
    pass


class DirectorPreviewService:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    def save(
        self, camera_id: str, content: bytes, media_type: str = "image/png"
    ) -> models.Asset:
        camera = self.session.get(models.ShotCamera, camera_id)
        if camera is None:
            raise KeyError(camera_id)
        if media_type != "image/png":
            raise DirectorPreviewError("invalid_media_type")
        if len(content) > MAX_DIRECTOR_PREVIEW_BYTES:
            raise DirectorPreviewError("preview_too_large")

        try:
            with Image.open(BytesIO(content)) as image:
                image.load()
                if image.format != "PNG":
                    raise DirectorPreviewError("invalid_png")
                width, height = image.size
        except DirectorPreviewError:
            raise
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise DirectorPreviewError("invalid_png") from exc

        project_id = camera.shot.scene.episode.project_id
        attempt = (
            self.session.scalar(
                select(func.count(models.Asset.id)).where(
                    models.Asset.project_id == project_id,
                    models.Asset.kind == f"director_preview:{camera.id}",
                )
            )
            or 0
        )
        old_asset = (
            self.session.get(models.Asset, camera.preview_asset_id)
            if camera.preview_asset_id
            else None
        )
        old_path = self._asset_path(old_asset.local_path) if old_asset else None
        old_content = old_path.read_bytes() if old_path and old_path.is_file() else None

        asset = models.Asset(
            project_id=project_id,
            kind=f"director_preview:{camera.id}",
            local_path="",
            media_type="image/png",
            provider="director",
            model="threejs",
            request_metadata={"camera_id": camera.id, "stage_id": camera.stage_id},
            generation_attempt=attempt + 1,
            checksum=hashlib.sha256(content).hexdigest(),
            width=width,
            height=height,
        )
        self.session.add(asset)
        self.session.flush()

        relative = (
            Path("projects")
            / project_id
            / "director"
            / camera.stage_id
            / f"{camera.id}.png"
        )
        destination = self._asset_path(str(relative))
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".png.tmp")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
            asset.local_path = str(relative)
            camera.preview_asset_id = asset.id
            if old_asset is not None:
                self.session.delete(old_asset)
            self.session.commit()
        except Exception:
            self.session.rollback()
            temporary.unlink(missing_ok=True)
            if old_content is None:
                destination.unlink(missing_ok=True)
            else:
                restore = destination.with_suffix(".png.restore")
                restore.write_bytes(old_content)
                os.replace(restore, destination)
            raise

        if old_path is not None and old_path != destination:
            old_path.unlink(missing_ok=True)
        self.session.refresh(asset)
        return asset

    def _asset_path(self, local_path: str) -> Path:
        destination = (self.data_root / local_path).resolve()
        if destination == self.data_root or self.data_root not in destination.parents:
            raise DirectorPreviewError("asset_path_escape")
        return destination
