from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.services.shot_inputs import ShotInputCompiler, ShotInputReferenceError


@dataclass(frozen=True)
class PanelFreshness:
    is_stale: bool
    reason: str | None = None


class PanelFreshnessService:
    def __init__(self, session: Session):
        self.session = session

    def inspect(self, shot_id: str, asset: models.Asset) -> PanelFreshness:
        return self.inspect_many(shot_id, [asset])[asset.id]

    def inspect_many(
        self, shot_id: str, assets: list[models.Asset]
    ) -> dict[str, PanelFreshness]:
        try:
            compiled = ShotInputCompiler(self.session).compile(
                shot_id, usage_kinds={"panel", "reference"}
            )
            current_snapshot = compiled.snapshot
            current_snapshot_hash = compiled.snapshot_hash
        except ShotInputReferenceError:
            current_snapshot = None
            current_snapshot_hash = None
        return {
            asset.id: self._evaluate(
                asset,
                current_snapshot=current_snapshot,
                current_snapshot_hash=current_snapshot_hash,
            )
            for asset in assets
        }

    @staticmethod
    def _panel_projection(snapshot: dict) -> dict:
        shot = snapshot.get("shot")
        if not isinstance(shot, dict):
            return snapshot
        return {
            **snapshot,
            "shot": {
                key: value
                for key, value in shot.items()
                if key not in {"video_prompt", "negative_video_prompt"}
            },
        }

    @staticmethod
    def _evaluate(
        asset: models.Asset,
        *,
        current_snapshot: dict | None,
        current_snapshot_hash: str | None,
    ) -> PanelFreshness:
        stored_hash = asset.request_metadata.get("input_snapshot_hash")
        if not isinstance(stored_hash, str) or not stored_hash:
            return PanelFreshness(True, "missing_provenance")
        if current_snapshot_hash is None:
            return PanelFreshness(True, "inputs_unavailable")
        if stored_hash != current_snapshot_hash:
            stored_snapshot = asset.request_metadata.get("input_snapshot")
            if (
                isinstance(stored_snapshot, dict)
                and current_snapshot is not None
                and PanelFreshnessService._panel_projection(stored_snapshot)
                == PanelFreshnessService._panel_projection(current_snapshot)
            ):
                return PanelFreshness(False)
            return PanelFreshness(True, "inputs_changed")
        return PanelFreshness(False)
