from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from comic_studio import models, schemas


class DuplicateLibraryAssetError(RuntimeError):
    pass


class LibraryAssetSceneProjectMismatchError(RuntimeError):
    pass


class LibraryAssetService:
    def __init__(self, session: Session):
        self.session = session

    def list(
        self,
        project_id: str,
        *,
        kind: schemas.LibraryAssetKind | None = None,
        query: str = "",
    ):
        if self.session.get(models.Project, project_id) is None:
            return None
        statement = select(models.LibraryAsset).where(
            models.LibraryAsset.project_id == project_id
        )
        if kind is not None:
            statement = statement.where(models.LibraryAsset.kind == kind)
        normalized = query.strip()
        if normalized:
            pattern = f"%{normalized}%"
            statement = statement.where(
                or_(
                    models.LibraryAsset.name.ilike(pattern),
                    models.LibraryAsset.description.ilike(pattern),
                )
            )
        return list(
            self.session.scalars(
                statement.order_by(
                    models.LibraryAsset.created_at, models.LibraryAsset.id
                )
            )
        )

    def create(self, project_id: str, data: schemas.LibraryAssetCreate):
        if self.session.get(models.Project, project_id) is None:
            return None
        payload = data.model_dump()
        metadata = payload.pop("metadata")
        asset = models.LibraryAsset(
            project_id=project_id, asset_metadata=metadata, **payload
        )
        self.session.add(asset)
        self._commit()
        self.session.refresh(asset)
        return asset

    def update(self, asset_id: str, data: schemas.LibraryAssetPatch):
        asset = self.session.get(models.LibraryAsset, asset_id)
        if asset is None:
            return None
        payload = data.model_dump(exclude_unset=True)
        if "metadata" in payload:
            asset.asset_metadata = payload.pop("metadata")
        for key, value in payload.items():
            setattr(asset, key, value)
        self._commit()
        self.session.refresh(asset)
        return asset

    def delete(self, asset_id: str) -> bool:
        asset = self.session.get(models.LibraryAsset, asset_id)
        if asset is None:
            return False
        self.session.delete(asset)
        self.session.commit()
        return True

    def list_for_scene(self, scene_id: str):
        if self.session.get(models.Scene, scene_id) is None:
            return None
        return list(
            self.session.scalars(
                select(models.LibraryAsset)
                .join(models.LibraryAssetSceneBinding)
                .where(models.LibraryAssetSceneBinding.scene_id == scene_id)
                .order_by(
                    models.LibraryAssetSceneBinding.created_at,
                    models.LibraryAssetSceneBinding.id,
                )
            )
        )

    def bind_to_scene(self, scene_id: str, asset_id: str) -> bool:
        scene = self.session.get(models.Scene, scene_id)
        asset = self.session.get(models.LibraryAsset, asset_id)
        if scene is None or asset is None:
            return False
        if scene.episode.project_id != asset.project_id:
            raise LibraryAssetSceneProjectMismatchError
        existing = self.session.scalar(
            select(models.LibraryAssetSceneBinding).where(
                models.LibraryAssetSceneBinding.scene_id == scene_id,
                models.LibraryAssetSceneBinding.library_asset_id == asset_id,
            )
        )
        if existing is None:
            self.session.add(
                models.LibraryAssetSceneBinding(
                    scene_id=scene_id, library_asset_id=asset_id
                )
            )
            self.session.commit()
        return True

    def unbind_from_scene(self, scene_id: str, asset_id: str) -> bool:
        scene = self.session.get(models.Scene, scene_id)
        asset = self.session.get(models.LibraryAsset, asset_id)
        if scene is None or asset is None:
            return False
        if scene.episode.project_id != asset.project_id:
            raise LibraryAssetSceneProjectMismatchError
        binding = self.session.scalar(
            select(models.LibraryAssetSceneBinding).where(
                models.LibraryAssetSceneBinding.scene_id == scene_id,
                models.LibraryAssetSceneBinding.library_asset_id == asset_id,
            )
        )
        if binding is not None:
            self.session.delete(binding)
            self.session.commit()
        return True

    def _commit(self) -> None:
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicateLibraryAssetError from exc
