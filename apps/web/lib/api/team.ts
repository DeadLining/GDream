// Auto-split from lib/api.ts — domain: team
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { ProductionTask, ProductionTaskCreate, ProductionTaskPatch, ProjectMember, ProjectMemberCreate, ProjectMemberPatch } from '../types';

export const listProjectMembers=(projectId:string)=>apiRequest<ProjectMember[]>(`/api/projects/${projectId}/members`);
export const createProjectMember=(projectId:string,data:ProjectMemberCreate)=>apiRequest<ProjectMember>(`/api/projects/${projectId}/members`,json('POST',data));
export const updateProjectMember=(id:string,data:ProjectMemberPatch)=>apiRequest<ProjectMember>(`/api/project-members/${id}`,json('PATCH',data));
export const listProductionTasks=(projectId:string)=>apiRequest<ProductionTask[]>(`/api/projects/${projectId}/tasks`);
export const createProductionTask=(projectId:string,data:ProductionTaskCreate)=>apiRequest<ProductionTask>(`/api/projects/${projectId}/tasks`,json('POST',data));
export const updateProductionTask=(id:string,data:ProductionTaskPatch)=>apiRequest<ProductionTask>(`/api/production-tasks/${id}`,json('PATCH',data));
