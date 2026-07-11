def test_project_and_characters_survive_new_request(client):
    project_response = client.post(
        "/api/projects",
        json={
            "title": "霓虹夜行",
            "logline": "失忆侦探寻找被删除的城市记忆",
            "story_bible": "近未来重庆，记忆可以买卖。",
            "visual_style": "Chinese noir comic, cyan and red accents",
            "aspect_ratio": "9:16",
        },
    )
    assert project_response.status_code == 201
    project = project_response.json()

    character_response = client.post(
        f"/api/projects/{project['id']}/characters",
        json={
            "name": "林默",
            "role": "protagonist",
            "appearance_bible": (
                "27-year-old Chinese man, black coat, silver left eye"
            ),
            "personality": "quiet, observant, distrustful",
            "continuity_rules": "Always wears the black coat outdoors",
            "voice_speaker": "Dylan",
            "voice_instruction": "冷静、低声、略带疲惫",
        },
    )
    assert character_response.status_code == 201
    character = character_response.json()

    loaded_response = client.get(f"/api/projects/{project['id']}")
    assert loaded_response.status_code == 200
    loaded = loaded_response.json()

    assert loaded["title"] == "霓虹夜行"
    assert loaded["characters"][0]["id"] == character["id"]
    assert loaded["characters"][0]["voice_speaker"] == "Dylan"


def test_project_rejects_unsupported_aspect_ratio(client):
    response = client.post(
        "/api/projects",
        json={
            "title": "错误项目",
            "logline": "测试",
            "story_bible": "测试",
            "visual_style": "comic",
            "aspect_ratio": "3:2",
        },
    )

    assert response.status_code == 422
