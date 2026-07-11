from comic_studio import models
from comic_studio.assets import AssetStore


def seed_shot(session):
    project = models.Project(
        title="霓虹夜行",
        logline="侦探寻找记忆",
        story_bible="近未来重庆",
        visual_style="Chinese noir",
        aspect_ratio="9:16",
    )
    episode = models.Episode(
        project=project,
        title="雨夜",
        premise="寻找芯片",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="巷道",
        summary="发现线索",
        estimated_duration_seconds=5,
    )
    shot = models.Shot(
        scene=scene,
        position=1,
        shot_type="close_up",
        duration_seconds=5,
        composition="芯片特写",
    )
    session.add(shot)
    session.commit()
    return project, shot


def test_rejected_panel_version_does_not_replace_active_asset(db_session, tmp_path):
    project, shot = seed_shot(db_session)
    store = AssetStore(db_session, tmp_path)

    first = store.register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=b"first",
        media_type="image/png",
        provider="test",
        model="test-image",
        request_metadata={"prompt": "first"},
        activate=True,
    )
    second = store.register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=b"second",
        media_type="image/png",
        provider="test",
        model="test-image",
        request_metadata={"prompt": "second"},
        activate=False,
    )

    db_session.refresh(shot)
    assert shot.active_panel_asset_id == first.id
    assert first.id != second.id
    assert (tmp_path / first.local_path).read_bytes() == b"first"
