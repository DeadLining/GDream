from __future__ import annotations

import hashlib
import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.providers.model_3d_base import Model3DResult
from comic_studio.services.character_3d import Character3DRepresentationService


class Model3DGenerationError(ValueError):
    pass


class Model3DGenerationService:
    def __init__(self, session: Session, data_root: Path, provider):
        self.session = session
        self.data_root = data_root.resolve()
        self.provider = provider

    async def generate(
        self,
        target_type: str,
        target_id: str,
        reference_asset_id: str | None = None,
        variant_id: str | None = None,
        state_id: str | None = None,
    ) -> dict:
        reference = self._reference_asset(
            target_type,
            target_id,
            reference_asset_id,
        )
        content = self._read_reference(reference)
        result = await self.provider.generate_model(
            content,
            reference.media_type,
            Path(reference.local_path).name,
        )
        if not isinstance(result, Model3DResult):
            raise Model3DGenerationError("invalid_model3d_result")
        Character3DRepresentationService.inspect_glb(result.content)
        provider_name = str(
            getattr(self.provider, "provider_id", self.provider.__class__.__name__)
        )
        model_name = str(getattr(self.provider, "model", ""))
        if target_type == "character":
            representation = Character3DRepresentationService(
                self.session,
                self.data_root,
            ).upload(
                target_id,
                result.content,
                label="AI 生成 3D 候选",
                activate=False,
                review_status="draft",
                provider=provider_name,
                model=model_name,
                request_metadata={
                    "reference_asset_id": reference.id,
                    "source_url": result.source_url,
                    "generation_kind": "image_to_3d",
                },
                variant_id=variant_id,
                state_id=state_id,
            )
            return {
                "capability": "model3d",
                "target_type": target_type,
                "target_id": target_id,
                "asset_id": representation.asset_id,
                "representation_id": representation.id,
                "variant_id": representation.variant_id,
                "state_id": representation.state_id,
                "model_url": f"/media/{representation.asset.local_path}",
                "review_status": representation.review_status,
                "is_active": representation.is_active,
            }
        candidate = self._save_library_candidate(
            target_id,
            reference,
            result,
            provider_name,
            model_name,
        )
        return {
            "capability": "model3d",
            "target_type": target_type,
            "target_id": target_id,
            "asset_id": candidate.id,
            "model_url": f"/media/{candidate.local_path}",
            "review_status": candidate.review_status,
            "is_active": False,
        }

    def _reference_asset(
        self,
        target_type: str,
        target_id: str,
        reference_asset_id: str | None,
    ) -> models.Asset:
        if target_type == "character":
            character = self.session.get(models.Character, target_id)
            if character is None:
                raise KeyError(target_id)
            statement = (
                select(models.CharacterReference)
                .where(
                    models.CharacterReference.character_id == target_id,
                    models.CharacterReference.review_status == "approved",
                )
                .order_by(
                    models.CharacterReference.is_active.desc(),
                    models.CharacterReference.created_at.desc(),
                )
            )
            if reference_asset_id:
                statement = statement.where(
                    models.CharacterReference.asset_id == reference_asset_id
                )
            reference = self.session.scalar(statement.limit(1))
            if reference is None:
                raise Model3DGenerationError(
                    "approved_character_reference_required"
                )
            asset = self.session.get(models.Asset, reference.asset_id)
        elif target_type == "library_asset":
            library_asset = self.session.get(models.LibraryAsset, target_id)
            if library_asset is None:
                raise KeyError(target_id)
            if library_asset.kind not in {"prop", "scene"}:
                raise Model3DGenerationError("library_asset_does_not_support_model3d")
            candidate_id = reference_asset_id or str(
                library_asset.asset_metadata.get("reference_asset_id") or ""
            ) or library_asset.media_asset_id
            asset = self.session.get(models.Asset, candidate_id) if candidate_id else None
            if asset is None or asset.project_id != library_asset.project_id:
                raise Model3DGenerationError("library_reference_required")
        else:
            raise Model3DGenerationError("unsupported_model3d_target")
        if asset is None or not asset.media_type.startswith("image/"):
            raise Model3DGenerationError("model3d_reference_must_be_image")
        return asset

    def _read_reference(self, asset: models.Asset) -> bytes:
        source = (self.data_root / asset.local_path).resolve()
        if self.data_root not in source.parents or not source.is_file():
            raise Model3DGenerationError("model3d_reference_missing")
        content = source.read_bytes()
        if not content or len(content) > 15 * 1024 * 1024:
            raise Model3DGenerationError("model3d_reference_invalid")
        return content

    def _save_library_candidate(
        self,
        library_asset_id: str,
        reference: models.Asset,
        result: Model3DResult,
        provider_name: str,
        model_name: str,
    ) -> models.Asset:
        library_asset = self.session.get(models.LibraryAsset, library_asset_id)
        if library_asset is None:
            raise KeyError(library_asset_id)
        attempt = (
            self.session.scalar(
                select(func.count(models.Asset.id)).where(
                    models.Asset.kind == "library-asset-model-candidate",
                    models.Asset.project_id == library_asset.project_id,
                )
            )
            or 0
        ) + 1
        candidate = models.Asset(
            project_id=library_asset.project_id,
            kind="library-asset-model-candidate",
            local_path="",
            media_type="model/gltf-binary",
            provider=provider_name,
            model=model_name,
            request_metadata={
                "library_asset_id": library_asset.id,
                "reference_asset_id": reference.id,
                "source_url": result.source_url,
                "generation_kind": "image_to_3d",
            },
            parent_asset_id=reference.id,
            generation_attempt=attempt,
            checksum=hashlib.sha256(result.content).hexdigest(),
            review_status="draft",
        )
        self.session.add(candidate)
        self.session.flush()
        relative = (
            Path("projects")
            / library_asset.project_id
            / "library-assets"
            / library_asset.id
            / "3d-candidates"
            / f"{candidate.id}.glb"
        )
        destination = (self.data_root / relative).resolve()
        if self.data_root not in destination.parents:
            raise Model3DGenerationError("asset_path_escape")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".glb.tmp")
        temporary.write_bytes(result.content)
        os.replace(temporary, destination)
        candidate.local_path = str(relative)
        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            destination.unlink(missing_ok=True)
            raise
        self.session.refresh(candidate)
        return candidate

    @staticmethod
    def approve(session: Session, target_type: str, target_id: str, metadata: dict) -> dict:
        if target_type == "character":
            representation_id = str(metadata.get("representation_id") or "")
            representation = session.get(
                models.Character3DRepresentation,
                representation_id,
            )
            if representation is None or representation.character_id != target_id:
                raise KeyError(representation_id)
            representation = Character3DRepresentationService(
                session,
                Path("."),
            ).activate(representation.id)
            return {
                **metadata,
                "review_status": representation.review_status,
                "is_active": representation.is_active,
            }
        if target_type == "library_asset":
            library_asset = session.get(models.LibraryAsset, target_id)
            candidate = session.get(models.Asset, str(metadata.get("asset_id") or ""))
            if library_asset is None or candidate is None:
                raise KeyError(target_id)
            if candidate.request_metadata.get("library_asset_id") != library_asset.id:
                raise KeyError(candidate.id)
            if candidate.media_type != "model/gltf-binary":
                raise Model3DGenerationError("invalid_model3d_candidate")
            reference_id = candidate.request_metadata.get("reference_asset_id")
            library_asset.asset_metadata = {
                **library_asset.asset_metadata,
                "reference_asset_id": reference_id,
            }
            library_asset.media_asset_id = candidate.id
            candidate.review_status = "approved"
            session.commit()
            return {
                **metadata,
                "review_status": "approved",
                "is_active": True,
            }
        raise Model3DGenerationError("unsupported_model3d_target")
