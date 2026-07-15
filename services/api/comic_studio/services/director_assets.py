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
    media_type: str | None
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
            media_type=self.media_type,
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
                .selectinload(models.LibraryAssetSceneBinding.library_asset)
                .selectinload(models.LibraryAsset.media_asset),
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
            media = asset.media_asset
            media_is_image = media is not None and media.media_type.startswith("image/")
            media_is_model = media is not None and media.media_type == "model/gltf-binary"
            media_url = (
                f"/media/{media.local_path}"
                if media_is_image or media_is_model
                else None
            )
            aspect_ratio = (
                media.width / media.height
                if media_is_image and media.width and media.height
                else 1.5 if is_background else 1.0
            )
            result.append(
                DirectorAssetDefinition(
                    key=f"library_asset:{asset.id}",
                    kind="background" if is_background else "prop",
                    source_type="library_asset",
                    source_id=asset.id,
                    asset_id=media.id if media_is_image or media_is_model else None,
                    label=asset.name,
                    media_url=media_url,
                    media_type=media.media_type if media is not None else None,
                    metadata={
                        "description": asset.description,
                        "tags": asset.tags,
                        **({"asset_id": media.id} if media_is_image or media_is_model else {}),
                        "requires_3d_model": not is_background and not media_is_model,
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
                    appearance=(
                        {"image_url": media_url, "aspect_ratio": aspect_ratio}
                        if is_background and media_is_image
                        else {"model_url": media_url}
                        if media_is_model
                        else {
                            "color": "#49636e" if is_background else "#7295a3",
                            **(
                                {"fallback_image_url": media_url}
                                if media_is_image and not is_background
                                else {}
                            ),
                        }
                    ),
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
            media_type=None,
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
        representations = list(
            self.session.scalars(
                select(models.Character3DRepresentation)
                .options(selectinload(models.Character3DRepresentation.asset))
                .where(
                    models.Character3DRepresentation.character_id.in_(characters),
                    models.Character3DRepresentation.is_active.is_(True),
                    models.Character3DRepresentation.review_status == "approved",
                    models.Character3DRepresentation.variant_id.is_(None),
                    models.Character3DRepresentation.state_id.is_(None),
                )
                .order_by(models.Character3DRepresentation.version.desc())
            )
        )
        by_character_representation = {
            item.character_id: item for item in representations
        }
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
            representation = by_character_representation.get(character.id)
            if reference is None and representation is None:
                continue
            reference_asset = (
                self.session.get(models.Asset, reference.asset_id) if reference else None
            )
            if reference_asset is not None and not reference_asset.media_type.startswith("image/"):
                reference_asset = None
            fallback_url = (
                f"/media/{reference_asset.local_path}" if reference_asset else None
            )
            aspect_ratio = (
                reference_asset.width / reference_asset.height
                if reference_asset and reference_asset.width and reference_asset.height
                else 0.75
            )
            if representation is not None:
                model_url = f"/media/{representation.asset.local_path}"
                minimum = representation.bounds.get("min")
                maximum = representation.bounds.get("max")
                height = (
                    float(maximum[1]) - float(minimum[1])
                    if isinstance(minimum, list)
                    and isinstance(maximum, list)
                    and len(minimum) == 3
                    and len(maximum) == 3
                    else 0
                )
                model_scale = 1.8 / height if height > 0 else 1.0
                model_offset_y = -float(minimum[1]) * model_scale if height > 0 else 0
                result.append(
                    DirectorAssetDefinition(
                        key=f"character:{character.id}:representation:{representation.id}",
                        kind="character",
                        source_type="model",
                        source_id=representation.id,
                        asset_id=representation.asset_id,
                        label=character.name,
                        media_url=model_url,
                        media_type="model/gltf-binary",
                        metadata={
                            "character_id": character.id,
                            "role": character.role,
                            "representation_id": representation.id,
                            "representation_version": representation.version,
                            "asset_id": representation.asset_id,
                            "mesh_count": representation.mesh_count,
                            "triangle_count": representation.triangle_count,
                            "has_skeleton": representation.has_skeleton,
                            "requires_3d_model": False,
                            "appearance_bible": character.appearance_bible,
                            "continuity_rules": character.continuity_rules,
                        },
                        transform={
                            "position": [(index - (len(characters) - 1) / 2) * 1.2, 0, 0],
                            "rotation": [0, 0, 0],
                            "scale": [1, 1, 1],
                        },
                        appearance={
                            "model_url": model_url,
                            "model_scale": model_scale,
                            "model_offset_y": model_offset_y,
                            "fallback_image_url": fallback_url,
                            "aspect_ratio": aspect_ratio,
                        },
                    )
                )
                continue
            if reference_asset is None:
                continue
            media_url = fallback_url
            result.append(
                DirectorAssetDefinition(
                    key=f"character:{character.id}:{reference.id}",
                    kind="character",
                    source_type="character_reference",
                    source_id=character.id,
                    asset_id=reference_asset.id,
                    label=character.name,
                    media_url=media_url,
                    media_type=reference_asset.media_type,
                    metadata={
                        "character_id": character.id,
                        "role": character.role,
                        "reference_id": reference.id,
                        "reference_type": reference.reference_type,
                        "asset_id": reference_asset.id,
                        "requires_3d_model": True,
                        "appearance_bible": character.appearance_bible,
                        "continuity_rules": character.continuity_rules,
                    },
                    transform={
                        "position": [(index - (len(characters) - 1) / 2) * 1.2, 0, 0],
                        "rotation": [0, 0, 0],
                        "scale": [1, 1, 1],
                    },
                    appearance={
                        "color": "#d76b4b",
                        "fallback_image_url": media_url,
                        "aspect_ratio": aspect_ratio,
                    },
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
                    media_type=None,
                    metadata={**metadata, "requires_3d_model": True},
                    transform={
                        "position": [(index + 1) * 1.1, 0, 0.8],
                        "rotation": [0, 0, 0],
                        "scale": [0.8, 0.8, 0.8],
                    },
                    appearance={"color": "#7295a3"},
                )
            )
        return result
