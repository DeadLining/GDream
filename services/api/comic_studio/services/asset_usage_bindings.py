from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models


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
        invalid_scope = variant.deleted_at is not None
        fallback = usage.state_id is not None and valid_state_id is None
        status = "invalid_scope" if invalid_scope else "fallback" if fallback else "resolved"
        return self._set(
            usage,
            effective_variant_id=variant.id if not invalid_scope else None,
            effective_state_id=valid_state_id,
            binding_status=status,
            binding_updated_at=models.utc_now(),
        )

    def _refresh_all(self, usages: list[models.AssetVariantUsage]) -> bool:
        changed = False
        for usage in usages:
            changed = self.refresh_usage(usage) or changed
        return changed

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
