from __future__ import annotations

from sqlalchemy import delete,select
from sqlalchemy.orm import Session,selectinload

from comic_studio import models
from comic_studio.director import DirectorObjectCreate,DirectorObjectPatch,DirectorStagePatch,ShotCameraPatch


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
        return {"version":stage.version,"environment":stage.environment,"objects":[{"id":item.id,"kind":item.kind,"source_type":item.source_type,"source_id":item.source_id,"label":item.label,"position":item.position,"transform":item.transform,"appearance":item.appearance,"metadata":item.object_metadata,"visible":item.visible} for item in stage.objects]}

    def _record_revision(self,stage:models.DirectorStage,*,camera:models.ShotCamera|None=None)->None:
        snapshot={}
        if camera is not None:snapshot={"version":camera.version,"position":camera.position,"target":camera.target,"rotation":camera.rotation,"focal_length_mm":camera.focal_length_mm,"near":camera.near,"far":camera.far,"shot_size":camera.shot_size,"camera_motion":camera.camera_motion,"framing_guides":camera.framing_guides,"object_overrides":camera.object_overrides}
        stage.revisions.append(models.DirectorRevision(shot_camera_id=camera.id if camera else None,stage_snapshot=self._stage_snapshot(stage),camera_snapshot=snapshot,reason="manual_save"))

    def _prune_revisions(self,stage_id:str)->None:
        ids=list(self.session.scalars(select(models.DirectorRevision.id).where(models.DirectorRevision.stage_id==stage_id).order_by(models.DirectorRevision.created_at.desc(),models.DirectorRevision.id.desc()).offset(50)))
        if ids:self.session.execute(delete(models.DirectorRevision).where(models.DirectorRevision.id.in_(ids)))

    def create_object(self,stage_id:str,expected_version:int,data:DirectorObjectCreate)->models.DirectorObject:
        stage=self.get_stage(stage_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        self._record_revision(stage)
        created=models.DirectorObject(stage_id=stage.id,kind=data.kind,source_type=data.source_type,source_id=data.source_id,label=data.label,position=len(stage.objects)+1,transform=data.transform.model_dump(),appearance=data.appearance,object_metadata=data.metadata,visible=data.visible)
        self.session.add(created);stage.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit();self.session.refresh(created);return created

    def sync_assets(self,stage_id:str,expected_version:int,asset_keys:list[str])->models.DirectorStage:
        from comic_studio.services.director_assets import DirectorAssetCatalogService

        stage=self.get_stage(stage_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        catalog_service=DirectorAssetCatalogService(self.session)
        catalog={item.key:item for item in catalog_service.definitions(stage_id)}
        unknown=[key for key in asset_keys if key not in catalog]
        if unknown:raise ValueError(f"unknown_director_asset:{unknown[0]}")
        selected=[catalog[key] for key in dict.fromkeys(asset_keys)]
        existing={item.object_metadata.get("catalog_key"):item for item in stage.objects if item.object_metadata.get("catalog_key")}
        environment=catalog_service.environment(stage)
        changed=stage.environment!=environment
        for definition in selected:
            metadata={**definition.metadata,"catalog_key":definition.key}
            current=existing.get(definition.key)
            if current is None:
                changed=True
                continue
            desired={"kind":definition.kind,"source_type":definition.source_type,"source_id":definition.source_id,"label":definition.label,"appearance":definition.appearance,"object_metadata":metadata}
            if any(getattr(current,key)!=value for key,value in desired.items()):changed=True
        if not changed:return stage
        self._record_revision(stage)
        stage.environment=environment
        next_position=max((item.position for item in stage.objects),default=0)+1
        for definition in selected:
            metadata={**definition.metadata,"catalog_key":definition.key}
            current=existing.get(definition.key)
            if current is None:
                self.session.add(models.DirectorObject(stage_id=stage.id,kind=definition.kind,source_type=definition.source_type,source_id=definition.source_id,label=definition.label,position=next_position,transform=definition.transform,appearance=definition.appearance,object_metadata=metadata,visible=True))
                next_position+=1
                continue
            current.kind=definition.kind;current.source_type=definition.source_type;current.source_id=definition.source_id;current.label=definition.label;current.appearance=definition.appearance;current.object_metadata=metadata
        stage.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit();return self.get_stage(stage.id)

    def update_stage(self,stage_id:str,expected_version:int,patch:DirectorStagePatch)->models.DirectorStage:
        stage=self.get_stage(stage_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        self._record_revision(stage)
        for key,value in patch.model_dump(exclude_none=True).items():setattr(stage,key,value)
        stage.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit();return self.get_stage(stage.id)

    def update_object(self,object_id:str,expected_version:int,patch:DirectorObjectPatch)->models.DirectorObject:
        item=self.session.get(models.DirectorObject,object_id)
        if item is None:raise KeyError(object_id)
        stage=self.get_stage(item.stage_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        self._record_revision(stage)
        for key,value in patch.model_dump(exclude_none=True).items():setattr(item,"object_metadata" if key=="metadata" else key,value.model_dump() if hasattr(value,"model_dump") else value)
        stage.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit();self.session.refresh(item);return item

    def delete_object(self,object_id:str,expected_version:int)->None:
        item=self.session.get(models.DirectorObject,object_id)
        if item is None:raise KeyError(object_id)
        stage=self.get_stage(item.stage_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        self._record_revision(stage);self.session.delete(item);stage.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit()

    def list_revisions(self,stage_id:str)->list[models.DirectorRevision]:
        if self.session.get(models.DirectorStage,stage_id) is None:raise KeyError(stage_id)
        return list(self.session.scalars(select(models.DirectorRevision).where(models.DirectorRevision.stage_id==stage_id).order_by(models.DirectorRevision.created_at,models.DirectorRevision.id)))

    def restore_revision(self,stage_id:str,revision_id:str,expected_version:int)->models.DirectorStage:
        stage=self.get_stage(stage_id);revision=self.session.get(models.DirectorRevision,revision_id)
        if revision is None or revision.stage_id!=stage.id:raise KeyError(revision_id)
        if stage.version!=expected_version:raise DirectorVersionConflict(stage.version)
        self._record_revision(stage)
        snapshot=revision.stage_snapshot;stage.environment=snapshot.get("environment",{})
        for item in list(stage.objects):self.session.delete(item)
        self.session.flush()
        for data in snapshot.get("objects",[]):
            self.session.add(models.DirectorObject(id=data["id"],stage_id=stage.id,kind=data["kind"],source_type=data["source_type"],source_id=data.get("source_id"),label=data["label"],position=data.get("position",0),transform=data["transform"],appearance=data.get("appearance",{}),object_metadata=data.get("metadata",{}),visible=data.get("visible",True)))
        stage.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit();return self.get_stage(stage.id)

    def update_camera(self,stage_id:str,shot_id:str,expected_version:int,patch:ShotCameraPatch)->models.ShotCamera:
        stage=self.get_stage(stage_id);camera=next((item for item in stage.shot_cameras if item.shot_id==shot_id),None)
        if camera is None:raise KeyError(shot_id)
        if camera.version!=expected_version:raise DirectorVersionConflict(camera.version)
        self._record_revision(stage,camera=camera)
        for key,value in patch.model_dump(exclude_none=True).items():setattr(camera,key,value)
        camera.version+=1;self.session.flush();self._prune_revisions(stage.id);self.session.commit();self.session.refresh(camera);return camera
