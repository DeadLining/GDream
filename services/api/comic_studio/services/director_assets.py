from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.director import DirectorAssetRead


@dataclass(frozen=True)
class DirectorAssetDefinition:
    key: str
    kind: str
    source_type: str
    source_id: str
    asset_id: str | None
    label: str
    media_url: str | None
    metadata: dict[str, Any]
    transform: dict[str, list[float]]
    appearance: dict[str, Any]

    def read(self) -> DirectorAssetRead:
        return DirectorAssetRead(
            key=self.key,
            kind=self.kind,
            source_type=self.source_type,
            source_id=self.source_id,
            asset_id=self.asset_id,
            label=self.label,
            media_url=self.media_url,
            metadata=self.metadata,
        )


class DirectorAssetCatalogService:
    def __init__(self, session: Session):
        self.session = session

    def definitions(self, stage_id: str) -> list[DirectorAssetDefinition]:
        stage = self.session.scalar(
            select(models.DirectorStage)
            .options(
                selectinload(models.DirectorStage.scene)
                .selectinload(models.Scene.episode)
                .selectinload(models.Episode.project)
                .selectinload(models.Project.characters),
                selectinload(models.DirectorStage.scene)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue),
                selectinload(models.DirectorStage.scene)
                .selectinload(models.Scene.library_asset_bindings)
                .selectinload(models.LibraryAssetSceneBinding.library_asset),
            )
            .where(models.DirectorStage.id == stage_id)
        )
        if stage is None:
            raise KeyError(stage_id)
        scene = stage.scene
        continuity = scene.continuity_state or {}
        result = [self._scene_definition(scene)]
        result.extend(self._library_asset_definitions(scene))
        result.extend(self._character_definitions(scene))
        result.extend(self._prop_definitions(scene, continuity.get("props")))
        return result

    @staticmethod
    def _library_asset_definitions(
        scene: models.Scene,
    ) -> list[DirectorAssetDefinition]:
        result: list[DirectorAssetDefinition] = []
        supported = [
            binding.library_asset
            for binding in scene.library_asset_bindings
            if binding.library_asset.kind in {"scene", "prop"}
        ]
        for index, asset in enumerate(supported):
            is_background = asset.kind == "scene"
            result.append(
                DirectorAssetDefinition(
                    key=f"library_asset:{asset.id}",
                    kind="background" if is_background else "prop",
                    source_type="library_asset",
                    source_id=asset.id,
                    asset_id=None,
                    label=asset.name,
                    media_url=None,
                    metadata={
                        "description": asset.description,
                        "tags": asset.tags,
                        **(asset.asset_metadata or {}),
                    },
                    transform={
                        "position": (
                            [0, 1.2, -2.2]
                            if is_background
                            else [(index + 1) * 1.1, 0, 0.8]
                        ),
                        "rotation": [0, 0, 0],
                        "scale": [2.5, 2.5, 2.5] if is_background else [0.8, 0.8, 0.8],
                    },
                    appearance={"color": "#49636e" if is_background else "#7295a3"},
                )
            )
        return result

    def list(self, stage_id: str) -> list[DirectorAssetRead]:
        return [item.read() for item in self.definitions(stage_id)]

    @staticmethod
    def environment(stage: models.DirectorStage) -> dict[str, Any]:
        scene = stage.scene
        return {
            **(stage.environment or {}),
            "scene_id": scene.id,
            "location": scene.location,
            "time_of_day": scene.time_of_day,
            "summary": scene.summary,
            "continuity_state": scene.continuity_state or {},
        }

    @staticmethod
    def _scene_definition(scene: models.Scene) -> DirectorAssetDefinition:
        time_label = f" · {scene.time_of_day}" if scene.time_of_day else ""
        return DirectorAssetDefinition(
            key=f"scene:{scene.id}",
            kind="background",
            source_type="scene_context",
            source_id=scene.id,
            asset_id=None,
            label=f"{scene.location}{time_label}",
            media_url=None,
            metadata={
                "summary": scene.summary,
                "time_of_day": scene.time_of_day,
                "continuity_state": scene.continuity_state or {},
            },
            transform={
                "position": [0, 1.2, -2.5],
                "rotation": [0, 0, 0],
                "scale": [2.5, 2.5, 2.5],
            },
            appearance={"color": "#49636e"},
        )

    def _character_definitions(
        self, scene: models.Scene
    ) -> list[DirectorAssetDefinition]:
        raw_present = (scene.continuity_state or {}).get("characters_present", [])
        present_ids = {
            item for item in raw_present if isinstance(item, str)
        } if isinstance(raw_present, list) else set()
        for shot in scene.shots:
            present_ids.update(
                item for item in (shot.character_state or {}) if isinstance(item, str)
            )
            present_ids.update(
                line.character_id for line in shot.dialogue if line.character_id
            )
        characters = {
            item.id: item
            for item in scene.episode.project.characters
            if not present_ids or item.id in present_ids
        }
        if not characters:
            return []
        references = list(
            self.session.scalars(
                select(models.CharacterReference).where(
                    models.CharacterReference.character_id.in_(characters),
                    models.CharacterReference.is_active.is_(True),
                    models.CharacterReference.review_status == "approved",
                    models.CharacterReference.reference_type.in_(("primary", "front")),
                )
            )
        )
        by_character: dict[str, list[models.CharacterReference]] = {}
        for reference in references:
            by_character.setdefault(reference.character_id, []).append(reference)
        result: list[DirectorAssetDefinition] = []
        for index, character in enumerate(characters.values()):
            candidates = by_character.get(character.id, [])
            reference = next(
                (
                    item
                    for kind in ("primary", "front")
                    for item in candidates
                    if item.reference_type == kind
                ),
                None,
            )
            if reference is None:
                continue
            asset = self.session.get(models.Asset, reference.asset_id)
            if asset is None or not asset.media_type.startswith("image/"):
                continue
            aspect_ratio = asset.width / asset.height if asset.width and asset.height else 0.75
            media_url = f"/media/{asset.local_path}"
            result.append(
                DirectorAssetDefinition(
                    key=f"character:{character.id}:{reference.id}",
                    kind="character",
                    source_type="character_reference",
                    source_id=character.id,
                    asset_id=asset.id,
                    label=character.name,
                    media_url=media_url,
                    metadata={
                        "character_id": character.id,
                        "role": character.role,
                        "reference_id": reference.id,
                        "reference_type": reference.reference_type,
                        "asset_id": asset.id,
                        "appearance_bible": character.appearance_bible,
                        "continuity_rules": character.continuity_rules,
                    },
                    transform={
                        "position": [(index - (len(characters) - 1) / 2) * 1.2, 0, 0],
                        "rotation": [0, 0, 0],
                        "scale": [1, 1, 1],
                    },
                    appearance={"image_url": media_url, "aspect_ratio": aspect_ratio},
                )
            )
        return result

    @staticmethod
    def _prop_definitions(
        scene: models.Scene, raw_props: Any
    ) -> list[DirectorAssetDefinition]:
        if isinstance(raw_props, (str, dict)):
            values = [raw_props]
        elif isinstance(raw_props, list):
            values = raw_props
        else:
            values = []
        result: list[DirectorAssetDefinition] = []
        for index, value in enumerate(values):
            if isinstance(value, str):
                label = value.strip()
                metadata = {"description": value}
            elif isinstance(value, dict):
                label = str(value.get("name") or value.get("label") or "场景道具").strip()
                metadata = dict(value)
            else:
                continue
            if not label:
                continue
            fingerprint = hashlib.sha256(
                json.dumps(value, ensure_ascii=True, sort_keys=True).encode("utf-8")
            ).hexdigest()[:12]
            result.append(
                DirectorAssetDefinition(
                    key=f"prop:{scene.id}:{fingerprint}",
                    kind="prop",
                    source_type="scene_context",
                    source_id=scene.id,
                    asset_id=None,
                    label=label,
                    media_url=None,
                    metadata=metadata,
                    transform={
                        "position": [(index + 1) * 1.1, 0, 0.8],
                        "rotation": [0, 0, 0],
                        "scale": [0.8, 0.8, 0.8],
                    },
                    appearance={"color": "#7295a3"},
                )
            )
        return result
