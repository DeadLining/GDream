from __future__ import annotations

from copy import deepcopy

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.services.production_decision import ACTIVE_RUN_STATUSES


class OperationsValidationError(ValueError):
    pass


def _json_value(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


class OperationsService:
    def __init__(self, session: Session):
        self.session = session

    def _validate_task_links(self, project_id: str, data: schemas.ProductionTaskCreate) -> None:
        episode = self.session.get(models.Episode, data.episode_id) if data.episode_id else None
        scene = self.session.get(models.Scene, data.scene_id) if data.scene_id else None
        shot = self.session.get(models.Shot, data.shot_id) if data.shot_id else None
        thread = self.session.get(models.VisualReviewThread, data.review_thread_id) if data.review_thread_id else None
        invalid = False
        if data.episode_id and (episode is None or episode.project_id != project_id): invalid = True
        if data.scene_id and (scene is None or scene.episode.project_id != project_id or (episode and scene.episode_id != episode.id)): invalid = True
        if data.shot_id and (shot is None or shot.scene.episode.project_id != project_id or (scene and shot.scene_id != scene.id) or (episode and shot.scene.episode_id != episode.id)): invalid = True
        if data.review_thread_id and (thread is None or thread.shot.scene.episode.project_id != project_id): invalid = True
        if invalid:
            raise OperationsValidationError("Task links must belong to the project and hierarchy")

    def create_task(self, project_id: str, data: schemas.ProductionTaskCreate):
        if self.session.get(models.Project, project_id) is None:
            return None
        self._validate_task_links(project_id, data)
        values = data.model_dump()
        values["checklist"] = [item.model_dump() for item in data.checklist]
        task = models.ProductionTask(project_id=project_id, **values)
        self.session.add(task)
        self.session.flush()
        self.session.commit()
        self.session.refresh(task)
        return task

    def list_tasks(self, project_id: str):
        if self.session.get(models.Project, project_id) is None:
            return None
        return list(self.session.scalars(select(models.ProductionTask).where(models.ProductionTask.project_id == project_id).order_by(models.ProductionTask.created_at.desc())))

    def update_task(self, task_id: str, data: schemas.ProductionTaskPatch):
        task = self.session.get(models.ProductionTask, task_id)
        if task is None:
            return None
        before = {"title": task.title, "description": task.description, "priority": task.priority, "status": task.status, "due_at": _json_value(task.due_at), "checklist": task.checklist}
        values = data.model_dump(exclude_unset=True)
        if "checklist" in values and values["checklist"] is not None:
            values["checklist"] = [item.model_dump() if hasattr(item, "model_dump") else item for item in data.checklist or []]
        for key, value in values.items(): setattr(task, key, value)
        after = {**before, **{key: _json_value(value) for key, value in values.items()}}
        self.session.commit(); self.session.refresh(task)
        return task

    def delete_task(self, task_id: str) -> bool:
        task = self.session.get(models.ProductionTask, task_id)
        if task is None:
            return False
        self.session.delete(task)
        self.session.commit()
        return True

    def _episode_snapshot(self, episode_id: str) -> dict | None:
        episode = self.session.scalar(
            select(models.Episode)
            .options(selectinload(models.Episode.scenes).selectinload(models.Scene.shots).selectinload(models.Shot.dialogue))
            .where(models.Episode.id == episode_id)
        )
        if episode is None:
            return None
        return {
            "episode": {"id": episode.id, "project_id": episode.project_id, "volume_id": episode.volume_id, "position": episode.position, "title": episode.title, "premise": episode.premise, "target_duration_seconds": episode.target_duration_seconds, "status": episode.status},
            "scenes": [{"id": scene.id, "position": scene.position, "location": scene.location, "time_of_day": scene.time_of_day, "summary": scene.summary, "continuity_state": scene.continuity_state, "estimated_duration_seconds": scene.estimated_duration_seconds, "shots": [{"id": shot.id, "position": shot.position, "shot_type": shot.shot_type, "duration_seconds": shot.duration_seconds, "composition": shot.composition, "camera_motion": shot.camera_motion, "character_state": shot.character_state, "image_prompt": shot.image_prompt, "negative_prompt": shot.negative_prompt, "active_panel_asset_id": shot.active_panel_asset_id, "previous_shot_tail_asset_id": shot.previous_shot_tail_asset_id, "video_prompt": shot.video_prompt, "negative_video_prompt": shot.negative_video_prompt, "active_video_asset_id": shot.active_video_asset_id, "video_render_status": shot.video_render_status, "review_status": shot.review_status, "render_status": shot.render_status, "dialogue": [{"id": line.id, "position": line.position, "character_id": line.character_id, "text": line.text, "subtitle_text": line.subtitle_text, "emotion": line.emotion, "performance_instruction": line.performance_instruction, "audio_asset_id": line.audio_asset_id, "start_seconds": line.start_seconds, "duration_seconds": line.duration_seconds} for line in shot.dialogue]} for shot in scene.shots]} for scene in episode.scenes],
        }

    def _next_version_number(self, episode_id: str) -> int:
        return (self.session.scalar(select(func.max(models.EpisodeVersion.version)).where(models.EpisodeVersion.episode_id == episode_id)) or 0) + 1

    def _valid_asset_id(self, asset_id, project_id: str) -> str | None:
        if not asset_id:
            return None
        asset = self.session.get(models.Asset, asset_id)
        return asset.id if asset is not None and asset.project_id == project_id else None

    def _valid_character_id(self, character_id, project_id: str) -> str | None:
        if not character_id:
            return None
        character = self.session.get(models.Character, character_id)
        return character.id if character is not None and character.project_id == project_id else None

    @staticmethod
    def _snapshot_id(item, kind: str, seen: set[str]) -> str:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise OperationsValidationError(f"Invalid {kind} in episode version snapshot")
        item_id = item["id"]
        if item_id in seen:
            raise OperationsValidationError(f"Duplicate {kind} id in episode version snapshot")
        seen.add(item_id)
        return item_id

    def _restore_episode_snapshot(self, episode: models.Episode, snapshot: dict) -> None:
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("episode"), dict) or not isinstance(snapshot.get("scenes"), list):
            raise OperationsValidationError("Invalid episode version snapshot")
        episode_data = snapshot["episode"]
        if episode_data.get("id") != episode.id or episode_data.get("project_id") != episode.project_id:
            raise OperationsValidationError("Episode version snapshot does not match its episode")

        try:
            episode.position = int(episode_data.get("position", episode.position))
            episode.title = str(episode_data["title"])
            episode.premise = str(episode_data.get("premise", ""))
            episode.target_duration_seconds = int(episode_data["target_duration_seconds"])
            episode.status = str(episode_data.get("status", "draft"))
        except (KeyError, TypeError, ValueError) as exc:
            raise OperationsValidationError("Invalid episode fields in version snapshot") from exc
        volume_id = episode_data.get("volume_id")
        volume = self.session.get(models.Volume, volume_id) if volume_id else None
        episode.volume_id = volume.id if volume is not None and volume.project_id == episode.project_id else None

        current_scenes = {scene.id: scene for scene in episode.scenes}
        current_shots = {shot.id: shot for scene in episode.scenes for shot in scene.shots}
        current_lines = {line.id: line for shot in current_shots.values() for line in shot.dialogue}
        desired_scene_ids: set[str] = set()
        desired_shot_ids: set[str] = set()
        desired_line_ids: set[str] = set()

        for scene_data in snapshot["scenes"]:
            scene_id = self._snapshot_id(scene_data, "scene", desired_scene_ids)
            scene = current_scenes.get(scene_id)
            if scene is None:
                collision = self.session.get(models.Scene, scene_id)
                if collision is not None:
                    raise OperationsValidationError("Snapshot scene id belongs to another episode")
                scene = models.Scene(id=scene_id, episode=episode)
                self.session.add(scene)
            try:
                scene.position = int(scene_data["position"])
                scene.location = str(scene_data.get("location", ""))
                scene.time_of_day = str(scene_data.get("time_of_day", ""))
                scene.summary = str(scene_data.get("summary", ""))
                scene.continuity_state = scene_data.get("continuity_state", {}) if isinstance(scene_data.get("continuity_state", {}), dict) else {}
                scene.estimated_duration_seconds = float(scene_data.get("estimated_duration_seconds", 0))
            except (KeyError, TypeError, ValueError) as exc:
                raise OperationsValidationError("Invalid scene fields in version snapshot") from exc
            shots_data = scene_data.get("shots", [])
            if not isinstance(shots_data, list):
                raise OperationsValidationError("Invalid shots in episode version snapshot")

            for shot_data in shots_data:
                shot_id = self._snapshot_id(shot_data, "shot", desired_shot_ids)
                shot = current_shots.get(shot_id)
                if shot is None:
                    collision = self.session.get(models.Shot, shot_id)
                    if collision is not None:
                        raise OperationsValidationError("Snapshot shot id belongs to another episode")
                    shot = models.Shot(id=shot_id, scene=scene)
                    self.session.add(shot)
                else:
                    shot.scene = scene
                try:
                    shot.position = int(shot_data["position"])
                    shot.shot_type = str(shot_data.get("shot_type", "medium"))
                    shot.duration_seconds = float(shot_data.get("duration_seconds", 0))
                    shot.composition = str(shot_data.get("composition", ""))
                    shot.camera_motion = str(shot_data.get("camera_motion", "static"))
                    shot.character_state = shot_data.get("character_state", {}) if isinstance(shot_data.get("character_state", {}), dict) else {}
                    shot.image_prompt = str(shot_data.get("image_prompt", ""))
                    shot.negative_prompt = str(shot_data.get("negative_prompt", ""))
                    shot.video_prompt = str(shot_data.get("video_prompt", ""))
                    shot.negative_video_prompt = str(shot_data.get("negative_video_prompt", ""))
                    shot.video_render_status = str(shot_data.get("video_render_status", shot.video_render_status or "pending"))
                    shot.review_status = str(shot_data.get("review_status", "draft"))
                    shot.render_status = str(shot_data.get("render_status", "pending"))
                except (KeyError, TypeError, ValueError) as exc:
                    raise OperationsValidationError("Invalid shot fields in version snapshot") from exc
                shot.active_panel_asset_id = self._valid_asset_id(shot_data.get("active_panel_asset_id"), episode.project_id)
                shot.previous_shot_tail_asset_id = self._valid_asset_id(shot_data.get("previous_shot_tail_asset_id"), episode.project_id)
                shot.active_video_asset_id = self._valid_asset_id(shot_data.get("active_video_asset_id"), episode.project_id)

                dialogue_data = shot_data.get("dialogue", [])
                if not isinstance(dialogue_data, list):
                    raise OperationsValidationError("Invalid dialogue in episode version snapshot")
                for line_data in dialogue_data:
                    line_id = self._snapshot_id(line_data, "dialogue line", desired_line_ids)
                    line = current_lines.get(line_id)
                    if line is None:
                        collision = self.session.get(models.DialogueLine, line_id)
                        if collision is not None:
                            raise OperationsValidationError("Snapshot dialogue id belongs to another episode")
                        line = models.DialogueLine(id=line_id, shot=shot)
                        self.session.add(line)
                    else:
                        line.shot = shot
                    try:
                        line.position = int(line_data["position"])
                        line.text = str(line_data.get("text", ""))
                        line.subtitle_text = str(line_data.get("subtitle_text", line.text))
                        line.emotion = str(line_data.get("emotion", "neutral"))
                        line.performance_instruction = str(line_data.get("performance_instruction", ""))
                        line.start_seconds = float(line_data.get("start_seconds", line.start_seconds or 0))
                        line.duration_seconds = float(line_data.get("duration_seconds", line.duration_seconds or 0))
                    except (KeyError, TypeError, ValueError) as exc:
                        raise OperationsValidationError("Invalid dialogue fields in version snapshot") from exc
                    line.character_id = self._valid_character_id(line_data.get("character_id"), episode.project_id)
                    line.audio_asset_id = self._valid_asset_id(line_data.get("audio_asset_id"), episode.project_id)

        for line_id, line in current_lines.items():
            if line_id not in desired_line_ids and line.shot_id in desired_shot_ids:
                self.session.delete(line)
        for shot_id, shot in current_shots.items():
            if shot_id not in desired_shot_ids and shot.scene_id in desired_scene_ids:
                self.session.delete(shot)
        for scene_id, scene in current_scenes.items():
            if scene_id not in desired_scene_ids:
                self.session.delete(scene)

    def create_version(self, episode_id: str, data: schemas.EpisodeVersionCreate):
        snapshot = self._episode_snapshot(episode_id)
        if snapshot is None: return None
        number = self._next_version_number(episode_id)
        version = models.EpisodeVersion(
            episode_id=episode_id,
            version=number,
            snapshot=snapshot,
            author="本人",
            **data.model_dump(),
        )
        self.session.add(version); self.session.flush()
        self.session.commit(); self.session.refresh(version)
        return version

    def list_versions(self, episode_id: str):
        episode = self.session.get(models.Episode, episode_id)
        if episode is None: return None
        return list(self.session.scalars(select(models.EpisodeVersion).where(models.EpisodeVersion.episode_id == episode_id).order_by(models.EpisodeVersion.version.desc())))

    def restore_version(self, version_id: str):
        source = self.session.get(models.EpisodeVersion, version_id)
        if source is None: return None
        active_run = self.session.scalar(select(models.ProductionRun.id).where(models.ProductionRun.episode_id == source.episode_id, models.ProductionRun.status.in_(ACTIVE_RUN_STATUSES)).limit(1))
        if active_run is not None:
            raise RuntimeError("episode_restore_active_production")
        episode = self.session.scalar(
            select(models.Episode)
            .options(selectinload(models.Episode.scenes).selectinload(models.Scene.shots).selectinload(models.Shot.dialogue))
            .where(models.Episode.id == source.episode_id)
        )
        if episode is None:
            return None
        backup_snapshot = self._episode_snapshot(episode.id)
        if backup_snapshot is None:
            return None
        try:
            number = self._next_version_number(episode.id)
            backup = models.EpisodeVersion(
                episode_id=episode.id,
                version=number,
                label=f"恢复 V{source.version} 前自动备份",
                source="checkpoint",
                author="系统恢复",
                snapshot=deepcopy(backup_snapshot),
            )
            self.session.add(backup)
            self.session.flush()
            self._restore_episode_snapshot(episode, deepcopy(source.snapshot))
            self.session.flush()
            self.session.expire_all()
            applied_snapshot = self._episode_snapshot(episode.id)
            if applied_snapshot is None:
                raise OperationsValidationError("Restored episode could not be loaded")
            restored = models.EpisodeVersion(
                episode_id=episode.id,
                version=number + 1,
                label=f"从 V{source.version} 恢复",
                source="restore",
                author="系统恢复",
                snapshot=deepcopy(applied_snapshot),
                restored_from_id=source.id,
            )
            self.session.add(restored)
            self.session.flush()
            self.session.commit()
            self.session.refresh(restored)
            return restored
        except Exception:
            self.session.rollback()
            raise
