from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.repositories import EpisodeRepository
from comic_studio.services.panel_freshness import PanelFreshnessService


class ReadinessService:
    def __init__(self, session: Session): self.session = session

    def inspect(self, episode_id: str) -> dict | None:
        episode = EpisodeRepository(self.session).get(episode_id)
        if episode is None: return None
        shots = [shot for scene in episode.scenes for shot in scene.shots]
        lines = [line for shot in shots for line in shot.dialogue if line.text.strip()]
        missing_panels = []
        stale_panels = []
        freshness = PanelFreshnessService(self.session)
        for shot in shots:
            panel = (
                self.session.get(models.Asset, shot.active_panel_asset_id)
                if shot.active_panel_asset_id
                else None
            )
            if panel is None or panel.kind != f"panel:{shot.id}":
                missing_panels.append(shot.id)
            elif freshness.inspect(shot.id, panel).is_stale:
                stale_panels.append(shot.id)
        unapproved = [shot.id for shot in shots if shot.review_status != "approved"]
        missing_speech = [line.id for line in lines if not line.audio_asset_id or line.duration_seconds <= 0]
        missing_videos = []
        stale_videos = []
        invalid_panels = set(missing_panels) | set(stale_panels)
        for shot in shots:
            video = (
                self.session.get(models.Asset, shot.active_video_asset_id)
                if shot.active_video_asset_id
                else None
            )
            if (
                video is None
                or video.kind != f"video:{shot.id}"
                or not video.media_type.startswith("video/")
                or not video.duration_seconds
                or video.duration_seconds <= 0
            ):
                missing_videos.append(shot.id)
            elif (
                shot.id in invalid_panels
                or video.parent_asset_id != shot.active_panel_asset_id
            ):
                stale_videos.append(shot.id)
        blockers = {"missing_panels": missing_panels, "stale_panels": stale_panels, "unapproved_shots": unapproved, "missing_speech": missing_speech}
        return {
            "episode_id": episode.id,
            "ready": not any(blockers.values()),
            "video_ready": not missing_videos and not stale_videos and not any(blockers.values()),
            "totals": {"shots": len(shots), "dialogue": len(lines)},
            "ready_counts": {
                "panels": len(shots) - len(missing_panels) - len(stale_panels),
                "approved": len(shots) - len(unapproved),
                "speech": len(lines) - len(missing_speech),
                "videos": len(shots) - len(missing_videos) - len(stale_videos),
            },
            "blockers": {
                **blockers,
                "missing_videos": missing_videos,
                "stale_videos": stale_videos,
            },
        }
