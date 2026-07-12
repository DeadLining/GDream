from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.panels import PanelService
from tests.test_character_references import PNG


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

    active_asset = client.get(f"/api/assets/{first.id}")
    assert active_asset.status_code == 200
    assert active_asset.json()["id"] == first.id
    assert active_asset.json()["media_url"].startswith("/media/projects/")

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


def test_panel_generation_uses_active_approved_character_references(
    db_session, tmp_path
):
    project, shot = seed_shot(db_session)
    character = models.Character(
        project_id=project.id,
        name="林夏",
        role="主角",
        appearance_bible="黑色风衣",
        personality="冷静",
        continuity_rules="耳钉",
        voice_speaker="v1",
    )
    db_session.add(character)
    db_session.flush()
    shot.character_state = {character.id: {"outfit": "coat"}}
    db_session.commit()
    reference, _ = CharacterReferenceService(db_session, tmp_path).upload(
        character.id, PNG, "primary", "主参考"
    )
    reference.review_status = "approved"
    db_session.commit()
    CharacterReferenceService(db_session, tmp_path).activate(character.id, reference.id)

    class Provider:
        model = "test-image"
        references = None

        async def edit(self, prompt, references, size="1024x1536", quality="auto"):
            self.references = references
            from comic_studio.providers.gpt_image import ImageResult

            return ImageResult(b"panel")

        async def generate(self, *args, **kwargs):
            raise AssertionError("must not use text-only generation")

    import asyncio

    provider = Provider()
    asset = asyncio.run(
        PanelService(db_session, tmp_path, provider).generate_panel(shot.id)
    )
    assert provider.references == [(PNG, "image/png")]
    assert asset.request_metadata["reference_asset_ids"]


def test_panel_generation_fails_when_present_character_lacks_reference(
    db_session, tmp_path
):
    project, shot = seed_shot(db_session)
    character = models.Character(
        project_id=project.id,
        name="林夏",
        role="主角",
        appearance_bible="黑色风衣",
        personality="冷静",
        continuity_rules="耳钉",
        voice_speaker="v1",
    )
    db_session.add(character)
    db_session.flush()
    shot.character_state = {character.id: {}}
    db_session.commit()
    import asyncio
    import pytest

    with pytest.raises(ValueError, match="missing_character_reference"):
        asyncio.run(
            PanelService(db_session, tmp_path, object()).generate_panel(shot.id)
        )
