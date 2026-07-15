from comic_studio import models


def _project(client, title: str):
    return client.post(
        "/api/projects",
        json={
            "title": title,
            "logline": "角色跨集保持一致",
            "story_bible": "主设定与变体分层管理",
            "visual_style": "comic",
            "aspect_ratio": "9:16",
        },
    ).json()


def _character(client, project_id: str, name: str):
    response = client.post(
        f"/api/projects/{project_id}/characters",
        json={
            "name": name,
            "role": "protagonist",
            "appearance_bible": "固定脸型与发型",
            "personality": "冷静",
            "continuity_rules": "身份特征不可覆盖",
            "voice_speaker": "speaker",
        },
    )
    assert response.status_code == 201
    return response.json()


def _episode(client, project_id: str, title: str):
    response = client.post(
        f"/api/projects/{project_id}/episodes",
        json={"title": title, "premise": "变体出现", "target_duration_seconds": 60},
    )
    assert response.status_code == 201
    return response.json()


def _shot(client, episode_id: str):
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode_id,
            position=1,
            location="巷道",
            time_of_day="night",
            summary="角色受伤",
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
            composition="面部伤痕特写",
            camera_motion="static",
            character_state={},
            image_prompt="injured face",
            negative_prompt="",
        )
        session.add(shot)
        session.commit()
        return shot.id


def test_asset_lineage_persists_variants_states_and_shot_usage(client):
    project = _project(client, "谱系作品")
    character = _character(client, project["id"], "林默")
    episode = _episode(client, project["id"], "第三集")
    shot_id = _shot(client, episode["id"])

    master = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "master",
            "label": "作品主设定",
            "inherited_fields": [],
            "overrides": {"identity": "固定脸型与发型"},
        },
    )
    assert master.status_code == 201
    master = master.json()
    variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "episode",
            "label": "受伤造型",
            "episode_id": episode["id"],
            "parent_variant_id": master["id"],
            "inherited_fields": ["identity", "hair"],
            "overrides": {"injury": "左眉伤痕", "outfit": "破损外套"},
        },
    )
    assert variant.status_code == 201
    variant = variant.json()
    state = client.post(
        f"/api/asset-variants/{variant['id']}/states",
        json={
            "kind": "expression",
            "label": "警惕",
            "overrides": {"eyes": "收紧", "brows": "眉峰提高"},
        },
    )
    assert state.status_code == 201
    state = state.json()
    usage = client.post(
        f"/api/asset-variants/{variant['id']}/usages",
        json={"state_id": state["id"], "shot_id": shot_id, "usage_kind": "panel"},
    )
    assert usage.status_code == 201

    response = client.get(f"/api/characters/{character['id']}/variants")

    assert response.status_code == 200
    lineage = response.json()
    assert [item["label"] for item in lineage] == ["作品主设定", "受伤造型"]
    assert lineage[1]["parent_variant_id"] == master["id"]
    assert lineage[1]["states"][0]["label"] == "警惕"
    assert lineage[1]["usages"][0]["shot_id"] == shot_id

    impact = client.get(f"/api/asset-variants/{variant['id']}/impact")
    assert impact.status_code == 200
    assert impact.json() == {
        "shots": [shot_id],
        "assets": [],
        "usage_count": 1,
        "episodes": [
            {
                "episode_id": episode["id"],
                "episode_title": "第三集",
                "scenes": [
                    {
                        "scene_id": impact.json()["episodes"][0]["scenes"][0]["scene_id"],
                        "scene_label": "场景 01 · 巷道",
                        "shots": [
                            {
                                "id": shot_id,
                                "position": 1,
                                "composition": "面部伤痕特写",
                            }
                        ],
                    }
                ],
            }
        ],
    }


def test_master_variant_impact_groups_shots_across_episodes_and_state_impact_filters_them(client):
    project = _project(client, "跨集影响")
    character = _character(client, project["id"], "林默")
    first_episode = _episode(client, project["id"], "第一集")
    second_episode = _episode(client, project["id"], "第二集")
    first_shot = _shot(client, first_episode["id"])
    second_shot = _shot(client, second_episode["id"])
    master = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "master", "label": "主设定", "inherited_fields": [], "overrides": {}},
    ).json()
    state = client.post(
        f"/api/asset-variants/{master['id']}/states",
        json={"kind": "expression", "label": "警惕", "overrides": {}},
    ).json()
    client.post(
        f"/api/asset-variants/{master['id']}/usages",
        json={"shot_id": first_shot, "usage_kind": "panel"},
    )
    client.post(
        f"/api/asset-variants/{master['id']}/usages",
        json={"state_id": state["id"], "shot_id": second_shot, "usage_kind": "panel"},
    )

    character_impact = client.get(f"/api/characters/{character['id']}/impact")
    state_impact = client.get(f"/api/asset-variant-states/{state['id']}/impact")

    assert character_impact.status_code == 200
    assert [item["episode_title"] for item in character_impact.json()["episodes"]] == [
        "第一集",
        "第二集",
    ]
    assert character_impact.json()["shots"] == sorted([first_shot, second_shot])
    assert state_impact.status_code == 200
    assert state_impact.json()["shots"] == [second_shot]
    assert state_impact.json()["episodes"][0]["episode_title"] == "第二集"


def test_asset_variant_rejects_parent_from_another_character(client):
    project = _project(client, "父级归属")
    first = _character(client, project["id"], "林默")
    second = _character(client, project["id"], "周岚")
    parent = client.post(
        f"/api/characters/{first['id']}/variants",
        json={"kind": "master", "label": "林默主设定", "inherited_fields": [], "overrides": {}},
    ).json()

    response = client.post(
        f"/api/characters/{second['id']}/variants",
        json={
            "kind": "episode",
            "label": "错误继承",
            "parent_variant_id": parent["id"],
            "inherited_fields": [],
            "overrides": {},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Parent variant must belong to the same character"


def test_asset_variant_rejects_episode_from_another_project(client):
    owner = _project(client, "角色作品")
    other = _project(client, "其他作品")
    character = _character(client, owner["id"], "林默")
    episode = _episode(client, other["id"], "外部集")

    response = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "episode",
            "label": "错误集变体",
            "episode_id": episode["id"],
            "inherited_fields": [],
            "overrides": {},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Episode must belong to the character project"


def test_episode_variant_usage_rejects_a_shot_from_another_episode(client):
    project = _project(client, "集级变体归属")
    character = _character(client, project["id"], "林默")
    source_episode = _episode(client, project["id"], "第一集")
    other_episode = _episode(client, project["id"], "第二集")
    other_shot_id = _shot(client, other_episode["id"])
    variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "episode",
            "label": "第一集造型",
            "episode_id": source_episode["id"],
            "inherited_fields": [],
            "overrides": {"outfit": "第一集外套"},
        },
    ).json()

    response = client.post(
        f"/api/asset-variants/{variant['id']}/usages",
        json={"shot_id": other_shot_id, "usage_kind": "panel"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Episode variant must belong to the shot episode"


def test_asset_lineage_updates_variants_and_states_with_version_increments(client):
    project = _project(client, "谱系编辑")
    character = _character(client, project["id"], "林默")
    episode = _episode(client, project["id"], "第三集")
    master = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "master", "label": "主设定", "inherited_fields": [], "overrides": {}},
    ).json()
    variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "episode", "label": "雨夜造型", "episode_id": episode["id"], "parent_variant_id": master["id"], "inherited_fields": ["identity"], "overrides": {"outfit": "雨衣"}},
    ).json()
    state = client.post(
        f"/api/asset-variants/{variant['id']}/states",
        json={"kind": "outfit", "label": "戴雨帽", "overrides": {"accessories": "hood"}},
    ).json()

    updated_variant = client.patch(
        f"/api/asset-variants/{variant['id']}",
        json={"label": "雨夜潜行造型", "overrides": {"outfit": "深色雨衣"}},
    )
    updated_state = client.patch(
        f"/api/asset-variant-states/{state['id']}",
        json={"label": "雨帽放下", "kind": "outfit", "overrides": {"accessories": "hood down"}},
    )

    assert updated_variant.status_code == 200
    assert updated_variant.json()["label"] == "雨夜潜行造型"
    assert updated_variant.json()["version"] == 2
    assert updated_state.status_code == 200
    assert updated_state.json()["label"] == "雨帽放下"
    assert updated_state.json()["version"] == 2


def test_asset_lineage_deletion_moves_nodes_to_recycle_bin(client):
    project = _project(client, "谱系删除")
    character = _character(client, project["id"], "林默")
    episode = _episode(client, project["id"], "第三集")
    shot_id = _shot(client, episode["id"])
    master = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "master", "label": "主设定", "inherited_fields": [], "overrides": {}},
    ).json()
    variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "episode", "label": "雨夜造型", "episode_id": episode["id"], "parent_variant_id": master["id"], "inherited_fields": ["identity"], "overrides": {}},
    ).json()
    state = client.post(
        f"/api/asset-variants/{variant['id']}/states",
        json={"kind": "expression", "label": "警惕", "overrides": {}},
    ).json()
    client.post(
        f"/api/asset-variants/{variant['id']}/usages",
        json={"state_id": state["id"], "shot_id": shot_id, "usage_kind": "panel"},
    )

    assert client.delete(f"/api/asset-variant-states/{state['id']}").status_code == 204
    assert client.delete(f"/api/asset-variants/{variant['id']}").status_code == 204
    assert client.delete(f"/api/asset-variants/{master['id']}").status_code == 204

    empty_variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "episode", "label": "备用造型", "episode_id": episode["id"], "parent_variant_id": master["id"], "inherited_fields": [], "overrides": {}},
    ).json()
    empty_state = client.post(
        f"/api/asset-variants/{empty_variant['id']}/states",
        json={"kind": "custom", "label": "备用状态", "overrides": {}},
    ).json()

    assert client.delete(f"/api/asset-variant-states/{empty_state['id']}").status_code == 204
    assert client.delete(f"/api/asset-variants/{empty_variant['id']}").status_code == 204
    trash = client.get(f"/api/projects/{project['id']}/trash-items")
    assert trash.status_code == 200
    assert {item["name"] for item in trash.json()} == {
        "警惕", "雨夜造型", "主设定", "备用状态", "备用造型"
    }


def test_asset_variant_patch_revalidates_parent_ownership(client):
    project = _project(client, "谱系归属")
    first = _character(client, project["id"], "林默")
    second = _character(client, project["id"], "周岚")
    first_master = client.post(
        f"/api/characters/{first['id']}/variants",
        json={"kind": "master", "label": "林默主设定", "inherited_fields": [], "overrides": {}},
    ).json()
    second_master = client.post(
        f"/api/characters/{second['id']}/variants",
        json={"kind": "master", "label": "周岚主设定", "inherited_fields": [], "overrides": {}},
    ).json()

    response = client.patch(
        f"/api/asset-variants/{first_master['id']}",
        json={"parent_variant_id": second_master["id"]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Parent variant must belong to the same character"
