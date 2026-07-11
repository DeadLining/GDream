import type {
  Asset, DialogueLine, DialoguePatch, EpisodeCreate, EpisodeDetail, EpisodePatch,
  EpisodeSummary, Job, Project, ProjectCreate, ProjectDetail, ProjectPatch,
  ProviderHealth, Shot, ShotPatch,
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
export const startSpeech = (dialogueId: string) => apiRequest<{job_id: string; status: string}>(`/api/dialogue/${dialogueId}/speech`, json('POST'));
export const startRender = (episodeId: string) => apiRequest<{job_id: string; status: string}>(`/api/episodes/${episodeId}/render`, json('POST'));
export const getJob = (jobId: string) => apiRequest<Job>(`/api/jobs/${jobId}`);
export const retryJob = (jobId: string) => apiRequest<Job>(`/api/jobs/${jobId}/retry`, json('POST'));
export const getProviderHealth = () => apiRequest<ProviderHealth>('/api/providers/health');
