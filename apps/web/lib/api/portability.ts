// M2.3 Project ZIP portability — API client.

import {API_BASE, ApiError, apiRequest} from './core';
import type {ProjectExportResponse, ProjectImportResponse} from '../types';

export const exportProject = (projectId: string) =>
  apiRequest<ProjectExportResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/export`,
    {method: 'POST'},
  );

export const importProject = async (file: File) => {
  // Bypass apiRequest so fetch can set the multipart/form-data boundary itself;
  // apiRequest would force content-type: application/json and break the upload.
  const form = new FormData();
  form.append('archive', file);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/projects/import`, {method: 'POST', body: form});
  } catch {
    throw new ApiError('无法连接本地 API', 0, 'connectivity_failure');
  }
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? (await response.json()) as {detail?: unknown}
      : {detail: await response.text()};
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    throw new ApiError(detail || `导入失败 (${response.status})`, response.status, detail);
  }
  return (await response.json()) as ProjectImportResponse;
};
