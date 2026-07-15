import json
import struct

from comic_studio import models


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
