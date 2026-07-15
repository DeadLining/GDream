// Auto-split from lib/api.ts — domain: project
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { Character, Project, ProjectCreate, ProjectDetail, ProjectOverviewMetrics, ProjectPatch } from '../types';

export type CharacterWrite=Pick<Character,'name'|'role'|'body_plan'|'appearance_bible'|'personality'|'continuity_rules'|'negative_constraints'|'voice_speaker'|'voice_instruction'>;
export type CharacterPatch=Partial<CharacterWrite>;

export const listProjects = () => apiRequest<Project[]>('/api/projects');
export const getProject = (id: string) => apiRequest<ProjectDetail>(`/api/projects/${id}`);
export const getProjectOverviewMetrics=(id:string)=>apiRequest<ProjectOverviewMetrics>(`/api/projects/${id}/overview-metrics`);
export const createProject = (data: ProjectCreate) => apiRequest<Project>('/api/projects', json('POST', data));
export const updateProject = (id: string, data: ProjectPatch) => apiRequest<Project>(`/api/projects/${id}`, json('PATCH', data));
export const createCharacter=(projectId:string,data:CharacterWrite)=>apiRequest<Character>(`/api/projects/${projectId}/characters`,json('POST',data));
export const updateCharacter=(characterId:string,data:CharacterPatch)=>apiRequest<Character>(`/api/characters/${characterId}`,json('PATCH',data));
