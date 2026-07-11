from pathlib import Path

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
