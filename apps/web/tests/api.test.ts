import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ApiError,
  apiRequest,
  createScript,
  deleteScript,
  listScripts,
  patchScript,
  restoreScriptRevision,
  applyDirectorSuggestionToShot,
  createDirectorStage,
  createDirectorSuggestion,
  getDirectorStage,
  updateDirectorCamera,
  uploadDirectorPreview,
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

describe('director api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses scene, stage, camera, suggestion, and apply endpoints', async () => {
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    await createDirectorStage('scene-1');
    await getDirectorStage('scene-1');
    await updateDirectorCamera('stage-1','shot-1',2,{focal_length_mm:85});
    await createDirectorSuggestion('stage-1','shot-1','shot_composition');
    await applyDirectorSuggestionToShot('stage-1','shot-1','suggestion-1',['composition']);
    expect(fetchMock.mock.calls.map(call=>String(call[0]))).toEqual([
      '/api/scenes/scene-1/director-stage',
      '/api/scenes/scene-1/director-stage',
      '/api/director-stages/stage-1/shots/shot-1/camera',
      '/api/director-stages/stage-1/suggestions',
      '/api/director-stages/stage-1/shots/shot-1/apply-to-shot',
    ]);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({method:'PUT',body:JSON.stringify({expected_version:2,camera:{focal_length_mm:85}})});
  });

  it('uploads previews as multipart without forcing a JSON content type', async () => {
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const blob=new Blob(['png'],{type:'image/png'});
    await uploadDirectorPreview('camera-1',blob);
    const init=fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });
});
