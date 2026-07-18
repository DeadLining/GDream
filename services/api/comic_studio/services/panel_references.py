from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.services.shot_inputs import CompiledShotInput


PanelReferenceRole = Literal[
    "previous_shot_tail",
    "director_preview",
    "director_guidance",
    "character_reference",
    "bound_asset",
]


@dataclass(frozen=True)
class PanelGenerationReference:
    asset: models.Asset
    role: PanelReferenceRole
    label: str
    guidance_kind: str | None = None


CHARACTER_REFERENCE_LABELS = {
    "primary": "主参考图",
    "front": "正面参考图",
    "outfit": "服装参考图",
}
DIRECTOR_GUIDANCE_LABELS = {
    "silhouette": "轮廓引导",
    "skeleton_pose": "骨架引导",
    "depth": "深度引导",
    "object_mask": "对象遮罩",
}
LIBRARY_ASSET_KIND_LABELS = {
    "scene": "场景背景",
    "prop": "道具",
    "costume": "服装",
    "sound": "音效",
}


def resolve_panel_generation_references(
    session: Session,
    shot: models.Shot,
    compiled: CompiledShotInput,
    *,
    require_character_references: bool = True,
    max_non_tail_references: int = 24,
) -> list[PanelGenerationReference]:
    references: list[PanelGenerationReference] = []
    tail_asset = (
        session.get(models.Asset, shot.previous_shot_tail_asset_id)
        if shot.previous_shot_tail_asset_id
        else None
    )
    if tail_asset is not None:
        references.append(
            PanelGenerationReference(
                tail_asset, "previous_shot_tail", "上一镜尾帧"
            )
        )

    non_tail: list[PanelGenerationReference] = []
    if compiled.director_preview_asset_id:
        asset = session.get(models.Asset, compiled.director_preview_asset_id)
        if asset is not None:
            non_tail.append(
                PanelGenerationReference(
                    asset,
                    "director_preview",
                    f"镜头 {shot.position:02d} · 3D 导演构图",
                )
            )
    for guidance_kind, asset_id in compiled.director_guidance_asset_ids:
        asset = session.get(models.Asset, asset_id)
        if asset is not None:
            non_tail.append(
                PanelGenerationReference(
                    asset,
                    "director_guidance",
                    f"镜头 {shot.position:02d} · "
                    f"{DIRECTOR_GUIDANCE_LABELS.get(guidance_kind, '3D 导演引导')}",
                    guidance_kind=guidance_kind,
                )
            )

    director_character_ids = [
        item.get("source_id")
        for item in compiled.snapshot.get("director", {}).get("objects", [])
        if item.get("kind") == "character"
        and item.get("source_type") == "character_reference"
        and isinstance(item.get("source_id"), str)
    ]
    character_ids = list(
        dict.fromkeys(
            [
                *(key for key in shot.character_state if isinstance(key, str)),
                *(
                    line.character_id
                    for line in shot.dialogue
                    if line.character_id is not None
                ),
                *sorted(compiled.character_ids),
                *director_character_ids,
            ]
        )
    )
    if character_ids:
        character_references = list(
            session.scalars(
                select(models.CharacterReference)
                .where(
                    models.CharacterReference.character_id.in_(character_ids),
                    models.CharacterReference.is_active.is_(True),
                    models.CharacterReference.review_status == "approved",
                )
                .order_by(
                    models.CharacterReference.created_at,
                    models.CharacterReference.id,
                )
            )
        )
        by_character: dict[str, list[models.CharacterReference]] = {}
        for reference in character_references:
            by_character.setdefault(reference.character_id, []).append(reference)
        for character_id in character_ids:
            character = session.get(models.Character, character_id)
            candidates = by_character.get(character_id, [])
            identity = next(
                (
                    item
                    for kind in ("primary", "front")
                    for item in candidates
                    if item.reference_type == kind
                ),
                None,
            )
            if identity is None:
                if require_character_references:
                    raise ValueError(f"missing_character_reference:{character_id}")
                continue
            selected = [identity]
            outfit = next(
                (item for item in candidates if item.reference_type == "outfit"),
                None,
            )
            if outfit is not None:
                selected.append(outfit)
            for reference in selected:
                asset = session.get(models.Asset, reference.asset_id)
                if asset is not None:
                    character_name = character.name if character is not None else "角色"
                    reference_label = CHARACTER_REFERENCE_LABELS.get(
                        reference.reference_type, reference.label or "参考图"
                    )
                    non_tail.append(
                        PanelGenerationReference(
                            asset,
                            "character_reference",
                            f"{character_name} · {reference_label}",
                        )
                    )

    seen_asset_ids = {item.asset.id for item in non_tail}
    library_asset_labels = {
        item["media_asset_id"]: (
            f"{item['name']} · "
            f"{LIBRARY_ASSET_KIND_LABELS.get(item['kind'], item['kind'])}"
        )
        for item in compiled.snapshot.get("library_assets", [])
        if item.get("media_asset_id")
    }
    binding_labels = {
        item["reference_asset_id"]: " · ".join(
            part
            for part in (
                item.get("character_name"),
                item.get("variant_label"),
                item.get("state_label"),
            )
            if part
        )
        for item in compiled.snapshot.get("asset_bindings", [])
        if item.get("reference_asset_id")
    }
    for asset_id in compiled.reference_asset_ids:
        asset = session.get(models.Asset, asset_id)
        if asset is not None and asset.id not in seen_asset_ids:
            non_tail.append(
                PanelGenerationReference(
                    asset,
                    "bound_asset",
                    library_asset_labels.get(asset.id)
                    or binding_labels.get(asset.id)
                    or "绑定素材",
                )
            )
            seen_asset_ids.add(asset.id)

    references.extend(non_tail[:max_non_tail_references])
    return references
