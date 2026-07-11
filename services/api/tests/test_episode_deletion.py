from pathlib import Path

import pytest

from comic_studio import models
from comic_studio.services.episode_deletion import EpisodeDeletionService


def _asset(project_id: str, kind: str, local_path: str, checksum: str) -> models.Asset:
    return models.Asset(
        project_id=project_id,
        kind=kind,
        local_path=local_path,
        media_type="application/octet-stream",
        provider="test",
        model="test",
        checksum=checksum * 64,
    )


def _episode_graph(db_session):
    project = models.Project(
        title="霓虹夜行",
        logline="寻找记忆",
        story_bible="近未来重庆",
        visual_style="Chinese noir",
    )
    target = models.Episode(
        project=project,
        title="第一集",
        premise="雨夜追逐",
        target_duration_seconds=60,
    )
    scene_a = models.Scene(
        episode=target,
        position=1,
        location="巷道",
        summary="发现芯片",
        estimated_duration_seconds=8,
    )
    scene_b = models.Scene(
        episode=target,
        position=2,
        location="天台",
        summary="追逐",
        estimated_duration_seconds=10,
    )
    shot_a = models.Shot(
        scene=scene_a,
        position=1,
        shot_type="wide",
        duration_seconds=4,
        composition="巷道全景",
    )
    shot_b = models.Shot(
        scene=scene_a,
        position=2,
        shot_type="close_up",
        duration_seconds=4,
        composition="芯片特写",
    )
    shot_c = models.Shot(
        scene=scene_b,
        position=1,
        shot_type="medium",
        duration_seconds=5,
        composition="天台追逐",
    )
    line_a = models.DialogueLine(
        shot=shot_a,
        position=1,
        text="别回头",
        subtitle_text="别回头",
    )
    line_b = models.DialogueLine(
        shot=shot_c,
        position=1,
        text="已经晚了",
        subtitle_text="已经晚了",
    )
    unrelated = models.Episode(
        project=project,
        title="第二集",
        premise="继续追查",
        target_duration_seconds=60,
    )
    unrelated_scene = models.Scene(
        episode=unrelated,
        position=1,
        location="码头",
        summary="交易",
        estimated_duration_seconds=5,
    )
    unrelated_shot = models.Shot(
        scene=unrelated_scene,
        position=1,
        shot_type="wide",
        duration_seconds=5,
        composition="码头全景",
    )
    db_session.add(project)
    db_session.flush()
    assets = [
        _asset(project.id, f"panel:{shot_a.id}", "projects/p/panels/a/1.png", "1"),
        _asset(project.id, f"panel:{shot_a.id}", "projects/p/panels/a/2.png", "2"),
        _asset(project.id, f"video:{shot_a.id}", "projects/p/videos/a/1.mp4", "3"),
        _asset(project.id, f"panel:{shot_b.id}", "projects/p/panels/b/1.png", "4"),
        _asset(project.id, f"dialogue:{line_a.id}", "projects/p/audio/a/1.wav", "5"),
        _asset(project.id, f"dialogue:{line_a.id}", "projects/p/audio/a/2.wav", "6"),
    ]
    unrelated_asset = _asset(
        project.id,
        f"panel:{unrelated_shot.id}",
        "projects/p/panels/unrelated/1.png",
        "7",
    )
    db_session.add_all([*assets, unrelated_asset])
    db_session.commit()
    return target, unrelated, assets, unrelated_asset, line_b


def test_preview_reports_only_the_requested_episode_graph(db_session, tmp_path: Path):
    target, _unrelated, assets, unrelated_asset, _line_b = _episode_graph(db_session)

    impact = EpisodeDeletionService(db_session, tmp_path).preview(target.id)

    assert impact is not None
    assert impact.episode_id == target.id
    assert impact.title == "第一集"
    assert impact.scenes == 2
    assert impact.shots == 3
    assert impact.dialogue_lines == 2
    assert impact.assets == 6
    assert set(impact.asset_ids) == {asset.id for asset in assets}
    assert unrelated_asset.id not in impact.asset_ids


def test_preview_returns_none_for_an_unknown_episode(db_session, tmp_path: Path):
    assert EpisodeDeletionService(db_session, tmp_path).preview("missing") is None


def test_delete_removes_episode_graph_assets_jobs_runs_and_local_files(
    db_session, tmp_path: Path
):
    target, unrelated, assets, unrelated_asset, line_b = _episode_graph(db_session)
    data_root = tmp_path / "media"
    removable = data_root / assets[0].local_path
    removable.parent.mkdir(parents=True)
    removable.write_bytes(b"panel")
    job_episode = models.Job(
        operation="plan_episode", target_type="episode", target_id=target.id
    )
    render_relative = f"projects/{target.project_id}/episodes/{target.id}/renders/render-job.mp4"
    render_job = models.Job(
        operation="render_episode",
        target_type="episode",
        target_id=target.id,
        status="succeeded",
        result_metadata={"output_path": render_relative},
    )
    job_shot = models.Job(
        operation="generate_panel",
        target_type="shot",
        target_id=target.scenes[0].shots[0].id,
    )
    job_dialogue = models.Job(
        operation="speech", target_type="dialogue", target_id=line_b.id
    )
    unrelated_job = models.Job(
        operation="plan_episode", target_type="episode", target_id=unrelated.id
    )
    run = models.ProductionRun(episode_id=target.id, stages=["panels"])
    item = models.ProductionItem(
        run=run,
        stage="panels",
        target_type="shot",
        target_id=target.scenes[0].shots[0].id,
        position=1,
    )
    db_session.add_all([job_episode, render_job, job_shot, job_dialogue, unrelated_job, run, item])
    db_session.commit()
    render_file = data_root / render_relative
    render_file.parent.mkdir(parents=True, exist_ok=True)
    render_file.write_bytes(b"video")
    render_manifest = render_file.with_suffix(".manifest.json")
    render_manifest.write_text("{}", encoding="utf-8")

    result = EpisodeDeletionService(db_session, data_root).delete(target.id)

    assert result is not None
    assert result.impact.episode_id == target.id
    assert result.cleanup_warnings == ()
    assert db_session.get(models.Episode, target.id) is None
    assert db_session.get(models.Episode, unrelated.id) is not None
    assert all(db_session.get(models.Asset, asset.id) is None for asset in assets)
    assert db_session.get(models.Asset, unrelated_asset.id) is not None
    assert db_session.get(models.Job, job_episode.id) is None
    assert db_session.get(models.Job, render_job.id) is None
    assert db_session.get(models.Job, job_shot.id) is None
    assert db_session.get(models.Job, job_dialogue.id) is None
    assert db_session.get(models.Job, unrelated_job.id) is not None
    assert db_session.get(models.ProductionRun, run.id) is None
    assert db_session.get(models.ProductionItem, item.id) is None
    assert not removable.exists()
    assert not render_file.exists()
    assert not render_manifest.exists()


def test_delete_skips_symlink_escape_without_exposing_paths(db_session, tmp_path: Path):
    target, _unrelated, assets, _unrelated_asset, _line_b = _episode_graph(db_session)
    data_root = tmp_path / "media"
    outside = tmp_path / "outside"
    outside.mkdir()
    escaped = outside / "secret.bin"
    escaped.write_bytes(b"secret")
    data_root.mkdir()
    (data_root / "link").symlink_to(outside, target_is_directory=True)
    assets[0].local_path = "link/secret.bin"
    db_session.commit()

    result = EpisodeDeletionService(db_session, data_root).delete(target.id)

    assert result is not None
    assert escaped.exists()
    assert result.cleanup_warnings == ("Skipped unsafe media path",)
    assert str(outside) not in result.cleanup_warnings[0]


def test_delete_treats_missing_media_as_already_cleaned(db_session, tmp_path: Path):
    target, _unrelated, _assets, _unrelated_asset, _line_b = _episode_graph(db_session)

    result = EpisodeDeletionService(db_session, tmp_path / "missing").delete(target.id)

    assert result is not None
    assert result.cleanup_warnings == ()


def test_delete_rolls_back_when_database_commit_fails(
    db_session, tmp_path: Path, monkeypatch
):
    target, _unrelated, assets, _unrelated_asset, _line_b = _episode_graph(db_session)
    original_commit = db_session.commit

    def fail_commit():
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="commit failed"):
        EpisodeDeletionService(db_session, tmp_path).delete(target.id)

    monkeypatch.setattr(db_session, "commit", original_commit)
    assert db_session.get(models.Episode, target.id) is not None
    assert db_session.get(models.Asset, assets[0].id) is not None


def test_deletion_preview_route_returns_public_counts(client):
    with client.app.state.session_factory() as session:
        target, _unrelated, assets, _unrelated_asset, _line_b = _episode_graph(session)
        target_id = target.id

    response = client.get(f"/api/episodes/{target_id}/deletion-preview")

    assert response.status_code == 200
    assert response.json() == {
        "episode_id": target_id,
        "title": "第一集",
        "deleted": {
            "scenes": 2,
            "shots": 3,
            "dialogue_lines": 2,
            "assets": 6,
        },
    }
    encoded = response.text
    assert assets[0].id not in encoded
    assert assets[0].local_path not in encoded


def test_delete_episode_route_removes_episode_and_returns_cleanup_result(client):
    with client.app.state.session_factory() as session:
        target, _unrelated, assets, _unrelated_asset, _line_b = _episode_graph(session)
        target_id = target.id
        asset_id = assets[0].id
        media = client.app.state.settings.data_root / assets[0].local_path
        media.parent.mkdir(parents=True)
        media.write_bytes(b"panel")

    response = client.delete(f"/api/episodes/{target_id}")

    assert response.status_code == 200
    assert response.json() == {
        "episode_id": target_id,
        "title": "第一集",
        "deleted_episode_id": target_id,
        "deleted": {
            "scenes": 2,
            "shots": 3,
            "dialogue_lines": 2,
            "assets": 6,
        },
        "cleanup_warnings": [],
    }
    assert client.get(f"/api/episodes/{target_id}").status_code == 404
    assert asset_id not in response.text
    assert not media.exists()


def test_episode_deletion_routes_return_404_for_unknown_episode(client):
    assert client.get("/api/episodes/missing/deletion-preview").status_code == 404
    assert client.delete("/api/episodes/missing").status_code == 404
