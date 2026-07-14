from comic_studio import models


def _project(client):
    return client.post(
        "/api/projects",
        json={
            "title": "回收站作品",
            "logline": "验证谱系恢复",
            "story_bible": "主设定和集级变体",
            "visual_style": "comic",
            "aspect_ratio": "16:9",
        },
    ).json()


def _lineage(client):
    project = _project(client)
    character = client.post(
        f"/api/projects/{project['id']}/characters",
        json={
            "name": "林默",
            "role": "protagonist",
            "appearance_bible": "黑发少年",
            "personality": "克制",
            "continuity_rules": "伤势连续",
            "voice_speaker": "speaker",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第03集 雨夜", "premise": "追踪", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"],
            position=1,
            location="雨夜天台",
            time_of_day="night",
            summary="对峙",
            continuity_state={},
            estimated_duration_seconds=8,
        )
        session.add(scene)
        session.flush()
        shot = models.Shot(
            scene_id=scene.id,
            position=1,
            shot_type="close_up",
            duration_seconds=8,
            composition="左臂伤势特写",
            camera_motion="static",
            character_state={},
            image_prompt="injury close up",
            negative_prompt="",
        )
        session.add(shot)
        session.commit()
        shot_id = shot.id
    master = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "master", "label": "作品主设定", "inherited_fields": [], "overrides": {}},
    ).json()
    variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "episode",
            "label": "第03集雨夜造型",
            "episode_id": episode["id"],
            "parent_variant_id": master["id"],
            "inherited_fields": ["identity"],
            "overrides": {"outfit": "雨衣"},
        },
    ).json()
    state = client.post(
        f"/api/asset-variants/{variant['id']}/states",
        json={"kind": "injury", "label": "左臂擦伤", "overrides": {"injury": "abrasion"}},
    ).json()
    usage = client.post(
        f"/api/asset-variants/{variant['id']}/usages",
        json={"state_id": state["id"], "shot_id": shot_id, "usage_kind": "panel"},
    ).json()
    return project, character, variant, state, usage


def test_soft_deleted_state_enters_trash_and_restores_with_usage(client):
    project, character, variant, state, usage = _lineage(client)

    deleted = client.delete(f"/api/asset-variant-states/{state['id']}")
    assert deleted.status_code == 204

    lineage = client.get(f"/api/characters/{character['id']}/variants").json()
    assert lineage[1]["states"] == []
    assert lineage[1]["usages"][0]["id"] == usage["id"]
    assert lineage[1]["usages"][0]["state_id"] == state["id"]

    trash = client.get(f"/api/projects/{project['id']}/trash-items")
    assert trash.status_code == 200
    item = trash.json()[0]
    assert item["resource_type"] == "asset_variant_state"
    assert item["resource_id"] == state["id"]
    assert item["name"] == "左臂擦伤"
    assert item["reference_count"] == 1
    assert item["lineage"] == ["作品主设定", "第03集雨夜造型", "左臂擦伤"]

    blocked = client.delete(f"/api/trash-items/{item['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Resource still has downstream references"

    restored = client.post(f"/api/trash-items/{item['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["restored"] is True
    restored_lineage = client.get(f"/api/characters/{character['id']}/variants").json()
    assert restored_lineage[1]["states"][0]["id"] == state["id"]
    assert restored_lineage[1]["usages"][0]["state_id"] == state["id"]
    assert client.get(f"/api/projects/{project['id']}/trash-items").json() == []


def test_unreferenced_state_can_be_permanently_deleted_from_trash(client):
    project, _character, variant, _state, _usage = _lineage(client)
    spare = client.post(
        f"/api/asset-variants/{variant['id']}/states",
        json={"kind": "custom", "label": "备用状态", "overrides": {}},
    ).json()

    assert client.delete(f"/api/asset-variant-states/{spare['id']}").status_code == 204
    item = next(
        item
        for item in client.get(f"/api/projects/{project['id']}/trash-items").json()
        if item["resource_id"] == spare["id"]
    )
    assert item["reference_count"] == 0
    assert client.delete(f"/api/trash-items/{item['id']}").status_code == 204
    assert client.post(f"/api/trash-items/{item['id']}/restore").status_code == 404
    with client.app.state.session_factory() as session:
        assert session.get(models.AssetVariantState, spare["id"]) is None


def test_soft_deleted_variant_preserves_parent_and_children_for_restore(client):
    project, character, variant, state, _usage = _lineage(client)

    assert client.delete(f"/api/asset-variants/{variant['id']}").status_code == 204
    lineage = client.get(f"/api/characters/{character['id']}/variants").json()
    assert [item["label"] for item in lineage] == ["作品主设定"]
    item = client.get(f"/api/projects/{project['id']}/trash-items").json()[0]
    assert item["resource_type"] == "asset_variant"
    assert item["reference_count"] == 1
    assert item["lineage"] == ["作品主设定", "第03集雨夜造型"]

    assert client.post(f"/api/trash-items/{item['id']}/restore").status_code == 200
    restored = client.get(f"/api/characters/{character['id']}/variants").json()
    assert restored[1]["parent_variant_id"] is not None
    assert restored[1]["states"][0]["id"] == state["id"]
