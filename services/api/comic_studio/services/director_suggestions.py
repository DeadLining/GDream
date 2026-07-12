from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.director import DirectorSuggestionPatch
from comic_studio.redaction import redact
from comic_studio.services.director_stages import DirectorStageService


ALLOWED_SHOT_FIELDS = {
    "composition",
    "camera_motion",
    "image_prompt",
    "negative_prompt",
}


class DirectorSuggestionService:
    def __init__(self, session: Session, provider):
        self.session = session
        self.provider = provider

    async def create(
        self, stage_id: str, shot_id: str | None, kind: str
    ) -> models.DirectorSuggestion:
        if kind not in {"stage_layout", "shot_composition"}:
            raise ValueError("invalid_suggestion_kind")
        stage = DirectorStageService(self.session).get_stage(stage_id)
        shot = self.session.get(models.Shot, shot_id) if shot_id else None
        if shot_id and (shot is None or shot.scene_id != stage.scene_id):
            raise KeyError(shot_id)
        if kind == "shot_composition" and shot is None:
            raise ValueError("shot_required")

        context = self._context(stage, shot)
        patch = await self.provider.suggest_director(context)
        valid_object_ids = {item.id for item in stage.objects}
        if any(
            item.object_id not in valid_object_ids for item in patch.object_patches
        ):
            raise ValueError("unknown_director_object")

        suggestion = models.DirectorSuggestion(
            stage_id=stage.id,
            shot_id=shot.id if shot else None,
            kind=kind,
            status="ready",
            request_context=redact(context),
            suggested_patch=patch.model_dump(exclude_none=True),
        )
        self.session.add(suggestion)
        self.session.commit()
        self.session.refresh(suggestion)
        return suggestion

    def apply_to_shot(
        self, suggestion_id: str, fields: set[str]
    ) -> models.Shot:
        suggestion = self.session.get(models.DirectorSuggestion, suggestion_id)
        if suggestion is None:
            raise KeyError(suggestion_id)
        if suggestion.status != "ready" or suggestion.shot_id is None:
            raise ValueError("suggestion_not_ready")
        if not fields or not fields.issubset(ALLOWED_SHOT_FIELDS):
            raise ValueError("invalid_apply_fields")
        patch = suggestion.suggested_patch
        if any(field not in patch for field in fields):
            raise ValueError("invalid_apply_fields")
        shot = self.session.get(models.Shot, suggestion.shot_id)
        stage = self.session.get(models.DirectorStage, suggestion.stage_id)
        if shot is None or stage is None:
            raise KeyError(suggestion.shot_id)

        stage.revisions.append(
            models.DirectorRevision(
                stage_snapshot={"version": stage.version},
                camera_snapshot={
                    "shot_id": shot.id,
                    **{field: getattr(shot, field) for field in ALLOWED_SHOT_FIELDS},
                },
                reason="shot_apply",
            )
        )
        for field in fields:
            setattr(shot, field, patch[field])
        suggestion.status = "applied"
        suggestion.applied_at = datetime.now(timezone.utc)
        self.session.commit()
        self.session.refresh(shot)
        return shot

    @staticmethod
    def _context(stage: models.DirectorStage, shot: models.Shot | None) -> dict:
        scene = stage.scene
        episode = scene.episode
        project = episode.project
        return {
            "project": {
                "id": project.id,
                "title": project.title,
                "logline": project.logline,
                "story_bible": project.story_bible,
                "visual_style": project.visual_style,
                "aspect_ratio": project.aspect_ratio,
            },
            "scene": {
                "id": scene.id,
                "location": scene.location,
                "time_of_day": scene.time_of_day,
                "summary": scene.summary,
                "continuity_state": scene.continuity_state,
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
                for character in project.characters
            ],
            "shot": (
                {
                    "id": shot.id,
                    "shot_type": shot.shot_type,
                    "composition": shot.composition,
                    "camera_motion": shot.camera_motion,
                    "image_prompt": shot.image_prompt,
                    "negative_prompt": shot.negative_prompt,
                }
                if shot
                else None
            ),
            "stage": {
                "id": stage.id,
                "version": stage.version,
                "environment": stage.environment,
                "objects": [
                    {
                        "id": item.id,
                        "kind": item.kind,
                        "label": item.label,
                        "transform": item.transform,
                        "visible": item.visible,
                    }
                    for item in stage.objects
                ],
                "cameras": [
                    {
                        "id": camera.id,
                        "shot_id": camera.shot_id,
                        "position": camera.position,
                        "target": camera.target,
                        "rotation": camera.rotation,
                        "focal_length_mm": camera.focal_length_mm,
                        "camera_motion": camera.camera_motion,
                    }
                    for camera in stage.shot_cameras
                ],
            },
        }
