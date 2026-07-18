import type {MediaPromptSuggestion,ShotGenerationContext} from '../types';
import {apiRequest,json} from './core';

export const suggestMediaPrompt=(shotId:string,mode:'panel'|'video')=>
  apiRequest<MediaPromptSuggestion>(`/api/shots/${shotId}/prompt-suggestion`,json('POST',{mode}));

export const getShotGenerationContext=(shotId:string,mode:'panel'|'video')=>
  apiRequest<ShotGenerationContext>(`/api/shots/${shotId}/generation-context?mode=${mode}`);
