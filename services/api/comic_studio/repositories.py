from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.services.narrative import next_unassigned_episode_position


def patch_resource(session: Session, model_type, resource_id: str, data):
    resource = session.get(model_type, resource_id)
    if resource is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(resource, field, value)
    session.commit()
    session.refresh(resource)
    return resource


class ProjectRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, data: schemas.ProjectCreate) -> models.Project:
        project = models.Project(**data.model_dump())
        self.session.add(project)
        self.session.commit()
        self.session.refresh(project)
        return project

    def list(self) -> list[models.Project]:
        statement = select(models.Project).order_by(models.Project.updated_at.desc())
        return list(self.session.scalars(statement))

    def get(self, project_id: str) -> models.Project | None:
        statement = (
            select(models.Project)
            .options(
                selectinload(models.Project.characters),
                selectinload(models.Project.episodes),
            )
            .where(models.Project.id == project_id)
        )
        return self.session.scalar(statement)

    def overview_metrics(
        self, project_id: str
    ) -> schemas.ProjectOverviewMetrics | None:
        if self.session.get(models.Project, project_id) is None:
            return None
        scene_count = self.session.scalar(
            select(func.count(models.Scene.id))
            .select_from(models.Scene)
            .join(models.Episode, models.Scene.episode_id == models.Episode.id)
            .where(models.Episode.project_id == project_id)
        ) or 0
        current_script_status = self.session.scalar(
            select(models.ScriptRevision.status)
            .select_from(models.ScriptDocument)
            .join(
                models.ScriptRevision,
                models.ScriptRevision.id == models.ScriptDocument.current_revision_id,
            )
            .where(models.ScriptDocument.project_id == project_id)
        )
        character_total = self.session.scalar(
            select(func.count(models.Character.id)).where(
                models.Character.project_id == project_id
            )
        ) or 0
        ready_characters = self.session.scalar(
            select(func.count(func.distinct(models.Character.id)))
            .select_from(models.Character)
            .join(
                models.CharacterReference,
                models.CharacterReference.character_id == models.Character.id,
            )
            .where(
                models.Character.project_id == project_id,
                models.CharacterReference.is_active.is_(True),
                models.CharacterReference.review_status == "approved",
            )
        ) or 0
        library_asset_total = self.session.scalar(
            select(func.count(models.LibraryAsset.id)).where(
                models.LibraryAsset.project_id == project_id
            )
        ) or 0
        ready_library_assets = self.session.scalar(
            select(func.count(models.LibraryAsset.id)).where(
                models.LibraryAsset.project_id == project_id,
                models.LibraryAsset.media_asset_id.is_not(None),
            )
        ) or 0
        return schemas.ProjectOverviewMetrics(
            project_id=project_id,
            scene_count=scene_count,
            script_locked=current_script_status == "finalized",
            asset_total=character_total + library_asset_total,
            asset_ready=ready_characters + ready_library_assets,
        )

    def create_character(
        self, project_id: str, data: schemas.CharacterCreate
    ) -> models.Character | None:
        project = self.session.get(models.Project, project_id)
        if project is None:
            return None
        character = models.Character(project_id=project_id, **data.model_dump())
        self.session.add(character)
        self.session.commit()
        self.session.refresh(character)
        return character

    def update(self, project_id: str, data: schemas.ProjectPatch):
        return patch_resource(self.session, models.Project, project_id, data)

    def update_character(self, character_id: str, data: schemas.CharacterPatch):
        return patch_resource(self.session, models.Character, character_id, data)


class EpisodeRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self, project_id: str, data: schemas.EpisodeCreate
    ) -> models.Episode | None:
        if self.session.get(models.Project, project_id) is None:
            return None
        episode = models.Episode(
            project_id=project_id,
            position=next_unassigned_episode_position(self.session, project_id),
            **data.model_dump(),
        )
        self.session.add(episode)
        self.session.commit()
        self.session.refresh(episode)
        return episode

    def get(self, episode_id: str) -> models.Episode | None:
        statement = (
            select(models.Episode)
            .options(
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue),
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.library_asset_bindings)
                .selectinload(models.LibraryAssetSceneBinding.library_asset)
                .selectinload(models.LibraryAsset.media_asset),
            )
            .where(models.Episode.id == episode_id)
        )
        return self.session.scalar(statement)

    def update(self, episode_id: str, data: schemas.EpisodePatch):
        return patch_resource(self.session, models.Episode, episode_id, data)

    def update_shot(self, shot_id: str, data: schemas.ShotPatch):
        return patch_resource(self.session, models.Shot, shot_id, data)

    def update_dialogue(self, dialogue_id: str, data: schemas.DialoguePatch):
        return patch_resource(self.session, models.DialogueLine, dialogue_id, data)
