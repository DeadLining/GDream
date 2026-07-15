"""M2.3 — Project ZIP portability.

Exports a project's *story structure* (project + characters + episodes +
scenes + shots + dialogue lines + assets) to a self-contained ZIP archive,
and re-imports it as a new project with fresh IDs while preserving foreign
key relationships.

ZIP layout::

    project-export.zip
    ├── manifest.json      # schema version + alembic revision + export metadata
    ├── database.json      # serialized core entities (grouped by table)
    └── assets/            # binary asset payloads, keyed by sha256

Operational entities (production_runs, render_reviews, jobs) are intentionally
excluded — they describe transient execution state, not the project's creative
content. Operators can re-run production after import.
"""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.config import get_settings


MANIFEST_SCHEMA = "ai-comic-studio-project-export/v1"
MANIFEST_FILENAME = "manifest.json"
DATABASE_FILENAME = "database.json"
ASSETS_DIR = "assets"


class ProjectPortabilityError(RuntimeError):
    """Raised when an export or import cannot be completed."""


@dataclass(frozen=True)
class ExportResult:
    zip_path: Path
    project_id: str
    bytes_written: int


@dataclass(frozen=True)
class ImportResult:
    project_id: str
    warnings: list[str]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _alembic_head() -> str:
    """Return the latest alembic revision id known to the codebase.

    Hard-coded rather than read at runtime so the export does not require a
    live alembic context. Update this constant when bumping the migration head.
    """
    return "20260721_29"


def _row_to_dict(instance: object) -> dict[str, Any]:
    """Serialize a SQLAlchemy model instance to a plain dict of column values."""
    mapper = inspect(type(instance))  # type: ignore[arg-type]
    return {column.key: getattr(instance, column.key) for column in mapper.columns}


def _serialize_project_tree(project: models.Project) -> dict[str, Any]:
    """Walk the project's core relationships and produce grouped dicts."""
    characters = [_row_to_dict(c) for c in project.characters]
    library_assets = [
        {
            "id": asset.id,
            "project_id": asset.project_id,
            "media_asset_id": asset.media_asset_id,
            "kind": asset.kind,
            "name": asset.name,
            "description": asset.description,
            "tags": asset.tags,
            "metadata": asset.asset_metadata,
            "created_at": asset.created_at,
            "updated_at": asset.updated_at,
        }
        for asset in project.library_assets
    ]
    library_asset_scene_bindings = [
        _row_to_dict(binding)
        for asset in project.library_assets
        for binding in asset.scene_bindings
    ]
    episodes: list[dict[str, Any]] = []
    scenes: list[dict[str, Any]] = []
    shots: list[dict[str, Any]] = []
    dialogue: list[dict[str, Any]] = []
    for episode in project.episodes:
        episodes.append(_row_to_dict(episode))
        for scene in episode.scenes:
            scenes.append(_row_to_dict(scene))
            for shot in scene.shots:
                shots.append(_row_to_dict(shot))
                for line in shot.dialogue:
                    dialogue.append(_row_to_dict(line))
    # Assets belong to the project directly; loaded by caller to avoid N+1.
    return {
        "project": _row_to_dict(project),
        "characters": characters,
        "library_assets": library_assets,
        "library_asset_scene_bindings": library_asset_scene_bindings,
        "episodes": episodes,
        "scenes": scenes,
        "shots": shots,
        "dialogue_lines": dialogue,
        "assets": [],  # filled by caller
    }


def _load_assets_for_project(session: Session, project_id: str) -> list[models.Asset]:
    return list(
        session.scalars(
            select(models.Asset).where(models.Asset.project_id == project_id)
        )
    )


class ProjectPortabilityService:
    """Export/import projects as ZIP archives."""

    def __init__(self, session: Session, data_root: Path | None = None):
        self.session = session
        self._data_root = data_root

    @property
    def data_root(self) -> Path:
        return self._data_root if self._data_root is not None else get_settings().data_root

    # --- Export ----------------------------------------------------------

    def export_project(self, project_id: str) -> ExportResult:
        project = self.session.scalar(
            select(models.Project)
            .where(models.Project.id == project_id)
            .options(
                selectinload(models.Project.characters),
                selectinload(models.Project.library_assets).selectinload(
                    models.LibraryAsset.scene_bindings
                ),
                selectinload(models.Project.episodes)
                .selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue),
            )
        )
        if project is None:
            raise ProjectPortabilityError(f"Project not found: {project_id}")

        tree = _serialize_project_tree(project)
        asset_rows = _load_assets_for_project(self.session, project_id)
        tree["assets"] = [_row_to_dict(a) for a in asset_rows]

        manifest = {
            "schema": MANIFEST_SCHEMA,
            "alembic_revision": _alembic_head(),
            "project_id": project.id,
            "project_title": project.title,
            "exported_at": _utc_now_iso(),
            "entity_counts": {k: len(v) for k, v in tree.items() if isinstance(v, list)},
        }

        # Write ZIP into data_root/exports/.
        export_dir = self.data_root / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in project.title)[:40]
        zip_path = export_dir / f"{safe_title}-{project.id[:8]}.zip"

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(MANIFEST_FILENAME, json.dumps(manifest, indent=2, ensure_ascii=False))
            zf.writestr(
                DATABASE_FILENAME,
                json.dumps(tree, indent=2, ensure_ascii=False, default=str),
            )
            # Pack each unique asset binary once (by checksum).
            seen_checksums: set[str] = set()
            for asset in asset_rows:
                checksum = asset.checksum or asset.id
                if checksum in seen_checksums:
                    continue
                seen_checksums.add(checksum)
                payload = self._read_asset_bytes(asset)
                if payload is not None:
                    zf.writestr(f"{ASSETS_DIR}/{checksum}", payload)
        data = buffer.getvalue()
        zip_path.write_bytes(data)
        return ExportResult(zip_path=zip_path, project_id=project.id, bytes_written=len(data))

    def _read_asset_bytes(self, asset: models.Asset) -> bytes | None:
        if not asset.local_path:
            return None
        path = (self.data_root / asset.local_path).resolve()
        try:
            # Path-traversal guard.
            path.relative_to(self.data_root.resolve())
        except ValueError:
            return None
        if not path.is_file():
            return None
        return path.read_bytes()

    # --- Import ----------------------------------------------------------

    def import_project(self, zip_path: Path) -> ImportResult:
        if not zip_path.is_file():
            raise ProjectPortabilityError(f"Import archive not found: {zip_path}")

        warnings: list[str] = []
        with zipfile.ZipFile(zip_path, mode="r") as zf:
            try:
                manifest = json.loads(zf.read(MANIFEST_FILENAME))
            except KeyError as exc:
                raise ProjectPortabilityError("Missing manifest.json") from exc
            try:
                database = json.loads(zf.read(DATABASE_FILENAME))
            except KeyError as exc:
                raise ProjectPortabilityError("Missing database.json") from exc

            schema = manifest.get("schema")
            if schema != MANIFEST_SCHEMA:
                raise ProjectPortabilityError(
                    f"Unsupported export schema: {schema!r} (expected {MANIFEST_SCHEMA!r})"
                )
            export_revision = manifest.get("alembic_revision")
            if export_revision != _alembic_head():
                warnings.append(
                    f"Export alembic revision {export_revision!r} differs from current "
                    f"head {_alembic_head()!r}; importing anyway."
                )

            asset_payloads = self._extract_asset_payloads(zf)

        # Phase 1 — assign new IDs and build FK maps.
        id_maps: dict[str, dict[str, str]] = {
            "project": {},
            "character": {},
            "library_asset": {},
            "episode": {},
            "scene": {},
            "shot": {},
            "dialogue_line": {},
            "asset": {},
        }

        def remap(table: str, old_id: str) -> str:
            new = id_maps[table].get(old_id)
            if new is None:
                new = models.new_id()
                id_maps[table][old_id] = new
            return new

        # Phase 2 — insert in FK order.
        # Project.
        old_project = database["project"]
        new_project_id = remap("project", old_project["id"])
        project = models.Project(
            id=new_project_id,
            title=f"{old_project['title']} (imported)",
            logline=old_project.get("logline", ""),
            story_bible=old_project.get("story_bible", ""),
            visual_style=old_project.get("visual_style", ""),
            aspect_ratio=old_project.get("aspect_ratio", "9:16"),
            language=old_project.get("language", "Chinese"),
        )
        self.session.add(project)
        self.session.flush()

        # Project-level scene, prop, costume, and sound catalog entries.
        for row in database.get("library_assets", []):
            library_asset = models.LibraryAsset(
                id=remap("library_asset", row["id"]),
                project_id=new_project_id,
                kind=row.get("kind", "scene"),
                name=row.get("name", ""),
                description=row.get("description", ""),
                tags=row.get("tags", []),
                asset_metadata=row.get("metadata", {}),
            )
            self.session.add(library_asset)
        self.session.flush()

        # Characters.
        for row in database.get("characters", []):
            char = models.Character(
                id=remap("character", row["id"]),
                project_id=new_project_id,
                name=row.get("name", ""),
                role=row.get("role", ""),
                appearance_bible=row.get("appearance_bible", ""),
                personality=row.get("personality", ""),
                continuity_rules=row.get("continuity_rules", ""),
                negative_constraints=row.get("negative_constraints", ""),
                voice_speaker=row.get("voice_speaker", ""),
                voice_instruction=row.get("voice_instruction", ""),
            )
            self.session.add(char)
        self.session.flush()

        # Episodes → scenes → shots → dialogue.
        for ep_row in database.get("episodes", []):
            episode = models.Episode(
                id=remap("episode", ep_row["id"]),
                project_id=new_project_id,
                title=ep_row.get("title", ""),
                premise=ep_row.get("premise", ""),
                target_duration_seconds=ep_row.get("target_duration_seconds", 60),
            )
            self.session.add(episode)
        self.session.flush()

        for sc_row in database.get("scenes", []):
            scene = models.Scene(
                id=remap("scene", sc_row["id"]),
                episode_id=id_maps["episode"][sc_row["episode_id"]],
                position=sc_row.get("position", 1),
                location=sc_row.get("location", ""),
                summary=sc_row.get("summary", ""),
                estimated_duration_seconds=sc_row.get("estimated_duration_seconds", 0),
            )
            self.session.add(scene)
        self.session.flush()

        for row in database.get("library_asset_scene_bindings", []):
            library_asset_id = id_maps["library_asset"].get(row["library_asset_id"])
            scene_id = id_maps["scene"].get(row["scene_id"])
            if library_asset_id is None or scene_id is None:
                warnings.append("Skipped library asset scene binding with missing target")
                continue
            self.session.add(
                models.LibraryAssetSceneBinding(
                    library_asset_id=library_asset_id,
                    scene_id=scene_id,
                )
            )
        self.session.flush()

        for sh_row in database.get("shots", []):
            shot = models.Shot(
                id=remap("shot", sh_row["id"]),
                scene_id=id_maps["scene"][sh_row["scene_id"]],
                position=sh_row.get("position", 1),
                shot_type=sh_row.get("shot_type", "wide"),
                duration_seconds=sh_row.get("duration_seconds", 0),
                composition=sh_row.get("composition", ""),
                camera_motion=sh_row.get("camera_motion", "push_in"),
                image_prompt=sh_row.get("image_prompt", ""),
                negative_prompt=sh_row.get("negative_prompt", ""),
                video_prompt=sh_row.get("video_prompt", ""),
                negative_video_prompt=sh_row.get("negative_video_prompt", ""),
                review_status=sh_row.get("review_status", "draft"),
                render_status=sh_row.get("render_status", "pending"),
                video_render_status=sh_row.get("video_render_status", "pending"),
            )
            self.session.add(shot)
        self.session.flush()

        for dl_row in database.get("dialogue_lines", []):
            line = models.DialogueLine(
                id=remap("dialogue_line", dl_row["id"]),
                shot_id=id_maps["shot"][dl_row["shot_id"]],
                position=dl_row.get("position", 1),
                text=dl_row.get("text", ""),
                subtitle_text=dl_row.get("subtitle_text", ""),
                character_id=(
                    id_maps["character"][dl_row["character_id"]]
                    if dl_row.get("character_id")
                    and dl_row["character_id"] in id_maps["character"]
                    else None
                ),
                emotion=dl_row.get("emotion", "neutral"),
                performance_instruction=dl_row.get("performance_instruction", ""),
                start_seconds=dl_row.get("start_seconds", 0),
                duration_seconds=dl_row.get("duration_seconds", 0),
            )
            self.session.add(line)
        self.session.flush()

        # Assets — write binary payloads into the new data_root under a fresh path.
        for as_row in database.get("assets", []):
            checksum = as_row.get("checksum") or as_row["id"]
            payload = asset_payloads.get(checksum)
            local_path = None
            if payload is not None and as_row.get("local_path"):
                # Preserve the suffix of the original path.
                old_path = Path(as_row["local_path"])
                suffix = old_path.suffix
                new_relative = Path("imported") / f"{models.new_id()}{suffix}"
                abs_path = (self.data_root / new_relative).resolve()
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                abs_path.write_bytes(payload)
                local_path = str(new_relative)
            asset = models.Asset(
                id=remap("asset", as_row["id"]),
                project_id=new_project_id,
                kind=as_row.get("kind", "asset"),
                local_path=local_path or as_row.get("local_path", ""),
                media_type=as_row.get("media_type", "application/octet-stream"),
                provider=as_row.get("provider", "imported"),
                model=as_row.get("model", "imported"),
                checksum=checksum,
            )
            self.session.add(asset)
        self.session.flush()

        for row in database.get("library_assets", []):
            old_media_id = row.get("media_asset_id")
            if not old_media_id:
                continue
            library_asset = self.session.get(
                models.LibraryAsset, id_maps["library_asset"][row["id"]]
            )
            library_asset.media_asset_id = id_maps["asset"].get(old_media_id)
            if library_asset.media_asset_id is None:
                warnings.append("Skipped missing library asset media reference")
        self.session.commit()

        return ImportResult(project_id=new_project_id, warnings=warnings)

    def _extract_asset_payloads(self, zf: zipfile.ZipFile) -> dict[str, bytes]:
        payloads: dict[str, bytes] = {}
        for info in zf.infolist():
            if info.filename.startswith(f"{ASSETS_DIR}/") and not info.is_dir():
                key = info.filename[len(ASSETS_DIR) + 1:]
                payloads[key] = zf.read(info.filename)
        return payloads


__all__: Iterable[str] = (
    "DATABASE_FILENAME",
    "ExportResult",
    "ImportResult",
    "MANIFEST_FILENAME",
    "MANIFEST_SCHEMA",
    "ProjectPortabilityError",
    "ProjectPortabilityService",
)
