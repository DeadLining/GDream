import hashlib
import json
import subprocess
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.services.panel_freshness import PanelFreshnessService


class RenderingService:
    def __init__(self, session: Session, data_root: Path, compositor_root: Path):
        self.session = session
        self.data_root = data_root.resolve()
        self.compositor_root = compositor_root.resolve()

    @staticmethod
    def manifest_snapshot_hash(manifest: dict) -> str:
        serialized = json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    def input_snapshot_hash(self, episode_id: str) -> str:
        return self.manifest_snapshot_hash(self.build_manifest(episode_id))

    @staticmethod
    def _srt_timestamp(seconds: float) -> str:
        milliseconds = max(0, round(seconds * 1000))
        hours, remainder = divmod(milliseconds, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        whole_seconds, milliseconds = divmod(remainder, 1000)
        return f"{hours:02}:{minutes:02}:{whole_seconds:02},{milliseconds:03}"

    @classmethod
    def build_srt(cls, manifest: dict) -> str:
        cues = []
        shot_offset = 0.0
        for shot in manifest.get("shots", []):
            shot_duration = max(0.0, float(shot.get("durationSeconds", 0)))
            for line in shot.get("dialogue", []):
                text = str(line.get("text", "")).replace("\r\n", "\n").replace("\r", "\n")
                text = text.replace("\x00", "").strip()
                if not text:
                    continue
                relative_start = max(0.0, float(line.get("startSeconds", 0)))
                if relative_start >= shot_duration:
                    continue
                duration = max(0.1, float(line.get("durationSeconds", 0.1)))
                start = shot_offset + relative_start
                end = shot_offset + min(shot_duration, relative_start + duration)
                if end <= start:
                    continue
                cues.append(
                    "\n".join(
                        [
                            str(len(cues) + 1),
                            f"{cls._srt_timestamp(start)} --> {cls._srt_timestamp(end)}",
                            text,
                        ]
                    )
                )
            shot_offset += shot_duration
        return "\n\n".join(cues) + ("\n" if cues else "")

    @staticmethod
    def _mux_subtitles(output_path: Path, subtitles: str) -> None:
        subtitle_path = output_path.with_suffix(".srt")
        subtitled_path = output_path.with_name(
            f"{output_path.stem}.subtitled{output_path.suffix}"
        )
        subtitle_path.write_text(subtitles, encoding="utf-8")
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(output_path),
                    "-sub_charenc",
                    "UTF-8",
                    "-i",
                    str(subtitle_path),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-map",
                    "1:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "copy",
                    "-c:s",
                    "mov_text",
                    "-metadata:s:s:0",
                    "language=zho",
                    "-movflags",
                    "+faststart",
                    str(subtitled_path),
                ],
                check=True,
            )
            subtitled_path.replace(output_path)
        finally:
            subtitled_path.unlink(missing_ok=True)

    def build_manifest(self, episode_id: str) -> dict:
        statement = (
            select(models.Episode)
            .options(
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue),
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.library_asset_bindings)
                .selectinload(models.LibraryAssetSceneBinding.library_asset)
                .selectinload(models.LibraryAsset.media_asset),
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
            sounds = []
            for binding in scene.library_asset_bindings:
                library_asset = binding.library_asset
                if library_asset.kind != "sound" or library_asset.media_asset is None:
                    continue
                media = library_asset.media_asset
                if not media.media_type.startswith("audio/"):
                    raise ValueError(
                        f"Library sound {library_asset.id} media is not audio"
                    )
                audio_file = (self.data_root / media.local_path).resolve()
                if (
                    self.data_root not in audio_file.parents
                    or not audio_file.is_file()
                ):
                    raise ValueError(
                        f"Library sound {library_asset.id} media file is missing"
                    )
                volume = (library_asset.asset_metadata or {}).get("volume", 0.35)
                if (
                    not isinstance(volume, (int, float))
                    or isinstance(volume, bool)
                    or not 0 <= volume <= 1
                ):
                    raise ValueError(
                        f"Library sound {library_asset.id} volume must be between 0 and 1"
                    )
                sounds.append(
                    {
                        "id": library_asset.id,
                        "name": library_asset.name,
                        "audioPath": str(audio_file),
                        "volume": float(volume),
                    }
                )
            for shot in scene.shots:
                if shot.review_status != "approved":
                    raise ValueError(f"Shot {shot.id} is not approved")
                if not shot.active_panel_asset_id:
                    raise ValueError(f"Shot {shot.id} has no active panel")
                panel = self.session.get(models.Asset, shot.active_panel_asset_id)
                if panel is None:
                    raise ValueError(f"Shot {shot.id} panel asset is missing")
                if PanelFreshnessService(self.session).inspect(shot.id, panel).is_stale:
                    raise ValueError(f"Shot {shot.id} panel is stale")
                panel_path = (self.data_root / panel.local_path).resolve()
                if not panel_path.is_file():
                    raise ValueError(f"Shot {shot.id} panel file is missing")
                video_path = None
                video_duration = None
                if shot.active_video_asset_id:
                    video = self.session.get(models.Asset, shot.active_video_asset_id)
                    if video is None or video.kind != f"video:{shot.id}":
                        raise ValueError(f"Shot {shot.id} active video asset is invalid")
                    if video.parent_asset_id != panel.id:
                        raise ValueError(
                            f"Shot {shot.id} video source panel is stale"
                        )
                    video_file = (self.data_root / video.local_path).resolve()
                    if self.data_root not in video_file.parents or not video_file.is_file():
                        raise ValueError(f"Shot {shot.id} active video file is missing")
                    if b"ftyp" not in video_file.read_bytes()[:32]:
                        raise ValueError(f"Shot {shot.id} active video is not a valid MP4")
                    video_path = str(video_file)
                    video_duration = video.duration_seconds
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
                        **({"videoPath": video_path, "videoDurationSeconds": video_duration} if video_path else {}),
                        "reviewStatus": "approved",
                        "motion": shot.camera_motion
                        if shot.camera_motion
                        in {"push_in", "pull_out", "pan_left", "pan_right", "still"}
                        else "push_in",
                        "dialogue": dialogue,
                        "sounds": sounds,
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
        subtitles = self.build_srt(manifest)
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
        if subtitles:
            self._mux_subtitles(output_path, subtitles)
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
        if subtitles and "subtitle" not in stream_types:
            raise RuntimeError("Rendered file has no subtitle stream")
        return report
