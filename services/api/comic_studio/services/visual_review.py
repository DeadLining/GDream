from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from pydantic import ValidationError

from comic_studio import models, schemas


class VisualReviewReferenceError(ValueError):
    pass


class VisualReviewService:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def _shot_project_id(shot: models.Shot) -> str:
        return shot.scene.episode.project_id

    def create_thread(
        self, shot_id: str, data: schemas.VisualReviewThreadCreate
    ):
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            return None
        if data.source_asset_id:
            asset = self.session.get(models.Asset, data.source_asset_id)
            if asset is None or asset.project_id != self._shot_project_id(shot):
                raise VisualReviewReferenceError(
                    "Source asset must belong to the shot project"
                )
            if asset.kind != f"panel:{shot.id}":
                raise VisualReviewReferenceError(
                    "Source asset must be a panel for the review shot"
                )
        thread = models.VisualReviewThread(
            episode_id=shot.scene.episode.id,
            shot_id=shot.id,
            status="open",
            **data.model_dump(),
        )
        self.session.add(thread)
        self.session.commit()
        self.session.refresh(thread)
        return thread

    def list_threads(self, shot_id: str):
        if self.session.get(models.Shot, shot_id) is None:
            return None
        statement = (
            select(models.VisualReviewThread)
            .options(
                selectinload(models.VisualReviewThread.annotations),
                selectinload(models.VisualReviewThread.messages),
                selectinload(models.VisualReviewThread.candidates),
            )
            .where(models.VisualReviewThread.shot_id == shot_id)
            .order_by(models.VisualReviewThread.created_at)
        )
        return list(self.session.scalars(statement))

    def update_thread(
        self, thread_id: str, data: schemas.VisualReviewThreadPatch
    ):
        thread = self.session.get(models.VisualReviewThread, thread_id)
        if thread is None:
            return None
        thread.modification_scope = data.modification_scope
        self.session.commit()
        self.session.refresh(thread)
        return thread

    def add_annotation(
        self, thread_id: str, data: schemas.VisualAnnotationCreate
    ):
        if self.session.get(models.VisualReviewThread, thread_id) is None:
            return None
        annotation = models.VisualAnnotation(thread_id=thread_id, **data.model_dump())
        self.session.add(annotation)
        self.session.commit()
        self.session.refresh(annotation)
        return annotation

    def update_annotation(
        self, annotation_id: str, data: schemas.VisualAnnotationPatch
    ):
        annotation = self.session.get(models.VisualAnnotation, annotation_id)
        if annotation is None:
            return None
        current = {
            "kind": annotation.kind,
            "geometry": annotation.geometry,
            "color": annotation.color,
            "label": annotation.label,
        }
        try:
            merged = schemas.VisualAnnotationCreate.model_validate(
                {**current, **data.model_dump(exclude_unset=True)}
            )
        except ValidationError as exc:
            raise VisualReviewReferenceError("Invalid annotation geometry") from exc
        for key, value in merged.model_dump().items():
            setattr(annotation, key, value)
        self.session.commit()
        self.session.refresh(annotation)
        return annotation

    def delete_annotation(self, annotation_id: str):
        annotation = self.session.get(models.VisualAnnotation, annotation_id)
        if annotation is None:
            return False
        self.session.delete(annotation)
        self.session.commit()
        return True

    def add_message(
        self, thread_id: str, data: schemas.VisualReviewMessageCreate
    ):
        if self.session.get(models.VisualReviewThread, thread_id) is None:
            return None
        message = models.VisualReviewMessage(thread_id=thread_id, **data.model_dump())
        self.session.add(message)
        self.session.commit()
        self.session.refresh(message)
        return message

    def add_candidate(
        self, thread_id: str, data: schemas.VisualReviewCandidateCreate
    ):
        thread = self.session.get(models.VisualReviewThread, thread_id)
        if thread is None:
            return None
        asset = self.session.get(models.Asset, data.asset_id)
        if asset is None or asset.project_id != self._shot_project_id(thread.shot):
            raise VisualReviewReferenceError(
                "Candidate asset must belong to the shot project"
            )
        if asset.kind != f"panel:{thread.shot_id}":
            raise VisualReviewReferenceError(
                "Candidate asset must be a panel for the review shot"
            )
        candidate = models.VisualReviewCandidate(
            thread_id=thread.id, status="ready", **data.model_dump()
        )
        self.session.add(candidate)
        self.session.commit()
        self.session.refresh(candidate)
        return candidate

    async def generate_candidate(self, thread_id: str, data_root: Path, provider):
        thread = self.session.get(models.VisualReviewThread, thread_id)
        if thread is None:
            return None
        shot = thread.shot
        source = (
            self.session.get(models.Asset, thread.source_asset_id)
            if thread.source_asset_id
            else None
        )
        if source is not None and (
            source.project_id != self._shot_project_id(shot)
            or source.kind != f"panel:{shot.id}"
        ):
            raise VisualReviewReferenceError(
                "Source asset must be a panel for the review shot"
            )
        review_context = {
            "thread_id": thread.id,
            "source_asset_id": thread.source_asset_id,
            "modification_scope": thread.modification_scope,
            "annotations": [
                {"kind": item.kind, "geometry": item.geometry, "label": item.label}
                for item in thread.annotations
            ],
            "messages": [
                {"author_kind": item.author_kind, "content": item.content}
                for item in thread.messages
            ],
            "locked": ["identity", "outfit", "composition"],
        }
        from comic_studio.services.panels import PanelService

        asset = await PanelService(self.session, data_root, provider).generate_panel(
            shot.id, activate=False, review_context=review_context
        )
        candidate = models.VisualReviewCandidate(
            thread_id=thread.id,
            asset_id=asset.id,
            status="ready",
            generation_metadata={
                "scope": thread.modification_scope,
                "locked": review_context["locked"],
                "source_asset_id": thread.source_asset_id,
            },
        )
        self.session.add(candidate)
        self.session.commit()
        self.session.refresh(candidate)
        return candidate

    def _scope_revisions(
        self, thread: models.VisualReviewThread, asset: models.Asset
    ) -> dict:
        shot = thread.shot
        character_ids = {
            key
            for key in shot.character_state
            if isinstance(key, str)
            and self.session.get(models.Character, key) is not None
        }
        character_ids.update(
            line.character_id
            for line in shot.dialogue
            if line.character_id is not None
        )
        if thread.modification_scope == "shot" or not character_ids:
            return {
                "scope": thread.modification_scope,
                "variant_ids": [],
                "usage_ids": [],
                "affected_shot_ids": [shot.id],
                "affected_episode_ids": [thread.episode_id],
            }

        conditions = [
            models.Episode.project_id == self._shot_project_id(shot)
        ]
        if thread.modification_scope == "episode":
            conditions.append(models.Episode.id == thread.episode_id)
        all_shots = list(
            self.session.scalars(
                select(models.Shot)
                .join(models.Scene)
                .join(models.Episode)
                .where(*conditions)
            )
        )
        affected = [
            item
            for item in all_shots
            if character_ids.intersection(
                key for key in item.character_state if isinstance(key, str)
            )
        ]
        variant_ids: list[str] = []
        usage_ids: list[str] = []
        for character_id in sorted(character_ids):
            kind = thread.modification_scope
            version_conditions = [
                models.AssetVariant.character_id == character_id,
                models.AssetVariant.kind == kind,
            ]
            if kind == "episode":
                version_conditions.append(
                    models.AssetVariant.episode_id == thread.episode_id
                )
            version = (
                self.session.scalar(
                    select(func.max(models.AssetVariant.version)).where(
                        *version_conditions
                    )
                )
                or 0
            ) + 1
            parent_id = None
            if kind == "episode":
                parent_id = self.session.scalar(
                    select(models.AssetVariant.id)
                    .where(
                        models.AssetVariant.character_id == character_id,
                        models.AssetVariant.kind == "master",
                        models.AssetVariant.deleted_at.is_(None),
                    )
                    .order_by(models.AssetVariant.version.desc())
                    .limit(1)
                )
            variant = models.AssetVariant(
                character_id=character_id,
                episode_id=thread.episode_id if kind == "episode" else None,
                parent_variant_id=parent_id,
                kind=kind,
                label=f"{thread.title} V{version}",
                inherited_fields=["identity", "face", "hair", "body", "outfit"],
                overrides={},
                version=version,
                review_status="approved",
            )
            self.session.add(variant)
            self.session.flush()
            usage = models.AssetVariantUsage(
                variant_id=variant.id,
                shot_id=shot.id,
                asset_id=asset.id,
                usage_kind="panel",
            )
            self.session.add(usage)
            self.session.flush()
            variant_ids.append(variant.id)
            usage_ids.append(usage.id)
        affected_shots = affected or [shot]
        return {
            "scope": thread.modification_scope,
            "variant_ids": variant_ids,
            "usage_ids": usage_ids,
            "affected_shot_ids": sorted({item.id for item in affected_shots}),
            "affected_episode_ids": sorted(
                {item.scene.episode_id for item in affected_shots}
            ),
        }

    def accept_candidate(self, candidate_id: str):
        candidate = self.session.get(models.VisualReviewCandidate, candidate_id)
        if candidate is None:
            return None
        if candidate.status != "ready":
            raise VisualReviewReferenceError("Candidate is not ready for acceptance")
        thread = candidate.thread
        shot = thread.shot
        asset = self.session.get(models.Asset, candidate.asset_id)
        if asset is None or asset.project_id != self._shot_project_id(shot):
            raise VisualReviewReferenceError(
                "Candidate asset must belong to the shot project"
            )
        if asset.kind != f"panel:{shot.id}":
            raise VisualReviewReferenceError(
                "Candidate asset must be a panel for the review shot"
            )
        for other in thread.candidates:
            if other.id != candidate.id and other.status == "ready":
                other.status = "rejected"
        candidate.status = "accepted"
        thread.status = "resolved"
        asset.review_status = "approved"
        shot.active_panel_asset_id = asset.id
        shot.review_status = "draft"
        candidate.generation_metadata = {
            **candidate.generation_metadata,
            "acceptance": self._scope_revisions(thread, asset),
        }
        self.session.commit()
        self.session.refresh(candidate)
        return candidate

    def reject_candidate(self, candidate_id: str):
        candidate = self.session.get(models.VisualReviewCandidate, candidate_id)
        if candidate is None:
            return None
        if candidate.status != "ready":
            raise VisualReviewReferenceError("Candidate is not ready for rejection")
        candidate.status = "rejected"
        self.session.commit()
        self.session.refresh(candidate)
        return candidate
