from comic_studio import models


def seed_mixed_episode(client):
    with client.app.state.session_factory() as session:
        project = models.Project(title="夜行", logline="寻找", story_bible="重庆", visual_style="comic")
        episode = models.Episode(project=project, title="雨夜", premise="线索", target_duration_seconds=60)
        scene = models.Scene(episode=episode, position=1, location="巷道", summary="发现", estimated_duration_seconds=8)
        ready = models.Shot(scene=scene, position=1, shot_type="wide", duration_seconds=4, composition="全景", review_status="approved")
        missing = models.Shot(scene=scene, position=2, shot_type="close_up", duration_seconds=4, composition="特写")
        line_ready = models.DialogueLine(shot=ready, position=1, text="已完成", subtitle_text="已完成", duration_seconds=1)
        line_missing = models.DialogueLine(shot=missing, position=1, text="待生成", subtitle_text="待生成")
        session.add_all([line_ready, line_missing]); session.flush()
        panel = models.Asset(project_id=project.id, kind=f"panel:{ready.id}", local_path="p.png", media_type="image/png", provider="test", model="test", checksum="0"*64)
        audio = models.Asset(project_id=project.id, kind=f"dialogue:{line_ready.id}", local_path="a.wav", media_type="audio/wav", provider="test", model="test", checksum="1"*64, duration_seconds=1)
        session.add_all([panel, audio]); session.flush(); ready.active_panel_asset_id=panel.id; line_ready.audio_asset_id=audio.id
        session.commit(); return episode.id, ready.id, missing.id, line_ready.id, line_missing.id


def test_run_creation_persists_ordered_eligible_and_skipped_items(client):
    episode_id, ready_shot, missing_shot, ready_line, missing_line = seed_mixed_episode(client)

    response = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages":["panels","speech"],"concurrency":2})

    assert response.status_code == 202
    run = response.json()
    items = client.get(f"/api/production-runs/{run['id']}/items").json()
    assert [(item["stage"], item["target_id"], item["status"]) for item in items] == [
        ("panel", ready_shot, "skipped"), ("panel", missing_shot, "queued"),
        ("speech", ready_line, "skipped"), ("speech", missing_line, "queued"),
    ]
    assert run["total_items"] == 4
    assert run["queued_items"] == 2
    assert run["skipped_items"] == 2


def test_run_creation_honors_regeneration_and_rejects_second_active_run(client):
    episode_id, ready_shot, _, ready_line, _ = seed_mixed_episode(client)
    first = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages":["panels","speech"],"regenerate_panels":True,"regenerate_speech":True})
    items = client.get(f"/api/production-runs/{first.json()['id']}/items").json()
    assert next(item for item in items if item["target_id"] == ready_shot)["status"] == "queued"
    assert next(item for item in items if item["target_id"] == ready_line)["status"] == "queued"

    second = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages":["panels"]})
    assert second.status_code == 409


def test_video_stage_queues_eligible_shots_and_skips_missing_panels(client):
    episode_id, ready_shot, missing_shot, _, _ = seed_mixed_episode(client)
    response = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages":["videos"],"regenerate_videos":True})
    assert response.status_code == 202
    items = client.get(f"/api/production-runs/{response.json()['id']}/items").json()
    assert [(item['target_id'],item['status']) for item in items] == [(ready_shot,'queued'),(missing_shot,'skipped')]
    assert response.json()['regenerate_videos'] is True
