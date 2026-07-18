import hashlib
import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models


EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
}


class StaleVideoVersionError(ValueError):
    pass


class AssetStore:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    @staticmethod
    def _activate_panel(shot: models.Shot, asset_id: str) -> None:
        if shot.active_panel_asset_id == asset_id:
            return
        shot.active_panel_asset_id = asset_id
        shot.active_video_asset_id = None
        shot.video_render_status = "pending"

    def register_panel(
        self,
        *,
        project_id: str,
        shot_id: str,
        content: bytes,
        media_type: str,
        provider: str,
        model: str,
        request_metadata: dict,
        activate: bool,
    ) -> models.Asset:
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            raise KeyError(shot_id)
        attempt = (
            self.session.scalar(
                select(func.count(models.Asset.id)).where(
                    models.Asset.project_id == project_id,
                    models.Asset.kind == f"panel:{shot_id}",
                )
            )
            or 0
        )
        asset = models.Asset(
            project_id=project_id,
            kind=f"panel:{shot_id}",
            local_path="",
            media_type=media_type,
            provider=provider,
            model=model,
            request_metadata=request_metadata,
            generation_attempt=attempt + 1,
            checksum=hashlib.sha256(content).hexdigest(),
        )
        self.session.add(asset)
        self.session.flush()

        extension = EXTENSIONS.get(media_type, ".bin")
        relative_path = (
            Path("projects")
            / project_id
            / "panels"
            / shot_id
            / f"{asset.id}{extension}"
        )
        destination = (self.data_root / relative_path).resolve()
        if self.data_root not in destination.parents:
            raise ValueError("Asset path escaped data root")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(content)
        os.replace(temporary, destination)

        asset.local_path = str(relative_path)
        if activate:
            self._activate_panel(shot, asset.id)
        self.session.commit()
        self.session.refresh(asset)
        return asset

    def register_dialogue_audio(
        self,
        *,
        project_id: str,
        dialogue_id: str,
        content: bytes,
        provider: str,
        model: str,
        request_metadata: dict,
    ) -> models.Asset:
        line = self.session.get(models.DialogueLine, dialogue_id)
        if line is None:
            raise KeyError(dialogue_id)
        attempt = (
            self.session.scalar(
                select(func.count(models.Asset.id)).where(
                    models.Asset.project_id == project_id,
                    models.Asset.kind == f"dialogue:{dialogue_id}",
                )
            )
            or 0
        )
        asset = models.Asset(
            project_id=project_id,
            kind=f"dialogue:{dialogue_id}",
            local_path="",
            media_type="audio/wav",
            provider=provider,
            model=model,
            request_metadata=request_metadata,
            generation_attempt=attempt + 1,
            checksum=hashlib.sha256(content).hexdigest(),
        )
        self.session.add(asset)
        self.session.flush()
        relative_path = (
            Path("projects") / project_id / "audio" / dialogue_id / f"{asset.id}.wav"
        )
        destination = (self.data_root / relative_path).resolve()
        if self.data_root not in destination.parents:
            raise ValueError("Asset path escaped data root")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".wav.tmp")
        temporary.write_bytes(content)
        os.replace(temporary, destination)
        asset.local_path = str(relative_path)
        line.audio_asset_id = asset.id
        self.session.commit()
        self.session.refresh(asset)
        return asset

    def list_panel_versions(self, shot_id: str) -> list[models.Asset]:
        return list(
            self.session.scalars(
                select(models.Asset)
                .where(models.Asset.kind == f"panel:{shot_id}")
                .order_by(models.Asset.generation_attempt.desc())
            )
        )

    def activate_panel(self, shot_id: str, asset_id: str) -> models.Shot | None:
        shot = self.session.get(models.Shot, shot_id)
        asset = self.session.get(models.Asset, asset_id)
        if shot is None or asset is None or asset.kind != f"panel:{shot_id}":
            return None
        self._activate_panel(shot, asset.id)
        self.session.commit()
        self.session.refresh(shot)
        return shot

    def register_video(
        self,
        *,
        project_id: str,
        shot_id: str,
        source_panel_id: str,
        content: bytes,
        provider: str,
        model: str,
        request_metadata: dict,
        duration_seconds: float,
        activate: bool,
    ):
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            raise KeyError(shot_id)
        if b"ftyp" not in content[:32]:
            raise ValueError("invalid_mp4")
        attempt = (
            self.session.scalar(
                select(func.count(models.Asset.id)).where(
                    models.Asset.project_id == project_id,
                    models.Asset.kind == f"video:{shot_id}",
                )
            )
            or 0
        )
        asset = models.Asset(
            project_id=project_id,
            kind=f"video:{shot_id}",
            local_path="",
            media_type="video/mp4",
            provider=provider,
            model=model,
            request_metadata=request_metadata,
            parent_asset_id=source_panel_id,
            generation_attempt=attempt + 1,
            checksum=hashlib.sha256(content).hexdigest(),
            duration_seconds=duration_seconds,
        )
        self.session.add(asset)
        self.session.flush()
        relative = (
            Path("projects") / project_id / "videos" / shot_id / f"{asset.id}.mp4"
        )
        destination = (self.data_root / relative).resolve()
        if self.data_root not in destination.parents:
            raise ValueError("Asset path escaped data root")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".mp4.tmp")
        temporary.write_bytes(content)
        os.replace(temporary, destination)
        asset.local_path = str(relative)
        if activate:
            shot.active_video_asset_id = asset.id
            shot.video_render_status = "completed"
        self.session.commit()
        self.session.refresh(asset)
        return asset

    def list_video_versions(self, shot_id: str):
        return list(
            self.session.scalars(
                select(models.Asset)
                .where(models.Asset.kind == f"video:{shot_id}")
                .order_by(models.Asset.generation_attempt.desc())
            )
        )

    def activate_video(self, shot_id: str, asset_id: str):
        shot = self.session.get(models.Shot, shot_id)
        asset = self.session.get(models.Asset, asset_id)
        if shot is None or asset is None or asset.kind != f"video:{shot_id}":
            return None
        if asset.parent_asset_id != shot.active_panel_asset_id:
            raise StaleVideoVersionError(
                "Video version was generated from a different panel"
            )
        shot.active_video_asset_id = asset.id
        shot.video_render_status = "completed"
        self.session.commit()
        self.session.refresh(shot)
        return shot
