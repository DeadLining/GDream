from types import SimpleNamespace

from comic_studio import models


def _project(client):
    response = client.post(
        "/api/projects",
        json={
            "title": "站位生成链路",
            "logline": "用资产和站位约束分镜生成",
            "story_bible": "角色、场景和道具必须保持一致。",
            "visual_style": "cinematic comic",
            "aspect_ratio": "16:9",
        },
    )
    assert response.status_code == 201
    return response.json()


def _script_scene(client, project_id: str):
    with client.app.state.session_factory() as session:
        document = models.ScriptDocument(
            project_id=project_id,
            title="主剧本",
            source_type="upload",
            status="ready",
        )
        session.add(document)
        session.flush()
        revision = models.ScriptRevision(
            document_id=document.id,
            revision_number=1,
            status="finalized",
            content="雨夜天台。张三拿着银色怀表等待。",
            checksum="script-v1",
            creation_method="upload",
        )
        session.add(revision)
        session.flush()
        document.current_revision_id = revision.id
        character = models.Character(
            project_id=project_id,
            name="张三",
            role="主角",
            appearance_bible="黑色风衣，短发",
            personality="谨慎",
            continuity_rules="始终佩戴银色怀表",
            negative_constraints="",
            voice_speaker="dylan",
        )
        session.add(character)
        session.flush()
        episode = models.Episode(
            project_id=project_id,
            title="第一集",
            premise="天台会面",
            target_duration_seconds=60,
            status="planned",
        )
        session.add(episode)
        session.flush()
        scene = models.Scene(
            episode_id=episode.id,
            position=1,
            location="雨夜天台",
            time_of_day="night",
            summary="张三在雨夜等待",
            continuity_state={
                "characters_present": [character.id],
                "props": [{"name": "银色怀表", "required": True}],
            },
            estimated_duration_seconds=12,
        )
        session.add(scene)
        session.flush()
        shot = models.Shot(
            scene_id=scene.id,
            position=1,
            shot_type="medium",
            duration_seconds=4,
            composition="张三位于画面左侧",
            camera_motion="static",
            character_state={character.id: {}},
            image_prompt="张三在雨夜天台等待",
        )
        session.add(shot)
        session.commit()
        return {
            "revision_id": revision.id,
            "character_id": character.id,
            "scene_id": scene.id,
            "shot_id": shot.id,
        }


def _media_asset(session, project_id: str, kind: str, suffix: str):
    asset = models.Asset(
        project_id=project_id,
        kind=kind,
        local_path=f"projects/{project_id}/{suffix}.png",
        media_type="image/png",
        provider="test",
        model="fixture",
        request_metadata={},
        checksum=f"checksum-{suffix}",
        review_status="approved",
        width=16,
        height=16,
    )
    session.add(asset)
    session.flush()
    return asset


def test_asset_requirements_sync_from_current_script_revision(client):
    project = _project(client)
    ids = _script_scene(client, project["id"])

    response = client.post(
        f"/api/projects/{project['id']}/asset-requirements/sync"
    )

    assert response.status_code == 200
    assert {item["kind"] for item in response.json()} == {
        "character",
        "scene",
        "prop",
    }
    by_kind = {item["kind"]: item for item in response.json()}
    assert by_kind["character"]["name"] == "张三"
    assert by_kind["character"]["binding_id"] == ids["character_id"]
    assert by_kind["character"]["status"] == "pending"
    assert by_kind["scene"]["name"] == "雨夜天台"
    assert by_kind["scene"]["status"] == "missing"
    assert by_kind["prop"]["name"] == "银色怀表"
    assert by_kind["prop"]["required"] is True
    assert by_kind["prop"]["status"] == "missing"
    assert all(item["script_revision_id"] == ids["revision_id"] for item in response.json())

    listed = client.get(
        f"/api/projects/{project['id']}/asset-requirements?kind=prop"
    )
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == ["银色怀表"]


def test_shot_generation_readiness_tracks_assets_blocking_and_preview(client):
    project = _project(client)
    ids = _script_scene(client, project["id"])
    assert client.post(
        f"/api/projects/{project['id']}/asset-requirements/sync"
    ).status_code == 200

    initial = client.get(f"/api/shots/{ids['shot_id']}/generation-readiness")
    assert initial.status_code == 200
    assert initial.json()["ready"] is False
    assert set(initial.json()["blockers"]) == {
        "missing_character_reference",
        "missing_background",
        "missing_required_prop",
    }

    with client.app.state.session_factory() as session:
        character_asset = _media_asset(
            session, project["id"], "character_reference", "character"
        )
        session.add(
            models.CharacterReference(
                character_id=ids["character_id"],
                asset_id=character_asset.id,
                reference_type="primary",
                label="主参考",
                is_active=True,
                review_status="approved",
            )
        )
        scene_media = _media_asset(session, project["id"], "library_scene", "scene")
        prop_media = _media_asset(session, project["id"], "library_prop", "prop")
        scene_asset = models.LibraryAsset(
            project_id=project["id"],
            media_asset_id=scene_media.id,
            kind="scene",
            name="雨夜天台",
            description="雨夜背景",
        )
        prop_asset = models.LibraryAsset(
            project_id=project["id"],
            media_asset_id=prop_media.id,
            kind="prop",
            name="银色怀表",
            description="关键道具",
        )
        session.add_all([scene_asset, prop_asset])
        session.flush()
        session.add_all(
            [
                models.LibraryAssetSceneBinding(
                    library_asset_id=scene_asset.id, scene_id=ids["scene_id"]
                ),
                models.LibraryAssetSceneBinding(
                    library_asset_id=prop_asset.id, scene_id=ids["scene_id"]
                ),
            ]
        )
        session.commit()

    ready = client.get(f"/api/shots/{ids['shot_id']}/generation-readiness")
    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert ready.json()["blockers"] == []
    assert ready.json()["script_revision_id"] == ids["revision_id"]


def test_direct_panel_endpoint_rejects_a_script_driven_blocked_shot(client):
    project = _project(client)
    ids = _script_scene(client, project["id"])

    response = client.post(f"/api/shots/{ids['shot_id']}/panels")

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "shot_generation_not_ready",
        "blocked_shots": {
            ids["shot_id"]: [
                "missing_character_reference",
                "missing_background",
                "missing_required_prop",
            ]
        },
    }
    with client.app.state.session_factory() as session:
        assert session.query(models.Job).count() == 0


def test_model_runtime_image_endpoint_rejects_blocked_shot_before_queueing(client):
    project = _project(client)
    ids = _script_scene(client, project["id"])

    class RecordingRuntime:
        created = False

        def create_media_job(self, *_args, **_kwargs):
            self.created = True
            return SimpleNamespace(id="should-not-exist", status="queued")

        async def run_media_job(self, _job_id):
            return None

    runtime = RecordingRuntime()
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/image",
        json={"target_type": "shot", "target_id": ids["shot_id"]},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "shot_generation_not_ready"
    assert response.json()["detail"]["blocked_shots"] == {
        ids["shot_id"]: [
            "missing_character_reference",
            "missing_background",
            "missing_required_prop",
        ]
    }
    assert runtime.created is False
