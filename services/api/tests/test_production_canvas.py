import pytest
from sqlalchemy.exc import IntegrityError

from comic_studio import models


def _episode(db_session):
    project = models.Project(
        title="Canvas Project",
        logline="A production canvas",
        story_bible="",
        visual_style="ink",
    )
    db_session.add(project)
    db_session.flush()
    episode = models.Episode(
        project_id=project.id,
        position=1,
        title="Episode 1",
        premise="",
        target_duration_seconds=60,
    )
    db_session.add(episode)
    db_session.commit()
    return project, episode


def test_production_canvas_layout_is_unique_per_episode(db_session):
    _, episode = _episode(db_session)
    db_session.add(
        models.ProductionCanvasLayout(
            episode_id=episode.id,
            version=1,
            layout={
                "version": 1,
                "viewport": {"x": 0, "y": 0, "zoom": 0.75},
                "nodes": {},
                "expanded_shots": [],
                "pinned_shots": [],
            },
        )
    )
    db_session.commit()
    db_session.add(
        models.ProductionCanvasLayout(
            episode_id=episode.id,
            version=1,
            layout={},
        )
    )

    with pytest.raises(IntegrityError):
        db_session.commit()


def test_production_workflow_binding_is_versioned(db_session):
    project, _ = _episode(db_session)
    binding = models.ProductionWorkflowBinding(
        project_id=project.id,
        capability="panel",
        name="vertical-animation-panel",
        workflow_id="workflow-panel-v3",
        workflow_version=3,
        input_mapping_version=1,
        enabled=True,
    )
    db_session.add(binding)
    db_session.commit()

    assert binding.workflow_version == 3
    assert binding.input_mapping_version == 1


def _seed_graph(client):
    with client.app.state.session_factory() as session:
        project = models.Project(
            title="Graph Project",
            logline="",
            story_bible="",
            visual_style="ink",
        )
        session.add(project)
        session.flush()
        episode = models.Episode(
            project_id=project.id,
            position=1,
            title="Episode 1",
            premise="",
            target_duration_seconds=60,
        )
        session.add(episode)
        session.flush()
        scene_one = models.Scene(
            episode_id=episode.id,
            position=1,
            location="Courtyard",
            summary="Arrival",
            estimated_duration_seconds=20,
        )
        scene_two = models.Scene(
            episode_id=episode.id,
            position=2,
            location="Hall",
            summary="Confrontation",
            estimated_duration_seconds=20,
        )
        session.add_all([scene_one, scene_two])
        session.flush()
        shots = [
            models.Shot(
                scene_id=scene_one.id,
                position=1,
                shot_type="medium",
                duration_seconds=4,
                composition="Entrance",
            ),
            models.Shot(
                scene_id=scene_one.id,
                position=2,
                shot_type="close",
                duration_seconds=3,
                composition="Reaction",
            ),
            models.Shot(
                scene_id=scene_two.id,
                position=1,
                shot_type="wide",
                duration_seconds=5,
                composition="Hall",
            ),
        ]
        session.add_all(shots)
        session.flush()
        panel = models.Asset(
            project_id=project.id,
            kind=f"panel:{shots[0].id}",
            local_path=f"projects/{project.id}/panels/{shots[0].id}/panel.png",
            media_type="image/png",
            provider="test",
            model="fixture",
            request_metadata={},
            generation_attempt=1,
            checksum="panel-checksum",
        )
        session.add(panel)
        session.flush()
        shots[0].active_panel_asset_id = panel.id
        session.add_all(
            [
                models.DialogueLine(
                    shot_id=shots[0].id,
                    position=1,
                    text="Ready line",
                    subtitle_text="Ready line",
                    audio_asset_id="audio-ready",
                ),
                models.DialogueLine(
                    shot_id=shots[0].id,
                    position=2,
                    text="Pending line",
                    subtitle_text="Pending line",
                ),
            ]
        )
        character = models.Character(
            project_id=project.id,
            name="Lin",
            role="lead",
            appearance_bible="",
            personality="",
            continuity_rules="",
            voice_speaker="default",
        )
        session.add(character)
        session.flush()
        variant = models.AssetVariant(
            character_id=character.id,
            kind="master",
            label="Primary look",
        )
        session.add(variant)
        session.flush()
        session.add_all(
            [
                models.AssetVariantUsage(
                    variant_id=variant.id,
                    shot_id=shots[0].id,
                    usage_kind="character",
                ),
                models.AssetVariantUsage(
                    variant_id=variant.id,
                    shot_id=shots[1].id,
                    usage_kind="character",
                ),
            ]
        )
        session.commit()
        return episode.id, [scene_one.id, scene_two.id], [shot.id for shot in shots], variant.id


def test_episode_production_graph_returns_peer_shots_and_real_dependencies(client):
    episode_id, scene_ids, shot_ids, variant_id = _seed_graph(client)

    response = client.get(f"/api/episodes/{episode_id}/production-graph")

    assert response.status_code == 200
    payload = response.json()
    assert [scene["id"] for scene in payload["scenes"]] == scene_ids
    assert {shot["id"] for shot in payload["shots"]} == set(shot_ids)
    first_shot = next(shot for shot in payload["shots"] if shot["id"] == shot_ids[0])
    assert first_shot["active_panel_media_url"].endswith("/panel.png")
    assert first_shot["dialogue_count"] == 2
    assert first_shot["speech_ready_count"] == 1
    assert len(first_shot["dialogue_ids"]) == 2
    shared = next(item for item in payload["assets"] if item["id"] == variant_id)
    assert set(shared["shot_ids"]) == set(shot_ids[:2])
    assert all(
        edge["source_shot_id"] == edge["target_shot_id"]
        for edge in payload["media_dependencies"]
    )


def test_canvas_layout_round_trips(client):
    episode_id, _, _, _ = _seed_graph(client)
    payload = {
        "version": 3,
        "viewport": {"x": 10, "y": -20, "zoom": 0.8},
        "nodes": {"shot:one": {"x": 300, "y": 120}},
        "expanded_shots": ["one"],
        "pinned_shots": [],
        "collapsed_scene_ids": ["scene:two"],
    }

    saved = client.put(
        f"/api/episodes/{episode_id}/production-canvas-layout", json=payload
    )
    loaded = client.get(f"/api/episodes/{episode_id}/production-canvas-layout")

    assert saved.status_code == 200
    assert loaded.status_code == 200
    assert loaded.json()["layout"] == payload


def test_canvas_layout_rejects_unknown_fields(client):
    episode_id, _, _, _ = _seed_graph(client)

    response = client.put(
        f"/api/episodes/{episode_id}/production-canvas-layout",
        json={
            "version": 1,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": {},
            "unknown": True,
        },
    )

    assert response.status_code == 422


def test_workflow_binding_round_trips_and_validates_versions(client):
    episode_id, _, _, _ = _seed_graph(client)
    with client.app.state.session_factory() as session:
        project_id = session.get(models.Episode, episode_id).project_id
    payload = {
        "workflow_id": "panel-workflow-v3",
        "workflow_version": 3,
        "input_mapping_version": 1,
        "enabled": True,
    }

    saved = client.put(
        f"/api/projects/{project_id}/production-workflows/panel/default",
        json=payload,
    )
    listed = client.get(f"/api/projects/{project_id}/production-workflows")
    invalid = client.put(
        f"/api/projects/{project_id}/production-workflows/audio/default",
        json=payload,
    )

    assert saved.status_code == 200
    assert saved.json()["workflow_version"] == 3
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == ["default"]
    assert invalid.status_code == 422
