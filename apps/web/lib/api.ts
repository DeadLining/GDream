const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {'content-type': 'application/json', ...init?.headers},
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const startPanelGeneration = (shotId: string) =>
  apiRequest<{job_id: string; status: string}>(`/api/shots/${shotId}/panels`, {
    method: 'POST',
  });
