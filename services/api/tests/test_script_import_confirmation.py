from comic_studio import models


def _draft(character_name="林夏"):
    return {
        "project": {"title": "雨夜失忆", "logline": "追查记忆交易"},
        "characters": [
            {
                "draft_id": "char-1",
                "name": character_name,
                "aliases": ["小夏"],
                "role": "主角",
                "appearance_bible": "黑色风衣",
                "personality": "冷静",
                "continuity_rules": "银色耳钉",
                "negative_constraints": "",
                "voice_speaker": "female-1",
                "voice_instruction": "低声",
            }
        ],
        "episodes": [
            {
                "draft_id": "ep-disabled",
                "enabled": False,
                "title": "禁用集",
                "premise": "不导入",
                "target_duration_seconds": 60,
                "scenes": [
                    {
                        "location": "街道",
                        "time_of_day": "night",
                        "summary": "禁用",
                        "continuity_state": {},
                        "estimated_duration_seconds": 5,
                        "shots": [
                            {
                                "shot_type": "wide",
                                "duration_seconds": 5,
                                "composition": "街道",
                                "camera_motion": "static",
                                "character_state": {},
                                "image_prompt": "street",
                                "negative_prompt": "",
                                "dialogue": [],
                            }
                        ],
                    }
                ],
            },
            {
                "draft_id": "ep-1",
                "enabled": True,
                "title": "失窃的雨夜",
                "premise": "林夏发现芯片",
                "target_duration_seconds": 60,
                "scenes": [
                    {
                        "location": "天台",
                        "time_of_day": "night",
                        "summary": "面对追兵",
                        "continuity_state": {"weather": "rain"},
                        "estimated_duration_seconds": 8,
                        "shots": [
                            {
                                "shot_type": "close_up",
                                "duration_seconds": 5,
                                "composition": "林夏回头",
                                "camera_motion": "push_in",
                                "character_state": {"char-1": {"outfit": "coat"}},
                                "image_prompt": "noir close-up",
                                "negative_prompt": "",
                                "dialogue": [
                                    {
                                        "speaker_draft_id": "char-1",
                                        "narration": False,
                                        "text": "别回头。",
                                        "subtitle_text": "别回头。",
                                        "emotion": "tense",
                                        "performance_instruction": "低声",
                                    },
                                    {
                                        "speaker_draft_id": None,
                                        "narration": True,
                                        "text": "雨更大了。",
                                        "subtitle_text": "雨更大了。",
                                        "emotion": "neutral",
                                        "performance_instruction": "",
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
        "warnings": [],
    }


def _ready_import(client, *, character_name="林夏"):
    project = client.post(
        "/api/projects",
        json={
            "title": "已有项目",
            "logline": "原梗概",
            "story_bible": "原设定",
            "visual_style": "漫画",
            "aspect_ratio": "9:16",
        },
    ).json()
    with client.app.state.session_factory() as session:
        script_import = models.ScriptImport(
            project_id=project["id"],
            status="ready",
            mode="auto",
            source_format="paste",
            checksum="d" * 64,
            extracted_text="剧本",
            structured_draft=_draft(character_name),
        )
        session.add(script_import)
        session.commit()
        return project, script_import.id


def test_confirmation_merges_normalized_character_and_appends_enabled_episodes(client):
    project, import_id = _ready_import(client, character_name="  林夏 ")
    existing = client.post(
        f"/api/projects/{project['id']}/characters",
        json={
            "name": "林夏",
            "role": "主角",
            "appearance_bible": "已有形象",
            "personality": "冷静",
            "continuity_rules": "银色耳钉",
            "voice_speaker": "female-old",
        },
    ).json()
    client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "已有第一集", "premise": "保留", "target_duration_seconds": 60},
    )

    response = client.post(f"/api/script-imports/{import_id}/confirm", json={})

    assert response.status_code == 200
    detail = client.get(f"/api/projects/{project['id']}").json()
    assert [character["id"] for character in detail["characters"]] == [existing["id"]]
    assert [episode["title"] for episode in detail["episodes"]] == [
        "已有第一集",
        "失窃的雨夜",
    ]
    imported_episode = client.get(f"/api/episodes/{detail['episodes'][1]['id']}").json()
    dialogue = imported_episode["scenes"][0]["shots"][0]["dialogue"]
    assert dialogue[0]["character_id"] == existing["id"]
    assert dialogue[1]["character_id"] is None


def test_confirmation_honors_explicit_character_mapping(client):
    project, import_id = _ready_import(client)
    existing = client.post(
        f"/api/projects/{project['id']}/characters",
        json={
            "name": "替代角色",
            "role": "主角",
            "appearance_bible": "已有形象",
            "personality": "冷静",
            "continuity_rules": "耳钉",
            "voice_speaker": "female-old",
        },
    ).json()

    response = client.post(
        f"/api/script-imports/{import_id}/confirm",
        json={"character_mappings": {"char-1": existing["id"]}},
    )

    assert response.status_code == 200
    detail = client.get(f"/api/projects/{project['id']}").json()
    assert len(detail["characters"]) == 1


def test_reconfirm_returns_conflict(client):
    _, import_id = _ready_import(client)
    assert client.post(f"/api/script-imports/{import_id}/confirm", json={}).status_code == 200

    assert client.post(f"/api/script-imports/{import_id}/confirm", json={}).status_code == 409


def test_invalid_mapping_rolls_back_entire_confirmation(client):
    project, import_id = _ready_import(client)

    response = client.post(
        f"/api/script-imports/{import_id}/confirm",
        json={"character_mappings": {"char-1": "missing-character"}},
    )

    assert response.status_code == 422
    detail = client.get(f"/api/projects/{project['id']}").json()
    assert detail["characters"] == []
    assert detail["episodes"] == []
    assert client.get(f"/api/script-imports/{import_id}").json()["status"] == "ready"


def test_confirmation_records_episode_provenance(client):
    project, import_id = _ready_import(client)

    response = client.post(f"/api/script-imports/{import_id}/confirm", json={})

    assert response.status_code == 200
    episode_ids = response.json()["generated_episode_ids"]
    assert len(episode_ids) == 1
    with client.app.state.session_factory() as session:
        link = session.query(models.ScriptImportEpisode).filter_by(
            script_import_id=import_id
        ).one()
        assert link.episode_id == episode_ids[0]
        assert link.draft_episode_id == "ep-1"


def test_confirmation_syncs_asset_requirements_for_current_script_revision(client):
    project, import_id = _ready_import(client)
    with client.app.state.session_factory() as session:
        script_import = session.get(models.ScriptImport, import_id)
        document = models.ScriptDocument(
            project_id=project["id"],
            title="主剧本",
            source_type="paste",
            status="ready",
        )
        session.add(document)
        session.flush()
        revision = models.ScriptRevision(
            document_id=document.id,
            revision_number=1,
            status="finalized",
            content="天台。林夏：别回头。",
            checksum="confirmed-script",
            creation_method="paste",
        )
        session.add(revision)
        session.flush()
        document.current_revision_id = revision.id
        script_import.script_revision_id = revision.id
        session.commit()

    response = client.post(f"/api/script-imports/{import_id}/confirm", json={})

    assert response.status_code == 200
    requirements = client.get(
        f"/api/projects/{project['id']}/asset-requirements"
    )
    assert requirements.status_code == 200
    assert {item["kind"] for item in requirements.json()} == {
        "character",
        "scene",
    }
