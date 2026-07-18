import asyncio

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.providers.gpt_image import ImageResult
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.panels import PanelService
from comic_studio.services.prompt_suggestions import PromptSuggestionService
from comic_studio.services.shot_inputs import ShotInputCompiler
from tests.test_character_references import PNG


class FakeImageProvider:
    """Minimal image provider that returns a fixed PNG bytes payload."""

    model = "fake-image"

    async def generate(self, prompt, size="1024x1536", quality="auto"):
        return ImageResult(PNG, media_type="image/png")

    async def edit(self, prompt, references, size="1024x1536", quality="auto"):
        return ImageResult(PNG, media_type="image/png")


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
    data = response.json()
    assert [item["id"] for item in data] == [second.id, first.id]
    assert all(item["is_stale"] is True for item in data)
    assert all(item["stale_reason"] == "missing_provenance" for item in data)


def test_panel_versions_mark_changed_generation_inputs_stale(client):
    with client.app.state.session_factory() as session:
        project, shot = seed_shot(session)
        compiled = ShotInputCompiler(session).compile(
            shot.id, usage_kinds={"panel", "reference"}
        )
        asset = AssetStore(session, client.app.state.settings.data_root).register_panel(
            project_id=project.id,
            shot_id=shot.id,
            content=b"current",
            media_type="image/png",
            provider="test",
            model="test-image",
            request_metadata={
                "prompt": "current",
                "input_snapshot": compiled.snapshot,
                "input_snapshot_hash": compiled.snapshot_hash,
            },
            activate=True,
        )
        shot_id = shot.id

    with client.app.state.session_factory() as session:
        after_registration = ShotInputCompiler(session).compile(
            shot_id, usage_kinds={"panel", "reference"}
        )
    assert after_registration.snapshot == compiled.snapshot
    assert after_registration.snapshot_hash == compiled.snapshot_hash

    current = client.get(f"/api/shots/{shot_id}/panels")
    assert current.status_code == 200
    assert current.json()[0]["id"] == asset.id
    assert current.json()[0]["is_stale"] is False
    assert current.json()[0]["stale_reason"] is None

    with client.app.state.session_factory() as session:
        shot = session.get(models.Shot, shot_id)
        assert shot is not None
        shot.image_prompt = "changed panel prompt"
        session.commit()

    changed = client.get(f"/api/shots/{shot_id}/panels")
    assert changed.status_code == 200
    assert changed.json()[0]["is_stale"] is True
    assert changed.json()[0]["stale_reason"] == "inputs_changed"


def test_generate_panel_uses_active_character_references(db_session, tmp_path):
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

    reference, _asset = asyncio.run(
        CharacterReferenceService(db_session, tmp_path).generate(
            character.id,
            "primary",
            label="正面",
            provider=FakeImageProvider(),
        )
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
    import pytest

    with pytest.raises(ValueError, match="missing_character_reference"):
        asyncio.run(
            PanelService(db_session, tmp_path, object()).generate_panel(shot.id)
        )


def test_generate_panel_injects_previous_shot_tail_frame(db_session, tmp_path):
    """Tail-frame continuity (M3.2): a shot with ``previous_shot_tail_asset_id``
    should receive that asset as the first reference image, and the prompt should
    mention the continuity anchor."""
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

    reference, _asset = asyncio.run(
        CharacterReferenceService(db_session, tmp_path).generate(
            character.id,
            "primary",
            label="正面",
            provider=FakeImageProvider(),
        )
    )
    reference.review_status = "approved"
    db_session.commit()
    CharacterReferenceService(db_session, tmp_path).activate(character.id, reference.id)

    tail = AssetStore(db_session, tmp_path).register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=PNG,
        media_type="image/png",
        provider="test",
        model="test-image",
        request_metadata={"prompt": "tail"},
        activate=True,
    )
    shot.previous_shot_tail_asset_id = tail.id
    db_session.commit()

    class Provider:
        model = "test-image"
        references = None

        async def edit(self, prompt, references, size="1024x1536", quality="auto"):
            self.prompt = prompt
            self.references = references
            from comic_studio.providers.gpt_image import ImageResult

            return ImageResult(b"panel")

        async def generate(self, *args, **kwargs):
            raise AssertionError("must not use text-only generation")

    provider = Provider()
    context = PromptSuggestionService(db_session, None).generation_context(
        shot.id, "panel"
    )
    asset = asyncio.run(
        PanelService(db_session, tmp_path, provider).generate_panel(shot.id)
    )
    assert provider.references is not None
    assert len(provider.references) == 2  # tail + character reference
    assert provider.references[0] == (PNG, "image/png")
    assert "tail frame" in provider.prompt.lower()
    assert asset.request_metadata["reference_asset_ids"][0] == f"tail:{tail.id}"
    assert [item.asset_id for item in context.references] == [tail.id, _asset.id]
    assert [item.role for item in context.references] == [
        "previous_shot_tail",
        "character_reference",
    ]
