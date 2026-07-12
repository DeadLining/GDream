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
