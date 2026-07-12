from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session,selectinload

from comic_studio import models
from comic_studio.director import DirectorObjectCreate,ShotCameraPatch


class DirectorVersionConflict(RuntimeError):
    def __init__(self,latest_version:int):
        super().__init__("director_version_conflict");self.latest_version=latest_version


class DirectorStageService:
    def __init__(self,session:Session):self.session=session

    def get_stage(self,stage_id:str)->models.DirectorStage:
        stage=self.session.scalar(select(models.DirectorStage).options(selectinload(models.DirectorStage.objects),selectinload(models.DirectorStage.shot_cameras),selectinload(models.DirectorStage.revisions),selectinload(models.DirectorStage.suggestions)).where(models.DirectorStage.id==stage_id).execution_options(populate_existing=True))
        if stage is None:raise KeyError(stage_id)
        return stage

    def get_or_create_stage(self,scene_id:str)->models.DirectorStage:
        stage=self.session.scalar(select(models.DirectorStage).where(models.DirectorStage.scene_id==scene_id))
        if stage is not None:return self.get_stage(stage.id)
        scene=self.session.scalar(select(models.Scene).options(selectinload(models.Scene.shots)).where(models.Scene.id==scene_id))
        if scene is None:raise KeyError(scene_id)
        stage=models.DirectorStage(scene_id=scene.id,version=1,environment={"background_color":"#6f858f","ground":"grid","ambient_light":0.8})
        self.session.add(stage);self.session.flush()
        for shot in scene.shots:
            stage.shot_cameras.append(models.ShotCamera(shot_id=shot.id,version=1,position=[0,1.6,5],target=[0,1.2,0],rotation=[0,0,0],focal_length_mm=50,near=0.1,far=1000,shot_size=shot.shot_type or "medium",camera_motion=shot.camera_motion or "static"))
        self.session.commit();return self.get_stage(stage.id)

    def _stage_snapshot(self,stage:models.DirectorStage)->dict:
        return {"version":stage.version,"environment":stage.environment,"objects":[{"id":item.id,"kind":item.kind,"label":item.label,"transform":item.transform,"visible":item.visible} for item in stage.objects]}

    def create_object(self,stage_id:str,expected_version:int,data:DirectorObjectCreate)->models.DirectorObject:
        stage=self.get_stage(stage_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        stage.revisions.append(models.DirectorRevision(stage_snapshot=self._stage_snapshot(stage),camera_snapshot={},reason="manual_save"))
        created=models.DirectorObject(stage_id=stage.id,kind=data.kind,source_type=data.source_type,source_id=data.source_id,label=data.label,position=len(stage.objects)+1,transform=data.transform.model_dump(),appearance=data.appearance,object_metadata=data.metadata,visible=data.visible)
        self.session.add(created);stage.version+=1;self.session.commit();self.session.refresh(created);return created

    def update_camera(self,stage_id:str,shot_id:str,expected_version:int,patch:ShotCameraPatch)->models.ShotCamera:
        stage=self.get_stage(stage_id);camera=next((item for item in stage.shot_cameras if item.shot_id==shot_id),None)
        if camera is None:raise KeyError(shot_id)
        if camera.version!=expected_version:raise DirectorVersionConflict(camera.version)
        stage.revisions.append(models.DirectorRevision(shot_camera_id=camera.id,stage_snapshot=self._stage_snapshot(stage),camera_snapshot={"version":camera.version,"position":camera.position,"target":camera.target,"rotation":camera.rotation,"focal_length_mm":camera.focal_length_mm},reason="manual_save"))
        for key,value in patch.model_dump(exclude_none=True).items():setattr(camera,key,value)
        camera.version+=1;self.session.commit();self.session.refresh(camera);return camera
