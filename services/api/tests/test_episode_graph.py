def create_project(client):
    return client.post(
        "/api/projects",
        json={
            "title": "霓虹夜行",
            "logline": "失忆侦探寻找被删除的城市记忆",
            "story_bible": "近未来重庆，记忆可以买卖。",
            "visual_style": "Chinese noir comic",
            "aspect_ratio": "9:16",
        },
    ).json()


def test_new_episode_returns_empty_ordered_production_graph(client):
    project = create_project(client)

    response = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={
            "title": "失窃的雨夜",
            "premise": "林默追查一段被盗记忆",
            "target_duration_seconds": 60,
        },
    )

    assert response.status_code == 201
    episode = response.json()
    loaded = client.get(f"/api/episodes/{episode['id']}").json()

    assert loaded["status"] == "draft"
    assert loaded["scenes"] == []
    assert loaded["target_duration_seconds"] == 60


def test_episode_duration_must_be_practical_for_short_form(client):
    project = create_project(client)

    response = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "过短", "premise": "测试", "target_duration_seconds": 3},
    )

    assert response.status_code == 422
