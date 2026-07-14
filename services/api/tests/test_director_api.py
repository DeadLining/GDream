import pytest

from comic_studio import models
from comic_studio.director import DirectorObjectCreate, DirectorObjectPatch, DirectorStagePatch, ShotCameraPatch, Transform
from comic_studio.services.director_stages import DirectorStageService, DirectorVersionConflict


def _scene(session):
    project=models.Project(title="雨夜",logline="追查",story_bible="设定",visual_style="漫画")
    episode=models.Episode(project=project,title="第一集",premise="追查",target_duration_seconds=60)
    scene=models.Scene(episode=episode,position=1,location="天台",summary="对峙",estimated_duration_seconds=10)
    scene.shots.extend([models.Shot(position=1,shot_type="wide",duration_seconds=5,composition="远景"),models.Shot(position=2,shot_type="close",duration_seconds=5,composition="特写")])
    session.add(project);session.commit();return scene


def test_get_or_create_stage_is_idempotent_and_creates_shot_cameras(db_session):
    scene=_scene(db_session);service=DirectorStageService(db_session)
    first=service.get_or_create_stage(scene.id);second=service.get_or_create_stage(scene.id)
    assert first.id==second.id
    assert first.version==1
    assert [item.shot_id for item in first.shot_cameras]==[shot.id for shot in scene.shots]


def test_create_object_increments_stage_version_and_records_revision(db_session):
    scene=_scene(db_session);service=DirectorStageService(db_session);stage=service.get_or_create_stage(scene.id)
    created=service.create_object(stage.id,1,DirectorObjectCreate(kind="character",source_type="placeholder",label="林夏"))
    assert created.label=="林夏"
    assert service.get_stage(stage.id).version==2
    assert service.get_stage(stage.id).revisions[-1].reason=="manual_save"


def test_camera_update_rejects_stale_version(db_session):
    scene=_scene(db_session);service=DirectorStageService(db_session);stage=service.get_or_create_stage(scene.id);shot=scene.shots[0]
    updated=service.update_camera(stage.id,shot.id,1,ShotCameraPatch(focal_length_mm=85))
    assert updated.focal_length_mm==85
    assert updated.version==2
    with pytest.raises(DirectorVersionConflict) as error:
        service.update_camera(stage.id,shot.id,1,ShotCameraPatch(focal_length_mm=35))
    assert error.value.latest_version==2


def test_camera_object_overrides_are_scoped_and_cleaned_when_object_is_deleted(db_session):
    scene=_scene(db_session);service=DirectorStageService(db_session);stage=service.get_or_create_stage(scene.id)
    created=service.create_object(stage.id,1,DirectorObjectCreate(kind="character",source_type="placeholder",label="林夏"))
    camera=stage.shot_cameras[0]
    overridden=service.update_camera(stage.id,camera.shot_id,camera.version,ShotCameraPatch(object_overrides={created.id:{"transform":{"position":[2,0,0],"rotation":[0,0,0],"scale":[1,1,1]},"visible":False}}))
    assert overridden.object_overrides[created.id]["transform"]["position"]==[2.0,0.0,0.0]
    assert overridden.object_overrides[created.id]["visible"] is False

    service.delete_object(created.id,2)

    assert service.get_stage(stage.id).shot_cameras[0].object_overrides=={}


def test_camera_object_overrides_reject_objects_from_another_stage(db_session):
    first_scene=_scene(db_session);service=DirectorStageService(db_session);first=service.get_or_create_stage(first_scene.id)
    second_scene=_scene(db_session);second=service.get_or_create_stage(second_scene.id)
    foreign=service.create_object(second.id,1,DirectorObjectCreate(kind="prop",source_type="placeholder",label="外部道具"))
    camera=first.shot_cameras[0]
    with pytest.raises(ValueError,match="director_object_not_in_stage"):
        service.update_camera(first.id,camera.shot_id,camera.version,ShotCameraPatch(object_overrides={foreign.id:{"visible":False}}))


def test_update_delete_and_restore_stage_objects(db_session):
    scene=_scene(db_session);service=DirectorStageService(db_session);stage=service.get_or_create_stage(scene.id)
    created=service.create_object(stage.id,1,DirectorObjectCreate(kind="primitive",source_type="placeholder",label="箱子"))
    updated=service.update_object(created.id,2,DirectorObjectPatch(transform=Transform(position=[2,0,0])))
    assert updated.transform["position"]==[2.0,0.0,0.0]
    service.update_stage(stage.id,3,DirectorStagePatch(environment={"background_color":"#112233"}))
    revision=service.list_revisions(stage.id)[-1]
    service.delete_object(created.id,4)
    assert service.get_stage(stage.id).objects==[]

    restored=service.restore_revision(stage.id,revision.id,5)

    assert restored.version==6
    assert restored.environment=={"background_color":"#6f858f","ground":"grid","ambient_light":0.8}
    assert restored.objects[0].id==created.id
    assert restored.objects[0].transform["position"]==[2.0,0.0,0.0]


def test_object_update_rejects_stale_stage_version(db_session):
    scene=_scene(db_session);service=DirectorStageService(db_session);stage=service.get_or_create_stage(scene.id)
    created=service.create_object(stage.id,1,DirectorObjectCreate(kind="prop",source_type="placeholder",label="道具"))
    with pytest.raises(DirectorVersionConflict) as error:
        service.update_object(created.id,1,DirectorObjectPatch(label="新名称"))
    assert error.value.latest_version==2


def _scene_via_client(client):
    project=client.post("/api/projects",json={"title":"雨夜","logline":"追查","story_bible":"设定","visual_style":"漫画","aspect_ratio":"9:16"}).json()
    episode=client.post(f"/api/projects/{project['id']}/episodes",json={"title":"第一集","premise":"追查","target_duration_seconds":60}).json()
    with client.app.state.session_factory() as session:
        scene=models.Scene(episode_id=episode["id"],position=1,location="天台",summary="对峙",estimated_duration_seconds=10)
        scene.shots.append(models.Shot(position=1,shot_type="medium",duration_seconds=5,composition="双人对峙"))
        session.add(scene);session.commit();return scene.id,scene.shots[0].id


def test_director_routes_create_stage_object_and_update_camera(client):
    scene_id,shot_id=_scene_via_client(client)
    created=client.post(f"/api/scenes/{scene_id}/director-stage")
    assert created.status_code==201
    stage=created.json();assert stage["scene_id"]==scene_id;assert stage["version"]==1
    assert stage["shot_cameras"][0]["shot_id"]==shot_id

    added=client.post(f"/api/director-stages/{stage['id']}/objects",json={"expected_version":1,"object":{"kind":"character","source_type":"placeholder","label":"林夏"}})
    assert added.status_code==201
    assert added.json()["label"]=="林夏"

    camera=client.put(f"/api/director-stages/{stage['id']}/shots/{shot_id}/camera",json={"expected_version":1,"camera":{"focal_length_mm":85}})
    assert camera.status_code==200
    assert camera.json()["focal_length_mm"]==85


def test_director_route_returns_structured_version_conflict(client):
    scene_id,shot_id=_scene_via_client(client);stage=client.post(f"/api/scenes/{scene_id}/director-stage").json()
    client.put(f"/api/director-stages/{stage['id']}/shots/{shot_id}/camera",json={"expected_version":1,"camera":{"focal_length_mm":85}})
    conflict=client.put(f"/api/director-stages/{stage['id']}/shots/{shot_id}/camera",json={"expected_version":1,"camera":{"focal_length_mm":35}})
    assert conflict.status_code==409
    assert conflict.json()["detail"]=={"code":"director_version_conflict","latest_version":2}


def test_director_routes_update_delete_and_restore_objects(client):
    scene_id,_shot_id=_scene_via_client(client);stage=client.post(f"/api/scenes/{scene_id}/director-stage").json()
    created=client.post(f"/api/director-stages/{stage['id']}/objects",json={"expected_version":1,"object":{"kind":"primitive","source_type":"placeholder","label":"箱子"}}).json()
    updated=client.patch(f"/api/director-objects/{created['id']}",json={"expected_version":2,"object":{"transform":{"position":[3,0,0]}}})
    assert updated.status_code==200
    assert updated.json()["transform"]["position"]==[3.0,0.0,0.0]
    revisions=client.get(f"/api/director-stages/{stage['id']}/revisions")
    assert revisions.status_code==200
    deleted=client.request("DELETE",f"/api/director-objects/{created['id']}",json={"expected_version":3})
    assert deleted.status_code==204
    restored=client.post(f"/api/director-stages/{stage['id']}/revisions/{revisions.json()[-1]['id']}/restore",json={"expected_version":4})
    assert restored.status_code==200
    assert restored.json()["objects"][0]["id"]==created["id"]


def test_director_asset_catalog_and_sync_use_real_character_references(client):
    scene_id, _shot_id = _scene_via_client(client)
    with client.app.state.session_factory() as session:
        scene = session.get(models.Scene, scene_id)
        character = models.Character(
            project_id=scene.episode.project_id,
            name="林夏",
            role="侦探",
            appearance_bible="黑色短发，深色雨衣",
            personality="冷静",
            continuity_rules="雨衣始终扣好",
            voice_speaker="linxia",
        )
        session.add(character)
        session.flush()
        scene.continuity_state = {
            "characters_present": [character.id],
            "props": [{"name": "证物箱", "description": "银色金属箱"}],
            "lighting": "冷蓝雨夜",
        }
        asset = models.Asset(
            project_id=scene.episode.project_id,
            kind=f"character-reference:{character.id}:primary",
            local_path=f"projects/{scene.episode.project_id}/characters/{character.id}/primary.png",
            media_type="image/png",
            provider="upload",
            model="local",
            checksum="director-catalog-reference",
            width=768,
            height=1024,
        )
        session.add(asset)
        session.flush()
        session.add(
            models.CharacterReference(
                character_id=character.id,
                asset_id=asset.id,
                reference_type="primary",
                label="主参考",
                is_active=True,
                review_status="approved",
            )
        )
        session.commit()
        character_id = character.id
        asset_id = asset.id

    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()
    catalog_response = client.get(f"/api/director-stages/{stage['id']}/assets")

    assert catalog_response.status_code == 200
    catalog = catalog_response.json()
    character_item = next(item for item in catalog if item["kind"] == "character")
    assert character_item["source_type"] == "character_reference"
    assert character_item["source_id"] == character_id
    assert character_item["asset_id"] == asset_id
    assert character_item["media_url"].endswith("/primary.png")
    assert {item["kind"] for item in catalog} == {"background", "character", "prop"}

    synced = client.post(
        f"/api/director-stages/{stage['id']}/assets/sync",
        json={"expected_version": stage["version"], "asset_keys": [item["key"] for item in catalog]},
    )

    assert synced.status_code == 200
    synced_stage = synced.json()
    assert synced_stage["environment"]["location"] == "天台"
    assert {item["kind"] for item in synced_stage["objects"]} == {"background", "character", "prop"}
    assert [item["position"] for item in synced_stage["objects"]] == [1, 2, 3]
    synced_character = next(item for item in synced_stage["objects"] if item["kind"] == "character")
    assert synced_character["appearance"]["image_url"].endswith("/primary.png")
    assert synced_character["metadata"]["asset_id"] == asset_id

    repeated = client.post(
        f"/api/director-stages/{stage['id']}/assets/sync",
        json={"expected_version": synced_stage["version"], "asset_keys": [item["key"] for item in catalog]},
    )
    assert repeated.status_code == 200
    assert repeated.json()["version"] == synced_stage["version"]
    assert len(repeated.json()["objects"]) == 3
