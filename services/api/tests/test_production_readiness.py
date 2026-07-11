from comic_studio import models


def seed_graph(client):
    with client.app.state.session_factory() as session:
        project = models.Project(title="夜行", logline="寻找", story_bible="重庆", visual_style="comic")
        episode = models.Episode(project=project, title="雨夜", premise="线索", target_duration_seconds=60)
        scene = models.Scene(episode=episode, position=1, location="巷道", summary="发现", estimated_duration_seconds=5)
        shot = models.Shot(scene=scene, position=1, shot_type="close_up", duration_seconds=5, composition="特写")
        line = models.DialogueLine(shot=shot, position=1, text="别回头", subtitle_text="别回头")
        session.add(line); session.commit()
        return episode.id, shot.id, line.id, project.id


def test_readiness_reports_exact_panel_approval_and_speech_blockers(client):
    episode_id, shot_id, line_id, _ = seed_graph(client)

    response = client.get(f"/api/episodes/{episode_id}/production-readiness")

    assert response.status_code == 200
    report = response.json()
    assert report["ready"] is False
    assert report["blockers"]["missing_panels"] == [shot_id]
    assert report["blockers"]["unapproved_shots"] == [shot_id]
    assert report["blockers"]["missing_speech"] == [line_id]
    assert report["blockers"]["missing_videos"] == [shot_id]
    assert report["video_ready"] is False


def test_readiness_becomes_true_when_required_assets_are_ready(client):
    episode_id, shot_id, line_id, project_id = seed_graph(client)
    with client.app.state.session_factory() as session:
        panel = models.Asset(project_id=project_id, kind=f"panel:{shot_id}", local_path="panel.png", media_type="image/png", provider="test", model="test", checksum="0"*64)
        audio = models.Asset(project_id=project_id, kind=f"dialogue:{line_id}", local_path="line.wav", media_type="audio/wav", provider="test", model="test", checksum="1"*64, duration_seconds=1.0)
        session.add_all([panel, audio]); session.flush()
        shot = session.get(models.Shot, shot_id); line = session.get(models.DialogueLine, line_id)
        shot.active_panel_asset_id = panel.id; shot.review_status = "approved"
        line.audio_asset_id = audio.id; line.duration_seconds = 1.0
        session.commit()

    report = client.get(f"/api/episodes/{episode_id}/production-readiness").json()

    assert report["ready"] is True
    assert report["blockers"] == {"missing_panels": [], "unapproved_shots": [], "missing_speech": [], "missing_videos": [shot_id]}
    assert report["ready"] is True
    assert report["video_ready"] is False
