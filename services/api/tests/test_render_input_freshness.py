import asyncio

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.services.episode_ai_stage_handlers import EpisodeAIStageHandlers
from tests.test_episode_ai_stage_handlers import (
    FakeImageRuntime,
    _context,
    _seed_episode,
)


def test_rendering_does_not_reuse_success_after_active_video_changes(tmp_path):
    session_factory, data_root, episode_id, _character_id, shot_id, _dialogue_id = (
        _seed_episode(tmp_path)
    )
    runtime = FakeImageRuntime(session_factory, data_root)
    render_calls = []

    def render_executor(_episode_id, output_path):
        render_calls.append(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 256)
        return {"format": {"duration": "6.0"}}

    handlers = EpisodeAIStageHandlers(
        session_factory,
        data_root,
        runtime,
        compositor_root=tmp_path / "compositor",
        render_executor=render_executor,
    )
    for stage in ("references", "panels", "panel_review", "speech", "videos"):
        asyncio.run(getattr(handlers, stage)(_context(episode_id, stage)))

    first = asyncio.run(handlers.rendering(_context(episode_id, "rendering")))
    with session_factory() as session:
        shot = session.get(models.Shot, shot_id)
        replacement = AssetStore(session, data_root).register_video(
            project_id=shot.scene.episode.project_id,
            shot_id=shot.id,
            source_panel_id=shot.active_panel_asset_id,
            content=b"\x00\x00\x00\x18ftypmp42replacement",
            provider="test",
            model="video-test",
            request_metadata={"prompt": "replacement motion"},
            duration_seconds=6,
            activate=True,
        )
        replacement_id = replacement.id

    second = asyncio.run(handlers.rendering(_context(episode_id, "rendering")))

    assert second["job_id"] != first["job_id"]
    assert len(render_calls) == 2
    with session_factory() as session:
        jobs = list(
            session.query(models.Job)
            .filter(
                models.Job.operation == "render_episode",
                models.Job.target_id == episode_id,
                models.Job.status == "succeeded",
            )
            .order_by(models.Job.created_at)
        )
        assert len(jobs) == 2
        assert jobs[0].result_metadata["input_snapshot_hash"]
        assert jobs[1].result_metadata["input_snapshot_hash"]
        assert jobs[0].result_metadata["input_snapshot_hash"] != jobs[1].result_metadata[
            "input_snapshot_hash"
        ]
        assert session.get(models.Shot, shot_id).active_video_asset_id == replacement_id
