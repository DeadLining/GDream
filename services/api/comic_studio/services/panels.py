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

    async def generate_panel(
        self, shot_id: str, *, activate: bool = False
    ) -> models.Asset:
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
        present_character_ids = {
            key for key in shot.character_state if isinstance(key, str)
        } | {
            line.character_id for line in shot.dialogue if line.character_id is not None
        }
        reference_assets: list[models.Asset] = []
        if present_character_ids:
            references = list(
                self.session.scalars(
                    select(models.CharacterReference).where(
                        models.CharacterReference.character_id.in_(
                            present_character_ids
                        ),
                        models.CharacterReference.is_active.is_(True),
                        models.CharacterReference.review_status == "approved",
                    )
                )
            )
            by_character: dict[str, list[models.CharacterReference]] = {}
            for reference in references:
                by_character.setdefault(reference.character_id, []).append(reference)
            for character_id in present_character_ids:
                candidates = by_character.get(character_id, [])
                identity = next(
                    (
                        item
                        for kind in ("primary", "front")
                        for item in candidates
                        if item.reference_type == kind
                    ),
                    None,
                )
                if identity is None:
                    raise ValueError(f"missing_character_reference:{character_id}")
                selected = [identity]
                outfit = next(
                    (item for item in candidates if item.reference_type == "outfit"),
                    None,
                )
                if outfit is not None:
                    selected.append(outfit)
                for reference in selected:
                    asset = self.session.get(models.Asset, reference.asset_id)
                    if asset is not None:
                        reference_assets.append(asset)
            reference_assets = reference_assets[:4]
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
        reference_inputs = []
        for asset in reference_assets:
            path = (self.assets.data_root / asset.local_path).resolve()
            if self.assets.data_root not in path.parents:
                raise ValueError("Asset path escaped data root")
            reference_inputs.append((path.read_bytes(), asset.media_type))
        result = (
            await self.provider.edit(prompt, reference_inputs, "1024x1536")
            if reference_inputs
            else await self.provider.generate(prompt, "1024x1536")
        )
        return self.assets.register_panel(
            project_id=project.id,
            shot_id=shot.id,
            content=result.content,
            media_type=result.media_type,
            provider="gpt-image",
            model=self.provider.model,
            request_metadata={
                "prompt": prompt,
                "size": "1024x1536",
                "reference_asset_ids": [asset.id for asset in reference_assets],
            },
            activate=activate,
        )
