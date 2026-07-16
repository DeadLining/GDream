from __future__ import annotations

import hashlib
from io import BytesIO
import os
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.providers.model_3d_base import Model3DResult
from comic_studio.services.character_3d import Character3DRepresentationService


class Model3DGenerationError(ValueError):
    pass


class Model3DGenerationService:
    CHARACTER_VIEW_ORDER = {
        "primary": 0,
        "front": 1,
        "three_quarter": 2,
        "side": 3,
        "back": 4,
    }
    MAX_CHARACTER_VIEWS = 4
    CONTACT_SHEET_SIZE = (1024, 1536)
    CONTACT_SHEET_COLUMNS = 2

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
        reference_asset_ids: list[str] | None = None,
    ) -> dict:
        references = self._reference_assets(
            target_type,
            target_id,
            reference_asset_id,
            reference_asset_ids or [],
        )
        content, media_type, filename, input_mode = self._provider_input(references)
        result = await self.provider.generate_model(
            content,
            media_type,
            filename,
        )
        if not isinstance(result, Model3DResult):
            raise Model3DGenerationError("invalid_model3d_result")
        Character3DRepresentationService.inspect_glb(result.content)
        provider_name = str(
            getattr(self.provider, "provider_id", self.provider.__class__.__name__)
        )
        model_name = str(getattr(self.provider, "model", ""))
        reference_ids = [asset.id for _reference, asset in references]
        reference_types = [
            reference.reference_type
            for reference, _asset in references
            if reference is not None
        ]
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
                    "reference_asset_id": reference_ids[0],
                    "reference_asset_ids": reference_ids,
                    "reference_types": reference_types,
                    "reference_input_mode": input_mode,
                    "reference_input_checksum": hashlib.sha256(content).hexdigest(),
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
            references[0][1],
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

    def _reference_assets(
        self,
        target_type: str,
        target_id: str,
        reference_asset_id: str | None,
        reference_asset_ids: list[str],
    ) -> list[tuple[models.CharacterReference | None, models.Asset]]:
        if target_type == "character":
            character = self.session.get(models.Character, target_id)
            if character is None:
                raise KeyError(target_id)
            requested_ids = list(dict.fromkeys(reference_asset_ids))
            if reference_asset_id and reference_asset_id not in requested_ids:
                requested_ids.insert(0, reference_asset_id)
            if len(requested_ids) > self.MAX_CHARACTER_VIEWS:
                raise Model3DGenerationError("too_many_character_reference_views")
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
            if requested_ids:
                statement = statement.where(
                    models.CharacterReference.asset_id.in_(requested_ids)
                )
                references = list(self.session.scalars(statement))
                if len(references) != len(requested_ids):
                    error = (
                        "approved_character_reference_required"
                        if len(requested_ids) == 1 and not reference_asset_ids
                        else "approved_character_references_required"
                    )
                    raise Model3DGenerationError(error)
                references.sort(
                    key=lambda item: (
                        self.CHARACTER_VIEW_ORDER.get(item.reference_type, 99),
                        item.created_at,
                        item.id,
                    )
                )
            else:
                reference = self.session.scalar(statement.limit(1))
                references = [reference] if reference is not None else []
            if not references:
                raise Model3DGenerationError(
                    "approved_character_reference_required"
                )
            result = []
            for reference in references:
                asset = self.session.get(models.Asset, reference.asset_id)
                if (
                    asset is None
                    or asset.project_id != character.project_id
                    or not asset.media_type.startswith("image/")
                ):
                    raise Model3DGenerationError("model3d_reference_must_be_image")
                result.append((reference, asset))
            return result
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
        return [(None, asset)]

    def _read_reference(self, asset: models.Asset) -> bytes:
        source = (self.data_root / asset.local_path).resolve()
        if self.data_root not in source.parents or not source.is_file():
            raise Model3DGenerationError("model3d_reference_missing")
        content = source.read_bytes()
        if not content or len(content) > 15 * 1024 * 1024:
            raise Model3DGenerationError("model3d_reference_invalid")
        return content

    def _provider_input(
        self,
        references: list[tuple[models.CharacterReference | None, models.Asset]],
    ) -> tuple[bytes, str, str, str]:
        if len(references) == 1:
            asset = references[0][1]
            return (
                self._read_reference(asset),
                asset.media_type,
                Path(asset.local_path).name,
                "single_reference",
            )
        sheet = Image.new("RGB", self.CONTACT_SHEET_SIZE, "white")
        cell_width = self.CONTACT_SHEET_SIZE[0] // self.CONTACT_SHEET_COLUMNS
        cell_height = self.CONTACT_SHEET_SIZE[1] // 2
        margin = 16
        for index, (_reference, asset) in enumerate(references):
            try:
                with Image.open(BytesIO(self._read_reference(asset))) as source:
                    rgba = source.convert("RGBA")
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                raise Model3DGenerationError("model3d_reference_invalid") from exc
            tile = Image.new(
                "RGBA",
                (cell_width - margin * 2, cell_height - margin * 2),
                "white",
            )
            fitted = ImageOps.contain(rgba, tile.size)
            tile.alpha_composite(
                fitted,
                ((tile.width - fitted.width) // 2, (tile.height - fitted.height) // 2),
            )
            x = (index % self.CONTACT_SHEET_COLUMNS) * cell_width + margin
            y = (index // self.CONTACT_SHEET_COLUMNS) * cell_height + margin
            sheet.paste(tile.convert("RGB"), (x, y))
        output = BytesIO()
        sheet.save(output, format="PNG", optimize=False, compress_level=9)
        return (
            output.getvalue(),
            "image/png",
            "character-multi-view.png",
            "multi_view_contact_sheet",
        )

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
