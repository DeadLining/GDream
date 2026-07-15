from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, with_loader_criteria

from comic_studio import models, schemas
from comic_studio.services.asset_usage_bindings import AssetUsageBindingService


class AssetLineageReferenceError(ValueError):
    pass


class AssetLineageConflictError(RuntimeError):
    pass


class AssetLineageService:
    def __init__(self, session: Session):
        self.session = session

    def create_variant(self, character_id: str, data: schemas.AssetVariantCreate):
        character = self.session.get(models.Character, character_id)
        if character is None:
            return None
        self._validate_variant(character, data)
        variant = models.AssetVariant(
            character_id=character.id, review_status="draft", **data.model_dump()
        )
        self.session.add(variant)
        self.session.commit()
        self.session.refresh(variant)
        return variant

    def _validate_variant(
        self,
        character: models.Character,
        data: schemas.AssetVariantCreate,
        current_id: str | None = None,
    ) -> None:
        if data.episode_id:
            episode = self.session.get(models.Episode, data.episode_id)
            if episode is None or episode.project_id != character.project_id:
                raise AssetLineageReferenceError(
                    "Episode must belong to the character project"
                )
        if data.parent_variant_id:
            parent = self.session.get(models.AssetVariant, data.parent_variant_id)
            if parent is None or parent.character_id != character.id:
                raise AssetLineageReferenceError(
                    "Parent variant must belong to the same character"
                )
            ancestor = parent
            while ancestor is not None:
                if ancestor.id == current_id:
                    raise AssetLineageReferenceError(
                        "Variant inheritance cycle is not allowed"
                    )
                ancestor = (
                    self.session.get(models.AssetVariant, ancestor.parent_variant_id)
                    if ancestor.parent_variant_id
                    else None
                )
        if data.kind == "master" and (data.episode_id or data.parent_variant_id):
            raise AssetLineageReferenceError(
                "Master variant cannot have an episode or parent"
            )

    def update_variant(self, variant_id: str, data: schemas.AssetVariantPatch):
        variant = self.session.get(models.AssetVariant, variant_id)
        if variant is None or variant.deleted_at is not None:
            return None
        character = self.session.get(models.Character, variant.character_id)
        current = {
            "kind": variant.kind,
            "label": variant.label,
            "episode_id": variant.episode_id,
            "parent_variant_id": variant.parent_variant_id,
            "inherited_fields": variant.inherited_fields,
            "overrides": variant.overrides,
        }
        merged = schemas.AssetVariantCreate.model_validate(
            {**current, **data.model_dump(exclude_unset=True)}
        )
        self._validate_variant(character, merged, current_id=variant.id)
        changed = any(getattr(variant, key) != value for key, value in merged.model_dump().items())
        if changed:
            for key, value in merged.model_dump().items():
                setattr(variant, key, value)
            variant.version += 1
            AssetUsageBindingService(self.session).refresh_for_variant(variant.id)
            self.session.commit()
            self.session.refresh(variant)
        return variant

    def list_variants(self, character_id: str):
        if self.session.get(models.Character, character_id) is None:
            return None
        statement = (
            select(models.AssetVariant)
            .options(
                selectinload(models.AssetVariant.states),
                selectinload(models.AssetVariant.usages),
                with_loader_criteria(
                    models.AssetVariantState,
                    models.AssetVariantState.deleted_at.is_(None),
                ),
            )
            .where(
                models.AssetVariant.character_id == character_id,
                models.AssetVariant.deleted_at.is_(None),
            )
            .order_by(models.AssetVariant.created_at, models.AssetVariant.id)
        )
        return list(self.session.scalars(statement))

    def create_state(
        self, variant_id: str, data: schemas.AssetVariantStateCreate
    ):
        variant = self.session.get(models.AssetVariant, variant_id)
        if variant is None or variant.deleted_at is not None:
            return None
        state = models.AssetVariantState(variant_id=variant.id, **data.model_dump())
        self.session.add(state)
        self.session.commit()
        self.session.refresh(state)
        return state

    def update_state(self, state_id: str, data: schemas.AssetVariantStatePatch):
        state = self.session.get(models.AssetVariantState, state_id)
        if state is None or state.deleted_at is not None:
            return None
        current = {
            "kind": state.kind,
            "label": state.label,
            "overrides": state.overrides,
        }
        merged = schemas.AssetVariantStateCreate.model_validate(
            {**current, **data.model_dump(exclude_unset=True)}
        )
        changed = any(getattr(state, key) != value for key, value in merged.model_dump().items())
        if changed:
            for key, value in merged.model_dump().items():
                setattr(state, key, value)
            state.version += 1
            AssetUsageBindingService(self.session).refresh_for_state(state.id)
            self.session.commit()
            self.session.refresh(state)
        return state

    def create_usage(
        self, variant_id: str, data: schemas.AssetVariantUsageCreate
    ):
        variant = self.session.get(models.AssetVariant, variant_id)
        if variant is None or variant.deleted_at is not None:
            return None
        character = self.session.get(models.Character, variant.character_id)
        shot = self.session.get(models.Shot, data.shot_id)
        if shot is None or shot.scene.episode.project_id != character.project_id:
            raise AssetLineageReferenceError(
                "Shot must belong to the character project"
            )
        if variant.episode_id and variant.episode_id != shot.scene.episode_id:
            raise AssetLineageReferenceError(
                "Episode variant must belong to the shot episode"
            )
        if data.state_id:
            state = self.session.get(models.AssetVariantState, data.state_id)
            if state is None or state.deleted_at is not None or state.variant_id != variant.id:
                raise AssetLineageReferenceError(
                    "State must belong to the selected variant"
                )
        if data.asset_id:
            asset = self.session.get(models.Asset, data.asset_id)
            if asset is None or asset.project_id != character.project_id:
                raise AssetLineageReferenceError(
                    "Asset must belong to the character project"
                )
        usage = models.AssetVariantUsage(variant_id=variant.id, **data.model_dump())
        self.session.add(usage)
        try:
            self.session.flush()
            AssetUsageBindingService(self.session).refresh_usage(usage)
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise AssetLineageConflictError("usage") from exc
        self.session.refresh(usage)
        return usage

    def impact(self, variant_id: str):
        variant = self.session.get(models.AssetVariant, variant_id)
        if variant is None:
            return None
        statement = select(models.AssetVariantUsage).where(
            models.AssetVariantUsage.variant_id == variant.id
        )
        usages = list(self.session.scalars(statement))
        return schemas.AssetVariantImpactRead(
            shots=sorted({usage.shot_id for usage in usages}),
            assets=sorted({usage.asset_id for usage in usages if usage.asset_id}),
            usage_count=len(usages),
        )
