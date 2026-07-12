import {afterEach, describe, expect, it, vi} from 'vitest';
import {ApiError, apiRequest} from '../lib/api';

describe('apiRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes JSON validation failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({detail: 'invalid'}),
      {status: 422, headers: {'content-type': 'application/json'}},
    )));

    await expect(apiRequest('/api/projects')).rejects.toEqual(
      new ApiError('invalid', 422, 'invalid'),
    );
  });

  it('reports connectivity failures without exposing request data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/api/projects')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: '无法连接本地 API',
    });
  });

  it('uses the same-origin API path by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: {'content-type': 'application/json'},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/projects');

    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.any(Object));
  });

  it('explains a local API proxy failure instead of exposing a generic 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'Internal Server Error',
      {status: 500, headers: {'content-type': 'text/plain'}},
    )));

    await expect(apiRequest('/api/shots/shot-1/panels')).rejects.toMatchObject({
      status: 500,
      message: '本地 API 暂时不可用，请稍后重试',
      detail: 'api_proxy_failure',
    });
  });
});
