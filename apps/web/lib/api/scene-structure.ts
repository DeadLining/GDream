import {apiRequest,json} from './core';
import type {SceneCreate,ScenePatch,StructureMutation,StructureShotCreate} from '../types';

export const createScene=(episodeId:string,data:SceneCreate)=>apiRequest<StructureMutation>(`/api/episodes/${episodeId}/scenes`,json('POST',data));
export const updateScene=(sceneId:string,data:ScenePatch)=>apiRequest<StructureMutation>(`/api/scenes/${sceneId}`,json('PATCH',data));
export const deleteScene=(sceneId:string)=>apiRequest<StructureMutation>(`/api/scenes/${sceneId}`,{method:'DELETE'});
export const reorderScenes=(episodeId:string,ids:string[])=>apiRequest<StructureMutation>(`/api/episodes/${episodeId}/scene-order`,json('PUT',{ids}));
export const createStructureShot=(sceneId:string,data:StructureShotCreate)=>apiRequest<StructureMutation>(`/api/scenes/${sceneId}/shots`,json('POST',data));
export const deleteStructureShot=(shotId:string)=>apiRequest<StructureMutation>(`/api/shots/${shotId}`,{method:'DELETE'});
export const reorderShots=(sceneId:string,ids:string[])=>apiRequest<StructureMutation>(`/api/scenes/${sceneId}/shot-order`,json('PUT',{ids}));
