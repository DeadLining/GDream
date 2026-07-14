// Auto-split from lib/api.ts — domain: script-import
// Do not edit manually; regenerate via the split script if api.ts changes.

import { API_BASE, ApiError, apiRequest, json } from './core';
import type { ScriptImport, ScriptImportDraft, ScriptImportMode } from '../types';

export const createPastedScriptImport = (projectId:string,mode:ScriptImportMode,text:string) => apiRequest<ScriptImport>(`/api/projects/${projectId}/script-imports`,json('POST',{mode,text}));
export async function uploadScriptImport(projectId:string,mode:ScriptImportMode,file:File):Promise<ScriptImport> {
  const form = new FormData(); form.set('mode',mode); form.set('file',file);
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/script-imports`,{method:'POST',body:form});
  if (!response.ok) {const body=await response.json() as {detail?:unknown}; const detail=String(body.detail??'上传失败'); throw new ApiError(detail,response.status,detail);}
  return response.json() as Promise<ScriptImport>;
}
export const parseScriptImport = (id:string) => apiRequest<ScriptImport>(`/api/script-imports/${id}/parse`,json('POST'));
export const retryScriptImport = (id:string) => apiRequest<ScriptImport>(`/api/script-imports/${id}/retry`,json('POST'));
export async function streamScriptGeneration(
  projectId:string,
  data:{brief:string;existing_draft:string},
  handlers:{onChunk:(text:string)=>void;onDone:()=>void;onError?:(message:string)=>void},
  signal?:AbortSignal,
):Promise<void>{
  let response:Response;
  try{
    response=await fetch(`${API_BASE}/api/projects/${projectId}/script-generation/stream`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal,
    });
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')throw error;
    throw new ApiError('无法连接本地 API',0,'connectivity_failure');
  }
  if(!response.ok||!response.body)throw new ApiError(`流式创作失败 (${response.status})`,response.status,'stream_failure');
  const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  const dispatch=(frame:string)=>{let event='';let dataLine='';for(const line of frame.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))dataLine+=line.slice(5).trim();}if(!event||!dataLine)return;const payload=JSON.parse(dataLine) as {text?:string;message?:string};if(event==='chunk'&&payload.text)handlers.onChunk(payload.text);if(event==='done')handlers.onDone();if(event==='error'){const message=payload.message??'流式创作失败';handlers.onError?.(message);throw new ApiError(message,502,'provider_failure');}};
  while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(frame.trim())dispatch(frame);}if(done)break;}
  if(buffer.trim())dispatch(buffer);
}
export const updateScriptImportDraft = (id:string,draft:ScriptImportDraft) => apiRequest<ScriptImport>(`/api/script-imports/${id}/draft`,json('PATCH',draft));
export const confirmScriptImport = (id:string) => apiRequest<ScriptImport>(`/api/script-imports/${id}/confirm`,json('POST',{}));
