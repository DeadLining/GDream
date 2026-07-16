from __future__ import annotations

import hashlib
import json
import math
import os
import struct
from pathlib import Path
from typing import Any

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session, selectinload

from comic_studio import models


class Character3DRepresentationError(ValueError):
    pass


class Character3DRepresentationService:
    MAX_BYTES = 50 * 1024 * 1024
    MAX_NODES = 1000
    MAX_MESHES = 200
    MAX_MATERIALS = 200
    MAX_TRIANGLES = 2_000_000
    MAX_SKINS = 64
    MAX_JOINTS = 1024
    MAX_ANIMATIONS = 256
    MAX_ANIMATION_CHANNELS = 4096
    JSON_CHUNK = 0x4E4F534A

    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    def list(self, character_id: str):
        if self.session.get(models.Character, character_id) is None:
            raise KeyError(character_id)
        return list(
            self.session.scalars(
                select(models.Character3DRepresentation)
                .options(selectinload(models.Character3DRepresentation.asset))
                .where(models.Character3DRepresentation.character_id == character_id)
                .order_by(models.Character3DRepresentation.version.desc())
            )
        )

    def upload(
        self,
        character_id: str,
        content: bytes,
        *,
        label: str = "",
        activate: bool = True,
        review_status: str = "approved",
        provider: str = "upload",
        model: str = "local-glb",
        request_metadata: dict[str, Any] | None = None,
        variant_id: str | None = None,
        state_id: str | None = None,
    ):
        character = self.session.get(models.Character, character_id)
        if character is None:
            raise KeyError(character_id)
        variant_id, state_id = self._validate_scope(
            character_id,
            variant_id,
            state_id,
        )
        metrics = self.inspect_glb(content)
        version = (
            self.session.scalar(
                select(func.max(models.Character3DRepresentation.version)).where(
                    models.Character3DRepresentation.character_id == character_id
                )
            )
            or 0
        ) + 1
        asset = models.Asset(
            project_id=character.project_id,
            kind=f"character-3d:{character_id}",
            local_path="",
            media_type="model/gltf-binary",
            provider=provider,
            model=model,
            request_metadata={
                **(request_metadata or {}),
                "character_id": character_id,
                "format": "glb",
                "variant_id": variant_id,
                "state_id": state_id,
            },
            generation_attempt=version,
            checksum=hashlib.sha256(content).hexdigest(),
            review_status=review_status,
        )
        self.session.add(asset)
        self.session.flush()
        relative = (
            Path("projects")
            / character.project_id
            / "characters"
            / character_id
            / "3d"
            / f"{asset.id}.glb"
        )
        destination = (self.data_root / relative).resolve()
        if self.data_root not in destination.parents:
            raise Character3DRepresentationError("asset_path_escape")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".glb.tmp")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
            asset.local_path = str(relative)
            if activate:
                self.session.execute(
                    update(models.Character3DRepresentation)
                    .where(*self._scope_filters(character_id, variant_id, state_id))
                    .values(is_active=False)
                )
            representation = models.Character3DRepresentation(
                character_id=character_id,
                variant_id=variant_id,
                state_id=state_id,
                asset_id=asset.id,
                label=label.strip()[:160] or f"{character.name} 3D 代理 V{version}",
                format="glb",
                version=version,
                is_active=activate,
                review_status=review_status,
                **metrics,
            )
            self.session.add(representation)
            if activate:
                from comic_studio.services.asset_usage_bindings import (
                    AssetUsageBindingService,
                )

                AssetUsageBindingService(self.session).refresh_for_character(
                    character_id
                )
            self.session.commit()
        except Exception:
            self.session.rollback()
            temporary.unlink(missing_ok=True)
            destination.unlink(missing_ok=True)
            raise
        return self.get(representation.id)

    def activate(self, representation_id: str):
        representation = self.get(representation_id)
        self.session.execute(
            update(models.Character3DRepresentation)
            .where(
                *self._scope_filters(
                    representation.character_id,
                    representation.variant_id,
                    representation.state_id,
                )
            )
            .values(is_active=False)
        )
        representation.is_active = True
        representation.review_status = "approved"
        representation.asset.review_status = "approved"
        from comic_studio.services.asset_usage_bindings import AssetUsageBindingService

        AssetUsageBindingService(self.session).refresh_for_character(
            representation.character_id
        )
        self.session.commit()
        return self.get(representation.id)

    def resolve(self, character_id: str, shot_id: str | None = None):
        if self.session.get(models.Character, character_id) is None:
            raise KeyError(character_id)
        variant_id: str | None = None
        state_id: str | None = None
        if shot_id:
            shot = self.session.get(models.Shot, shot_id)
            if shot is None:
                raise KeyError(shot_id)
            usage = self.session.scalar(
                select(models.AssetVariantUsage)
                .join(
                    models.AssetVariant,
                    models.AssetVariant.id == models.AssetVariantUsage.variant_id,
                )
                .where(
                    models.AssetVariantUsage.shot_id == shot_id,
                    models.AssetVariant.character_id == character_id,
                    models.AssetVariant.deleted_at.is_(None),
                )
                .order_by(
                    case(
                        (models.AssetVariantUsage.usage_kind == "reference", 0),
                        (models.AssetVariantUsage.usage_kind == "panel", 1),
                        (models.AssetVariantUsage.usage_kind == "video", 2),
                        else_=3,
                    ),
                    models.AssetVariantUsage.created_at.desc(),
                )
                .limit(1)
            )
            if usage is not None:
                variant_id = usage.variant_id
                state_id = (
                    usage.state_id
                    if usage.state is not None and usage.state.deleted_at is None
                    else None
                )
            else:
                variant_id = self.session.scalar(
                    select(models.AssetVariant.id)
                    .where(
                        models.AssetVariant.character_id == character_id,
                        models.AssetVariant.episode_id == shot.scene.episode_id,
                        models.AssetVariant.deleted_at.is_(None),
                    )
                    .order_by(
                        models.AssetVariant.updated_at.desc(),
                        models.AssetVariant.id.desc(),
                    )
                    .limit(1)
                )
        scopes = (
            [(variant_id, state_id), (variant_id, None)]
            if variant_id
            else []
        )
        scopes.append((None, None))
        for scope_variant_id, scope_state_id in dict.fromkeys(scopes):
            representation = self.session.scalar(
                select(models.Character3DRepresentation)
                .options(selectinload(models.Character3DRepresentation.asset))
                .where(
                    *self._scope_filters(
                        character_id,
                        scope_variant_id,
                        scope_state_id,
                    ),
                    models.Character3DRepresentation.is_active.is_(True),
                    models.Character3DRepresentation.review_status == "approved",
                )
                .order_by(models.Character3DRepresentation.version.desc())
                .limit(1)
            )
            if representation is not None:
                return representation
        return None

    def _validate_scope(
        self,
        character_id: str,
        variant_id: str | None,
        state_id: str | None,
    ) -> tuple[str | None, str | None]:
        variant = self.session.get(models.AssetVariant, variant_id) if variant_id else None
        state = self.session.get(models.AssetVariantState, state_id) if state_id else None
        if state is not None:
            if state.deleted_at is not None:
                raise Character3DRepresentationError("representation_state_not_available")
            if variant is None:
                variant = self.session.get(models.AssetVariant, state.variant_id)
                variant_id = state.variant_id
            elif state.variant_id != variant.id:
                raise Character3DRepresentationError("representation_state_variant_mismatch")
        if variant_id and (
            variant is None
            or variant.deleted_at is not None
            or variant.character_id != character_id
        ):
            raise Character3DRepresentationError("representation_variant_not_available")
        if state_id and state is None:
            raise Character3DRepresentationError("representation_state_not_available")
        return variant_id, state_id

    @staticmethod
    def _scope_filters(
        character_id: str,
        variant_id: str | None,
        state_id: str | None,
    ) -> tuple:
        representation = models.Character3DRepresentation
        return (
            representation.character_id == character_id,
            representation.variant_id == variant_id
            if variant_id
            else representation.variant_id.is_(None),
            representation.state_id == state_id
            if state_id
            else representation.state_id.is_(None),
        )

    @classmethod
    def inspect_glb(cls, content: bytes) -> dict[str, Any]:
        return cls._metrics(cls._validate_glb(content))

    def get(self, representation_id: str):
        representation = self.session.scalar(
            select(models.Character3DRepresentation)
            .options(selectinload(models.Character3DRepresentation.asset))
            .where(models.Character3DRepresentation.id == representation_id)
        )
        if representation is None:
            raise KeyError(representation_id)
        return representation

    @classmethod
    def _validate_glb(cls, content: bytes) -> dict[str, Any]:
        if not content:
            raise Character3DRepresentationError("empty_glb")
        if len(content) > cls.MAX_BYTES:
            raise Character3DRepresentationError("glb_too_large")
        if len(content) < 20:
            raise Character3DRepresentationError("invalid_glb")
        magic, version, total_length = struct.unpack_from("<4sII", content, 0)
        if magic != b"glTF" or version != 2 or total_length != len(content):
            raise Character3DRepresentationError("invalid_glb")
        offset = 12
        document = None
        while offset + 8 <= len(content):
            chunk_length, chunk_type = struct.unpack_from("<II", content, offset)
            offset += 8
            end = offset + chunk_length
            if end > len(content):
                raise Character3DRepresentationError("invalid_glb")
            if chunk_type == cls.JSON_CHUNK and document is None:
                try:
                    document = json.loads(content[offset:end].rstrip(b"\x00 ").decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise Character3DRepresentationError("invalid_glb_json") from exc
            offset = end
        if offset != len(content) or not isinstance(document, dict):
            raise Character3DRepresentationError("invalid_glb")
        if str(document.get("asset", {}).get("version")) != "2.0":
            raise Character3DRepresentationError("unsupported_glb_version")
        resources = [*document.get("buffers", []), *document.get("images", [])]
        if any(isinstance(item, dict) and item.get("uri") for item in resources):
            raise Character3DRepresentationError("glb_external_resources_not_allowed")
        return document

    @classmethod
    def _metrics(cls, document: dict[str, Any]) -> dict[str, Any]:
        nodes = document.get("nodes", [])
        meshes = document.get("meshes", [])
        materials = document.get("materials", [])
        accessors = document.get("accessors", [])
        skins = document.get("skins", [])
        animations = document.get("animations", [])
        if len(nodes) > cls.MAX_NODES or len(meshes) > cls.MAX_MESHES:
            raise Character3DRepresentationError("glb_too_complex")
        if (
            len(materials) > cls.MAX_MATERIALS
            or len(skins) > cls.MAX_SKINS
            or len(animations) > cls.MAX_ANIMATIONS
        ):
            raise Character3DRepresentationError("glb_too_complex")
        triangle_count = 0
        bounds_min: list[float] | None = None
        bounds_max: list[float] | None = None
        for mesh in meshes:
            for primitive in mesh.get("primitives", []) if isinstance(mesh, dict) else []:
                accessor_index = primitive.get("indices")
                if isinstance(accessor_index, int) and accessor_index < len(accessors):
                    triangle_count += int(accessors[accessor_index].get("count", 0)) // 3
                position_index = primitive.get("attributes", {}).get("POSITION")
                if isinstance(position_index, int) and position_index < len(accessors):
                    accessor = accessors[position_index]
                    minimum, maximum = accessor.get("min"), accessor.get("max")
                    if (
                        isinstance(minimum, list)
                        and isinstance(maximum, list)
                        and len(minimum) == 3
                        and len(maximum) == 3
                    ):
                        bounds_min = minimum if bounds_min is None else [min(a, b) for a, b in zip(bounds_min, minimum)]
                        bounds_max = maximum if bounds_max is None else [max(a, b) for a, b in zip(bounds_max, maximum)]
        if triangle_count > cls.MAX_TRIANGLES:
            raise Character3DRepresentationError("glb_too_complex")
        skeletons: list[dict[str, Any]] = []
        joint_indexes: set[int] = set()
        for skin_index, skin in enumerate(skins):
            if not isinstance(skin, dict):
                continue
            raw_joints = skin.get("joints", [])
            if not isinstance(raw_joints, list) or len(raw_joints) > cls.MAX_JOINTS:
                raise Character3DRepresentationError("glb_too_complex")
            skin_joint_indexes = cls._valid_indexes(raw_joints, len(nodes))
            joint_indexes.update(skin_joint_indexes)
            skeletons.append(
                {
                    "name": cls._label(skin.get("name"), f"Skeleton {skin_index + 1}"),
                    "root": cls._node_name(nodes, skin.get("skeleton")),
                    "joint_count": len(skin_joint_indexes),
                    "joints": [cls._node_name(nodes, index) for index in skin_joint_indexes],
                }
            )
        if len(joint_indexes) > cls.MAX_JOINTS:
            raise Character3DRepresentationError("glb_too_complex")
        animation_clips: list[dict[str, Any]] = []
        for animation_index, animation in enumerate(animations):
            if not isinstance(animation, dict):
                continue
            channels = animation.get("channels", [])
            samplers = animation.get("samplers", [])
            if not isinstance(channels, list) or len(channels) > cls.MAX_ANIMATION_CHANNELS:
                raise Character3DRepresentationError("glb_too_complex")
            if not isinstance(samplers, list):
                samplers = []
            duration = 0.0
            for sampler in samplers:
                if not isinstance(sampler, dict):
                    continue
                accessor_index = sampler.get("input")
                if not cls._valid_index(accessor_index, len(accessors)):
                    continue
                accessor = accessors[accessor_index]
                maximum = accessor.get("max", []) if isinstance(accessor, dict) else []
                if (
                    isinstance(maximum, list)
                    and maximum
                    and isinstance(maximum[0], (int, float))
                    and not isinstance(maximum[0], bool)
                    and math.isfinite(maximum[0])
                ):
                    duration = max(duration, float(maximum[0]))
            target_nodes: list[str] = []
            target_paths: list[str] = []
            for channel in channels:
                target = channel.get("target", {}) if isinstance(channel, dict) else {}
                if not isinstance(target, dict):
                    continue
                node_name = cls._node_name(nodes, target.get("node"))
                if node_name and node_name not in target_nodes:
                    target_nodes.append(node_name)
                path = cls._label(target.get("path"), "")
                if path and path not in target_paths:
                    target_paths.append(path)
            animation_clips.append(
                {
                    "name": cls._label(
                        animation.get("name"), f"Animation {animation_index + 1}"
                    ),
                    "duration_seconds": duration,
                    "channel_count": len(channels),
                    "target_nodes": target_nodes,
                    "target_paths": target_paths,
                }
            )
        bounds = {"min": bounds_min, "max": bounds_max} if bounds_min and bounds_max else {}
        return {
            "bounds": bounds,
            "mesh_count": len(meshes),
            "triangle_count": triangle_count,
            "material_count": len(materials),
            "has_skeleton": bool(skins),
            "representation_metadata": {
                "node_count": len(nodes),
                "animation_count": len(animations),
                "skin_count": len(skins),
                "joint_count": len(joint_indexes),
                "skeletons": skeletons,
                "animation_clips": animation_clips,
            },
        }

    @staticmethod
    def _label(value: Any, fallback: str) -> str:
        return value.strip()[:160] if isinstance(value, str) and value.strip() else fallback

    @staticmethod
    def _valid_index(value: Any, length: int) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < length

    @classmethod
    def _valid_indexes(cls, values: list[Any], length: int) -> list[int]:
        return list(dict.fromkeys(value for value in values if cls._valid_index(value, length)))

    @classmethod
    def _node_name(cls, nodes: list[Any], index: Any) -> str:
        if not cls._valid_index(index, len(nodes)):
            return ""
        node = nodes[index]
        name = node.get("name") if isinstance(node, dict) else None
        return cls._label(name, f"Node {index}")
