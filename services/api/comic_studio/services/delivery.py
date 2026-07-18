from __future__ import annotations

import json
import os
from pathlib import Path
import zipfile

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.services.review_publication import ReviewPublicationService


class DeliveryValidationError(ValueError):
    pass


class DeliveryCandidateNotApproved(RuntimeError):
    pass


class DeliveryCandidateRenderStale(RuntimeError):
    pass


class DeliveryPackageService:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    def create(self, episode_id: str, data: schemas.DeliveryPackageCreate):
        episode = self.session.scalar(
            select(models.Episode)
            .where(models.Episode.id == episode_id)
            .options(
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue),
                selectinload(models.Episode.project),
            )
        )
        if episode is None:
            return None
        candidate = self.session.get(models.ReleaseCandidate, data.release_candidate_id)
        if candidate is None or candidate.episode_id != episode_id:
            raise DeliveryValidationError(
                "Release candidate must belong to the delivery episode"
            )
        if candidate.status not in {"approved", "published"}:
            raise DeliveryCandidateNotApproved
        if not ReviewPublicationService(
            self.session, self.data_root
        ).candidate_render_is_current(candidate):
            raise DeliveryCandidateRenderStale

        enabled = {item.kind for item in data.outputs if item.enabled}
        if not enabled:
            raise DeliveryValidationError("At least one delivery output is required")
        expected_video = self._video_kind(episode.project.aspect_ratio)
        unsupported = enabled & {"clean_master", "audio_mix"}
        requested_videos = enabled & {"landscape_video", "vertical_video"}
        if unsupported or requested_videos - {expected_video}:
            raise DeliveryValidationError(
                "Requested delivery outputs cannot be generated from the current master"
            )

        render_path = self._render_path(episode, candidate)
        package = models.DeliveryPackage(
            project_id=episode.project_id,
            episode_id=episode_id,
            release_candidate_id=candidate.id,
            preset_name=data.preset_name,
            outputs=[item.model_dump() for item in data.outputs],
            checks={
                "release_candidate_approved": True,
                "render_complete": True,
                "archive_created": False,
            },
            status="running",
        )
        self.session.add(package)
        self.session.flush()

        relative_archive = (
            Path("projects")
            / episode.project_id
            / "episodes"
            / episode.id
            / "delivery"
            / f"{package.id}.zip"
        )
        archive_path = self._resolve(relative_archive)
        temporary_path = archive_path.with_suffix(".zip.tmp")
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(
                temporary_path, mode="w", compression=zipfile.ZIP_DEFLATED
            ) as archive:
                if expected_video in enabled:
                    archive.write(render_path, "video/final.mp4")
                if "subtitles" in enabled:
                    archive.writestr(
                        "subtitles/subtitles.srt", self._subtitles(episode)
                    )
                if "asset_manifest" in enabled:
                    archive.writestr(
                        "manifest.json",
                        json.dumps(
                            self._manifest(episode, candidate, enabled),
                            ensure_ascii=False,
                            indent=2,
                        ),
                    )
            os.replace(temporary_path, archive_path)
            package.artifact_path = relative_archive.as_posix()
            package.checks = {**package.checks, "archive_created": True}
            package.status = "completed"
            self.session.commit()
            self.session.refresh(package)
            return package
        except Exception:
            self.session.rollback()
            temporary_path.unlink(missing_ok=True)
            archive_path.unlink(missing_ok=True)
            raise

    def list(self, episode_id: str):
        if self.session.get(models.Episode, episode_id) is None:
            return None
        packages = list(
            self.session.scalars(
                select(models.DeliveryPackage)
                .where(models.DeliveryPackage.episode_id == episode_id)
                .order_by(models.DeliveryPackage.created_at.desc())
            )
        )
        repaired = False
        for package in packages:
            missing_archive = (
                package.status == "completed" and self._artifact_file(package) is None
            )
            interrupted = package.status in {"queued", "running"}
            if missing_archive or interrupted:
                package.status = "failed"
                package.artifact_path = ""
                package.checks = {**package.checks, "archive_created": False}
                repaired = True
        if repaired:
            self.session.commit()
        return packages

    def artifact(self, package_id: str) -> tuple[models.DeliveryPackage, Path] | None:
        package = self.session.get(models.DeliveryPackage, package_id)
        if package is None or package.status != "completed":
            return None
        path = self._artifact_file(package)
        return (package, path) if path is not None else None

    def _artifact_file(self, package: models.DeliveryPackage) -> Path | None:
        if not package.artifact_path:
            return None
        try:
            path = self._resolve(Path(package.artifact_path))
        except DeliveryValidationError:
            return None
        return path if path.is_file() else None

    def _render_path(
        self, episode: models.Episode, candidate: models.ReleaseCandidate
    ) -> Path:
        relative = Path(candidate.render_path)
        expected_root = (
            Path("projects")
            / episode.project_id
            / "episodes"
            / episode.id
            / "renders"
        )
        try:
            relative.relative_to(expected_root)
        except ValueError as exc:
            raise DeliveryValidationError(
                "Release render must belong to the delivery episode"
            ) from exc
        path = self._resolve(relative)
        if not path.is_file():
            raise DeliveryValidationError("Release render file does not exist")
        return path

    def _resolve(self, relative: Path) -> Path:
        if relative.is_absolute():
            raise DeliveryValidationError("Delivery path must be relative")
        path = (self.data_root / relative).resolve()
        try:
            path.relative_to(self.data_root)
        except ValueError as exc:
            raise DeliveryValidationError("Delivery path escapes the data root") from exc
        return path

    @staticmethod
    def _video_kind(aspect_ratio: str) -> str:
        try:
            width, height = (float(value) for value in aspect_ratio.split(":", 1))
        except (TypeError, ValueError):
            return "landscape_video"
        return "vertical_video" if height > width else "landscape_video"

    def _manifest(
        self,
        episode: models.Episode,
        candidate: models.ReleaseCandidate,
        enabled: set[str],
    ) -> dict:
        assets = self.session.scalars(
            select(models.Asset)
            .where(models.Asset.project_id == episode.project_id)
            .order_by(models.Asset.created_at, models.Asset.id)
        )
        return {
            "schema": "ai-comic-delivery/v1",
            "project": {
                "id": episode.project.id,
                "title": episode.project.title,
                "aspect_ratio": episode.project.aspect_ratio,
            },
            "episode": {"id": episode.id, "title": episode.title},
            "release_candidate": {
                "id": candidate.id,
                "version": candidate.version,
                "render_path": candidate.render_path,
            },
            "outputs": sorted(enabled),
            "assets": [
                {
                    "id": asset.id,
                    "kind": asset.kind,
                    "media_type": asset.media_type,
                    "checksum": asset.checksum,
                    "local_path": asset.local_path,
                }
                for asset in assets
            ],
        }

    @classmethod
    def _subtitles(cls, episode: models.Episode) -> str:
        entries: list[str] = []
        index = 0
        shot_offset = 0.0
        for scene in sorted(episode.scenes, key=lambda item: item.position):
            for shot in sorted(scene.shots, key=lambda item: item.position):
                for line in sorted(shot.dialogue, key=lambda item: item.position):
                    text = (line.subtitle_text or line.text).strip()
                    if not text:
                        continue
                    index += 1
                    start = shot_offset + max(0.0, line.start_seconds)
                    end = start + max(0.001, line.duration_seconds)
                    entries.append(
                        f"{index}\n{cls._timestamp(start)} --> {cls._timestamp(end)}\n{text}\n"
                    )
                shot_offset += max(0.0, shot.duration_seconds)
        return "\n".join(entries)

    @staticmethod
    def _timestamp(seconds: float) -> str:
        milliseconds = max(0, round(seconds * 1000))
        hours, remainder = divmod(milliseconds, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        whole_seconds, millis = divmod(remainder, 1000)
        return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{millis:03d}"
