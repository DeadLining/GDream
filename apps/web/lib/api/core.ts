// Auto-split from lib/api.ts — domain: core (HTTP infrastructure)
// Do not edit manually; regenerate via the split script if api.ts changes.

export const API_BASE = '';
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
    if (response.status === 500 && detail.trim() === 'Internal Server Error') {
      throw new ApiError('本地 API 暂时不可用，请稍后重试', response.status, 'api_proxy_failure');
    }
    throw new ApiError(detail || `请求失败 (${response.status})`, response.status, detail);
  }
  return response.json() as Promise<T>;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
export const mediaUrl = (path: string) => path.startsWith('http') ? path : `${API_BASE}${path}`;
