from __future__ import annotations

import hashlib
import os
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from comic_studio import models, schemas


MAX_REFERENCE_BYTES = 15 * 1024 * 1024
FORMATS = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
}


class CharacterReferenceError(ValueError):
    pass


class CharacterReferenceService:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    def upload(
        self, character_id: str, content: bytes, reference_type: str, label: str = ""
    ):
        character = self.session.get(models.Character, character_id)
        if character is None:
            raise KeyError(character_id)
        if len(content) > MAX_REFERENCE_BYTES:
            raise CharacterReferenceError("image_too_large")
        try:
            with Image.open(BytesIO(content)) as image:
                image.load()
                format_name = image.format or ""
                width, height = image.size
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise CharacterReferenceError("invalid_image") from exc
        if format_name not in FORMATS:
            raise CharacterReferenceError("unsupported_image_format")
        media_type, extension = FORMATS[format_name]
        attempt = (
            self.session.scalar(
                select(func.count(models.Asset.id)).where(
                    models.Asset.project_id == character.project_id,
                    models.Asset.kind
                    == f"character-reference:{character_id}:{reference_type}",
                )
            )
            or 0
        )
        asset = models.Asset(
            project_id=character.project_id,
            kind=f"character-reference:{character_id}:{reference_type}",
            local_path="",
            media_type=media_type,
            provider="upload",
            model="local",
            request_metadata={},
            generation_attempt=attempt + 1,
            checksum=hashlib.sha256(content).hexdigest(),
            width=width,
            height=height,
        )
        self.session.add(asset)
        self.session.flush()
        relative = (
            Path("projects")
            / character.project_id
            / "characters"
            / character_id
            / reference_type
            / f"{asset.id}{extension}"
        )
        destination = (self.data_root / relative).resolve()
        if self.data_root not in destination.parents:
            raise CharacterReferenceError("asset_path_escape")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(content)
        os.replace(temporary, destination)
        asset.local_path = str(relative)
        reference = models.CharacterReference(
            character_id=character_id,
            asset_id=asset.id,
            reference_type=reference_type,
            label=label.strip(),
            position=attempt,
        )
        self.session.add(reference)
        self.session.commit()
        self.session.refresh(reference)
        return reference, asset

    def list(self, character_id: str):
        if self.session.get(models.Character, character_id) is None:
            raise KeyError(character_id)
        refs = list(
            self.session.scalars(
                select(models.CharacterReference)
                .where(models.CharacterReference.character_id == character_id)
                .order_by(
                    models.CharacterReference.reference_type,
                    models.CharacterReference.position.desc(),
                    models.CharacterReference.created_at.desc(),
                )
            )
        )
        return [(ref, self.session.get(models.Asset, ref.asset_id)) for ref in refs]

    def patch(self, reference_id: str, data: schemas.CharacterReferencePatch):
        reference = self.session.get(models.CharacterReference, reference_id)
        if reference is None:
            raise KeyError(reference_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(reference, field, value)
        self.session.commit()
        self.session.refresh(reference)
        return reference

    def activate(self, character_id: str, reference_id: str):
        reference = self.session.get(models.CharacterReference, reference_id)
        if reference is None or reference.character_id != character_id:
            raise KeyError(reference_id)
        if reference.review_status != "approved":
            raise CharacterReferenceError("reference_not_approved")
        self.session.execute(
            update(models.CharacterReference)
            .where(
                models.CharacterReference.character_id == character_id,
                models.CharacterReference.reference_type == reference.reference_type,
            )
            .values(is_active=False)
        )
        reference.is_active = True
        self.session.commit()
        self.session.refresh(reference)
        return reference

    def delete(self, reference_id: str):
        reference = self.session.get(models.CharacterReference, reference_id)
        if reference is None:
            raise KeyError(reference_id)
        if reference.is_active:
            raise CharacterReferenceError("active_reference_cannot_be_deleted")
        asset = self.session.get(models.Asset, reference.asset_id)
        asset_path = (self.data_root / asset.local_path).resolve() if asset else None
        self.session.delete(reference)
        self.session.flush()
        remaining = (
            self.session.scalar(
                select(func.count(models.CharacterReference.id)).where(
                    models.CharacterReference.asset_id == reference.asset_id
                )
            )
            or 0
        )
        if asset is not None and remaining == 0:
            self.session.delete(asset)
        self.session.commit()
        if asset_path is not None and self.data_root in asset_path.parents:
            asset_path.unlink(missing_ok=True)

    async def generate(
        self, character_id: str, reference_type: str, label: str, provider
    ):
        character = self.session.get(models.Character, character_id)
        if character is None:
            raise KeyError(character_id)
        if reference_type in {"primary", "front"}:
            return await self.generate_primary(
                character_id, reference_type, label, provider
            )
        anchor = self.find_identity_anchor(character_id)
        if anchor is None:
            raise CharacterReferenceError("approved_primary_reference_required")
        return await self.generate_from_anchor(
            character_id, reference_type, label, provider, *anchor
        )

    @staticmethod
    def _prompt(character: models.Character, reference_type: str) -> str:
        return (
            "Create a clean production reference image for an original, legally "
            "distinct cartoon character used in a vertical animated comic. Use "
            "the supplied image only as a loose visual continuity reference. "
            "If it resembles an existing copyrighted or trademarked character, "
            "transform the protected character-specific expression into a clearly "
            "different design. Do not reproduce a copyrighted character exactly. "
            "Keep the redesigned face, hairstyle, age, body proportions, costume "
            "construction, palette, accessories, and distinctive internal details "
            "consistent across this reference set. "
            f"Narrative role: {character.role}. "
            f"Appearance bible: {character.appearance_bible}. "
            f"Continuity rules: {character.continuity_rules}. "
            f"Forbidden changes: {character.negative_constraints or 'none'}. "
            f"Reference view: {reference_type}. Full body, plain neutral "
            "background, no text."
        )

    def find_identity_anchor(self, character_id: str):
        if self.session.get(models.Character, character_id) is None:
            raise KeyError(character_id)
        reference = self.session.scalar(
            select(models.CharacterReference)
            .where(
                models.CharacterReference.character_id == character_id,
                models.CharacterReference.reference_type.in_({"primary", "front"}),
                models.CharacterReference.is_active.is_(True),
                models.CharacterReference.review_status == "approved",
            )
            .order_by(models.CharacterReference.reference_type.desc())
        )
        if reference is None:
            return None
        asset = self.session.get(models.Asset, reference.asset_id)
        if asset is None:
            raise CharacterReferenceError("anchor_asset_missing")
        return reference, asset

    def approve_and_activate(self, character_id: str, reference_id: str):
        reference = self.session.get(models.CharacterReference, reference_id)
        if reference is None or reference.character_id != character_id:
            raise KeyError(reference_id)
        reference.review_status = "approved"
        self.session.commit()
        return self.activate(character_id, reference_id)

    async def generate_primary(
        self,
        character_id: str,
        reference_type: str,
        label: str,
        provider,
    ):
        character = self.session.get(models.Character, character_id)
        if character is None:
            raise KeyError(character_id)
        prompt = self._prompt(character, reference_type)
        result = await provider.generate(prompt, "1024x1536", quality="auto")
        reference, asset = self.upload(
            character_id, result.content, reference_type, label
        )
        asset.provider = "gpt-image"
        asset.model = provider.model
        asset.request_metadata = {"prompt": prompt, "parent_asset_id": None}
        self.session.commit()
        return reference, asset

    async def generate_from_anchor(
        self,
        character_id: str,
        reference_type: str,
        label: str,
        provider,
        anchor_reference: models.CharacterReference,
        anchor_asset: models.Asset,
    ):
        character = self.session.get(models.Character, character_id)
        if character is None:
            raise KeyError(character_id)
        if (
            anchor_reference.character_id != character_id
            or anchor_reference.asset_id != anchor_asset.id
        ):
            raise CharacterReferenceError("invalid_identity_anchor")
        prompt = self._prompt(character, reference_type)
        path = (self.data_root / anchor_asset.local_path).resolve()
        if self.data_root not in path.parents:
            raise CharacterReferenceError("asset_path_escape")
        result = await provider.edit(
            prompt,
            [(path.read_bytes(), anchor_asset.media_type)],
            "768x1024",
            quality="low",
        )
        reference, asset = self.upload(
            character_id, result.content, reference_type, label
        )
        asset.provider = "gpt-image"
        asset.model = provider.model
        asset.parent_asset_id = anchor_asset.id
        asset.request_metadata = {
            "prompt": prompt,
            "parent_asset_id": anchor_asset.id,
        }
        self.session.commit()
        return reference, asset
