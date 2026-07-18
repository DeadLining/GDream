from __future__ import annotations

import math
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.prompt_suggestions import MediaPromptSuggestion, ShotGenerationContext
from comic_studio.redaction import is_sensitive_key
from comic_studio.services.panel_references import resolve_panel_generation_references
from comic_studio.services.shot_inputs import ShotInputCompiler


PromptMode = Literal["panel", "video"]


def _text(value: Any, limit: int = 2000) -> str:
    return str(value or "")[:limit]


def _bounded_json(value: Any, *, depth: int = 0) -> Any:
    if depth >= 4:
        return _text(value, 500)
    if isinstance(value, dict):
        return {
            _text(key, 80): _bounded_json(item, depth=depth + 1)
            for key, item in list(value.items())[:40]
            if not is_sensitive_key(str(key))
        }
    if isinstance(value, (list, tuple)):
        return [_bounded_json(item, depth=depth + 1) for item in value[:40]]
    if isinstance(value, str):
        return _text(value)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _text(value, 500)


class PromptSuggestionService:
    def __init__(self, session: Session, provider):
        self.session = session
        self.provider = provider

    async def create(
        self, shot_id: str, mode: PromptMode
    ) -> MediaPromptSuggestion:
        if mode not in {"panel", "video"}:
            raise ValueError("invalid_prompt_mode")
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            raise KeyError(shot_id)

        context = self._context(shot, mode)
        suggestion = await self.provider.suggest_media_prompt(context)
        return MediaPromptSuggestion.model_validate(suggestion)

    def generation_context(
        self, shot_id: str, mode: PromptMode
    ) -> ShotGenerationContext:
        if mode not in {"panel", "video"}:
            raise ValueError("invalid_prompt_mode")
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            raise KeyError(shot_id)
        compiled = self._compile(shot.id, mode)
        if mode == "panel":
            references = [
                {
                    "asset_id": item.asset.id,
                    "label": item.label,
                    "media_url": f"/media/{item.asset.local_path}",
                    "media_type": item.asset.media_type,
                    "role": item.role,
                    "guidance_kind": item.guidance_kind,
                }
                for item in resolve_panel_generation_references(
                    self.session,
                    shot,
                    compiled,
                    require_character_references=False,
                )
            ]
        else:
            references = []
        return ShotGenerationContext.model_validate(
            {
                "shot_id": shot.id,
                "mode": mode,
                "snapshot_hash": compiled.snapshot_hash,
                "prompt_constraints": compiled.prompt_constraints,
                "library_assets": [
                    {
                        "id": item["id"],
                        "kind": item["kind"],
                        "name": item["name"],
                        "description": item["description"],
                        "tags": item["tags"],
                    }
                    for item in compiled.snapshot["library_assets"]
                ],
                "director": self._director_context(compiled.snapshot["director"]),
                "references": references,
            }
        )

    def _context(self, shot: models.Shot, mode: PromptMode) -> dict[str, Any]:
        scene = shot.scene
        episode = scene.episode
        project = episode.project
        ordered_shots = list(
            self.session.scalars(
                select(models.Shot)
                .join(models.Scene)
                .where(models.Scene.episode_id == episode.id)
                .order_by(models.Scene.position, models.Shot.position)
            )
        )
        shot_index = next(
            (index for index, item in enumerate(ordered_shots) if item.id == shot.id),
            0,
        )
        previous_shot = ordered_shots[shot_index - 1] if shot_index > 0 else None
        compiled = self._compile(shot.id, mode)

        characters = list(
            self.session.scalars(
                select(models.Character)
                .where(models.Character.project_id == project.id)
                .order_by(models.Character.created_at)
            )
        )
        usages = self.session.execute(
            select(
                models.AssetVariantUsage,
                models.AssetVariant,
                models.AssetVariantState,
            )
            .join(
                models.AssetVariant,
                models.AssetVariant.id == models.AssetVariantUsage.variant_id,
            )
            .outerjoin(
                models.AssetVariantState,
                models.AssetVariantState.id == models.AssetVariantUsage.state_id,
            )
            .where(models.AssetVariantUsage.shot_id == shot.id)
            .order_by(models.AssetVariantUsage.created_at)
        ).all()
        visual_reviews = list(
            self.session.scalars(
                select(models.VisualReviewThread)
                .options(
                    selectinload(models.VisualReviewThread.annotations),
                    selectinload(models.VisualReviewThread.messages),
                )
                .where(
                    models.VisualReviewThread.shot_id == shot.id,
                    models.VisualReviewThread.status == "open",
                )
                .order_by(models.VisualReviewThread.updated_at.desc())
                .limit(3)
            )
        )

        return {
            "mode": mode,
            "project": {
                "title": _text(project.title, 200),
                "logline": _text(project.logline),
                "story_bible": _text(project.story_bible, 4000),
                "visual_style": _text(project.visual_style),
                "aspect_ratio": _text(project.aspect_ratio, 20),
            },
            "episode": {
                "title": _text(episode.title, 200),
                "premise": _text(episode.premise, 2000),
            },
            "scene": {
                "location": _text(scene.location, 200),
                "time_of_day": _text(scene.time_of_day, 80),
                "summary": _text(scene.summary, 2000),
                "continuity_state": _bounded_json(scene.continuity_state),
            },
            "shot": self._shot_context(shot),
            "previous_shot": (
                self._shot_context(previous_shot) if previous_shot else None
            ),
            "characters": [
                {
                    "id": character.id,
                    "name": _text(character.name, 120),
                    "role": _text(character.role, 80),
                    "appearance_bible": _text(character.appearance_bible, 2000),
                    "personality": _text(character.personality, 1200),
                    "continuity_rules": _text(character.continuity_rules, 2000),
                    "negative_constraints": _text(
                        character.negative_constraints, 1200
                    ),
                }
                for character in characters[:30]
            ],
            "asset_usages": [
                {
                    "usage_kind": _text(usage.usage_kind, 24),
                    "variant_kind": _text(variant.kind, 24),
                    "variant_label": _text(variant.label, 160),
                    "variant_overrides": _bounded_json(variant.overrides),
                    "state_kind": _text(state.kind, 32) if state else "",
                    "state_label": _text(state.label, 160) if state else "",
                    "state_overrides": _bounded_json(state.overrides) if state else {},
                }
                for usage, variant, state in usages[:30]
            ],
            "library_assets": _bounded_json(compiled.snapshot["library_assets"]),
            "generation_constraints": _text(compiled.prompt_constraints, 6000),
            "visual_reviews": [
                {
                    "title": _text(review.title, 200),
                    "scope": _text(review.modification_scope, 24),
                    "annotations": [
                        {
                            "kind": _text(annotation.kind, 24),
                            "geometry": _bounded_json(annotation.geometry),
                            "label": _text(annotation.label, 120),
                        }
                        for annotation in review.annotations[-20:]
                    ],
                    "messages": [
                        {
                            "author_kind": _text(message.author_kind, 24),
                            "content": _text(message.content, 2000),
                        }
                        for message in review.messages[-12:]
                        if message.author_kind in {"user", "assistant"}
                    ],
                }
                for review in visual_reviews
            ],
            "director": self._director_context(compiled.snapshot["director"]),
        }

    @staticmethod
    def _shot_context(shot: models.Shot) -> dict[str, Any]:
        return {
            "id": shot.id,
            "shot_type": _text(shot.shot_type, 80),
            "duration_seconds": shot.duration_seconds,
            "composition": _text(shot.composition, 2000),
            "camera_motion": _text(shot.camera_motion, 80),
            "character_state": _bounded_json(shot.character_state),
            "image_prompt": _text(shot.image_prompt, 3000),
            "negative_prompt": _text(shot.negative_prompt, 1500),
            "video_prompt": _text(shot.video_prompt, 3000),
            "negative_video_prompt": _text(shot.negative_video_prompt, 1500),
        }

    @staticmethod
    def _director_context(director: dict[str, Any]) -> dict[str, Any] | None:
        camera = director.get("camera")
        objects = director.get("objects") or []
        environment = director.get("environment") or {}
        if not camera and not objects and not environment:
            return None

        director_objects = []
        for item in objects[:60]:
            transform = item.get("transform") or {}
            rotation = transform.get("rotation") or [0, 0, 0]
            horizontal_facing = 0
            if (
                isinstance(rotation, (list, tuple))
                and len(rotation) > 1
                and isinstance(rotation[1], (int, float))
                and not isinstance(rotation[1], bool)
            ):
                horizontal_facing = round(math.degrees(rotation[1]))
            director_objects.append(
                {
                    "id": _text(item.get("id"), 80),
                    "kind": _text(item.get("kind"), 40),
                    "source_type": _text(item.get("source_type"), 40),
                    "source_id": item.get("source_id"),
                    "label": _text(item.get("label"), 160),
                    "position": _bounded_json(transform.get("position", [0, 0, 0])),
                    "horizontal_facing_degrees": horizontal_facing,
                }
            )

        return {
            "environment": _bounded_json(environment),
            "camera": (
                {
                    "position": _bounded_json(camera.get("position")),
                    "target": _bounded_json(camera.get("target")),
                    "rotation": _bounded_json(camera.get("rotation")),
                    "focal_length_mm": camera.get("focal_length_mm"),
                    "shot_size": _text(camera.get("shot_size"), 40),
                    "camera_motion": _text(camera.get("camera_motion"), 80),
                    "framing_guides": _bounded_json(camera.get("framing_guides", {})),
                }
                if camera
                else None
            ),
            "objects": director_objects,
        }

    def _compile(self, shot_id: str, mode: PromptMode):
        return ShotInputCompiler(self.session).compile(
            shot_id,
            usage_kinds={"video", "reference"}
            if mode == "video"
            else {"panel", "reference"},
        )
