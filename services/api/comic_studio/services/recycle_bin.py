from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models, schemas


class RecycleBinConflictError(RuntimeError):
    pass


class RecycleBinService:
    def __init__(self, session: Session):
        self.session = session

    def _variant_project(self, variant: models.AssetVariant) -> str:
        character = self.session.get(models.Character, variant.character_id)
        if character is None:
            raise KeyError(variant.character_id)
        return character.project_id

    def _variant_lineage(self, variant: models.AssetVariant) -> list[str]:
        lineage = [variant.label]
        parent_id = variant.parent_variant_id
        seen = {variant.id}
        while parent_id and parent_id not in seen:
            seen.add(parent_id)
            parent = self.session.get(models.AssetVariant, parent_id)
            if parent is None:
                break
            lineage.insert(0, parent.label)
            parent_id = parent.parent_variant_id
        return lineage

    def soft_delete_variant(self, variant_id: str, actor: str = "林默") -> bool:
        variant = self.session.get(models.AssetVariant, variant_id)
        if variant is None or variant.deleted_at is not None:
            return False
        now = models.utc_now()
        lineage = self._variant_lineage(variant)
        variant.deleted_at = now
        variant.deleted_by = actor
        self.session.add(
            models.TrashItem(
                project_id=self._variant_project(variant),
                resource_type="asset_variant",
                resource_id=variant.id,
                name=variant.label,
                original_location=lineage,
                lineage=lineage,
                deleted_by=actor,
                deleted_at=now,
                expires_at=now + timedelta(days=30),
            )
        )
        self.session.commit()
        return True

    def soft_delete_state(self, state_id: str, actor: str = "林默") -> bool:
        state = self.session.get(models.AssetVariantState, state_id)
        if state is None or state.deleted_at is not None:
            return False
        variant = self.session.get(models.AssetVariant, state.variant_id)
        if variant is None:
            return False
        now = models.utc_now()
        lineage = [*self._variant_lineage(variant), state.label]
        state.deleted_at = now
        state.deleted_by = actor
        self.session.add(
            models.TrashItem(
                project_id=self._variant_project(variant),
                resource_type="asset_variant_state",
                resource_id=state.id,
                name=state.label,
                original_location=lineage,
                lineage=lineage,
                deleted_by=actor,
                deleted_at=now,
                expires_at=now + timedelta(days=30),
            )
        )
        self.session.commit()
        return True

    def _reference_count(self, item: models.TrashItem) -> int:
        if item.resource_type == "asset_variant_state":
            return int(
                self.session.scalar(
                    select(func.count(models.AssetVariantUsage.id)).where(
                        models.AssetVariantUsage.state_id == item.resource_id
                    )
                )
                or 0
            )
        return int(
            self.session.scalar(
                select(func.count(models.AssetVariantUsage.id)).where(
                    models.AssetVariantUsage.variant_id == item.resource_id
                )
            )
            or 0
        )

    def _blocking_dependency_count(self, item: models.TrashItem) -> int:
        usage_count = self._reference_count(item)
        if item.resource_type == "asset_variant_state":
            return usage_count
        child_count = int(
            self.session.scalar(
                select(func.count(models.AssetVariant.id)).where(
                    models.AssetVariant.parent_variant_id == item.resource_id
                )
            )
            or 0
        )
        state_count = int(
            self.session.scalar(
                select(func.count(models.AssetVariantState.id)).where(
                    models.AssetVariantState.variant_id == item.resource_id
                )
            )
            or 0
        )
        return usage_count + child_count + state_count

    def _read(self, item: models.TrashItem) -> schemas.TrashItemRead:
        references = self._reference_count(item)
        return schemas.TrashItemRead(
            id=item.id,
            project_id=item.project_id,
            resource_type=item.resource_type,
            resource_id=item.resource_id,
            name=item.name,
            original_location=item.original_location,
            lineage=item.lineage,
            deleted_by=item.deleted_by,
            deleted_at=item.deleted_at,
            expires_at=item.expires_at,
            reference_count=references,
            can_permanently_delete=self._blocking_dependency_count(item) == 0,
        )

    def list_for_project(self, project_id: str):
        if self.session.get(models.Project, project_id) is None:
            return None
        items = self.session.scalars(
            select(models.TrashItem)
            .where(models.TrashItem.project_id == project_id)
            .order_by(models.TrashItem.deleted_at.desc())
        )
        return [self._read(item) for item in items]

    def restore(self, item_id: str):
        item = self.session.get(models.TrashItem, item_id)
        if item is None:
            return None
        if item.resource_type == "asset_variant":
            resource = self.session.get(models.AssetVariant, item.resource_id)
        else:
            resource = self.session.get(models.AssetVariantState, item.resource_id)
            if resource is not None:
                parent = self.session.get(models.AssetVariant, resource.variant_id)
                if parent is None or parent.deleted_at is not None:
                    raise RecycleBinConflictError("Parent resource must be restored first")
        if resource is None:
            self.session.delete(item)
            self.session.commit()
            return None
        resource.deleted_at = None
        resource.deleted_by = ""
        self.session.delete(item)
        self.session.commit()
        return schemas.TrashRestoreRead(
            restored=True,
            resource_type=item.resource_type,
            resource_id=item.resource_id,
        )

    def permanently_delete(self, item_id: str) -> bool:
        item = self.session.get(models.TrashItem, item_id)
        if item is None:
            return False
        if self._blocking_dependency_count(item):
            raise RecycleBinConflictError("Resource still has downstream references")
        resource = (
            self.session.get(models.AssetVariant, item.resource_id)
            if item.resource_type == "asset_variant"
            else self.session.get(models.AssetVariantState, item.resource_id)
        )
        if resource is not None:
            self.session.delete(resource)
        self.session.delete(item)
        self.session.commit()
        return True
