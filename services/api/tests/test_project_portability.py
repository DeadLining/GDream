"""M2.3 — Project ZIP portability tests (export → import round-trip)."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

from comic_studio import models
from comic_studio.services.project_portability import (
    MANIFEST_SCHEMA,
    ProjectPortabilityError,
    ProjectPortabilityService,
)


def _seed_project(session, data_root: Path) -> str:
    """Seed a project with 1 character, 1 episode, 1 scene, 1 shot, 1 dialogue line, 1 asset."""
    project = models.Project(
        title="夜行", logline="寻找", story_bible="重庆",
        visual_style="comic", aspect_ratio="9:16", language="Chinese",
    )
    character = models.Character(
        project=project, name="林深", role="主角",
        appearance_bible="黑发", personality="沉稳",
        continuity_rules="疤痕在左眉", voice_speaker="male_adult",
    )
    episode = models.Episode(
        project=project, title="雨夜", premise="线索",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode, position=1, location="巷道", summary="发现",
        estimated_duration_seconds=8,
    )
    shot = models.Shot(
        scene=scene, position=1, shot_type="wide", duration_seconds=4,
        composition="全景", image_prompt="雨中", video_prompt="推进",
    )
    line = models.DialogueLine(
        shot=shot, position=1, text="来了", subtitle_text="来了",
        character_id=None, emotion="tense",
    )
    session.add_all([project, character, episode, scene, shot, line])
    session.flush()

    # Seed one asset with actual bytes on disk so we can verify round-trip.
    asset_dir = data_root / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    asset_file = asset_dir / "panel-1.png"
    asset_file.write_bytes(b"\x89PNG\r\n\x1a\nfake-png-bytes")
    asset = models.Asset(
        project_id=project.id, kind=f"panel:{shot.id}",
        local_path="assets/panel-1.png", media_type="image/png",
        provider="test", model="test", checksum="a" * 64,
    )
    session.add(asset)
    session.commit()
    return project.id


def test_export_writes_valid_zip_with_manifest(db_session, tmp_path):
    project_id = _seed_project(db_session, tmp_path)
    result = ProjectPortabilityService(db_session, data_root=tmp_path).export_project(project_id)

    assert result.project_id == project_id
    assert result.zip_path.is_file()
    assert result.bytes_written > 0

    with zipfile.ZipFile(result.zip_path) as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "database.json" in names
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["schema"] == MANIFEST_SCHEMA
        assert manifest["project_id"] == project_id
        assert manifest["project_title"] == "夜行"
        assert manifest["entity_counts"]["episodes"] == 1
        assert manifest["entity_counts"]["shots"] == 1
        database = json.loads(zf.read("database.json"))
        assert database["project"]["title"] == "夜行"
        assert len(database["characters"]) == 1
        assert len(database["dialogue_lines"]) == 1
        # Asset binary packed.
        assert any(name.startswith("assets/") for name in names)
        assert zf.read("assets/" + "a" * 64) == b"\x89PNG\r\n\x1a\nfake-png-bytes"


def test_export_unknown_project_raises(db_session, tmp_path):
    import pytest

    with pytest.raises(ProjectPortabilityError, match="Project not found"):
        ProjectPortabilityService(db_session, data_root=tmp_path).export_project("nope")


def test_import_round_trip_preserves_structure(db_session, tmp_path):
    project_id = _seed_project(db_session, tmp_path)
    service = ProjectPortabilityService(db_session, data_root=tmp_path)
    exported = service.export_project(project_id)

    # Import as a new project.
    imported = service.import_project(exported.zip_path)

    assert imported.project_id != project_id  # new ID assigned
    assert imported.warnings == []  # same alembic revision

    new_project = db_session.get(models.Project, imported.project_id)
    assert new_project is not None
    assert new_project.title == "夜行 (imported)"
    assert new_project.logline == "寻找"

    # Episode/scene/shot/dialogue counts preserved.
    assert len(new_project.episodes) == 1
    episode = new_project.episodes[0]
    assert len(episode.scenes) == 1
    assert len(episode.scenes[0].shots) == 1
    assert len(episode.scenes[0].shots[0].dialogue) == 1
    # Character preserved.
    assert len(new_project.characters) == 1
    assert new_project.characters[0].name == "林深"


def test_import_rejects_wrong_schema(db_session, tmp_path):
    project_id = _seed_project(db_session, tmp_path)
    service = ProjectPortabilityService(db_session, data_root=tmp_path)
    exported = service.export_project(project_id)

    # Tamper with manifest schema.
    import io

    buffer = io.BytesIO()
    with zipfile.ZipFile(exported.zip_path) as src, zipfile.ZipFile(buffer, "w") as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "manifest.json":
                manifest = json.loads(data)
                manifest["schema"] = "bogus/v2"
                data = json.dumps(manifest).encode()
            dst.writestr(item, data)
    bad_zip = tmp_path / "tampered.zip"
    bad_zip.write_bytes(buffer.getvalue())

    import pytest

    with pytest.raises(ProjectPortabilityError, match="Unsupported export schema"):
        service.import_project(bad_zip)


def test_import_assets_written_to_disk(db_session, tmp_path):
    project_id = _seed_project(db_session, tmp_path)
    service = ProjectPortabilityService(db_session, data_root=tmp_path)
    exported = service.export_project(project_id)
    imported = service.import_project(exported.zip_path)

    # The imported project should have 1 asset with a local file under imported/.
    from sqlalchemy import select

    assets = list(db_session.scalars(
        select(models.Asset).where(models.Asset.project_id == imported.project_id)
    ))
    assert len(assets) == 1
    asset = assets[0]
    assert asset.local_path.startswith("imported/")
    abs_path = (tmp_path / asset.local_path).resolve()
    assert abs_path.is_file()
    assert abs_path.read_bytes() == b"\x89PNG\r\n\x1a\nfake-png-bytes"
