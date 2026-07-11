import base64

from comic_studio import models


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _character(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "项目",
            "logline": "梗概",
            "story_bible": "设定",
            "visual_style": "漫画",
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
            "continuity_rules": "银色耳钉",
            "voice_speaker": "v1",
        },
    ).json()
    return project, character


def test_upload_validates_decoded_image_and_lists_immutable_version(client):
    _, character = _character(client)
    response = client.post(
        f"/api/characters/{character['id']}/references/upload",
        data={"reference_type": "primary", "label": "初版"},
        files={"file": ("face.png", PNG, "application/octet-stream")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["asset"]["media_type"] == "image/png"
    assert body["asset"]["width"] == 1
    assert body["label"] == "初版"
    assert body["is_active"] is False
    listed = client.get(f"/api/characters/{character['id']}/references").json()
    assert [item["id"] for item in listed] == [body["id"]]


def test_activation_replaces_active_reference_of_same_type(client):
    _, character = _character(client)
    first = client.post(
        f"/api/characters/{character['id']}/references/upload",
        data={"reference_type": "primary"},
        files={"file": ("one.png", PNG, "image/png")},
    ).json()
    second = client.post(
        f"/api/characters/{character['id']}/references/upload",
        data={"reference_type": "primary"},
        files={"file": ("two.png", PNG, "image/png")},
    ).json()
    client.patch(
        f"/api/character-references/{first['id']}", json={"review_status": "approved"}
    )
    client.patch(
        f"/api/character-references/{second['id']}", json={"review_status": "approved"}
    )
    assert (
        client.put(
            f"/api/characters/{character['id']}/references/{first['id']}/active"
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/characters/{character['id']}/references/{second['id']}/active"
        ).status_code
        == 200
    )
    listed = client.get(f"/api/characters/{character['id']}/references").json()
    active = [item for item in listed if item["is_active"]]
    assert [item["id"] for item in active] == [second["id"]]
    assert client.delete(f"/api/character-references/{second['id']}").status_code == 409


def test_rejects_invalid_image_and_unapproved_activation(client):
    _, character = _character(client)
    invalid = client.post(
        f"/api/characters/{character['id']}/references/upload",
        data={"reference_type": "primary"},
        files={"file": ("fake.png", b"not-image", "image/png")},
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "invalid_image"
    reference = client.post(
        f"/api/characters/{character['id']}/references/upload",
        data={"reference_type": "primary"},
        files={"file": ("face.png", PNG, "image/png")},
    ).json()
    assert (
        client.put(
            f"/api/characters/{character['id']}/references/{reference['id']}/active"
        ).status_code
        == 409
    )


def test_delete_inactive_reference_removes_relation_and_file(client):
    _, character = _character(client)
    reference = client.post(
        f"/api/characters/{character['id']}/references/upload",
        data={"reference_type": "expression", "label": "微笑"},
        files={"file": ("smile.png", PNG, "image/png")},
    ).json()
    with client.app.state.session_factory() as session:
        asset = session.get(models.Asset, reference["asset"]["id"])
        path = client.app.state.settings.data_root / asset.local_path
        assert path.exists()
    assert (
        client.delete(f"/api/character-references/{reference['id']}").status_code == 204
    )
    assert not path.exists()


def test_generates_primary_and_reference_based_variant(client):
    _, character = _character(client)

    class Provider:
        model = "gpt-image-test"
        edits = 0

        async def generate(self, prompt, size="1024x1536", quality="auto"):
            from comic_studio.providers.gpt_image import ImageResult

            return ImageResult(PNG)

        async def edit(self, prompt, references, size="1024x1536", quality="auto"):
            self.edits += 1
            from comic_studio.providers.gpt_image import ImageResult

            return ImageResult(PNG)

    provider = Provider()

    class Factory:
        def create_image(self):
            return provider

    client.app.state.provider_factory = Factory()
    primary = client.post(
        f"/api/characters/{character['id']}/references/generate",
        json={"reference_type": "primary", "label": "AI 主参考"},
    ).json()
    client.patch(
        f"/api/character-references/{primary['id']}",
        json={"review_status": "approved"},
    )
    client.put(f"/api/characters/{character['id']}/references/{primary['id']}/active")

    variant = client.post(
        f"/api/characters/{character['id']}/references/generate",
        json={"reference_type": "side", "label": "侧面"},
    )

    assert variant.status_code == 201
    assert variant.json()["reference_type"] == "side"
    assert provider.edits == 1
