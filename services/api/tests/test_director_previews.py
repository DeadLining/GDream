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


def test_save_guidance_tracks_and_replaces_each_kind_independently(db_session, tmp_path):
    camera, _project = _camera(db_session)
    service = DirectorPreviewService(db_session, tmp_path)

    first_silhouette = service.save_guidance(
        camera.id, "silhouette", _png(color=(0, 0, 0, 255)), "image/png"
    )
    skeleton = service.save_guidance(
        camera.id, "skeleton_pose", _png(color=(0, 255, 255, 255)), "image/png"
    )
    depth = service.save_guidance(
        camera.id, "depth", _png(color=(80, 80, 80, 255)), "image/png"
    )
    object_mask = service.save_guidance(
        camera.id, "object_mask", _png(color=(255, 0, 255, 255)), "image/png"
    )
    second_silhouette = service.save_guidance(
        camera.id, "silhouette", _png(color=(255, 255, 255, 255)), "image/png"
    )

    stored = db_session.get(models.ShotCamera, camera.id)
    assert stored.guidance_asset_ids == {
        "silhouette": second_silhouette.id,
        "skeleton_pose": skeleton.id,
        "depth": depth.id,
        "object_mask": object_mask.id,
    }
    assert db_session.get(models.Asset, first_silhouette.id) is None
    assert second_silhouette.kind == f"director_guidance:silhouette:{camera.id}"
    assert skeleton.kind == f"director_guidance:skeleton_pose:{camera.id}"
    assert (tmp_path / second_silhouette.local_path).is_file()
    assert (tmp_path / skeleton.local_path).is_file()
    assert (tmp_path / depth.local_path).is_file()
    assert (tmp_path / object_mask.local_path).is_file()

    with pytest.raises(DirectorPreviewError, match="invalid_guidance_kind"):
        service.save_guidance(camera.id, "normal", _png(), "image/png")


def test_guidance_upload_route_accepts_depth_and_object_mask(client):
    from tests.test_director_api import _scene_via_client

    scene_id, _shot_id = _scene_via_client(client)
    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()
    camera_id = stage["shot_cameras"][0]["id"]

    for guidance_kind in ("depth", "object_mask"):
        response = client.post(
            f"/api/director-cameras/{camera_id}/guidance/{guidance_kind}",
            files={"file": (f"{guidance_kind}.png", _png(), "image/png")},
        )
        assert response.status_code == 201
        assert response.json()["kind"] == f"director_guidance:{guidance_kind}:{camera_id}"

    refreshed = client.get(f"/api/scenes/{scene_id}/director-stage").json()
    assert set(refreshed["shot_cameras"][0]["guidance_asset_ids"]) == {
        "depth",
        "object_mask",
    }


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


def test_guidance_upload_route_returns_public_asset(client):
    from tests.test_director_api import _scene_via_client

    scene_id, _shot_id = _scene_via_client(client)
    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()
    camera_id = stage["shot_cameras"][0]["id"]

    response = client.post(
        f"/api/director-cameras/{camera_id}/guidance/silhouette",
        files={"file": ("silhouette.png", _png(), "image/png")},
    )

    assert response.status_code == 201
    assert response.json()["kind"] == f"director_guidance:silhouette:{camera_id}"
    refreshed = client.get(f"/api/scenes/{scene_id}/director-stage").json()
    assert refreshed["shot_cameras"][0]["guidance_asset_ids"]["silhouette"] == response.json()["id"]


def test_episode_deletion_removes_director_preview_asset_and_file(
    db_session, tmp_path
):
    camera, _project = _camera(db_session)
    episode_id = camera.shot.scene.episode_id
    asset = DirectorPreviewService(db_session, tmp_path).save(
        camera.id, _png(), "image/png"
    )
    silhouette = DirectorPreviewService(db_session, tmp_path).save_guidance(
        camera.id, "silhouette", _png(color=(0, 0, 0, 255)), "image/png"
    )
    skeleton = DirectorPreviewService(db_session, tmp_path).save_guidance(
        camera.id, "skeleton_pose", _png(color=(0, 255, 255, 255)), "image/png"
    )
    depth = DirectorPreviewService(db_session, tmp_path).save_guidance(
        camera.id, "depth", _png(color=(80, 80, 80, 255)), "image/png"
    )
    object_mask = DirectorPreviewService(db_session, tmp_path).save_guidance(
        camera.id, "object_mask", _png(color=(255, 0, 255, 255)), "image/png"
    )
    preview_path = tmp_path / asset.local_path
    guidance_paths = [tmp_path / item.local_path for item in (silhouette, skeleton, depth, object_mask)]

    result = EpisodeDeletionService(db_session, tmp_path).delete(episode_id)

    assert result is not None
    assert asset.id in result.impact.asset_ids
    assert silhouette.id in result.impact.asset_ids
    assert skeleton.id in result.impact.asset_ids
    assert depth.id in result.impact.asset_ids
    assert object_mask.id in result.impact.asset_ids
    assert all(
        db_session.get(models.Asset, item.id) is None
        for item in (asset, silhouette, skeleton, depth, object_mask)
    )
    assert not preview_path.exists()
    assert all(not path.exists() for path in guidance_paths)
