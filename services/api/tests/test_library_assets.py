def _project(client, title: str = "资产目录"):
    response = client.post(
        "/api/projects",
        json={
            "title": title,
            "logline": "管理作品资产",
            "story_bible": "场景、道具、服装和声音保持一致。",
            "visual_style": "cinematic comic",
            "aspect_ratio": "16:9",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_library_assets_support_project_crud_and_category_filtering(client):
    project = _project(client)
    created = []
    for kind, name in (
        ("scene", "雨夜天台"),
        ("prop", "银色怀表"),
        ("costume", "黑色风衣"),
        ("sound", "城市雨声"),
    ):
        response = client.post(
            f"/api/projects/{project['id']}/library-assets",
            json={
                "kind": kind,
                "name": name,
                "description": f"{name}的作品级设定",
                "tags": ["雨夜", kind],
                "metadata": {"source": "manual"},
            },
        )
        assert response.status_code == 201
        created.append(response.json())

    all_assets = client.get(
        f"/api/projects/{project['id']}/library-assets"
    )
    scenes = client.get(
        f"/api/projects/{project['id']}/library-assets?kind=scene&q=天台"
    )

    assert all_assets.status_code == 200
    assert [item["kind"] for item in all_assets.json()] == [
        "scene",
        "prop",
        "costume",
        "sound",
    ]
    assert [item["name"] for item in scenes.json()] == ["雨夜天台"]

    updated = client.patch(
        f"/api/library-assets/{created[0]['id']}",
        json={
            "name": "暴雨天台",
            "description": "霓虹灯下的暴雨天台",
            "tags": ["暴雨", "夜景"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "暴雨天台"
    assert updated.json()["tags"] == ["暴雨", "夜景"]

    deleted = client.delete(f"/api/library-assets/{created[1]['id']}")
    assert deleted.status_code == 204
    remaining = client.get(
        f"/api/projects/{project['id']}/library-assets?kind=prop"
    )
    assert remaining.json() == []


def test_library_asset_rejects_duplicate_name_and_invalid_references(client):
    project = _project(client, "目录校验")
    body = {
        "kind": "scene",
        "name": "主控室",
        "description": "核心场景",
        "tags": [],
        "metadata": {},
    }
    assert client.post(
        f"/api/projects/{project['id']}/library-assets", json=body
    ).status_code == 201

    duplicate = client.post(
        f"/api/projects/{project['id']}/library-assets", json=body
    )
    invalid_kind = client.post(
        f"/api/projects/{project['id']}/library-assets",
        json={**body, "kind": "character", "name": "错误类别"},
    )
    missing_project = client.post(
        "/api/projects/not-found/library-assets", json=body
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Library asset name already exists"
    assert invalid_kind.status_code == 422
    assert missing_project.status_code == 404

