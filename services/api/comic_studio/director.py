from __future__ import annotations

from typing import Literal
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictDirectorModel(BaseModel):
    model_config=ConfigDict(extra="forbid")


class Transform(StrictDirectorModel):
    position:list[float]=[0,0,0]
    rotation:list[float]=[0,0,0]
    scale:list[float]=[1,1,1]

    @field_validator("position","rotation","scale")
    @classmethod
    def vector3(cls,value:list[float]):
        if len(value)!=3:raise ValueError("vector3_required")
        return value


class DirectorObjectCreate(StrictDirectorModel):
    kind:Literal["character","prop","background","light","primitive"]
    source_type:Literal["placeholder","character_reference","asset","model"]
    source_id:str|None=None
    label:str=Field(min_length=1,max_length=160)
    transform:Transform=Transform()
    appearance:dict={}
    metadata:dict={}
    visible:bool=True


class ShotCameraPatch(StrictDirectorModel):
    position:list[float]|None=None
    target:list[float]|None=None
    rotation:list[float]|None=None
    focal_length_mm:float|None=Field(default=None,ge=12,le=300)
    near:float|None=Field(default=None,gt=0)
    far:float|None=Field(default=None,gt=0)
    shot_size:str|None=None
    camera_motion:str|None=None
    framing_guides:dict|None=None
    object_overrides:dict|None=None

    @field_validator("position","target","rotation")
    @classmethod
    def vector3(cls,value):
        if value is not None and len(value)!=3:raise ValueError("vector3_required")
        return value

    @model_validator(mode="after")
    def clip_range(self):
        if self.near is not None and self.far is not None and self.far<=self.near:raise ValueError("far_must_exceed_near")
        return self


class DirectorObjectRead(BaseModel):
    model_config=ConfigDict(from_attributes=True,populate_by_name=True)
    id:str;stage_id:str;kind:str;source_type:str;source_id:str|None;label:str;position:int;transform:dict;appearance:dict
    metadata:dict=Field(validation_alias=AliasChoices("object_metadata","metadata"))
    visible:bool


class ShotCameraRead(BaseModel):
    model_config=ConfigDict(from_attributes=True)
    id:str;stage_id:str;shot_id:str;version:int;position:list[float];target:list[float];rotation:list[float];focal_length_mm:float;near:float;far:float;shot_size:str;camera_motion:str;framing_guides:dict;object_overrides:dict;preview_asset_id:str|None


class DirectorStageRead(BaseModel):
    model_config=ConfigDict(from_attributes=True)
    id:str;scene_id:str;version:int;environment:dict;objects:list[DirectorObjectRead];shot_cameras:list[ShotCameraRead]


class DirectorObjectCreateRequest(StrictDirectorModel):
    expected_version:int=Field(ge=1)
    object:DirectorObjectCreate


class ShotCameraUpdateRequest(StrictDirectorModel):
    expected_version:int=Field(ge=1)
    camera:ShotCameraPatch
