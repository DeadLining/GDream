from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.repositories import EpisodeRepository


class EpisodePlanner(Protocol):
    async def plan_episode(self, context: dict) -> schemas.EpisodePlan: ...


class PlanningService:
    def __init__(self, session: Session, planner: EpisodePlanner):
        self.session = session
        self.planner = planner

    async def plan_episode(self, episode_id: str) -> models.Episode:
        statement = (
            select(models.Episode)
            .options(
                selectinload(models.Episode.project).selectinload(
                    models.Project.characters
                ),
                selectinload(models.Episode.scenes),
            )
            .where(models.Episode.id == episode_id)
        )
        episode = self.session.scalar(statement)
        if episode is None:
            raise KeyError(episode_id)
        if episode.scenes:
            raise RuntimeError("storyboard_already_exists")

        context = {
            "project": {
                "title": episode.project.title,
                "logline": episode.project.logline,
                "story_bible": episode.project.story_bible,
                "visual_style": episode.project.visual_style,
                "aspect_ratio": episode.project.aspect_ratio,
            },
            "episode": {
                "id": episode.id,
                "title": episode.title,
                "premise": episode.premise,
                "target_duration_seconds": episode.target_duration_seconds,
            },
            "characters": [
                {
                    "id": character.id,
                    "name": character.name,
                    "role": character.role,
                    "appearance_bible": character.appearance_bible,
                    "personality": character.personality,
                    "continuity_rules": character.continuity_rules,
                }
                for character in episode.project.characters
            ],
        }
        plan = await self.planner.plan_episode(context)
        valid_character_ids = {character.id for character in episode.project.characters}

        try:
            for scene_position, planned_scene in enumerate(plan.scenes, start=1):
                scene_data = planned_scene.model_dump(exclude={"shots"})
                scene = models.Scene(
                    episode_id=episode.id,
                    position=scene_position,
                    **scene_data,
                )
                self.session.add(scene)
                self.session.flush()
                for shot_position, planned_shot in enumerate(
                    planned_scene.shots, start=1
                ):
                    shot_data = planned_shot.model_dump(exclude={"dialogue"})
                    shot = models.Shot(
                        scene_id=scene.id,
                        position=shot_position,
                        **shot_data,
                    )
                    self.session.add(shot)
                    self.session.flush()
                    for line_position, planned_line in enumerate(
                        planned_shot.dialogue, start=1
                    ):
                        line_data = planned_line.model_dump()
                        if line_data["character_id"] not in valid_character_ids:
                            line_data["character_id"] = None
                        self.session.add(
                            models.DialogueLine(
                                shot_id=shot.id,
                                position=line_position,
                                **line_data,
                            )
                        )
            episode.status = "planned"
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        self.session.expire_all()
        planned_episode = EpisodeRepository(self.session).get(episode.id)
        if planned_episode is None:
            raise RuntimeError("Planned episode disappeared after commit")
        return planned_episode
