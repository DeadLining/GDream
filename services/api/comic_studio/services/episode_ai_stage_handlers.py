import asyncio
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select

from comic_studio import models, schemas
from comic_studio.jobs import JobStore
from comic_studio.repositories import EpisodeRepository
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.episode_ai_orchestrator import (
    EpisodeAIStageContext,
    EpisodeAIStageNeedsReview,
)
from comic_studio.services.render_review import RenderReviewService, review_to_payload
from comic_studio.services.rendering import RenderingService
from comic_studio.services.review_publication import ReviewPublicationService


class EpisodeAIStageHandlers:
    def __init__(
        self,
        session_factory,
        data_root: Path,
        model_runtime,
        *,
        compositor_root: Path | None = None,
        render_executor=None,
        review_executor=None,
    ):
        self.session_factory = session_factory
        self.data_root = data_root.resolve()
        self.model_runtime = model_runtime
        self.compositor_root = compositor_root.resolve() if compositor_root else None
        self.render_executor = render_executor
        self.review_executor = review_executor

    def mapping(self):
        return {
            "references": self.references,
            "panels": self.panels,
            "panel_review": self.panel_review,
            "speech": self.speech,
            "videos": self.videos,
            "rendering": self.rendering,
            "quality_review": self.quality_review,
            "release_candidate": self.release_candidate,
            "release_gate": self.release_gate,
            "published": self.published,
        }

    def _episode_targets(self, episode_id: str):
        with self.session_factory() as session:
            episode = EpisodeRepository(session).get(episode_id)
            if episode is None:
                raise KeyError(episode_id)
            characters = list(
                session.scalars(
                    select(models.Character)
                    .where(models.Character.project_id == episode.project_id)
                    .order_by(models.Character.created_at, models.Character.id)
                )
            )
            shots = sorted(
                (shot for scene in episode.scenes for shot in scene.shots),
                key=lambda shot: (shot.scene.position, shot.position, shot.id),
            )
            return [item.id for item in characters], [item.id for item in shots]

    def _dialogue_ids(self, episode_id: str) -> list[str]:
        with self.session_factory() as session:
            episode = EpisodeRepository(session).get(episode_id)
            if episode is None:
                raise KeyError(episode_id)
            return [
                line.id
                for scene in episode.scenes
                for shot in scene.shots
                for line in shot.dialogue
                if line.text.strip()
            ]

    def _media_path(self, asset: models.Asset, label: str) -> Path:
        path = (self.data_root / asset.local_path).resolve()
        if self.data_root not in path.parents or not path.is_file():
            raise EpisodeAIStageNeedsReview(f"{label} media is missing: {asset.id}")
        return path

    def _image_asset(self, asset_id: str, label: str) -> models.Asset:
        with self.session_factory() as session:
            asset = session.get(models.Asset, asset_id)
            if asset is None:
                raise EpisodeAIStageNeedsReview(f"{label} asset is missing: {asset_id}")
            if not asset.provider or not asset.model or not asset.request_metadata.get("prompt"):
                raise EpisodeAIStageNeedsReview(
                    f"{label} generation metadata is incomplete: {asset_id}"
                )
            path = self._media_path(asset, label)
            try:
                with Image.open(path) as image:
                    image.verify()
                with Image.open(path) as image:
                    width, height = image.size
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                raise EpisodeAIStageNeedsReview(
                    f"{label} media is invalid: {asset_id}"
                ) from exc
            if width <= 0 or height <= 0:
                raise EpisodeAIStageNeedsReview(f"{label} dimensions are invalid: {asset_id}")
            session.expunge(asset)
            return asset

    async def references(self, context: EpisodeAIStageContext) -> dict:
        character_ids, _shot_ids = self._episode_targets(context.episode_id)
        reference_ids = []
        asset_ids = []
        for character_id in character_ids:
            with self.session_factory() as session:
                reference = session.scalar(
                    select(models.CharacterReference)
                    .where(
                        models.CharacterReference.character_id == character_id,
                        models.CharacterReference.reference_type.in_({"primary", "front"}),
                        models.CharacterReference.is_active.is_(True),
                        models.CharacterReference.review_status == "approved",
                    )
                    .order_by(models.CharacterReference.created_at.desc())
                )
                existing = (
                    (reference.id, reference.asset_id) if reference is not None else None
                )
            if existing is None:
                reference, asset = await self.model_runtime.execute_image(
                    "character",
                    character_id,
                    {"reference_type": "primary", "label": "AI 主参考"},
                )
                reference_id, asset_id = reference.id, asset.id
            else:
                reference_id, asset_id = existing
            self._image_asset(asset_id, "Character reference")
            with self.session_factory() as session:
                CharacterReferenceService(
                    session, self.data_root
                ).approve_and_activate(character_id, reference_id)
            reference_ids.append(reference_id)
            asset_ids.append(asset_id)
        return {
            "character_ids": character_ids,
            "reference_ids": reference_ids,
            "asset_ids": asset_ids,
        }

    async def panels(self, context: EpisodeAIStageContext) -> dict:
        _character_ids, shot_ids = self._episode_targets(context.episode_id)
        if not shot_ids:
            raise EpisodeAIStageNeedsReview("Episode has no shots")
        asset_ids = []
        for shot_id in shot_ids:
            with self.session_factory() as session:
                shot = session.get(models.Shot, shot_id)
                asset_id = shot.active_panel_asset_id
            if asset_id is None:
                asset = await self.model_runtime.execute_image(
                    "shot", shot_id, {"activate": True}
                )
                asset_id = asset.id
            self._image_asset(asset_id, "Shot panel")
            asset_ids.append(asset_id)
        return {"shot_ids": shot_ids, "asset_ids": asset_ids}

    async def panel_review(self, context: EpisodeAIStageContext) -> dict:
        _character_ids, shot_ids = self._episode_targets(context.episode_id)
        approved = []
        with self.session_factory() as session:
            for shot_id in shot_ids:
                shot = session.get(models.Shot, shot_id)
                if shot.active_panel_asset_id is None:
                    raise EpisodeAIStageNeedsReview(
                        f"Shot has no active panel: {shot_id}"
                    )
                self._image_asset(shot.active_panel_asset_id, "Shot panel")
                asset = session.get(models.Asset, shot.active_panel_asset_id)
                asset.review_status = "approved"
                shot.review_status = "approved"
                if not shot.video_prompt.strip():
                    shot.video_prompt = (
                        f"{shot.composition}。保持角色外观、场景空间、光线方向和首帧构图稳定，"
                        "动作自然连续。"
                    )
                if not shot.negative_video_prompt.strip():
                    shot.negative_video_prompt = (
                        "闪烁、变形、额外肢体、镜头抖动、角色换脸、字幕、水印"
                    )
                approved.append(shot_id)
            session.commit()
        return {"approved_shot_ids": approved}

    def _speech_asset(self, dialogue_id: str, asset_id: str) -> None:
        with self.session_factory() as session:
            line = session.get(models.DialogueLine, dialogue_id)
            asset = session.get(models.Asset, asset_id)
            if line is None or asset is None or line.audio_asset_id != asset.id:
                raise EpisodeAIStageNeedsReview(
                    f"Dialogue speech is not activated: {dialogue_id}"
                )
            if (
                asset.kind != f"dialogue:{dialogue_id}"
                or not asset.provider
                or not asset.model
                or not asset.request_metadata.get("text")
                or not asset.duration_seconds
                or asset.duration_seconds <= 0
                or line.duration_seconds <= 0
            ):
                raise EpisodeAIStageNeedsReview(
                    f"Dialogue speech metadata is invalid: {dialogue_id}"
                )
            path = self._media_path(asset, "Dialogue speech")
            if path.read_bytes()[:4] != b"RIFF":
                raise EpisodeAIStageNeedsReview(
                    f"Dialogue speech media is invalid: {dialogue_id}"
                )

    async def speech(self, context: EpisodeAIStageContext) -> dict:
        dialogue_ids = self._dialogue_ids(context.episode_id)
        asset_ids = []
        for dialogue_id in dialogue_ids:
            with self.session_factory() as session:
                line = session.get(models.DialogueLine, dialogue_id)
                if line.character_id is None:
                    raise EpisodeAIStageNeedsReview(
                        f"Dialogue has no character: {dialogue_id}"
                    )
                asset_id = (
                    line.audio_asset_id
                    if line.audio_asset_id and line.duration_seconds > 0
                    else None
                )
            if asset_id is None:
                asset = await self.model_runtime.execute_speech(dialogue_id)
                asset_id = asset.id
            self._speech_asset(dialogue_id, asset_id)
            asset_ids.append(asset_id)
        return {"dialogue_ids": dialogue_ids, "asset_ids": asset_ids}

    def _video_asset(self, shot_id: str, asset_id: str) -> None:
        with self.session_factory() as session:
            shot = session.get(models.Shot, shot_id)
            asset = session.get(models.Asset, asset_id)
            if shot is None or asset is None or shot.active_video_asset_id != asset.id:
                raise EpisodeAIStageNeedsReview(
                    f"Shot video is not activated: {shot_id}"
                )
            if (
                asset.kind != f"video:{shot_id}"
                or asset.parent_asset_id != shot.active_panel_asset_id
                or not asset.provider
                or not asset.model
                or not asset.request_metadata.get("prompt")
                or not asset.duration_seconds
                or asset.duration_seconds <= 0
            ):
                raise EpisodeAIStageNeedsReview(
                    f"Shot video metadata is invalid: {shot_id}"
                )
            path = self._media_path(asset, "Shot video")
            if b"ftyp" not in path.read_bytes()[:32]:
                raise EpisodeAIStageNeedsReview(
                    f"Shot video media is invalid: {shot_id}"
                )

    async def videos(self, context: EpisodeAIStageContext) -> dict:
        _character_ids, shot_ids = self._episode_targets(context.episode_id)
        asset_ids = []
        for shot_id in shot_ids:
            with self.session_factory() as session:
                shot = session.get(models.Shot, shot_id)
                if shot.review_status != "approved" or not shot.active_panel_asset_id:
                    raise EpisodeAIStageNeedsReview(
                        f"Shot is not ready for video: {shot_id}"
                    )
                asset_id = shot.active_video_asset_id
            if asset_id is None:
                asset = await self.model_runtime.execute_video(shot_id, True)
                asset_id = asset.id
            self._video_asset(shot_id, asset_id)
            asset_ids.append(asset_id)
        return {"shot_ids": shot_ids, "asset_ids": asset_ids}

    def _latest_render_job(self, episode_id: str):
        with self.session_factory() as session:
            job = session.scalar(
                select(models.Job)
                .where(
                    models.Job.operation == "render_episode",
                    models.Job.target_type == "episode",
                    models.Job.target_id == episode_id,
                    models.Job.status == "succeeded",
                )
                .order_by(models.Job.created_at.desc())
            )
            if job is None:
                return None
            session.expunge(job)
            return job

    def _render_path(self, job: models.Job) -> tuple[str, Path]:
        relative = str(job.result_metadata.get("output_path", ""))
        path = (self.data_root / relative).resolve()
        if (
            not relative
            or self.data_root not in path.parents
            or not path.is_file()
            or b"ftyp" not in path.read_bytes()[:32]
        ):
            raise EpisodeAIStageNeedsReview(
                f"Episode render is invalid: {job.target_id}"
            )
        return relative, path

    def _render_default(self, episode_id: str, output_path: Path) -> dict:
        if self.compositor_root is None:
            raise RuntimeError("Compositor root is not configured")
        with self.session_factory() as session:
            return RenderingService(
                session, self.data_root, self.compositor_root
            ).render(episode_id, output_path)

    async def rendering(self, context: EpisodeAIStageContext) -> dict:
        existing = self._latest_render_job(context.episode_id)
        if existing is not None:
            relative, _path = self._render_path(existing)
            return {
                "job_id": existing.id,
                "output_path": relative,
                "media_url": f"/media/{relative}",
                "probe": existing.result_metadata.get("probe", {}),
            }
        with self.session_factory() as session:
            episode = session.get(models.Episode, context.episode_id)
            if episode is None:
                raise KeyError(context.episode_id)
            job = JobStore(session).create(
                "render_episode", "episode", episode.id, {"ai_run_id": context.run_id}
            )
            JobStore(session).transition(job.id, "running", progress=5)
            relative = str(
                Path("projects")
                / episode.project_id
                / "episodes"
                / episode.id
                / "renders"
                / f"{job.id}.mp4"
            )
            job_id = job.id
        output_path = self.data_root / relative
        try:
            executor = self.render_executor or self._render_default
            probe = await asyncio.to_thread(executor, context.episode_id, output_path)
            if not output_path.is_file() or b"ftyp" not in output_path.read_bytes()[:32]:
                raise EpisodeAIStageNeedsReview(
                    f"Episode render is invalid: {context.episode_id}"
                )
            with self.session_factory() as session:
                JobStore(session).transition(
                    job_id,
                    "succeeded",
                    result_metadata={
                        "episode_id": context.episode_id,
                        "output_path": relative,
                        "media_url": f"/media/{relative}",
                        "probe": probe,
                    },
                )
        except Exception as exc:
            with self.session_factory() as session:
                JobStore(session).transition(
                    job_id, "failed", error=f"{type(exc).__name__}: {exc}"
                )
            raise
        return {
            "job_id": job_id,
            "output_path": relative,
            "media_url": f"/media/{relative}",
            "probe": probe,
        }

    def _review(self, episode_id: str, job_id: str, render_path: Path) -> dict:
        with self.session_factory() as session:
            record = session.scalar(
                select(models.RenderReviewRecord)
                .where(
                    models.RenderReviewRecord.episode_id == episode_id,
                    models.RenderReviewRecord.job_id == job_id,
                )
                .order_by(models.RenderReviewRecord.created_at.desc())
            )
            if record is None:
                if self.review_executor is not None:
                    record = self.review_executor(
                        session, render_path, episode_id, job_id
                    )
                else:
                    record = RenderReviewService(session).review_render(
                        render_path, episode_id, job_id=job_id
                    )
                session.commit()
            return review_to_payload(record)

    async def quality_review(self, context: EpisodeAIStageContext) -> dict:
        job = self._latest_render_job(context.episode_id)
        if job is None:
            raise EpisodeAIStageNeedsReview(
                f"Episode has no successful render: {context.episode_id}"
            )
        _relative, path = self._render_path(job)
        payload = await asyncio.to_thread(
            self._review, context.episode_id, job.id, path
        )
        if payload["overall_pass"] is not True:
            raise EpisodeAIStageNeedsReview(
                f"Episode render quality review failed: {context.episode_id}"
            )
        return {
            "job_id": job.id,
            "review_id": payload["id"],
            "overall_pass": True,
            "findings": payload["findings"],
        }

    @staticmethod
    def _candidate_version(context: EpisodeAIStageContext) -> str:
        return f"AI-{context.run_id}"

    async def release_candidate(self, context: EpisodeAIStageContext) -> dict:
        job = self._latest_render_job(context.episode_id)
        if job is None:
            raise EpisodeAIStageNeedsReview(
                f"Episode has no successful render: {context.episode_id}"
            )
        relative, _path = self._render_path(job)
        version = self._candidate_version(context)
        with self.session_factory() as session:
            candidate = session.scalar(
                select(models.ReleaseCandidate).where(
                    models.ReleaseCandidate.episode_id == context.episode_id,
                    models.ReleaseCandidate.version == version,
                )
            )
            if candidate is None:
                candidate = ReviewPublicationService(
                    session, self.data_root
                ).create_release_candidate(
                    context.episode_id,
                    schemas.ReleaseCandidateCreate(
                        version=version,
                        render_path=relative,
                    ),
                )
            return {
                "candidate_id": candidate.id,
                "version": candidate.version,
                "render_path": candidate.render_path,
            }

    def _candidate(self, context: EpisodeAIStageContext, session):
        candidate = session.scalar(
            select(models.ReleaseCandidate).where(
                models.ReleaseCandidate.episode_id == context.episode_id,
                models.ReleaseCandidate.version == self._candidate_version(context),
            )
        )
        if candidate is None:
            raise EpisodeAIStageNeedsReview(
                f"Release candidate is missing: {context.episode_id}"
            )
        return candidate

    async def release_gate(self, context: EpisodeAIStageContext) -> dict:
        with self.session_factory() as session:
            service = ReviewPublicationService(session)
            candidate = self._candidate(context, session)
            gate = service.gate(candidate.id)
            if gate is None or not gate.ready:
                raise EpisodeAIStageNeedsReview(
                    f"Release gate is blocked: {context.episode_id}"
                )
            if candidate.status == "draft":
                candidate = service.approve(candidate.id)
            return {
                "candidate_id": candidate.id,
                "ready": True,
                "production_ready": gate.production_ready,
            }

    async def published(self, context: EpisodeAIStageContext) -> dict:
        with self.session_factory() as session:
            service = ReviewPublicationService(session)
            candidate = self._candidate(context, session)
            record, _created = service.publish(
                candidate.id,
                schemas.PublicationCreate(
                    platform="internal_master",
                    idempotency_key=f"episode-ai:{context.run_id}:internal-master",
                ),
            )
            return {
                "candidate_id": candidate.id,
                "publication_id": record.id,
                "platform": record.platform,
                "status": record.status,
            }
