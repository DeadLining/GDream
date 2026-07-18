import asyncio

import pytest

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.services.videos import VideoService
from comic_studio.services.shot_inputs import ShotInputCompiler
from tests.test_panel_versions import seed_shot


MP4 = b"\x00\x00\x00\x18ftypmp42video-data"


class Provider:
    model = "video-test"
    provider_id = "wan-video"

    async def submit_image_to_video(
        self, prompt, image_bytes, image_media_type, duration
    ):
        self.prompt = prompt
        self.duration = duration
        return "task-1"

    async def get_task(self, task_id):
        from comic_studio.providers.minimax_video import VideoTask

        return VideoTask(task_id, "succeeded", "file-1")

    async def download_result(self, task):
        from comic_studio.providers.minimax_video import VideoResult

        return VideoResult(MP4)


def _eligible(session, tmp_path):
    project, shot = seed_shot(session)
    compiled = ShotInputCompiler(session).compile(
        shot.id, usage_kinds={"panel", "reference"}
    )
    panel = AssetStore(session, tmp_path).register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=b"panel",
        media_type="image/png",
        provider="test",
        model="image",
        request_metadata={
            "input_snapshot": compiled.snapshot,
            "input_snapshot_hash": compiled.snapshot_hash,
        },
        activate=True,
    )
    shot.review_status = "approved"
    shot.video_prompt = "rain moves slowly"
    session.commit()
    return project, shot, panel


def test_generates_immutable_video_version_from_active_panel(db_session, tmp_path):
    _, shot, panel = _eligible(db_session, tmp_path)
    provider = Provider()
    asset = asyncio.run(
        VideoService(db_session, tmp_path, provider).generate(shot.id, activate=True)
    )
    db_session.refresh(shot)
    assert asset.parent_asset_id == panel.id
    assert asset.media_type == "video/mp4"
    assert asset.request_metadata["provider_task_id"] == "task-1"
    assert asset.provider == "wan-video"
    assert shot.active_video_asset_id == asset.id
    assert provider.duration == 6


def test_registering_active_panel_invalidates_existing_video(db_session, tmp_path):
    project, shot, _panel = _eligible(db_session, tmp_path)
    video = asyncio.run(
        VideoService(db_session, tmp_path, Provider()).generate(shot.id, activate=True)
    )

    replacement = AssetStore(db_session, tmp_path).register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=b"replacement-panel",
        media_type="image/png",
        provider="test",
        model="image",
        request_metadata={},
        activate=True,
    )

    db_session.refresh(shot)
    assert shot.active_panel_asset_id == replacement.id
    assert shot.active_video_asset_id is None
    assert shot.video_render_status == "pending"
    assert db_session.get(models.Asset, video.id) is not None


def test_activating_panel_version_invalidates_existing_video(db_session, tmp_path):
    project, shot, _panel = _eligible(db_session, tmp_path)
    replacement = AssetStore(db_session, tmp_path).register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=b"inactive-replacement",
        media_type="image/png",
        provider="test",
        model="image",
        request_metadata={},
        activate=False,
    )
    video = asyncio.run(
        VideoService(db_session, tmp_path, Provider()).generate(shot.id, activate=True)
    )

    updated = AssetStore(db_session, tmp_path).activate_panel(shot.id, replacement.id)

    assert updated is not None
    assert updated.active_panel_asset_id == replacement.id
    assert updated.active_video_asset_id is None
    assert updated.video_render_status == "pending"
    assert db_session.get(models.Asset, video.id) is not None


def test_requires_approved_shot_and_active_panel(db_session, tmp_path):
    _, shot, _ = _eligible(db_session, tmp_path)
    shot.review_status = "draft"
    db_session.commit()
    with pytest.raises(ValueError, match="shot_not_approved"):
        asyncio.run(VideoService(db_session, tmp_path, Provider()).generate(shot.id))


def test_rejects_stale_active_panel(db_session, tmp_path):
    _, shot, _ = _eligible(db_session, tmp_path)
    shot.image_prompt = "changed after panel generation"
    db_session.commit()

    with pytest.raises(ValueError, match="active_panel_stale"):
        asyncio.run(VideoService(db_session, tmp_path, Provider()).generate(shot.id))


def test_video_generation_waits_longer_than_ten_minutes_for_local_models(
    db_session,
    tmp_path,
    monkeypatch,
):
    _, shot, _ = _eligible(db_session, tmp_path)

    class SlowProvider(Provider):
        polls = 0

        async def get_task(self, task_id):
            from comic_studio.providers.minimax_video import VideoTask

            self.polls += 1
            status = "succeeded" if self.polls == 301 else "processing"
            return VideoTask(
                task_id,
                status,
                "file-1" if status == "succeeded" else None,
            )

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr("comic_studio.services.videos.asyncio.sleep", no_sleep)
    provider = SlowProvider()

    asset = asyncio.run(VideoService(db_session, tmp_path, provider).generate(shot.id))

    assert provider.polls == 301
    assert asset.provider == "wan-video"


def test_video_generation_compiles_bound_variant_and_state(db_session, tmp_path):
    project, shot, _panel = _eligible(db_session, tmp_path)
    character = models.Character(
        project_id=project.id,
        name="林夏",
        role="主角",
        appearance_bible="黑色长发",
        personality="冷静",
        continuity_rules="保持脸型",
        voice_speaker="v1",
    )
    db_session.add(character)
    db_session.flush()
    variant = models.AssetVariant(
        character_id=character.id,
        episode_id=shot.scene.episode_id,
        kind="episode",
        label="雨夜造型",
        inherited_fields=[],
        overrides={"outfit": "深色雨衣"},
        review_status="approved",
    )
    db_session.add(variant)
    db_session.flush()
    state = models.AssetVariantState(
        variant_id=variant.id,
        kind="expression",
        label="警惕",
        overrides={"eyes": "目光收紧"},
    )
    db_session.add(state)
    db_session.flush()
    db_session.add(
        models.AssetVariantUsage(
            variant_id=variant.id,
            state_id=state.id,
            shot_id=shot.id,
            usage_kind="video",
        )
    )
    db_session.commit()
    provider = Provider()

    asset = asyncio.run(VideoService(db_session, tmp_path, provider).generate(shot.id))

    assert "深色雨衣" in provider.prompt
    assert "目光收紧" in provider.prompt
    snapshot = asset.request_metadata["input_snapshot"]
    assert snapshot["asset_bindings"][0]["variant_id"] == variant.id
    assert snapshot["asset_bindings"][0]["state_id"] == state.id
    assert len(asset.request_metadata["input_snapshot_hash"]) == 64


def test_video_generation_includes_bound_sound_design(db_session, tmp_path):
    project, shot, _panel = _eligible(db_session, tmp_path)
    sound_media = models.Asset(
        project_id=project.id,
        kind="library-asset-media",
        local_path="projects/rain.wav",
        media_type="audio/wav",
        provider="upload",
        model="local",
        checksum="d" * 64,
    )
    db_session.add(sound_media)
    db_session.flush()
    sound = models.LibraryAsset(
        project_id=project.id,
        kind="sound",
        name="城市雨声",
        description="持续的雨声和远处车流",
        tags=["环境"],
        media_asset_id=sound_media.id,
    )
    db_session.add(sound)
    db_session.flush()
    db_session.add(
        models.LibraryAssetSceneBinding(
            library_asset_id=sound.id, scene_id=shot.scene_id
        )
    )
    db_session.commit()
    provider = Provider()

    asset = asyncio.run(VideoService(db_session, tmp_path, provider).generate(shot.id))

    assert "城市雨声" in provider.prompt
    assert asset.request_metadata["input_snapshot"]["library_assets"][0]["id"] == sound.id
    panel_input = ShotInputCompiler(db_session).compile(
        shot.id, usage_kinds={"panel", "reference"}
    )
    assert panel_input.snapshot["library_assets"] == []
    assert "城市雨声" not in panel_input.prompt_constraints


def test_video_api_job_lists_and_activates_versions(client):
    with client.app.state.session_factory() as session:
        _, shot, _ = _eligible(session, client.app.state.settings.data_root)
        shot_id = shot.id

    class Factory:
        def create_video(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    started = client.post(f"/api/shots/{shot_id}/videos?activate=true")
    assert started.status_code == 202
    job = client.get(f"/api/jobs/{started.json()['job_id']}").json()
    assert job["status"] == "succeeded"
    versions = client.get(f"/api/shots/{shot_id}/videos").json()
    assert len(versions) == 1
    active = client.put(f"/api/shots/{shot_id}/videos/{versions[0]['id']}/active")
    assert active.json()["active_video_asset_id"] == versions[0]["id"]


def test_video_api_rejects_version_generated_from_inactive_panel(client):
    with client.app.state.session_factory() as session:
        project, shot, _panel = _eligible(
            session, client.app.state.settings.data_root
        )
        video = asyncio.run(
            VideoService(
                session, client.app.state.settings.data_root, Provider()
            ).generate(shot.id, activate=True)
        )
        AssetStore(session, client.app.state.settings.data_root).register_panel(
            project_id=project.id,
            shot_id=shot.id,
            content=b"new-active-panel",
            media_type="image/png",
            provider="test",
            model="image",
            request_metadata={},
            activate=True,
        )
        shot_id=shot.id;video_id=video.id

    response=client.put(f"/api/shots/{shot_id}/videos/{video_id}/active")

    assert response.status_code==409
    assert response.json()["detail"]=="Video version was generated from a different panel"
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        assert shot.active_video_asset_id is None
        assert shot.video_render_status=="pending"
