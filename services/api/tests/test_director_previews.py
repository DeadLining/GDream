from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from comic_studio import models
from comic_studio.services.director_previews import (
    MAX_DIRECTOR_PREVIEW_BYTES,
    DirectorPreviewError,
    DirectorPreviewService,
)
from comic_studio.services.director_stages import DirectorStageService
from comic_studio.services.episode_deletion import EpisodeDeletionService


def _png(width: int = 8, height: int = 6, color=(24, 120, 180, 255)) -> bytes:
    buffer = BytesIO()
    Image.new("RGBA", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _camera(session):
    project = models.Project(
        title="雨夜",
        logline="追查",
        story_bible="设定",
        visual_style="漫画",
    )
    episode = models.Episode(
        project=project,
        title="第一集",
        premise="追查",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="天台",
        summary="对峙",
        estimated_duration_seconds=10,
    )
    scene.shots.append(
        models.Shot(
            position=1,
            shot_type="medium",
            duration_seconds=5,
            composition="双人对峙",
        )
    )
    session.add(project)
    session.commit()
    stage = DirectorStageService(session).get_or_create_stage(scene.id)
    return stage.shot_cameras[0], project


def test_save_registers_png_asset_and_activates_camera_preview(db_session, tmp_path):
    camera, project = _camera(db_session)
    content = _png()

    asset = DirectorPreviewService(db_session, tmp_path).save(
        camera.id, content, "image/png"
    )

    assert asset.project_id == project.id
    assert asset.kind == f"director_preview:{camera.id}"
    assert asset.media_type == "image/png"
    assert asset.width == 8
    assert asset.height == 6
    assert (tmp_path / asset.local_path).read_bytes() == content
    assert db_session.get(models.ShotCamera, camera.id).preview_asset_id == asset.id


@pytest.mark.parametrize(
    ("content", "media_type", "error"),
    [
        (b"not-an-image", "image/png", "invalid_png"),
        (_png(), "image/jpeg", "invalid_media_type"),
        (b"x" * (MAX_DIRECTOR_PREVIEW_BYTES + 1), "image/png", "preview_too_large"),
    ],
)
def test_save_rejects_invalid_preview(db_session, tmp_path, content, media_type, error):
    camera, _project = _camera(db_session)

    with pytest.raises(DirectorPreviewError, match=error):
        DirectorPreviewService(db_session, tmp_path).save(
            camera.id, content, media_type
        )

    assert list(tmp_path.rglob("*.png")) == []


def test_save_replaces_old_preview_asset_and_file(db_session, tmp_path):
    camera, _project = _camera(db_session)
    service = DirectorPreviewService(db_session, tmp_path)
    first = service.save(camera.id, _png(color=(255, 0, 0, 255)), "image/png")
    first_path = tmp_path / first.local_path

    second = service.save(camera.id, _png(color=(0, 255, 0, 255)), "image/png")

    assert second.id != first.id
    assert db_session.get(models.Asset, first.id) is None
    assert first_path == tmp_path / second.local_path
    assert first_path.read_bytes() == _png(color=(0, 255, 0, 255))


def test_save_cleans_written_file_when_commit_fails(db_session, tmp_path, monkeypatch):
    camera, _project = _camera(db_session)

    def fail_commit():
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="commit failed"):
        DirectorPreviewService(db_session, tmp_path).save(
            camera.id, _png(), "image/png"
        )

    assert list(tmp_path.rglob("*.png")) == []
    assert list(tmp_path.rglob("*.tmp")) == []


def test_preview_upload_route_returns_public_asset(client):
    from tests.test_director_api import _scene_via_client

    scene_id, _shot_id = _scene_via_client(client)
    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()
    camera_id = stage["shot_cameras"][0]["id"]

    response = client.post(
        f"/api/director-cameras/{camera_id}/preview",
        files={"file": ("preview.png", _png(), "image/png")},
    )

    assert response.status_code == 201
    assert response.json()["kind"] == f"director_preview:{camera_id}"
    assert response.json()["media_url"].startswith("/media/projects/")
    assert "local_path" not in response.json()


def test_episode_deletion_removes_director_preview_asset_and_file(
    db_session, tmp_path
):
    camera, _project = _camera(db_session)
    episode_id = camera.shot.scene.episode_id
    asset = DirectorPreviewService(db_session, tmp_path).save(
        camera.id, _png(), "image/png"
    )
    preview_path = tmp_path / asset.local_path

    result = EpisodeDeletionService(db_session, tmp_path).delete(episode_id)

    assert result is not None
    assert asset.id in result.impact.asset_ids
    assert db_session.get(models.Asset, asset.id) is None
    assert not preview_path.exists()
