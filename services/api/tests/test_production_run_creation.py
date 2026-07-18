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


def test_create_shot_group_run_only_snapshots_selected_shots(client):
    episode_id, ready_shot, missing_shot, ready_line, missing_line = seed_mixed_episode(client)

    response = client.post(
        f"/api/episodes/{episode_id}/production-runs",
        json={"stages": ["panels", "speech"], "shot_ids": [missing_shot]},
    )

    assert response.status_code == 202
    run = response.json()
    assert run["scope_type"] == "shot_group"
    assert run["shot_ids"] == [missing_shot]
    items = client.get(f"/api/production-runs/{run['id']}/items").json()
    # Only the selected shot (missing_shot) and its dialogue line are snapshotted.
    assert [item["target_id"] for item in items] == [missing_shot, missing_line]
    assert run["total_items"] == 2


def test_episode_run_conflict_does_not_block_non_overlapping_shot_group_run(client):
    episode_id, ready_shot, missing_shot, _, _ = seed_mixed_episode(client)

    # Episode-scope run already active.
    first = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages": ["panels"]})
    assert first.status_code == 202

    # Shot-group run targeting a non-overlapping shot is allowed.
    group = client.post(
        f"/api/episodes/{episode_id}/production-runs",
        json={"stages": ["panels"], "shot_ids": [missing_shot]},
    )
    assert group.status_code == 202
    assert group.json()["scope_type"] == "shot_group"


def test_shot_group_run_rejects_overlapping_shot(client):
    episode_id, ready_shot, missing_shot, _, _ = seed_mixed_episode(client)

    first = client.post(
        f"/api/episodes/{episode_id}/production-runs",
        json={"stages": ["panels"], "shot_ids": [ready_shot, missing_shot]},
    )
    assert first.status_code == 202

    # Overlap on ready_shot -> 409.
    second = client.post(
        f"/api/episodes/{episode_id}/production-runs",
        json={"stages": ["panels"], "shot_ids": [ready_shot]},
    )
    assert second.status_code == 409


def test_episode_scope_run_still_mutually_exclusive(client):
    episode_id, _, _, _, _ = seed_mixed_episode(client)

    first = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages": ["panels"]})
    assert first.status_code == 202

    second = client.post(f"/api/episodes/{episode_id}/production-runs", json={"stages": ["panels"]})
    assert second.status_code == 409


def seed_grid_episode(client):
    with client.app.state.session_factory() as session:
        project = models.Project(title="Grid test", logline="x", story_bible="x", visual_style="comic")
        episode = models.Episode(project=project, title="Grid ep", premise="x", target_duration_seconds=60)
        scene = models.Scene(episode=episode, position=1, location="street", summary="chase", estimated_duration_seconds=8)
        shots = [
            models.Shot(scene=scene, position=i, shot_type="wide", duration_seconds=2, composition=f"shot-{i}", image_prompt=f"prompt-{i}")
            for i in range(1, 6)
        ]
        session.add_all(shots); session.flush()
        session.commit()
        return episode.id, [shot.id for shot in shots]


def enable_script_driven_generation(client, episode_id):
    with client.app.state.session_factory() as session:
        episode = session.get(models.Episode, episode_id)
        document = models.ScriptDocument(
            project_id=episode.project_id,
            title="Production script",
            source_type="upload",
            status="ready",
        )
        session.add(document)
        session.flush()
        revision = models.ScriptRevision(
            document_id=document.id,
            revision_number=1,
            status="finalized",
            content="Generate the episode from bound assets and director blocking.",
            checksum=f"script-{episode.id}",
            creation_method="upload",
        )
        session.add(revision)
        session.flush()
        document.current_revision_id = revision.id
        session.commit()


def test_grid_mode_groups_shots_by_scene_in_chunks_of_four(client):
    episode_id, shot_ids = seed_grid_episode(client)

    response = client.post(
        f"/api/episodes/{episode_id}/production-runs",
        json={"stages": ["panels"], "panel_generation_mode": "grid"},
    )

    assert response.status_code == 202
    run = response.json()
    assert run["panel_generation_mode"] == "grid"
    items = client.get(f"/api/production-runs/{run['id']}/items").json()
    assert len(items) == 2
    assert items[0]["target_type"] == "grid_panel"
    assert items[0]["target_id"] == ",".join(shot_ids[:4])
    assert items[1]["target_type"] == "grid_panel"
    assert items[1]["target_id"] == shot_ids[4]
    assert all(item["status"] == "queued" for item in items)
