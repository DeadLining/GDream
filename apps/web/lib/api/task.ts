import {apiRequest,json} from './core';
import type {ProductionTask,ProductionTaskCreate,ProductionTaskPatch} from '../types';

export const listProductionTasks=(projectId:string)=>apiRequest<ProductionTask[]>(`/api/projects/${projectId}/tasks`);
export const createProductionTask=(projectId:string,data:ProductionTaskCreate)=>apiRequest<ProductionTask>(`/api/projects/${projectId}/tasks`,json('POST',data));
export const updateProductionTask=(id:string,data:ProductionTaskPatch)=>apiRequest<ProductionTask>(`/api/production-tasks/${id}`,json('PATCH',data));
export const deleteProductionTask=(id:string)=>apiRequest<void>(`/api/production-tasks/${id}`,{method:'DELETE'});
