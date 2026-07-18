from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models


class CurrentScriptRevisionMissing(RuntimeError):
    pass


class ShotGenerationNotReady(RuntimeError):
    def __init__(self, blocked_shots: dict[str, list[str]]):
        super().__init__("shot_generation_not_ready")
        self.blocked_shots = blocked_shots

    @property
    def detail(self) -> dict:
        return {
            "code": "shot_generation_not_ready",
            "blocked_shots": self.blocked_shots,
        }


@dataclass(frozen=True)
class RequirementDefinition:
    canonical_key: str
    kind: str
    name: str
    description: str
    required: bool
    status: str
    binding_type: str
    binding_id: str | None
    source_context: dict
    metadata: dict


def _normalized_name(value: str) -> str:
    return "".join(value.split()).casefold()


def _prop_values(value) -> list[dict]:
    if isinstance(value, (str, dict)):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        values = []
    result = []
    for item in values:
        if isinstance(item, str):
            name = item.strip()
            metadata = {"description": item}
            required = True
        elif isinstance(item, dict):
            name = str(item.get("name") or item.get("label") or "").strip()
            metadata = dict(item)
            required = item.get("required", True) is not False
        else:
            continue
        if name:
            result.append({"name": name, "required": required, "metadata": metadata})
    return result


class AssetRequirementService:
    def __init__(self, session: Session):
        self.session = session

    def current_revision_id(self, project_id: str) -> str:
        document = self.session.scalar(
            select(models.ScriptDocument).where(
                models.ScriptDocument.project_id == project_id
            )
        )
        if document is None or not document.current_revision_id:
            raise CurrentScriptRevisionMissing("current_script_revision_missing")
        return document.current_revision_id

    def list(self, project_id: str, *, kind: str | None = None):
        if self.session.get(models.Project, project_id) is None:
            return None
        revision_id = self.current_revision_id(project_id)
        statement = select(models.AssetRequirement).where(
            models.AssetRequirement.project_id == project_id,
            models.AssetRequirement.script_revision_id == revision_id,
        )
        if kind is not None:
            statement = statement.where(models.AssetRequirement.kind == kind)
        return list(
            self.session.scalars(
                statement.order_by(
                    models.AssetRequirement.kind,
                    models.AssetRequirement.name,
                    models.AssetRequirement.id,
                )
            )
        )

    def sync(self, project_id: str, *, commit: bool = True):
        if self.session.get(models.Project, project_id) is None:
            return None
        revision_id = self.current_revision_id(project_id)
        definitions = self._definitions(project_id)
        existing = {
            item.canonical_key: item
            for item in self.session.scalars(
                select(models.AssetRequirement).where(
                    models.AssetRequirement.script_revision_id == revision_id
                )
            )
        }
        desired_keys = set()
        for definition in definitions:
            desired_keys.add(definition.canonical_key)
            requirement = existing.get(definition.canonical_key)
            if requirement is None:
                requirement = models.AssetRequirement(
                    project_id=project_id,
                    script_revision_id=revision_id,
                    canonical_key=definition.canonical_key,
                )
                self.session.add(requirement)
            requirement.kind = definition.kind
            requirement.name = definition.name
            requirement.description = definition.description
            requirement.required = definition.required
            requirement.status = definition.status
            requirement.binding_type = definition.binding_type
            requirement.binding_id = definition.binding_id
            requirement.source_context = definition.source_context
            requirement.requirement_metadata = definition.metadata
        for key, requirement in existing.items():
            if key not in desired_keys:
                self.session.delete(requirement)
        if commit:
            self.session.commit()
        else:
            self.session.flush()
        return self.list(project_id)

    def shot_readiness(self, shot_id: str) -> dict | None:
        shot = self.session.scalar(
            select(models.Shot)
            .options(
                selectinload(models.Shot.scene).selectinload(models.Scene.episode),
            )
            .where(models.Shot.id == shot_id)
        )
        if shot is None:
            return None
        project_id = shot.scene.episode.project_id
        requirements = self.sync(project_id) or []
        relevant = [
            item
            for item in requirements
            if shot.id in item.source_context.get("shot_ids", [])
        ]
        blockers = []
        if any(
            item.kind == "character" and item.status != "ready"
            for item in relevant
        ):
            blockers.append("missing_character_reference")
        if any(item.kind == "scene" and item.status != "ready" for item in relevant):
            blockers.append("missing_background")
        if any(
            item.kind == "prop" and item.required and item.status != "ready"
            for item in relevant
        ):
            blockers.append("missing_required_prop")

        return {
            "shot_id": shot.id,
            "project_id": project_id,
            "script_revision_id": self.current_revision_id(project_id),
            "ready": not blockers,
            "asset_ready": not any(
                item.status != "ready" and item.required for item in relevant
            ),
            "blocking_ready": True,
            "camera_ready": True,
            "blockers": blockers,
            "requirement_ids": [item.id for item in relevant],
        }

    def _definitions(self, project_id: str) -> list[RequirementDefinition]:
        characters = list(
            self.session.scalars(
                select(models.Character)
                .options(selectinload(models.Character.references))
                .where(models.Character.project_id == project_id)
            )
        )
        scenes = list(
            self.session.scalars(
                select(models.Scene)
                .join(models.Episode)
                .options(
                    selectinload(models.Scene.shots).selectinload(models.Shot.dialogue),
                    selectinload(models.Scene.library_asset_bindings)
                    .selectinload(models.LibraryAssetSceneBinding.library_asset)
                    .selectinload(models.LibraryAsset.media_asset),
                )
                .where(models.Episode.project_id == project_id)
            )
        )
        library_assets = list(
            self.session.scalars(
                select(models.LibraryAsset)
                .options(selectinload(models.LibraryAsset.media_asset))
                .where(models.LibraryAsset.project_id == project_id)
            )
        )
        assets_by_id = {
            asset.id: asset
            for asset in self.session.scalars(
                select(models.Asset).where(models.Asset.project_id == project_id)
            )
        }
        definitions = []
        for character in characters:
            shot_ids = []
            scene_ids = []
            for scene in scenes:
                present = character.id in (scene.continuity_state or {}).get(
                    "characters_present", []
                )
                matching_shots = [
                    shot.id
                    for shot in scene.shots
                    if character.id in (shot.character_state or {})
                    or any(line.character_id == character.id for line in shot.dialogue)
                ]
                if present and not matching_shots:
                    matching_shots = [shot.id for shot in scene.shots]
                if matching_shots:
                    scene_ids.append(scene.id)
                    shot_ids.extend(matching_shots)
            if not shot_ids:
                continue
            ready_reference = next(
                (
                    reference
                    for reference in character.references
                    if reference.is_active
                    and reference.review_status == "approved"
                    and reference.reference_type in {"primary", "front"}
                    and reference.asset_id in assets_by_id
                    and assets_by_id[reference.asset_id].media_type.startswith("image/")
                ),
                None,
            )
            definitions.append(
                RequirementDefinition(
                    canonical_key=f"character:{character.id}",
                    kind="character",
                    name=character.name,
                    description=character.appearance_bible,
                    required=True,
                    status="ready" if ready_reference else "pending",
                    binding_type="character",
                    binding_id=character.id,
                    source_context={"scene_ids": scene_ids, "shot_ids": shot_ids},
                    metadata={"reference_id": ready_reference.id if ready_reference else None},
                )
            )
        for scene in scenes:
            shot_ids = [shot.id for shot in scene.shots]
            bound_assets = [
                binding.library_asset for binding in scene.library_asset_bindings
            ]
            bound_scene = next(
                (item for item in bound_assets if item.kind == "scene"), None
            )
            project_scene = next(
                (
                    item
                    for item in library_assets
                    if item.kind == "scene"
                    and _normalized_name(item.name) == _normalized_name(scene.location)
                ),
                None,
            )
            scene_asset = bound_scene or project_scene
            scene_ready = bool(
                bound_scene
                and bound_scene.media_asset
                and bound_scene.media_asset.media_type.startswith("image/")
            )
            definitions.append(
                RequirementDefinition(
                    canonical_key=f"scene:{scene.id}",
                    kind="scene",
                    name=scene.location,
                    description=scene.summary,
                    required=True,
                    status=(
                        "ready"
                        if scene_ready
                        else "pending" if scene_asset else "missing"
                    ),
                    binding_type="library_asset" if scene_asset else "",
                    binding_id=scene_asset.id if scene_asset else None,
                    source_context={"scene_ids": [scene.id], "shot_ids": shot_ids},
                    metadata={"time_of_day": scene.time_of_day},
                )
            )
            for prop in _prop_values((scene.continuity_state or {}).get("props")):
                bound_prop = next(
                    (
                        item
                        for item in bound_assets
                        if item.kind == "prop"
                        and _normalized_name(item.name) == _normalized_name(prop["name"])
                    ),
                    None,
                )
                project_prop = next(
                    (
                        item
                        for item in library_assets
                        if item.kind == "prop"
                        and _normalized_name(item.name) == _normalized_name(prop["name"])
                    ),
                    None,
                )
                prop_asset = bound_prop or project_prop
                prop_ready = bool(bound_prop and bound_prop.media_asset)
                definitions.append(
                    RequirementDefinition(
                        canonical_key=(
                            f"prop:{scene.id}:{_normalized_name(prop['name'])}"
                        ),
                        kind="prop",
                        name=prop["name"],
                        description=str(prop["metadata"].get("description", "")),
                        required=prop["required"],
                        status=(
                            "ready"
                            if prop_ready
                            else "pending" if prop_asset else "missing"
                        ),
                        binding_type="library_asset" if prop_asset else "",
                        binding_id=prop_asset.id if prop_asset else None,
                        source_context={"scene_ids": [scene.id], "shot_ids": shot_ids},
                        metadata=prop["metadata"],
                    )
                )
        return definitions


def require_image_target_ready(
    session: Session, target_type: str, target_id: str
) -> None:
    if target_type == "shot":
        shot_ids = [target_id]
    elif target_type == "grid_panel":
        shot_ids = [shot_id for shot_id in target_id.split(",") if shot_id]
    else:
        return

    blocked_shots = {}
    service = AssetRequirementService(session)
    for shot_id in shot_ids:
        try:
            readiness = service.shot_readiness(shot_id)
        except CurrentScriptRevisionMissing:
            continue
        if readiness is not None and not readiness["ready"]:
            blocked_shots[shot_id] = readiness["blockers"]
    if blocked_shots:
        raise ShotGenerationNotReady(blocked_shots)
