from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.services.character_3d import Character3DRepresentationService


class AssetUsageBindingService:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def _set(usage: models.AssetVariantUsage, **values) -> bool:
        changed = any(
            key != "binding_updated_at" and getattr(usage, key) != value
            for key, value in values.items()
        )
        if not changed:
            return False
        for key, value in values.items():
            setattr(usage, key, value)
        return changed

    def refresh_usage(self, usage: models.AssetVariantUsage) -> bool:
        variant = self.session.get(models.AssetVariant, usage.variant_id)
        shot = self.session.get(models.Shot, usage.shot_id)
        if variant is None or shot is None:
            return self._set(
                usage,
                effective_variant_id=None,
                effective_state_id=None,
                effective_representation_id=None,
                effective_representation_version=None,
                director_object_id=None,
                binding_status="invalid_scope",
                binding_updated_at=models.utc_now(),
            )

        state = (
            self.session.get(models.AssetVariantState, usage.state_id)
            if usage.state_id
            else None
        )
        valid_state_id = (
            state.id
            if state is not None
            and state.deleted_at is None
            and state.variant_id == variant.id
            else None
        )
        representation = Character3DRepresentationService(
            self.session, Path(".")
        ).resolve(variant.character_id, shot.id)
        stage = self.session.scalar(
            select(models.DirectorStage).where(
                models.DirectorStage.scene_id == shot.scene_id
            )
        )
        stage_objects = (
            list(
                self.session.scalars(
                    select(models.DirectorObject).where(
                        models.DirectorObject.stage_id == stage.id,
                        models.DirectorObject.kind == "character",
                    )
                )
            )
            if stage is not None
            else []
        )
        director_object = next(
            (
                item
                for item in stage_objects
                if item.object_metadata.get("character_id") == variant.character_id
            ),
            None,
        )

        invalid_scope = variant.deleted_at is not None
        fallback = bool(
            (usage.state_id is not None and valid_state_id is None)
            or (
                representation is not None
                and (
                    representation.variant_id != variant.id
                    or representation.state_id != valid_state_id
                )
            )
        )
        if invalid_scope:
            status = "invalid_scope"
        elif representation is None:
            status = "missing_representation"
        elif director_object is None:
            status = "missing_director_object"
        elif fallback:
            status = "fallback"
        else:
            status = "resolved"
        return self._set(
            usage,
            effective_variant_id=(representation.variant_id if representation else None),
            effective_state_id=(representation.state_id if representation else None),
            effective_representation_id=(representation.id if representation else None),
            effective_representation_version=(representation.version if representation else None),
            director_object_id=(director_object.id if director_object else None),
            binding_status=status,
            binding_updated_at=models.utc_now(),
        )

    def _refresh_all(self, usages: list[models.AssetVariantUsage]) -> bool:
        changed = False
        for usage in usages:
            changed = self.refresh_usage(usage) or changed
        return changed

    def refresh_for_stage(self, stage_id: str) -> bool:
        stage = self.session.get(models.DirectorStage, stage_id)
        if stage is None:
            return False
        usages = list(
            self.session.scalars(
                select(models.AssetVariantUsage)
                .join(models.Shot)
                .where(models.Shot.scene_id == stage.scene_id)
            )
        )
        return self._refresh_all(usages)

    def refresh_for_character(self, character_id: str) -> bool:
        usages = list(
            self.session.scalars(
                select(models.AssetVariantUsage)
                .join(
                    models.AssetVariant,
                    models.AssetVariant.id == models.AssetVariantUsage.variant_id,
                )
                .where(models.AssetVariant.character_id == character_id)
            )
        )
        return self._refresh_all(usages)

    def refresh_for_variant(self, variant_id: str) -> bool:
        usages = list(
            self.session.scalars(
                select(models.AssetVariantUsage).where(
                    models.AssetVariantUsage.variant_id == variant_id
                )
            )
        )
        return self._refresh_all(usages)

    def refresh_for_state(self, state_id: str) -> bool:
        usages = list(
            self.session.scalars(
                select(models.AssetVariantUsage).where(
                    models.AssetVariantUsage.state_id == state_id
                )
            )
        )
        return self._refresh_all(usages)
