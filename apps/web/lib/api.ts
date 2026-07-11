import type {
  Asset, DialogueLine, DialoguePatch, EpisodeCreate, EpisodeDetail, EpisodePatch,
  EpisodeSummary, Job, Project, ProjectCreate, ProjectDetail, ProjectPatch,
  ProviderHealth, Shot, ShotPatch, ProductionReadiness, ProductionRun,
  ProductionRunCreate, ProductionItem, ProviderChannelKind, ProviderChannelsRead,
  ProviderChannelTestResult, ProviderChannelUpdate, ProviderChannelUpdateRead,
  ScriptImport, ScriptImportDraft, ScriptImportMode,
  CharacterReference, CharacterReferenceType, ReviewStatus,
} from './types';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {
  constructor(message: string, public status: number, public detail: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {'content-type': 'application/json', ...init?.headers},
    });
  } catch {
    throw new ApiError('无法连接本地 API', 0, 'connectivity_failure');
  }
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json() as {detail?: unknown}
      : {detail: await response.text()};
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    throw new ApiError(detail || `请求失败 (${response.status})`, response.status, detail);
  }
  return response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const mediaUrl = (path: string) => path.startsWith('http') ? path : `${API_BASE}${path}`;
export const listProjects = () => apiRequest<Project[]>('/api/projects');
export const getProject = (id: string) => apiRequest<ProjectDetail>(`/api/projects/${id}`);
export const createProject = (data: ProjectCreate) => apiRequest<Project>('/api/projects', json('POST', data));
export const updateProject = (id: string, data: ProjectPatch) => apiRequest<Project>(`/api/projects/${id}`, json('PATCH', data));
export const createEpisode = (projectId: string, data: EpisodeCreate) => apiRequest<EpisodeSummary>(`/api/projects/${projectId}/episodes`, json('POST', data));
export const getEpisode = (id: string) => apiRequest<EpisodeDetail>(`/api/episodes/${id}`);
export const updateEpisode = (id: string, data: EpisodePatch) => apiRequest<EpisodeSummary>(`/api/episodes/${id}`, json('PATCH', data));
export const updateShot = (id: string, data: ShotPatch) => apiRequest<Shot>(`/api/shots/${id}`, json('PATCH', data));
export const updateDialogue = (id: string, data: DialoguePatch) => apiRequest<DialogueLine>(`/api/dialogue/${id}`, json('PATCH', data));
export const startPlanning = (episodeId: string) => apiRequest<Job>(`/api/episodes/${episodeId}/plan`, json('POST'));
export const startPanelGeneration = (shotId: string, activate = true) => apiRequest<{job_id: string; status: string}>(`/api/shots/${shotId}/panels?${new URLSearchParams({activate: String(activate)})}`, json('POST'));
export const listPanelVersions = (shotId: string) => apiRequest<Asset[]>(`/api/shots/${shotId}/panels`);
export const activatePanel = (shotId: string, assetId: string) => apiRequest<Shot>(`/api/shots/${shotId}/panels/${assetId}/active`, json('PUT'));
export const startVideoGeneration = (shotId:string,activate=true) => apiRequest<{job_id:string;status:string}>(`/api/shots/${shotId}/videos?${new URLSearchParams({activate:String(activate)})}`,json('POST'));
export const listVideoVersions = (shotId:string) => apiRequest<Asset[]>(`/api/shots/${shotId}/videos`);
export const activateVideo = (shotId:string,assetId:string) => apiRequest<Shot>(`/api/shots/${shotId}/videos/${assetId}/active`,json('PUT'));
export const startSpeech = (dialogueId: string) => apiRequest<{job_id: string; status: string}>(`/api/dialogue/${dialogueId}/speech`, json('POST'));
export const startRender = (episodeId: string) => apiRequest<{job_id: string; status: string}>(`/api/episodes/${episodeId}/render`, json('POST'));
export const getJob = (jobId: string) => apiRequest<Job>(`/api/jobs/${jobId}`);
export const retryJob = (jobId: string) => apiRequest<Job>(`/api/jobs/${jobId}/retry`, json('POST'));
export const getProviderHealth = () => apiRequest<ProviderHealth>('/api/providers/health');
export const getProviderChannels = (signal?: AbortSignal) => apiRequest<ProviderChannelsRead>('/api/provider-channels', {signal});
export const updateProviderChannel = (kind: ProviderChannelKind, update: ProviderChannelUpdate) =>
  apiRequest<ProviderChannelUpdateRead>(`/api/provider-channels/${kind}`, json('PUT', update));
export const testProviderChannel = (kind: ProviderChannelKind, candidate: ProviderChannelUpdate) =>
  apiRequest<ProviderChannelTestResult>(`/api/provider-channels/${kind}/test`, json('POST', candidate));
export const getProductionReadiness = (episodeId:string) => apiRequest<ProductionReadiness>(`/api/episodes/${episodeId}/production-readiness`);
export const createProductionRun = (episodeId:string,data:ProductionRunCreate) => apiRequest<ProductionRun>(`/api/episodes/${episodeId}/production-runs`,json('POST',data));
export const getProductionRun = (runId:string) => apiRequest<ProductionRun>(`/api/production-runs/${runId}`);
export const listProductionItems = (runId:string) => apiRequest<ProductionItem[]>(`/api/production-runs/${runId}/items`);
export const pauseProductionRun = (runId:string) => apiRequest<ProductionRun>(`/api/production-runs/${runId}/pause`,json('POST'));
export const continueProductionRun = (runId:string) => apiRequest<ProductionRun>(`/api/production-runs/${runId}/continue`,json('POST'));
export const retryProductionRun = (runId:string,itemIds?:string[]) => apiRequest<ProductionRun>(`/api/production-runs/${runId}/retry`,json('POST',{item_ids:itemIds}));
export const createPastedScriptImport = (projectId:string,mode:ScriptImportMode,text:string) => apiRequest<ScriptImport>(`/api/projects/${projectId}/script-imports`,json('POST',{mode,text}));
export async function uploadScriptImport(projectId:string,mode:ScriptImportMode,file:File):Promise<ScriptImport> {
  const form = new FormData(); form.set('mode',mode); form.set('file',file);
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/script-imports`,{method:'POST',body:form});
  if (!response.ok) {const body=await response.json() as {detail?:unknown}; const detail=String(body.detail??'上传失败'); throw new ApiError(detail,response.status,detail);}
  return response.json() as Promise<ScriptImport>;
}
export const parseScriptImport = (id:string) => apiRequest<ScriptImport>(`/api/script-imports/${id}/parse`,json('POST'));
export const retryScriptImport = (id:string) => apiRequest<ScriptImport>(`/api/script-imports/${id}/retry`,json('POST'));
export const updateScriptImportDraft = (id:string,draft:ScriptImportDraft) => apiRequest<ScriptImport>(`/api/script-imports/${id}/draft`,json('PATCH',draft));
export const confirmScriptImport = (id:string) => apiRequest<ScriptImport>(`/api/script-imports/${id}/confirm`,json('POST',{}));
export const listCharacterReferences = (id:string) => apiRequest<CharacterReference[]>(`/api/characters/${id}/references`);
export async function uploadCharacterReference(id:string,type:CharacterReferenceType,file:File,label=''):Promise<CharacterReference>{const form=new FormData();form.set('reference_type',type);form.set('label',label);form.set('file',file);const response=await fetch(`${API_BASE}/api/characters/${id}/references/upload`,{method:'POST',body:form});if(!response.ok){const body=await response.json() as {detail?:unknown};throw new ApiError(String(body.detail??'上传失败'),response.status,String(body.detail??''));}return response.json() as Promise<CharacterReference>;}
export const generateCharacterReference=(id:string,type:CharacterReferenceType,label='')=>apiRequest<CharacterReference>(`/api/characters/${id}/references/generate`,json('POST',{reference_type:type,label}));
export const updateCharacterReference=(id:string,data:{label?:string;review_status?:ReviewStatus})=>apiRequest<CharacterReference>(`/api/character-references/${id}`,json('PATCH',data));
export const activateCharacterReference=(characterId:string,referenceId:string)=>apiRequest<CharacterReference>(`/api/characters/${characterId}/references/${referenceId}/active`,json('PUT'));
