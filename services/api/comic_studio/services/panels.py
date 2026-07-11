from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.providers.gpt_image import GPTImageProvider


class PanelService:
    def __init__(
        self,
        session: Session,
        data_root: Path,
        provider: GPTImageProvider,
    ):
        self.session = session
        self.assets = AssetStore(session, data_root)
        self.provider = provider

    async def generate_panel(self, shot_id: str, *, activate: bool = False) -> models.Asset:
        statement = (
            select(models.Shot)
            .options(
                selectinload(models.Shot.scene)
                .selectinload(models.Scene.episode)
                .selectinload(models.Episode.project)
                .selectinload(models.Project.characters)
            )
            .where(models.Shot.id == shot_id)
        )
        shot = self.session.scalar(statement)
        if shot is None:
            raise KeyError(shot_id)
        project = shot.scene.episode.project
        character_rules = "\n".join(
            f"- {character.name}: {character.appearance_bible}. "
            f"Continuity: {character.continuity_rules}. Avoid: {character.negative_constraints}"
            for character in project.characters
        )
        prompt = (
            "Create one polished vertical comic panel with no captions or text.\n"
            f"Series visual style: {project.visual_style}\n"
            f"Scene: {shot.scene.location}; {shot.scene.summary}\n"
            f"Shot composition: {shot.composition}\n"
            f"Shot prompt: {shot.image_prompt}\n"
            f"Characters:\n{character_rules}\n"
            f"Negative constraints: {shot.negative_prompt}"
        )
        result = await self.provider.generate(prompt, "1024x1536")
        return self.assets.register_panel(
            project_id=project.id,
            shot_id=shot.id,
            content=result.content,
            media_type=result.media_type,
            provider="gpt-image",
            model=self.provider.model,
            request_metadata={"prompt": prompt, "size": "1024x1536"},
            activate=activate,
        )
