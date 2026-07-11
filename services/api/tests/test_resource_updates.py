from comic_studio import models


def seed_production_graph(client):
    with client.app.state.session_factory() as session:
        project = models.Project(
            title="霓虹夜行",
            logline="失忆侦探寻找记忆",
            story_bible="近未来重庆",
            visual_style="Chinese noir",
            aspect_ratio="9:16",
        )
        character = models.Character(
            project=project,
            name="林默",
            role="protagonist",
            appearance_bible="black coat",
            personality="quiet",
            continuity_rules="keep silver eye",
            voice_speaker="Dylan",
        )
        episode = models.Episode(
            project=project,
            title="失窃的雨夜",
            premise="寻找芯片",
            target_duration_seconds=60,
        )
        scene = models.Scene(
            episode=episode,
            position=1,
            location="雨夜巷道",
            summary="发现线索",
            estimated_duration_seconds=8,
        )
        shot = models.Shot(
            scene=scene,
            position=1,
            shot_type="close_up",
            duration_seconds=5,
            composition="芯片映出眼睛",
            image_prompt="Chinese noir close-up",
        )
        dialogue = models.DialogueLine(
            shot=shot,
            character_id=None,
            position=1,
            text="这段记忆不对。",
            subtitle_text="这段记忆不对。",
        )
        session.add_all([character, dialogue])
        session.commit()
        return {
            "project": project.id,
            "character": character.id,
            "episode": episode.id,
            "shot": shot.id,
            "dialogue": dialogue.id,
        }


def test_patch_routes_update_only_supplied_fields(client):
    ids = seed_production_graph(client)

    project = client.patch(
        f"/api/projects/{ids['project']}", json={"title": "新标题"}
    )
    character = client.patch(
        f"/api/characters/{ids['character']}",
        json={"voice_instruction": "冷静、低声"},
    )
    episode = client.patch(
        f"/api/episodes/{ids['episode']}", json={"target_duration_seconds": 90}
    )
    shot = client.patch(
        f"/api/shots/{ids['shot']}",
        json={"duration_seconds": 7.5, "review_status": "approved"},
    )
    dialogue = client.patch(
        f"/api/dialogue/{ids['dialogue']}",
        json={"emotion": "tense", "subtitle_text": "记忆不对。"},
    )

    assert project.status_code == 200
    assert project.json()["title"] == "新标题"
    assert project.json()["logline"] == "失忆侦探寻找记忆"
    assert character.status_code == 200
    assert character.json()["voice_instruction"] == "冷静、低声"
    assert episode.status_code == 200
    assert episode.json()["target_duration_seconds"] == 90
    assert shot.status_code == 200
    assert shot.json()["duration_seconds"] == 7.5
    assert shot.json()["review_status"] == "approved"
    assert dialogue.status_code == 200
    assert dialogue.json()["emotion"] == "tense"


def test_dialogue_can_be_assigned_to_a_project_character(client):
    ids = seed_production_graph(client)

    response = client.patch(
        f"/api/dialogue/{ids['dialogue']}",
        json={"character_id": ids["character"]},
    )

    assert response.status_code == 200
    assert response.json()["character_id"] == ids["character"]


def test_patch_routes_reject_unknown_and_invalid_fields(client):
    ids = seed_production_graph(client)

    unknown = client.patch(
        f"/api/projects/{ids['project']}", json={"api_key": "not-allowed"}
    )
    invalid_status = client.patch(
        f"/api/shots/{ids['shot']}", json={"review_status": "published"}
    )

    assert unknown.status_code == 422
    assert invalid_status.status_code == 422
