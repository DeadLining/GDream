from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models


class ShotInputReferenceError(ValueError):
    pass


def _canonical_snapshot_value(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _canonical_snapshot_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical_snapshot_value(item) for item in value]
    return value


@dataclass(frozen=True)
class CompiledShotInput:
    snapshot: dict[str, Any]
    prompt_constraints: str
    character_ids: frozenset[str]
    reference_asset_ids: tuple[str, ...]

    @property
    def snapshot_hash(self) -> str:
        canonical = json.dumps(
            _canonical_snapshot_value(self.snapshot),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()


class ShotInputCompiler:
    """Resolve authoritative shot inputs into a reproducible generation snapshot."""

    def __init__(self, session: Session):
        self.session = session

    def compile(
        self, shot_id: str, *, usage_kinds: Iterable[str]
    ) -> CompiledShotInput:
        shot = self.session.scalar(
            select(models.Shot)
            .options(
                selectinload(models.Shot.scene)
                .selectinload(models.Scene.episode)
                .selectinload(models.Episode.project)
                .selectinload(models.Project.characters),
                selectinload(models.Shot.dialogue),
            )
            .where(models.Shot.id == shot_id)
        )
        if shot is None:
            raise KeyError(shot_id)
        project = shot.scene.episode.project
        allowed_kinds = tuple(sorted(set(usage_kinds)))
        usages = list(
            self.session.scalars(
                select(models.AssetVariantUsage)
                .where(
                    models.AssetVariantUsage.shot_id == shot.id,
                    models.AssetVariantUsage.usage_kind.in_(allowed_kinds),
                )
                .order_by(
                    models.AssetVariantUsage.created_at,
                    models.AssetVariantUsage.id,
                )
            )
        )
        bindings: list[dict[str, Any]] = []
        prompt_lines: list[str] = []
        character_ids: set[str] = set()
        reference_asset_ids: list[str] = []
        for usage in usages:
            variant = self.session.get(models.AssetVariant, usage.variant_id)
            if variant is None or variant.deleted_at is not None:
                raise ShotInputReferenceError("Bound asset variant is unavailable")
            character = self.session.get(models.Character, variant.character_id)
            if character is None or character.project_id != project.id:
                raise ShotInputReferenceError(
                    "Bound asset variant must belong to the shot project"
                )
            if variant.episode_id and variant.episode_id != shot.scene.episode_id:
                raise ShotInputReferenceError(
                    "Bound episode variant must belong to the shot episode"
                )
            state = None
            if usage.state_id:
                state = self.session.get(models.AssetVariantState, usage.state_id)
                if (
                    state is None
                    or state.deleted_at is not None
                    or state.variant_id != variant.id
                ):
                    raise ShotInputReferenceError(
                        "Bound state must belong to the selected variant"
                    )
            reference_asset = None
            if usage.asset_id:
                reference_asset = self.session.get(models.Asset, usage.asset_id)
                if reference_asset is None or reference_asset.project_id != project.id:
                    raise ShotInputReferenceError(
                        "Bound reference asset must belong to the shot project"
                    )
                if usage.usage_kind in {"panel", "reference"} and not reference_asset.media_type.startswith("image/"):
                    raise ShotInputReferenceError(
                        "Panel reference asset must be an image"
                    )
                reference_asset_ids.append(reference_asset.id)
            lineage = self._variant_lineage(variant, character.id)
            resolved_overrides: dict[str, Any] = {}
            for item in lineage:
                resolved_overrides.update(item.overrides)
            if state is not None:
                resolved_overrides.update(state.overrides)
            binding = {
                "usage_id": usage.id,
                "usage_kind": usage.usage_kind,
                "character_id": character.id,
                "character_name": character.name,
                "variant_id": variant.id,
                "variant_version": variant.version,
                "variant_label": variant.label,
                "variant_review_status": variant.review_status,
                "variant_lineage": [
                    {
                        "id": item.id,
                        "version": item.version,
                        "label": item.label,
                        "kind": item.kind,
                        "overrides": item.overrides,
                    }
                    for item in lineage
                ],
                "state_id": state.id if state is not None else None,
                "state_version": state.version if state is not None else None,
                "state_label": state.label if state is not None else None,
                "state_kind": state.kind if state is not None else None,
                "state_overrides": state.overrides if state is not None else {},
                "resolved_overrides": resolved_overrides,
                "reference_asset_id": reference_asset.id if reference_asset else None,
                "effective_variant_id": usage.effective_variant_id,
                "effective_state_id": usage.effective_state_id,
                "binding_status": usage.binding_status,
                "binding_updated_at": (
                    usage.binding_updated_at.isoformat()
                    if usage.binding_updated_at is not None
                    else None
                ),
            }
            bindings.append(binding)
            character_ids.add(character.id)
            scope = f" / {state.label}" if state is not None else ""
            prompt_lines.append(
                f"- {character.name}: {variant.label}{scope}; "
                f"{self._format_mapping(resolved_overrides)}"
            )

        library_assets = list(
            self.session.scalars(
                select(models.LibraryAsset)
                .join(models.LibraryAssetSceneBinding)
                .where(models.LibraryAssetSceneBinding.scene_id == shot.scene_id)
                .order_by(
                    models.LibraryAssetSceneBinding.created_at,
                    models.LibraryAssetSceneBinding.id,
                )
            )
        )
        if "video" not in allowed_kinds:
            library_assets = [item for item in library_assets if item.kind != "sound"]
        library_media: dict[str, models.Asset | None] = {}
        for item in library_assets:
            media = (
                self.session.get(models.Asset, item.media_asset_id)
                if item.media_asset_id
                else None
            )
            if item.media_asset_id and (
                media is None or media.project_id != project.id
            ):
                raise ShotInputReferenceError(
                    "Bound library asset media must belong to the shot project"
                )
            library_media[item.id] = media
            if (
                media is not None
                and item.kind in {"scene", "prop", "costume"}
                and media.media_type.startswith("image/")
            ):
                reference_asset_ids.append(media.id)
        library_asset_snapshot = [
            {
                "id": item.id,
                "kind": item.kind,
                "name": item.name,
                "description": item.description,
                "tags": item.tags,
                "metadata": item.asset_metadata,
                "media_asset_id": item.media_asset_id,
                "media_type": (
                    library_media[item.id].media_type
                    if library_media[item.id] is not None
                    else None
                ),
            }
            for item in library_assets
        ]
        for item in library_assets:
            details = [item.description.strip()]
            tags = ", ".join(str(tag) for tag in item.tags if str(tag).strip())
            if tags:
                details.append(f"tags {tags}")
            suffix = "; " + "; ".join(part for part in details if part) if any(details) else ""
            prompt_lines.append(
                f"- Bound {item.kind} asset: {item.name}{suffix}"
            )

        prompt_constraints = (
            "Bound production inputs:\n" + "\n".join(prompt_lines)
            if prompt_lines
            else ""
        )
        snapshot = {
            "version": 1,
            "project_id": project.id,
            "episode_id": shot.scene.episode_id,
            "scene_id": shot.scene_id,
            "shot_id": shot.id,
            "usage_kinds": list(allowed_kinds),
            "scene": {
                "location": shot.scene.location,
                "time_of_day": shot.scene.time_of_day,
                "summary": shot.scene.summary,
                "continuity_state": shot.scene.continuity_state,
            },
            "shot": {
                "position": shot.position,
                "duration_seconds": shot.duration_seconds,
                "composition": shot.composition,
                "camera_motion": shot.camera_motion,
                "image_prompt": shot.image_prompt,
                "negative_prompt": shot.negative_prompt,
                "video_prompt": shot.video_prompt,
                "negative_video_prompt": shot.negative_video_prompt,
            },
            "asset_bindings": bindings,
            "library_assets": library_asset_snapshot,
            "reference_asset_ids": list(dict.fromkeys(reference_asset_ids)),
        }
        return CompiledShotInput(
            snapshot=snapshot,
            prompt_constraints=prompt_constraints,
            character_ids=frozenset(character_ids),
            reference_asset_ids=tuple(dict.fromkeys(reference_asset_ids)),
        )

    def _variant_lineage(
        self, variant: models.AssetVariant, character_id: str
    ) -> list[models.AssetVariant]:
        lineage: list[models.AssetVariant] = []
        seen: set[str] = set()
        current: models.AssetVariant | None = variant
        while current is not None:
            if current.id in seen:
                raise ShotInputReferenceError("Asset variant inheritance cycle detected")
            if current.character_id != character_id or current.deleted_at is not None:
                raise ShotInputReferenceError(
                    "Asset variant lineage must stay within one character"
                )
            seen.add(current.id)
            lineage.append(current)
            current = (
                self.session.get(models.AssetVariant, current.parent_variant_id)
                if current.parent_variant_id
                else None
            )
        lineage.reverse()
        return lineage

    @classmethod
    def _format_mapping(cls, value: dict[str, Any]) -> str:
        if not value:
            return "no overrides"
        rendered = ", ".join(
            f"{key}={cls._format_value(item)}" for key, item in sorted(value.items())
        )
        return rendered[:4000]

    @staticmethod
    def _format_value(value: Any) -> str:
        if isinstance(value, str):
            return value[:1000]
        return json.dumps(value, ensure_ascii=False, sort_keys=True)[:1000]
