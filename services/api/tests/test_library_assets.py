from io import BytesIO
import wave

from PIL import Image
import pytest

from comic_studio import models
from comic_studio.services.library_assets import LibraryAssetService
from tests.test_character_3d_representations import _glb


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


def _png() -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), "black").save(output, format="PNG")
    return output.getvalue()


def _wav() -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * 80)
    return output.getvalue()


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


def test_library_assets_bind_explicitly_to_scenes(client):
    project = _project(client, "场景绑定")
    other_project = _project(client, "其他项目")
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "进入主场景", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"],
            position=1,
            location="雨夜天台",
            summary="主角与反派对峙",
            estimated_duration_seconds=12,
        )
        session.add(scene)
        session.commit()
        scene_id = scene.id

    def create_asset(project_id, kind, name):
        response = client.post(
            f"/api/projects/{project_id}/library-assets",
            json={"kind": kind, "name": name, "description": name, "tags": [], "metadata": {}},
        )
        assert response.status_code == 201
        return response.json()

    scene_asset = create_asset(project["id"], "scene", "霓虹天台")
    prop_asset = create_asset(project["id"], "prop", "银色证物箱")
    foreign_asset = create_asset(other_project["id"], "prop", "外部道具")

    uploaded_scene = client.post(
        f"/api/library-assets/{scene_asset['id']}/media",
        files={"file": ("rooftop.png", _png(), "image/png")},
    )
    assert uploaded_scene.status_code == 201

    assert client.put(
        f"/api/scenes/{scene_id}/library-assets/{scene_asset['id']}"
    ).status_code == 204
    assert client.put(
        f"/api/scenes/{scene_id}/library-assets/{prop_asset['id']}"
    ).status_code == 204
    assert client.put(
        f"/api/scenes/{scene_id}/library-assets/{scene_asset['id']}"
    ).status_code == 204

    bound = client.get(f"/api/scenes/{scene_id}/library-assets")
    assert bound.status_code == 200
    assert [item["name"] for item in bound.json()] == ["霓虹天台", "银色证物箱"]
    episode_detail = client.get(f"/api/episodes/{episode['id']}")
    reference = episode_detail.json()["scenes"][0]
    assert reference["reference_asset_id"] == scene_asset["id"]
    assert reference["reference_asset_name"] == "霓虹天台"
    assert reference["reference_media_type"] == "image/png"
    assert reference["reference_media_url"].endswith(".png")

    foreign = client.put(
        f"/api/scenes/{scene_id}/library-assets/{foreign_asset['id']}"
    )
    assert foreign.status_code == 409
    assert foreign.json()["detail"] == "Library asset and scene must belong to the same project"

    assert client.delete(
        f"/api/scenes/{scene_id}/library-assets/{scene_asset['id']}"
    ).status_code == 204
    assert [item["name"] for item in client.get(
        f"/api/scenes/{scene_id}/library-assets"
    ).json()] == ["银色证物箱"]


def test_library_assets_accept_kind_specific_media_uploads(client):
    project = _project(client, "资产媒体")

    def create(kind: str, name: str):
        return client.post(
            f"/api/projects/{project['id']}/library-assets",
            json={"kind": kind, "name": name, "description": "", "tags": [], "metadata": {}},
        ).json()

    costume = create("costume", "黑色风衣")
    prop = create("prop", "银色怀表")
    sound = create("sound", "城市雨声")

    costume_upload = client.post(
        f"/api/library-assets/{costume['id']}/media",
        files={"file": ("coat.png", _png(), "image/png")},
    )
    sound_upload = client.post(
        f"/api/library-assets/{sound['id']}/media",
        files={"file": ("rain.wav", _wav(), "audio/wav")},
    )
    invalid_sound = client.post(
        f"/api/library-assets/{sound['id']}/media",
        files={"file": ("wrong.png", _png(), "image/png")},
    )
    prop_model_upload = client.post(
        f"/api/library-assets/{prop['id']}/media",
        files={"file": ("watch.glb", _glb(), "model/gltf-binary")},
    )

    assert costume_upload.status_code == 201
    assert costume_upload.json()["media_type"] == "image/png"
    assert costume_upload.json()["media_url"].endswith(".png")
    assert costume_upload.json()["media_asset_id"]
    assert sound_upload.status_code == 201
    assert sound_upload.json()["media_type"] == "audio/wav"
    assert sound_upload.json()["media_url"].endswith(".wav")
    assert invalid_sound.status_code == 422
    assert invalid_sound.json()["detail"] == "sound_asset_requires_audio"
    assert prop_model_upload.status_code == 201
    assert prop_model_upload.json()["media_type"] == "model/gltf-binary"
    assert prop_model_upload.json()["media_url"].endswith(".glb")


def test_library_asset_rejects_invalid_prop_glb(client):
    project = _project(client, "道具模型校验")
    prop = client.post(
        f"/api/projects/{project['id']}/library-assets",
        json={"kind": "prop", "name": "损坏道具", "description": "", "tags": [], "metadata": {}},
    ).json()

    response = client.post(
        f"/api/library-assets/{prop['id']}/media",
        files={"file": ("broken.glb", b"not-a-glb", "model/gltf-binary")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "invalid_glb"


def test_library_asset_upload_cleans_model_file_when_commit_fails(
    db_session, tmp_path, monkeypatch
):
    project = models.Project(
        title="上传事务",
        logline="验证失败清理",
        story_bible="资产文件与数据库保持一致。",
        visual_style="cinematic comic",
    )
    library_asset = models.LibraryAsset(
        project=project,
        kind="prop",
        name="事务怀表",
        description="",
        tags=[],
    )
    db_session.add_all([project, library_asset])
    db_session.commit()

    def fail_commit():
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="commit failed"):
        LibraryAssetService(db_session).upload_media(
            library_asset.id,
            _glb(),
            filename="watch.glb",
            data_root=tmp_path,
        )

    assert list(tmp_path.rglob("*.glb")) == []
    assert list(tmp_path.rglob("*.tmp")) == []
