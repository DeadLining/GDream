from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas


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
        episode = models.Episode(project_id=project_id, **data.model_dump())
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
                .selectinload(models.Shot.dialogue)
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
