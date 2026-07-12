import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ApiError,
  apiRequest,
  createScript,
  deleteScript,
  listScripts,
  patchScript,
  restoreScriptRevision,
} from '../lib/api';

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

describe('script library api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses project and revision scoped endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await listScripts('project-1');
    await createScript('project-1', {title:'雨夜', source_type:'paste', content:'第一集'});
    await patchScript('script-1', {content:'第二版', expected_checksum:'abc'});
    await restoreScriptRevision('script-1', 'revision-1');

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('/api/projects/project-1/scripts'),
      expect.stringContaining('/api/projects/project-1/scripts'),
      expect.stringContaining('/api/scripts/script-1'),
      expect.stringContaining('/api/scripts/script-1/revisions/revision-1/restore'),
    ]);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method:'PATCH',
      body:JSON.stringify({content:'第二版', expected_checksum:'abc'}),
    });
  });

  it('accepts a successful no-content deletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {status:204})));

    await expect(deleteScript('script-1')).resolves.toBeUndefined();
  });
});
