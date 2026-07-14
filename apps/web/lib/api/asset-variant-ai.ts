import {apiRequest,json} from './core';

export type AssetVariantSuggestion={
  kind:'episode'|'state';
  label:string;
  summary:string;
  inherited_fields:string[];
  overrides:Record<string,unknown>;
  state_kind:'expression'|'outfit'|'injury'|'age'|'custom'|null;
  assistant_message:string;
};

export type AssetVariantSuggestionRequest={
  character_id:string;
  episode_id:string|null;
  message:string;
  character:Record<string,unknown>;
  episode:Record<string,unknown>|null;
  conversation:Array<{role:'user'|'assistant';content:string}>;
  annotations:Array<{kind:'circle';geometry:{cx:number;cy:number;rx:number;ry:number};label:string}>;
};

export const suggestAssetVariant=(data:AssetVariantSuggestionRequest)=>
  apiRequest<AssetVariantSuggestion>('/api/model-runtime/asset-variant/suggest',json('POST',data));
