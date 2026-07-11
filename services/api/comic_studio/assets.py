import hashlib
import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models


EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "audio/wav": ".wav"}


class AssetStore:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

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
        attempt = self.session.scalar(
            select(func.count(models.Asset.id)).where(
                models.Asset.project_id == project_id,
                models.Asset.kind == f"panel:{shot_id}",
            )
        ) or 0
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
        relative_path = Path("projects") / project_id / "panels" / shot_id / f"{asset.id}{extension}"
        destination = (self.data_root / relative_path).resolve()
        if self.data_root not in destination.parents:
            raise ValueError("Asset path escaped data root")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(content)
        os.replace(temporary, destination)

        asset.local_path = str(relative_path)
        if activate:
            shot.active_panel_asset_id = asset.id
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
        attempt = self.session.scalar(
            select(func.count(models.Asset.id)).where(
                models.Asset.project_id == project_id,
                models.Asset.kind == f"dialogue:{dialogue_id}",
            )
        ) or 0
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
            Path("projects")
            / project_id
            / "audio"
            / dialogue_id
            / f"{asset.id}.wav"
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
