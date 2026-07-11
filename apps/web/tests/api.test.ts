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
});
