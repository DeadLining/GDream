import json
import subprocess
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models


class RenderingService:
    def __init__(self, session: Session, data_root: Path, compositor_root: Path):
        self.session = session
        self.data_root = data_root.resolve()
        self.compositor_root = compositor_root.resolve()

    def build_manifest(self, episode_id: str) -> dict:
        statement = (
            select(models.Episode)
            .options(
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue)
            )
            .where(models.Episode.id == episode_id)
        )
        episode = self.session.scalar(statement)
        if episode is None:
            raise KeyError(episode_id)
        project = self.session.get(models.Project, episode.project_id)
        if project is None:
            raise RuntimeError("Episode project does not exist")
        dimensions = {
            "9:16": (1080, 1920),
            "16:9": (1920, 1080),
            "1:1": (1080, 1080),
        }
        width, height = dimensions[project.aspect_ratio]
        shots = []
        for scene in episode.scenes:
            for shot in scene.shots:
                if shot.review_status != "approved":
                    raise ValueError(f"Shot {shot.id} is not approved")
                if not shot.active_panel_asset_id:
                    raise ValueError(f"Shot {shot.id} has no active panel")
                panel = self.session.get(models.Asset, shot.active_panel_asset_id)
                if panel is None:
                    raise ValueError(f"Shot {shot.id} panel asset is missing")
                panel_path = (self.data_root / panel.local_path).resolve()
                if not panel_path.is_file():
                    raise ValueError(f"Shot {shot.id} panel file is missing")
                dialogue = []
                for line in shot.dialogue:
                    character = (
                        self.session.get(models.Character, line.character_id)
                        if line.character_id
                        else None
                    )
                    audio_path = None
                    if line.audio_asset_id:
                        audio = self.session.get(models.Asset, line.audio_asset_id)
                        if audio is None:
                            raise ValueError(f"Dialogue {line.id} audio asset is missing")
                        audio_file = (self.data_root / audio.local_path).resolve()
                        if not audio_file.is_file():
                            raise ValueError(f"Dialogue {line.id} audio file is missing")
                        audio_path = str(audio_file)
                    dialogue.append(
                        {
                            "id": line.id,
                            "characterName": character.name if character else "旁白",
                            "text": line.subtitle_text,
                            "startSeconds": line.start_seconds,
                            "durationSeconds": max(
                                0.1, line.duration_seconds or shot.duration_seconds
                            ),
                            **({"audioPath": audio_path} if audio_path else {}),
                        }
                    )
                shots.append(
                    {
                        "id": shot.id,
                        "durationSeconds": shot.duration_seconds,
                        "panelPath": str(panel_path),
                        "reviewStatus": "approved",
                        "motion": shot.camera_motion
                        if shot.camera_motion
                        in {"push_in", "pull_out", "pan_left", "pan_right", "still"}
                        else "push_in",
                        "dialogue": dialogue,
                    }
                )
        if not shots:
            raise ValueError("Episode has no shots to render")
        return {
            "episode": {
                "id": episode.id,
                "title": episode.title,
                "width": width,
                "height": height,
                "fps": 30,
            },
            "shots": shots,
        }

    def render(self, episode_id: str, output_path: Path) -> dict:
        manifest = self.build_manifest(episode_id)
        output_path = output_path.resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path = output_path.with_suffix(".manifest.json")
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        subprocess.run(
            [
                "node",
                str(self.compositor_root / "scripts" / "render.mjs"),
                str(manifest_path),
                str(output_path),
            ],
            cwd=self.compositor_root,
            check=True,
        )
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,codec_name,width,height:format=duration",
                "-of",
                "json",
                str(output_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(probe.stdout)
        stream_types = {stream["codec_type"] for stream in report.get("streams", [])}
        if "video" not in stream_types:
            raise RuntimeError("Rendered file has no video stream")
        return report
