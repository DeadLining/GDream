import pytest
from sqlalchemy.exc import IntegrityError

from comic_studio import models


def _graph(session):
    project=models.Project(title="雨夜",logline="追查芯片",story_bible="设定",visual_style="漫画")
    episode=models.Episode(project=project,title="第一集",premise="追查",target_duration_seconds=60)
    scene=models.Scene(episode=episode,position=1,location="天台",summary="对峙",estimated_duration_seconds=10)
    shot=models.Shot(scene=scene,position=1,shot_type="medium",duration_seconds=5,composition="双人对峙")
    session.add(project);session.commit()
    return project,scene,shot


def test_director_stage_owns_objects_cameras_revisions_and_suggestions(db_session):
    _,scene,shot=_graph(db_session)
    stage=models.DirectorStage(scene_id=scene.id,version=1,environment={})
    stage.objects.append(models.DirectorObject(kind="character",source_type="placeholder",label="林夏",position=1,transform={"position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}))
    stage.shot_cameras.append(models.ShotCamera(shot_id=shot.id,version=1,position=[0,1.6,5],target=[0,1.2,0],rotation=[0,0,0],focal_length_mm=50,near=0.1,far=1000,shot_size="medium",camera_motion="static"))
    stage.revisions.append(models.DirectorRevision(stage_snapshot={},camera_snapshot={},reason="manual_save"))
    stage.suggestions.append(models.DirectorSuggestion(shot_id=shot.id,kind="shot_composition",status="ready",request_context={},suggested_patch={}))
    db_session.add(stage);db_session.commit()

    assert scene.director_stage==stage
    assert shot.director_camera==stage.shot_cameras[0]
    assert [item.label for item in stage.objects]==["林夏"]
    assert stage.revisions[0].reason=="manual_save"
    assert stage.suggestions[0].shot_id==shot.id


def test_scene_allows_only_one_director_stage(db_session):
    _,scene,_=_graph(db_session)
    db_session.add_all([models.DirectorStage(scene_id=scene.id,version=1,environment={}),models.DirectorStage(scene_id=scene.id,version=1,environment={})])
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_shot_allows_only_one_camera_per_stage(db_session):
    _,scene,shot=_graph(db_session)
    stage=models.DirectorStage(scene_id=scene.id,version=1,environment={})
    for _ in range(2):
        stage.shot_cameras.append(models.ShotCamera(shot_id=shot.id,version=1,position=[0,1,5],target=[0,1,0],rotation=[0,0,0],focal_length_mm=50,near=0.1,far=100,shot_size="medium",camera_motion="static"))
    db_session.add(stage)
    with pytest.raises(IntegrityError):
        db_session.commit()

