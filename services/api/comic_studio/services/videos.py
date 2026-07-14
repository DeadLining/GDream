from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.services.shot_inputs import ShotInputCompiler


VIDEO_TASK_POLL_INTERVAL_SECONDS = 2
VIDEO_TASK_MAX_POLLS = 1800


class VideoService:
    def __init__(self, session: Session, data_root: Path, provider):
        self.session = session
        self.assets = AssetStore(session, data_root)
        self.provider = provider

    async def generate(self, shot_id: str, *, activate: bool = False):
        shot = self.session.scalar(
            select(models.Shot)
            .options(
                selectinload(models.Shot.scene)
                .selectinload(models.Scene.episode)
                .selectinload(models.Episode.project)
            )
            .where(models.Shot.id == shot_id)
        )
        if shot is None:
            raise KeyError(shot_id)
        if shot.review_status != "approved":
            raise ValueError("shot_not_approved")
        if not shot.active_panel_asset_id:
            raise ValueError("active_panel_required")
        panel = self.session.get(models.Asset, shot.active_panel_asset_id)
        if panel is None or panel.kind != f"panel:{shot.id}":
            raise ValueError("active_panel_invalid")
        compiled = ShotInputCompiler(self.session).compile(
            shot.id, usage_kinds={"video", "reference"}
        )
        path = (self.assets.data_root / panel.local_path).resolve()
        if self.assets.data_root not in path.parents:
            raise ValueError("Asset path escaped data root")
        duration = 6 if shot.duration_seconds <= 6 else 10
        prompt = "\n".join(
            filter(
                None,
                [
                    shot.scene.summary,
                    shot.composition,
                    f"Camera: {shot.camera_motion}",
                    shot.video_prompt,
                    f"Avoid: {shot.negative_video_prompt}"
                    if shot.negative_video_prompt
                    else "",
                    compiled.prompt_constraints,
                ],
            )
        )
        task_id = await self.provider.submit_image_to_video(
            prompt, path.read_bytes(), panel.media_type, duration
        )
        task = None
        for _ in range(VIDEO_TASK_MAX_POLLS):
            task = await self.provider.get_task(task_id)
            if task.status in {"succeeded", "failed"}:
                break
            await asyncio.sleep(VIDEO_TASK_POLL_INTERVAL_SECONDS)
        if task is None or task.status != "succeeded":
            raise ValueError(task.error if task else "video_task_timeout")
        result = await self.provider.download_result(task)
        project = shot.scene.episode.project
        return self.assets.register_video(
            project_id=project.id,
            shot_id=shot.id,
            source_panel_id=panel.id,
            content=result.content,
            provider=getattr(self.provider, "provider_id", "video-provider"),
            model=self.provider.model,
            request_metadata={
                "prompt": prompt,
                "provider_task_id": task_id,
                "source_panel_id": panel.id,
                "duration": duration,
                "input_snapshot": compiled.snapshot,
                "input_snapshot_hash": compiled.snapshot_hash,
            },
            duration_seconds=duration,
            activate=activate,
        )
