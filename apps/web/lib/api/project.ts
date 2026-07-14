// Auto-split from lib/api.ts — domain: project
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { Project, ProjectCreate, ProjectDetail, ProjectPatch } from '../types';

export const listProjects = () => apiRequest<Project[]>('/api/projects');
export const getProject = (id: string) => apiRequest<ProjectDetail>(`/api/projects/${id}`);
export const createProject = (data: ProjectCreate) => apiRequest<Project>('/api/projects', json('POST', data));
export const updateProject = (id: string, data: ProjectPatch) => apiRequest<Project>(`/api/projects/${id}`, json('PATCH', data));
