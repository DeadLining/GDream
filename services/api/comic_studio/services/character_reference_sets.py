from __future__ import annotations

from comic_studio import models
from comic_studio.providers.base import ProviderHTTPError
from comic_studio.services.character_references import CharacterReferenceService


REFERENCE_SET_TYPES = (
    "primary",
    "front",
    "three_quarter",
    "side",
    "back",
    "expression",
    "outfit",
)

REFERENCE_LABELS = {
    "primary": "主参考",
    "front": "正面",
    "three_quarter": "四分之三",
    "side": "侧面",
    "back": "背面",
    "expression": "表情",
    "outfit": "服装",
}


class CharacterReferenceSetError(RuntimeError):
    def __init__(self, metadata: dict, cause: Exception):
        super().__init__(str(cause))
        self.metadata = metadata
        self.__cause__ = cause


class CharacterReferenceSetService:
    def __init__(self, session, data_root):
        self.session = session
        self.references = CharacterReferenceService(session, data_root)

    def _load_resume_anchor(self, character_id: str, resume: dict):
        reference_id = str(resume.get("anchor_reference_id", ""))
        asset_id = str(resume.get("anchor_asset_id", ""))
        if not reference_id or not asset_id:
            return None
        reference = self.session.get(models.CharacterReference, reference_id)
        asset = self.session.get(models.Asset, asset_id)
        if (
            reference is None
            or asset is None
            or reference.character_id != character_id
            or reference.asset_id != asset.id
        ):
            return None
        return reference, asset

    @staticmethod
    def _snapshot(
        completed: list[str],
        references: dict,
        anchor,
        current_type: str | None,
        *,
        failed: bool = False,
    ) -> dict:
        result = {
            "capability": "image",
            "mode": "reference_set",
            "current_type": current_type,
            "current_index": len(completed),
            "total": len(REFERENCE_SET_TYPES),
            "completed_types": list(completed),
            "references": dict(references),
            "anchor_reference_id": anchor[0].id,
            "anchor_asset_id": anchor[1].id,
        }
        if failed:
            result["failed_type"] = current_type
        return result

    async def generate(
        self,
        character_id: str,
        provider,
        *,
        on_progress,
        resume: dict,
    ) -> dict:
        if self.session.get(models.Character, character_id) is None:
            raise KeyError(character_id)
        completed = [
            item
            for item in resume.get("completed_types", [])
            if item in REFERENCE_SET_TYPES
        ]
        generated_references = dict(resume.get("references", {}))
        anchor = self._load_resume_anchor(character_id, resume)
        if anchor is None:
            anchor = self.references.find_identity_anchor(character_id)
        if anchor is None:
            reference, asset = await self.references.generate_primary(
                character_id,
                "primary",
                REFERENCE_LABELS["primary"],
                provider,
            )
            self.references.approve_and_activate(character_id, reference.id)
            anchor = (reference, asset)
            if "primary" not in completed:
                completed.append("primary")
            generated_references["primary"] = {
                "reference_id": reference.id,
                "asset_id": asset.id,
            }
        elif "primary" not in completed:
            completed.append("primary")
            generated_references["primary"] = {
                "reference_id": anchor[0].id,
                "asset_id": anchor[1].id,
                "reused": True,
            }
        await on_progress(
            self._snapshot(
                completed,
                generated_references,
                anchor,
                next(
                    (item for item in REFERENCE_SET_TYPES if item not in completed),
                    None,
                ),
            )
        )
        anchor_fallback_used = False
        for reference_type in REFERENCE_SET_TYPES[1:]:
            if reference_type in completed:
                continue
            while True:
                try:
                    reference, asset = await self.references.generate_from_anchor(
                        character_id,
                        reference_type,
                        REFERENCE_LABELS[reference_type],
                        provider,
                        *anchor,
                    )
                    break
                except Exception as error:
                    reused_primary = bool(
                        generated_references.get("primary", {}).get("reused")
                    )
                    can_replace_anchor = (
                        not anchor_fallback_used
                        and reused_primary
                        and completed == ["primary"]
                        and reference_type == "front"
                        and isinstance(error, ProviderHTTPError)
                        and error.status_code == 400
                    )
                    if can_replace_anchor:
                        reference, asset = await self.references.generate_primary(
                            character_id,
                            "primary",
                            REFERENCE_LABELS["primary"],
                            provider,
                        )
                        self.references.approve_and_activate(
                            character_id, reference.id
                        )
                        anchor = (reference, asset)
                        generated_references["primary"] = {
                            "reference_id": reference.id,
                            "asset_id": asset.id,
                        }
                        anchor_fallback_used = True
                        await on_progress(
                            self._snapshot(
                                completed,
                                generated_references,
                                anchor,
                                reference_type,
                            )
                        )
                        continue
                    metadata = self._snapshot(
                        completed,
                        generated_references,
                        anchor,
                        reference_type,
                        failed=True,
                    )
                    raise CharacterReferenceSetError(metadata, error) from error
            completed.append(reference_type)
            generated_references[reference_type] = {
                "reference_id": reference.id,
                "asset_id": asset.id,
            }
            await on_progress(
                self._snapshot(
                    completed,
                    generated_references,
                    anchor,
                    next(
                        (item for item in REFERENCE_SET_TYPES if item not in completed),
                        None,
                    ),
                )
            )
        return self._snapshot(
            completed, generated_references, anchor, None
        )
