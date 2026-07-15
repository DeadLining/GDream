import base64


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _project(client):
    return client.post(
        "/api/projects",
        json={
            "title": "总览指标",
            "logline": "连接真实制作状态",
            "story_bible": "所有阶段必须来自实际数据。",
            "visual_style": "comic",
            "aspect_ratio": "9:16",
        },
    ).json()


def _character(client, project_id: str, name: str):
    response = client.post(
        f"/api/projects/{project_id}/characters",
        json={
            "name": name,
            "role": "主角",
            "appearance_bible": "黑色风衣",
            "personality": "冷静",
            "continuity_rules": "银色耳钉",
            "voice_speaker": "v1",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_project_overview_metrics_aggregate_script_scenes_and_ready_assets(client):
    project = _project(client)
    for index in range(2):
        episode = client.post(
            f"/api/projects/{project['id']}/episodes",
            json={
                "title": f"第 {index + 1} 集",
                "premise": "继续追踪",
                "target_duration_seconds": 60,
            },
        ).json()
        created_scene = client.post(
            f"/api/episodes/{episode['id']}/scenes",
            json={
                "location": f"场景 {index + 1}",
                "time_of_day": "night",
                "summary": "线索出现",
                "continuity_state": {},
                "estimated_duration_seconds": 10,
            },
        )
        assert created_scene.status_code == 201

    script = client.post(
        f"/api/projects/{project['id']}/scripts",
        json={"title": "正式剧本", "source_type": "paste", "content": "第一集"},
    ).json()
    assert client.post(f"/api/scripts/{script['id']}/finalize").status_code == 200

    ready_character = _character(client, project["id"], "林夏")
    _character(client, project["id"], "林默")
    reference = client.post(
        f"/api/characters/{ready_character['id']}/references/upload",
        data={"reference_type": "primary"},
        files={"file": ("face.png", PNG, "image/png")},
    ).json()
    client.patch(
        f"/api/character-references/{reference['id']}",
        json={"review_status": "approved"},
    )
    client.put(
        f"/api/characters/{ready_character['id']}/references/{reference['id']}/active"
    )

    ready_asset = client.post(
        f"/api/projects/{project['id']}/library-assets",
        json={"kind": "prop", "name": "怀表", "description": "", "tags": [], "metadata": {}},
    ).json()
    client.post(
        f"/api/projects/{project['id']}/library-assets",
        json={"kind": "scene", "name": "天台", "description": "", "tags": [], "metadata": {}},
    )
    assert client.post(
        f"/api/library-assets/{ready_asset['id']}/media",
        files={"file": ("watch.png", PNG, "image/png")},
    ).status_code == 201

    response = client.get(f"/api/projects/{project['id']}/overview-metrics")

    assert response.status_code == 200
    assert response.json() == {
        "project_id": project["id"],
        "scene_count": 2,
        "script_locked": True,
        "asset_total": 4,
        "asset_ready": 2,
    }


def test_project_overview_metrics_return_not_found_for_unknown_project(client):
    response = client.get("/api/projects/not-found/overview-metrics")

    assert response.status_code == 404
