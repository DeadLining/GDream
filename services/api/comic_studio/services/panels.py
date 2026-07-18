import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.providers.gpt_image import GPTImageProvider
from comic_studio.services.grid_split import split_grid_image
from comic_studio.services.panel_references import resolve_panel_generation_references
from comic_studio.services.shot_inputs import ShotInputCompiler
from comic_studio.services.skill_loader import get_skill_loader
from comic_studio.services.visual_review_markup import render_visual_review_markup


# Four grid shots can each contribute one preview plus four guidance images.
MAX_PANEL_REFERENCE_IMAGES = 24
DIRECTOR_GUIDANCE_LABELS = {
    "silhouette": "silhouette guidance",
    "skeleton_pose": "skeleton pose guidance",
    "depth": "depth guidance",
    "object_mask": "object mask guidance",
}
DIRECTOR_GUIDANCE_CONSTRAINTS = {
    "silhouette": "subject boundaries and occlusion",
    "skeleton_pose": "body pose and joint placement",
    "depth": "relative depth, foreground separation, and occlusion",
    "object_mask": "per-object boundaries, visibility, and overlap",
}


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

    async def generate_grid_panels(
        self,
        shot_ids: list[str],
        *,
        activate: bool = False,
    ) -> list[models.Asset]:
        """Generate a single 2x2 grid image and assign one cell to each shot."""
        if not shot_ids:
            return []
        statement = (
            select(models.Shot)
            .options(
                selectinload(models.Shot.scene)
                .selectinload(models.Scene.episode)
                .selectinload(models.Episode.project)
                .selectinload(models.Project.characters)
            )
            .where(models.Shot.id.in_(shot_ids))
            .order_by(models.Shot.scene_id, models.Shot.position)
        )
        shots = list(self.session.scalars(statement))
        if not shots:
            raise KeyError(shot_ids)
        project = shots[0].scene.episode.project
        scene = shots[0].scene
        compiled_inputs = [
            ShotInputCompiler(self.session).compile(
                shot.id, usage_kinds={"panel", "reference"}
            )
            for shot in shots
        ]
        present_character_ids: set[str] = set()
        for shot, compiled in zip(shots, compiled_inputs):
            present_character_ids.update(
                key for key in shot.character_state if isinstance(key, str)
            )
            present_character_ids.update(
                line.character_id for line in shot.dialogue if line.character_id is not None
            )
            present_character_ids.update(compiled.character_ids)
        reference_assets: list[models.Asset] = []
        director_reference_ids = []
        for compiled in compiled_inputs:
            if compiled.director_preview_asset_id:
                director_reference_ids.append(compiled.director_preview_asset_id)
            director_reference_ids.extend(
                asset_id
                for _kind, asset_id in compiled.director_guidance_asset_ids
            )
        for asset_id in dict.fromkeys(director_reference_ids):
            director_asset = self.session.get(models.Asset, asset_id)
            if director_asset is not None:
                reference_assets.append(director_asset)
        if present_character_ids:
            references = list(
                self.session.scalars(
                    select(models.CharacterReference).where(
                        models.CharacterReference.character_id.in_(present_character_ids),
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
        for asset_id in dict.fromkeys(
            asset_id
            for compiled in compiled_inputs
            for asset_id in compiled.reference_asset_ids
        ):
            asset = self.session.get(models.Asset, asset_id)
            if asset is not None and asset.id not in {item.id for item in reference_assets}:
                reference_assets.append(asset)
        reference_assets = reference_assets[:MAX_PANEL_REFERENCE_IMAGES]
        character_by_id = {character.id: character for character in project.characters}
        character_rules = "\n".join(
            f"- {character.name} [{character.body_plan}]: {character.appearance_bible}. "
            f"Continuity: {character.continuity_rules}. Avoid: {character.negative_constraints}"
            for character in project.characters
        )
        style_id = next(
            (
                character_by_id[cid].art_style_id
                for cid in present_character_ids
                if cid in character_by_id and character_by_id[cid].art_style_id
            ),
            None,
        )
        style_prefix = ""
        style_negative = ""
        if style_id:
            from comic_studio.services.art_style_loader import get_art_style_loader

            loader = get_art_style_loader()
            style_prefix = loader.get_prefix(style_id)
            style_negative = loader.get_negative(style_id)
        reference_indices = {
            asset.id: index for index, asset in enumerate(reference_assets, start=1)
        }
        panel_description_items: list[str] = []
        for index, (shot, compiled) in enumerate(
            zip(shots, compiled_inputs), start=1
        ):
            lines = [f"{index}. Shot: {shot.composition}. {shot.image_prompt}"]
            preview_index = reference_indices.get(compiled.director_preview_asset_id or "")
            if preview_index is not None:
                lines.append(
                    f"Use reference image {preview_index} as the saved 3D director "
                    f"composition for panel {index}. Preserve its camera angle, "
                    "framing, subject placement, and spatial proportions."
                )
            for guidance_kind, guidance_asset_id in compiled.director_guidance_asset_ids:
                guidance_index = reference_indices.get(guidance_asset_id)
                if guidance_index is None:
                    continue
                label = DIRECTOR_GUIDANCE_LABELS.get(guidance_kind, "guidance")
                constraint = DIRECTOR_GUIDANCE_CONSTRAINTS.get(
                    guidance_kind, "composition"
                )
                lines.append(
                    f"Use reference image {guidance_index} as the 3D director {label} "
                    f"for panel {index}. Preserve the indicated {constraint}."
                )
            if compiled.prompt_constraints:
                lines.append(compiled.prompt_constraints)
            panel_description_items.append("\n".join(lines))
        panel_descriptions = "\n".join(panel_description_items)
        negative_constraints = self._combine_negative(
            ", ".join(dict.fromkeys(shot.negative_prompt for shot in shots if shot.negative_prompt)),
            style_negative,
        )
        prompt = get_skill_loader().render(
            "grid_panel_prompt",
            visual_style=project.visual_style,
            scene_location=scene.location,
            scene_summary=scene.summary,
            panel_descriptions=panel_descriptions,
            character_rules=character_rules,
            negative_constraints=negative_constraints,
        )
        if style_prefix:
            prompt = f"Style: {style_prefix}.\n\n{prompt}"
        reference_inputs = [
            self._asset_to_input(asset) for asset in reference_assets
        ]
        result = (
            await self.provider.edit(prompt, reference_inputs, "1024x1536")
            if reference_inputs
            else await self.provider.generate(prompt, "1024x1536")
        )
        cells = split_grid_image(result.content, rows=2, columns=2)
        assets: list[models.Asset] = []
        for shot, cell in zip(shots, cells):
            asset = self.assets.register_panel(
                project_id=project.id,
                shot_id=shot.id,
                content=cell,
                media_type=result.media_type,
                provider="gpt-image",
                model=self.provider.model,
                request_metadata={
                    "prompt": prompt,
                    "size": "1024x1536",
                    "grid": True,
                    "reference_asset_ids": [asset.id for asset in reference_assets],
                    "input_snapshot": compiled_inputs[shots.index(shot)].snapshot,
                    "input_snapshot_hash": compiled_inputs[shots.index(shot)].snapshot_hash,
                },
                activate=activate,
            )
            assets.append(asset)
        return assets

    async def generate_panel(
        self,
        shot_id: str,
        *,
        activate: bool = False,
        review_context: dict | None = None,
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
        compiled = ShotInputCompiler(self.session).compile(
            shot.id, usage_kinds={"panel", "reference"}
        )
        generation_references = resolve_panel_generation_references(
            self.session,
            shot,
            compiled,
            max_non_tail_references=MAX_PANEL_REFERENCE_IMAGES,
        )
        tail_reference = next(
            (
                item
                for item in generation_references
                if item.role == "previous_shot_tail"
            ),
            None,
        )
        tail_asset = tail_reference.asset if tail_reference is not None else None
        non_tail_references = [
            item
            for item in generation_references
            if item.role != "previous_shot_tail"
        ]
        reference_assets = [item.asset for item in non_tail_references]
        director_preview_reference = next(
            (
                item
                for item in non_tail_references
                if item.role == "director_preview"
            ),
            None,
        )
        director_preview = (
            director_preview_reference.asset
            if director_preview_reference is not None
            else None
        )
        from comic_studio.services.art_style_loader import get_art_style_loader

        character_rules = "\n".join(
            f"- {character.name} [{character.body_plan}]: {character.appearance_bible}. "
            f"Continuity: {character.continuity_rules}. Avoid: {character.negative_constraints}"
            for character in project.characters
        )
        style_id = self._resolve_shot_style_id(shot, project.characters)
        style_prefix = ""
        style_negative = ""
        if style_id:
            loader = get_art_style_loader()
            style_prefix = loader.get_prefix(style_id)
            style_negative = loader.get_negative(style_id)
        prompt = get_skill_loader().render(
            "panel_prompt",
            visual_style=project.visual_style,
            scene_location=shot.scene.location,
            scene_summary=shot.scene.summary,
            shot_composition=shot.composition,
            shot_image_prompt=shot.image_prompt,
            character_rules=character_rules,
            negative_constraints=self._combine_negative(shot.negative_prompt, style_negative),
        )
        if style_prefix:
            prompt = f"Style: {style_prefix}.\n\n{prompt}"
        if compiled.prompt_constraints:
            prompt = f"{prompt}\n\n{compiled.prompt_constraints}"
        if review_context:
            annotations = json.dumps(
                review_context.get("annotations", []),
                ensure_ascii=False,
                sort_keys=True,
            )
            messages = "\n".join(
                f"- {item['author_kind']}: {item['content']}"
                for item in review_context.get("messages", [])
            )
            prompt = (
                f"{prompt}\n\nVisual review revision instructions:\n"
                f"- Modification scope: {review_context['modification_scope']}\n"
                f"- Source asset: {review_context.get('source_asset_id') or 'none'}\n"
                "- Locked constraints: identity, outfit, composition\n"
                f"- Annotations (normalized canvas geometry): {annotations}\n"
                f"- Review conversation:\n{messages or '- no additional message'}"
            )
        if tail_asset is not None and not (
            review_context and review_context.get("source_asset_id")
        ):
            # Make the prompt explicitly call out the continuity anchor.
            prompt = f"{prompt}\n\nContinuity: continue the visual from the previous shot's tail frame (reference image 1)."
        review_source = None
        if review_context and review_context.get("source_asset_id"):
            review_source = self.session.get(
                models.Asset, review_context["source_asset_id"]
            )
        reference_indices = {
            asset.id: index + (1 if tail_asset is not None else 0)
            for index, asset in enumerate(reference_assets, start=1)
        }
        if director_preview is not None and review_source is None:
            preview_index = reference_indices.get(director_preview.id)
        else:
            preview_index = None
        if preview_index is not None:
            prompt = (
                f"{prompt}\n\nComposition reference: use the saved 3D director preview "
                f"(reference image {preview_index}) for camera angle, framing, subject "
                "placement, and spatial proportions. Preserve character identity and "
                "the requested visual style from the other references and prompt."
            )
        if review_source is None and non_tail_references:
            guidance_lines = []
            for reference in non_tail_references:
                if reference.role != "director_guidance":
                    continue
                guidance_kind = reference.guidance_kind or ""
                guidance_index = reference_indices.get(reference.asset.id)
                if guidance_index is None:
                    continue
                label = DIRECTOR_GUIDANCE_LABELS.get(guidance_kind, "guidance")
                constraint = DIRECTOR_GUIDANCE_CONSTRAINTS.get(
                    guidance_kind, "composition"
                )
                guidance_lines.append(
                    f"Use reference image {guidance_index} as the 3D director {label}; "
                    f"preserve {constraint}."
                )
            if guidance_lines:
                prompt = f"{prompt}\n\n" + "\n".join(guidance_lines)
        reference_inputs = []
        annotated_reference = False
        if review_source is not None:
            review_input = self._asset_to_input(review_source)
            if review_context and (
                review_context.get("annotations") or review_context.get("messages")
            ):
                review_input = (
                    render_visual_review_markup(
                        review_input[0],
                        review_context.get("annotations", []),
                        review_context.get("messages", []),
                    ),
                    "image/png",
                    1024,
                )
                annotated_reference = True
            reference_inputs.append(review_input)
        if review_source is None:
            if tail_asset is not None:
                reference_inputs.append(self._asset_to_input(tail_asset))
            for asset in reference_assets:
                reference_inputs.append(self._asset_to_input(asset))
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
                "reference_asset_ids": (
                    []
                    if review_source is not None
                    else [
                        *(["tail:" + tail_asset.id] if tail_asset is not None else []),
                        *[asset.id for asset in reference_assets],
                    ]
                ),
                "input_snapshot": compiled.snapshot,
                "input_snapshot_hash": compiled.snapshot_hash,
                **(
                    {
                        "visual_review": {
                            **review_context,
                            "annotated_reference": annotated_reference,
                        }
                    }
                    if review_context
                    else {}
                ),
            },
            activate=activate,
        )

    def _tail_frame_asset(self, shot: models.Shot) -> models.Asset | None:
        """Resolve the previous-shot tail-frame anchor declared on ``shot``.

        Returns None when the shot has no tail-frame link or when the linked
        asset no longer exists; the caller treats None as "no continuity anchor".
        """
        asset_id = shot.previous_shot_tail_asset_id
        if not asset_id:
            return None
        return self.session.get(models.Asset, asset_id)

    def _resolve_shot_style_id(
        self, shot: models.Shot, characters: list[models.Character]
    ) -> str | None:
        """Pick the first present character with an explicit art style.

        If no character declares a style, the project-level visual_style is
        still in the prompt; this only affects the art-style catalog prefix.
        """
        character_by_id = {character.id: character for character in characters}
        for character_id in shot.character_state:
            character = character_by_id.get(character_id)
            if character and character.art_style_id:
                return character.art_style_id
        for line in shot.dialogue:
            if line.character_id:
                character = character_by_id.get(line.character_id)
                if character and character.art_style_id:
                    return character.art_style_id
        return None

    @staticmethod
    def _combine_negative(base: str, extra: str) -> str:
        if not base:
            return extra
        if not extra:
            return base
        return f"{base}, {extra}"

    def _asset_to_input(self, asset: models.Asset) -> tuple[bytes, str]:
        """Read an asset off disk and return (bytes, media_type) for the provider.

        Mirrors the pre-M3.2 inline logic, hoisted so tail-frame references and
        character references share the same path-escape guard.
        """
        path = (self.assets.data_root / asset.local_path).resolve()
        if self.assets.data_root not in path.parents:
            raise ValueError("Asset path escaped data root")
        return (path.read_bytes(), asset.media_type)
