from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas


class DuplicatePositionError(RuntimeError):
    pass


class NarrativeReferenceError(ValueError):
    pass


class NarrativeService:
    def __init__(self, session: Session):
        self.session = session

    def create_volume(self, project_id: str, data: schemas.VolumeCreate):
        if self.session.get(models.Project, project_id) is None:
            return None
        volume = models.Volume(project_id=project_id, **data.model_dump())
        self.session.add(volume)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicatePositionError("volume") from exc
        self.session.refresh(volume)
        return volume

    def list_volumes(self, project_id: str):
        if self.session.get(models.Project, project_id) is None:
            return None
        statement = (
            select(models.Volume)
            .options(selectinload(models.Volume.episodes))
            .where(models.Volume.project_id == project_id)
            .order_by(models.Volume.position)
        )
        return list(self.session.scalars(statement))

    def update_volume(self, volume_id: str, data: schemas.VolumePatch):
        volume = self.session.get(models.Volume, volume_id)
        if volume is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(volume, key, value)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicatePositionError("volume") from exc
        self.session.refresh(volume)
        return volume

    def move_episode(self, episode_id: str, volume_id: str | None):
        episode = self.session.get(models.Episode, episode_id)
        if episode is None:
            return None
        if episode.volume_id == volume_id:
            return episode

        if volume_id is not None:
            volume = self.session.get(models.Volume, volume_id)
            if volume is None or volume.project_id != episode.project_id:
                raise NarrativeReferenceError(
                    "Volume must belong to the episode project"
                )

        source_siblings = list(
            self.session.scalars(
                select(models.Episode)
                .where(
                    models.Episode.project_id == episode.project_id,
                    models.Episode.volume_id == episode.volume_id,
                    models.Episode.id != episode.id,
                )
                .order_by(models.Episode.position, models.Episode.created_at)
            )
        )
        target_siblings = list(
            self.session.scalars(
                select(models.Episode)
                .where(
                    models.Episode.project_id == episode.project_id,
                    models.Episode.volume_id == volume_id,
                    models.Episode.id != episode.id,
                )
                .order_by(models.Episode.position, models.Episode.created_at)
            )
        )
        for position, sibling in enumerate(source_siblings, start=1):
            sibling.position = position
        episode.volume_id = volume_id
        episode.position = len(target_siblings) + 1
        self.session.commit()
        self.session.refresh(episode)
        return episode

    def delete_volume(self, volume_id: str) -> bool:
        volume = self.session.get(models.Volume, volume_id)
        if volume is None:
            return False
        next_position = next_unassigned_episode_position(
            self.session, volume.project_id
        )
        episodes = list(
            self.session.scalars(
                select(models.Episode)
                .where(models.Episode.volume_id == volume.id)
                .order_by(models.Episode.position, models.Episode.created_at)
            )
        )
        for offset, episode in enumerate(episodes):
            episode.volume_id = None
            episode.position = next_position + offset
        self.session.flush()
        self.session.delete(volume)
        self.session.commit()
        return True

    def create_volume_episode(
        self, volume_id: str, data: schemas.VolumeEpisodeCreate
    ):
        volume = self.session.get(models.Volume, volume_id)
        if volume is None:
            return None
        payload = data.model_dump()
        episode = models.Episode(
            project_id=volume.project_id,
            volume_id=volume.id,
            **payload,
        )
        self.session.add(episode)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicatePositionError("episode") from exc
        self.session.refresh(episode)
        return episode

    def create_storyline(self, project_id: str, data: schemas.StorylineCreate):
        if self.session.get(models.Project, project_id) is None:
            return None
        storyline = models.Storyline(project_id=project_id, **data.model_dump())
        self.session.add(storyline)
        self.session.commit()
        self.session.refresh(storyline)
        return storyline

    def list_storylines(self, project_id: str):
        if self.session.get(models.Project, project_id) is None:
            return None
        statement = (
            select(models.Storyline)
            .options(selectinload(models.Storyline.events))
            .where(models.Storyline.project_id == project_id)
            .order_by(models.Storyline.created_at, models.Storyline.id)
        )
        return list(self.session.scalars(statement))

    def update_storyline(self, storyline_id: str, data: schemas.StorylinePatch):
        storyline = self.session.get(models.Storyline, storyline_id)
        if storyline is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(storyline, key, value)
        self.session.commit()
        self.session.refresh(storyline)
        return storyline

    def _validate_storyline_event(
        self, storyline: models.Storyline, data: schemas.StorylineEventCreate
    ) -> None:
        episode = self.session.get(models.Episode, data.episode_id)
        if episode is None or episode.project_id != storyline.project_id:
            raise NarrativeReferenceError(
                "Episode must belong to the storyline project"
            )
        scene = self.session.get(models.Scene, data.scene_id) if data.scene_id else None
        if data.scene_id and (scene is None or scene.episode_id != episode.id):
            raise NarrativeReferenceError("Scene must belong to the selected episode")
        shot = self.session.get(models.Shot, data.shot_id) if data.shot_id else None
        if data.shot_id and (
            shot is None or scene is None or shot.scene_id != scene.id
        ):
            raise NarrativeReferenceError("Shot must belong to the selected scene")
        for event_id in (data.setup_event_id, data.payoff_event_id):
            if event_id:
                event = self.session.get(models.StorylineEvent, event_id)
                if event is None or event.storyline_id != storyline.id:
                    raise NarrativeReferenceError(
                        "Linked event must belong to the same storyline"
                    )

    def create_storyline_event(
        self, storyline_id: str, data: schemas.StorylineEventCreate
    ):
        storyline = self.session.get(models.Storyline, storyline_id)
        if storyline is None:
            return None
        self._validate_storyline_event(storyline, data)
        payload = data.model_dump()
        metadata = payload.pop("metadata")
        event = models.StorylineEvent(
            storyline_id=storyline.id,
            event_metadata=metadata,
            **payload,
        )
        self.session.add(event)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicatePositionError("storyline_event") from exc
        self.session.refresh(event)
        return event

    def update_storyline_event(
        self, event_id: str, data: schemas.StorylineEventPatch
    ):
        event = self.session.get(models.StorylineEvent, event_id)
        if event is None:
            return None
        current = {
            "episode_id": event.episode_id,
            "scene_id": event.scene_id,
            "shot_id": event.shot_id,
            "position": event.position,
            "stage": event.stage,
            "title": event.title,
            "description": event.description,
            "setup_event_id": event.setup_event_id,
            "payoff_event_id": event.payoff_event_id,
            "metadata": event.event_metadata,
        }
        merged = schemas.StorylineEventCreate.model_validate(
            {**current, **data.model_dump(exclude_unset=True)}
        )
        self._validate_storyline_event(event.storyline, merged)
        payload = data.model_dump(exclude_unset=True)
        if "metadata" in payload:
            event.event_metadata = payload.pop("metadata")
        for key, value in payload.items():
            setattr(event, key, value)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise DuplicatePositionError("storyline_event") from exc
        self.session.refresh(event)
        return event

    def delete_storyline_event(self, event_id: str) -> bool:
        event = self.session.get(models.StorylineEvent, event_id)
        if event is None:
            return False
        self.session.delete(event)
        self.session.commit()
        return True


def next_unassigned_episode_position(session: Session, project_id: str) -> int:
    current = session.scalar(
        select(func.max(models.Episode.position)).where(
            models.Episode.project_id == project_id,
            models.Episode.volume_id.is_(None),
        )
    )
    return int(current or 0) + 1
