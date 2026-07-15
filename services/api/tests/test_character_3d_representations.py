import json
import struct

import pytest

from comic_studio import models
from comic_studio.services.character_3d import Character3DRepresentationService


def _glb(document: dict | None = None) -> bytes:
    payload = json.dumps(
        document
        or {
            "asset": {"version": "2.0"},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0, "name": "Proxy"}],
            "meshes": [{"primitives": []}],
        },
        separators=(",", ":"),
    ).encode()
    payload += b" " * ((4 - len(payload) % 4) % 4)
    chunk = struct.pack("<II", len(payload), 0x4E4F534A) + payload
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk


def _character(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "3D 角色",
            "logline": "导演代理",
            "story_bible": "角色代理设定",
            "visual_style": "comic",
            "aspect_ratio": "9:16",
        },
    ).json()
    character = client.post(
        f"/api/projects/{project['id']}/characters",
        json={
            "name": "林夏",
            "role": "主角",
            "appearance_bible": "黑色风衣",
            "personality": "冷静",
            "continuity_rules": "保持脸型",
            "negative_constraints": "",
            "voice_speaker": "v1",
            "voice_instruction": "",
        },
    ).json()
    return project, character


def test_glb_upload_creates_active_character_representation(client):
    _project, character = _character(client)

    response = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("linxia.glb", _glb(), "model/gltf-binary")},
        data={"label": "低模导演代理"},
    )

    assert response.status_code == 201
    representation = response.json()
    assert representation["format"] == "glb"
    assert representation["is_active"] is True
    assert representation["review_status"] == "approved"
    assert representation["model_url"].endswith(".glb")
    assert representation["mesh_count"] == 1
    listed = client.get(
        f"/api/characters/{character['id']}/3d-representations"
    )
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [representation["id"]]


def test_glb_upload_rejects_external_resources(client):
    _project, character = _character(client)
    content = _glb(
        {
            "asset": {"version": "2.0"},
            "buffers": [{"uri": "../../secret.bin", "byteLength": 12}],
        }
    )

    response = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("unsafe.glb", content, "model/gltf-binary")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "glb_external_resources_not_allowed"


def test_director_catalog_prefers_active_character_glb(client):
    project, character = _character(client)
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "天台对峙", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"],
            position=1,
            location="天台",
            summary="对峙",
            continuity_state={"characters_present": [character["id"]]},
            estimated_duration_seconds=5,
        )
        scene.shots.append(
            models.Shot(
                position=1,
                shot_type="medium",
                duration_seconds=5,
                composition="对峙",
                character_state={character["id"]: {}},
            )
        )
        session.add(scene)
        session.commit()
        scene_id = scene.id
    uploaded = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("linxia.glb", _glb(), "model/gltf-binary")},
    ).json()
    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()

    catalog = client.get(f"/api/director-stages/{stage['id']}/assets").json()

    character_asset = next(item for item in catalog if item["kind"] == "character")
    assert character_asset["source_type"] == "model"
    assert character_asset["asset_id"] == uploaded["asset_id"]
    assert character_asset["media_type"] == "model/gltf-binary"
    synced = client.post(
        f"/api/director-stages/{stage['id']}/assets/sync",
        json={
            "expected_version": stage["version"],
            "asset_keys": [item["key"] for item in catalog],
        },
    ).json()
    character_object = next(
        item for item in synced["objects"] if item["kind"] == "character"
    )
    assert character_object["appearance"]["model_url"] == uploaded["model_url"]

    replacement = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("linxia-v2.glb", _glb(), "model/gltf-binary")},
        data={"label": "林夏代理 V2"},
    ).json()
    next_catalog = client.get(
        f"/api/director-stages/{stage['id']}/assets"
    ).json()
    replaced = client.post(
        f"/api/director-stages/{stage['id']}/assets/sync",
        json={
            "expected_version": synced["version"],
            "asset_keys": [item["key"] for item in next_catalog],
        },
    ).json()
    character_objects = [
        item for item in replaced["objects"] if item["kind"] == "character"
    ]
    assert len(character_objects) == 1
    assert character_objects[0]["source_id"] == replacement["id"]


def test_character_model_upload_scopes_activation_to_variant_and_state(client):
    project, character = _character(client)
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第二集", "premise": "雨夜追踪", "target_duration_seconds": 60},
    ).json()
    master_variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "master",
            "label": "作品主设定",
            "episode_id": None,
            "parent_variant_id": None,
            "inherited_fields": [],
            "overrides": {},
        },
    ).json()
    episode_variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={
            "kind": "episode",
            "label": "雨夜造型",
            "episode_id": episode["id"],
            "parent_variant_id": master_variant["id"],
            "inherited_fields": ["identity"],
            "overrides": {"outfit": "雨衣"},
        },
    ).json()
    state = client.post(
        f"/api/asset-variants/{episode_variant['id']}/states",
        json={"kind": "injury", "label": "左眉受伤", "overrides": {"injury": "left brow"}},
    ).json()

    master_model = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("master.glb", _glb(), "model/gltf-binary")},
    ).json()
    variant_model = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("variant.glb", _glb(), "model/gltf-binary")},
        data={"variant_id": episode_variant["id"]},
    ).json()
    state_model = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("state.glb", _glb(), "model/gltf-binary")},
        data={"state_id": state["id"]},
    ).json()

    assert master_model["is_active"] is True
    assert variant_model["variant_id"] == episode_variant["id"]
    assert variant_model["state_id"] is None
    assert variant_model["is_active"] is True
    assert state_model["variant_id"] == episode_variant["id"]
    assert state_model["state_id"] == state["id"]
    assert state_model["is_active"] is True

    listed = client.get(
        f"/api/characters/{character['id']}/3d-representations"
    ).json()
    assert {item["id"] for item in listed if item["is_active"]} == {
        master_model["id"],
        variant_model["id"],
        state_model["id"],
    }


def test_director_catalog_resolves_state_variant_and_master_models_by_shot(client):
    project, character = _character(client)
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第三集", "premise": "伤后对峙", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"],
            position=1,
            location="仓库",
            summary="角色状态连续变化",
            continuity_state={"characters_present": [character["id"]]},
            estimated_duration_seconds=10,
        )
        scene.shots.extend(
            [
                models.Shot(position=1, shot_type="wide", duration_seconds=5, composition="未受伤", character_state={character["id"]: {}}),
                models.Shot(position=2, shot_type="close_up", duration_seconds=5, composition="受伤特写", character_state={character["id"]: {}}),
            ]
        )
        session.add(scene)
        session.commit()
        scene_id = scene.id
        first_shot_id, second_shot_id = [shot.id for shot in scene.shots]
    master_variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "master", "label": "主设定", "episode_id": None, "parent_variant_id": None, "inherited_fields": [], "overrides": {}},
    ).json()
    episode_variant = client.post(
        f"/api/characters/{character['id']}/variants",
        json={"kind": "episode", "label": "本集造型", "episode_id": episode["id"], "parent_variant_id": master_variant["id"], "inherited_fields": ["identity"], "overrides": {}},
    ).json()
    state = client.post(
        f"/api/asset-variants/{episode_variant['id']}/states",
        json={"kind": "injury", "label": "受伤", "overrides": {"injury": "left brow"}},
    ).json()
    client.post(
        f"/api/asset-variants/{episode_variant['id']}/usages",
        json={"shot_id": second_shot_id, "state_id": state["id"], "usage_kind": "reference"},
    )
    master_model = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("master.glb", _glb(), "model/gltf-binary")},
    ).json()
    variant_model = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("variant.glb", _glb(), "model/gltf-binary")},
        data={"variant_id": episode_variant["id"]},
    ).json()
    state_model = client.post(
        f"/api/characters/{character['id']}/3d-representations",
        files={"file": ("state.glb", _glb(), "model/gltf-binary")},
        data={"state_id": state["id"]},
    ).json()
    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()

    default_catalog = client.get(f"/api/director-stages/{stage['id']}/assets").json()
    first_catalog = client.get(
        f"/api/director-stages/{stage['id']}/assets?shot_id={first_shot_id}"
    ).json()
    second_catalog = client.get(
        f"/api/director-stages/{stage['id']}/assets?shot_id={second_shot_id}"
    ).json()

    assert next(item for item in default_catalog if item["kind"] == "character")["source_id"] == master_model["id"]
    assert next(item for item in first_catalog if item["kind"] == "character")["source_id"] == variant_model["id"]
    state_asset = next(item for item in second_catalog if item["kind"] == "character")
    assert state_asset["source_id"] == state_model["id"]
    assert state_asset["metadata"]["variant_id"] == episode_variant["id"]
    assert state_asset["metadata"]["state_id"] == state["id"]


def test_character_model_upload_cleans_file_when_commit_fails(
    db_session, tmp_path, monkeypatch
):
    project = models.Project(
        title="3D transaction",
        logline="Keep files and rows consistent",
        story_bible="Story",
        visual_style="comic",
    )
    character = models.Character(
        project=project,
        name="Lin Xia",
        role="Lead",
        appearance_bible="teal jacket",
        personality="calm",
        continuity_rules="same face",
        voice_speaker="v1",
    )
    db_session.add(project)
    db_session.commit()

    def fail_commit():
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="commit failed"):
        Character3DRepresentationService(db_session, tmp_path).upload(
            character.id,
            _glb(),
            activate=False,
            review_status="draft",
        )

    assert list(tmp_path.rglob("*.glb")) == []
    assert list(tmp_path.rglob("*.tmp")) == []


def test_character_model_upload_keeps_validated_scope_metadata_authoritative(
    db_session, tmp_path
):
    project = models.Project(
        title="3D metadata",
        logline="Keep validated ownership metadata",
        story_bible="Story",
        visual_style="comic",
    )
    character = models.Character(
        project=project,
        name="Lin Xia",
        role="Lead",
        appearance_bible="teal jacket",
        personality="calm",
        continuity_rules="same face",
        voice_speaker="v1",
    )
    db_session.add(project)
    db_session.commit()

    representation = Character3DRepresentationService(
        db_session, tmp_path
    ).upload(
        character.id,
        _glb(),
        request_metadata={
            "character_id": "spoofed-character",
            "variant_id": "spoofed-variant",
            "state_id": "spoofed-state",
            "source": "test",
        },
    )
    asset = db_session.get(models.Asset, representation.asset_id)

    assert asset.request_metadata == {
        "source": "test",
        "character_id": character.id,
        "format": "glb",
        "variant_id": None,
        "state_id": None,
    }
