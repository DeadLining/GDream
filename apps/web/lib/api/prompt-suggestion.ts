import type {MediaPromptSuggestion} from '../types';
import {apiRequest,json} from './core';

export const suggestMediaPrompt=(shotId:string,mode:'panel'|'video')=>
  apiRequest<MediaPromptSuggestion>(`/api/shots/${shotId}/prompt-suggestion`,json('POST',{mode}));
