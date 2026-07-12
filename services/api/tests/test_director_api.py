import pytest

from comic_studio import models
from comic_studio.director import DirectorObjectCreate, ShotCameraPatch
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
