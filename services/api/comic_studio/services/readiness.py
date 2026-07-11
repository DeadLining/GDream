from sqlalchemy.orm import Session

from comic_studio.repositories import EpisodeRepository


class ReadinessService:
    def __init__(self, session: Session): self.session = session

    def inspect(self, episode_id: str) -> dict | None:
        episode = EpisodeRepository(self.session).get(episode_id)
        if episode is None: return None
        shots = [shot for scene in episode.scenes for shot in scene.shots]
        lines = [line for shot in shots for line in shot.dialogue if line.text.strip()]
        missing_panels = [shot.id for shot in shots if not shot.active_panel_asset_id]
        unapproved = [shot.id for shot in shots if shot.review_status != "approved"]
        missing_speech = [line.id for line in lines if not line.audio_asset_id or line.duration_seconds <= 0]
        blockers = {"missing_panels": missing_panels, "unapproved_shots": unapproved, "missing_speech": missing_speech}
        return {
            "episode_id": episode.id,
            "ready": not any(blockers.values()),
            "totals": {"shots": len(shots), "dialogue": len(lines)},
            "ready_counts": {
                "panels": len(shots) - len(missing_panels),
                "approved": len(shots) - len(unapproved),
                "speech": len(lines) - len(missing_speech),
            },
            "blockers": blockers,
        }
