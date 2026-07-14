// M2.1 Skill file management — API client.

import {apiRequest, json} from './core';
import type {SkillRead, SkillSummary, SkillWrite} from '../types';

export const listSkills = () => apiRequest<SkillSummary[]>('/api/skills');

export const getSkill = (name: string) =>
  apiRequest<SkillRead>(`/api/skills/${encodeURIComponent(name)}`);

export const putSkill = (name: string, data: SkillWrite) =>
  apiRequest<SkillRead>(`/api/skills/${encodeURIComponent(name)}`, json('PUT', data));
