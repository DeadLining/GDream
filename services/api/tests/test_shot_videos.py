import asyncio

import pytest

from comic_studio.assets import AssetStore
from comic_studio.services.videos import VideoService
from tests.test_panel_versions import seed_shot


MP4 = b"\x00\x00\x00\x18ftypmp42video-data"


class Provider:
    model = "video-test"

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
    panel = AssetStore(session, tmp_path).register_panel(
        project_id=project.id,
        shot_id=shot.id,
        content=b"panel",
        media_type="image/png",
        provider="test",
        model="image",
        request_metadata={},
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
    assert shot.active_video_asset_id == asset.id
    assert provider.duration == 6


def test_requires_approved_shot_and_active_panel(db_session, tmp_path):
    _, shot, _ = _eligible(db_session, tmp_path)
    shot.review_status = "draft"
    db_session.commit()
    with pytest.raises(ValueError, match="shot_not_approved"):
        asyncio.run(VideoService(db_session, tmp_path, Provider()).generate(shot.id))


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
