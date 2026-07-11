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


def test_panel_api_lists_newest_first_and_activates_selected_version(client):
    with client.app.state.session_factory() as session:
        project, shot = seed_shot(session)
        store = AssetStore(session, client.app.state.settings.data_root)
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
        shot_id = shot.id

    response = client.get(f"/api/shots/{shot_id}/panels")

    assert response.status_code == 200
    versions = response.json()
    assert [item["generation_attempt"] for item in versions] == [2, 1]
    assert versions[0]["media_url"].startswith("/media/projects/")
    assert "local_path" not in versions[0]
    assert "request_metadata" not in versions[0]

    selected = client.put(f"/api/shots/{shot_id}/panels/{first.id}/active")

    assert selected.status_code == 200
    assert selected.json()["active_panel_asset_id"] == first.id
    assert second.id != first.id


def test_panel_api_rejects_asset_from_another_shot(client):
    with client.app.state.session_factory() as session:
        project, first_shot = seed_shot(session)
        second_scene = models.Scene(
            episode_id=first_shot.scene.episode_id,
            position=2,
            location="诊所",
            summary="检查芯片",
            estimated_duration_seconds=5,
        )
        second_shot = models.Shot(
            scene=second_scene,
            position=1,
            shot_type="medium",
            duration_seconds=5,
            composition="诊所中景",
        )
        session.add(second_shot)
        session.commit()
        asset = AssetStore(session, client.app.state.settings.data_root).register_panel(
            project_id=project.id,
            shot_id=first_shot.id,
            content=b"first",
            media_type="image/png",
            provider="test",
            model="test-image",
            request_metadata={},
            activate=False,
        )
        second_shot_id = second_shot.id

    response = client.put(f"/api/shots/{second_shot_id}/panels/{asset.id}/active")

    assert response.status_code == 422
