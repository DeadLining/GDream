// Auto-split from lib/api.ts — domain: script
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { ScriptCreate, ScriptDocument, ScriptDocumentSummary, ScriptImport, ScriptPatch, ScriptRevision } from '../types';

export const listScripts=(projectId:string)=>apiRequest<ScriptDocumentSummary[]>(`/api/projects/${projectId}/scripts`);
export const getScript=(id:string)=>apiRequest<ScriptDocument>(`/api/scripts/${id}`);
export const createScript=(projectId:string,data:ScriptCreate)=>apiRequest<ScriptDocument>(`/api/projects/${projectId}/scripts`,json('POST',data));
export const patchScript=(id:string,data:ScriptPatch)=>apiRequest<ScriptDocument>(`/api/scripts/${id}`,json('PATCH',data));
export const finalizeScript=(id:string)=>apiRequest<ScriptDocument>(`/api/scripts/${id}/finalize`,json('POST'));
export const listScriptRevisions=(id:string)=>apiRequest<ScriptRevision[]>(`/api/scripts/${id}/revisions`);
export const restoreScriptRevision=(id:string,revisionId:string)=>apiRequest<ScriptDocument>(`/api/scripts/${id}/revisions/${revisionId}/restore`,json('POST'));
export const deleteScriptRevision=(id:string,revisionId:string)=>apiRequest<void>(`/api/scripts/${id}/revisions/${revisionId}`,json('DELETE'));
export const parseScript=(id:string)=>apiRequest<ScriptImport>(`/api/scripts/${id}/parse`,json('POST'));
export async function deleteScript(id:string):Promise<void>{
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/scripts/${id}`,{method:'DELETE'});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=typeof body.detail==='string'?body.detail:JSON.stringify(body.detail??body);throw new ApiError(detail||`请求失败 (${response.status})`,response.status,detail);}
}
export async function uploadScript(projectId:string,title:string,file:File):Promise<ScriptDocument>{
  const form=new FormData();form.set('title',title);form.set('file',file);
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/projects/${projectId}/scripts/upload`,{method:'POST',body:form});}catch{throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok){const body=await response.json() as {detail?:unknown};const detail=String(body.detail??'上传失败');throw new ApiError(detail,response.status,detail);}
  return response.json() as Promise<ScriptDocument>;
}
export async function streamDocumentScript(scriptId:string,data:{brief:string;expected_revision_id:string},handlers:{onStarted:(revision:ScriptRevision)=>void;onChunk:(event:{text:string;revision_id:string;persisted_length:number})=>void;onDone:(event:{revision_id:string})=>void;onError?:(message:string)=>void},signal?:AbortSignal):Promise<void>{
  let response:Response;
  try{response=await fetch(`${API_BASE}/api/scripts/${scriptId}/generation/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal});}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;throw new ApiError('无法连接本地 API',0,'connectivity_failure');}
  if(!response.ok||!response.body){const detail=response.status===409?'revision_conflict':'stream_failure';throw new ApiError(`流式创作失败 (${response.status})`,response.status,detail);}
  const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  const dispatch=(frame:string)=>{let event='';let dataLine='';for(const line of frame.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))dataLine+=line.slice(5).trim();}if(!event||!dataLine)return;const payload=JSON.parse(dataLine) as {revision?:ScriptRevision;text?:string;message?:string;revision_id?:string;persisted_length?:number};if(event==='started'&&payload.revision)handlers.onStarted(payload.revision);if(event==='chunk'&&payload.text&&payload.revision_id)handlers.onChunk({text:payload.text,revision_id:payload.revision_id,persisted_length:payload.persisted_length??0});if(event==='done'&&payload.revision_id)handlers.onDone({revision_id:payload.revision_id});if(event==='error'){const message=payload.message??'流式创作失败';handlers.onError?.(message);throw new ApiError(message,502,'provider_failure');}};
  while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(frame.trim())dispatch(frame);}if(done)break;}if(buffer.trim())dispatch(buffer);
}
