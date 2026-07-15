import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ApiError,
  apiRequest,
  createScript,
  deleteScript,
  generateCharacterReferenceSet,
  createCharacter,
  updateCharacter,
  deleteCharacterReference,
  listScripts,
  patchScript,
  restoreScriptRevision,
  applyDirectorSuggestionToShot,
  createDirectorStage,
  createDirectorSuggestion,
  getDirectorStage,
  updateDirectorCamera,
  uploadDirectorPreview,
  createVolume,
  deleteVolume,
  createStoryline,
  createStorylineEvent,
  updateVolume,
  moveEpisodeToVolume,
  updateStoryline,
  updateStorylineEvent,
  deleteStorylineEvent,
  createAssetVariant,
  createAssetVariantState,
  createAssetVariantUsage,
  updateAssetVariant,
  deleteAssetVariant,
  updateAssetVariantState,
  deleteAssetVariantState,
  createVisualAnnotation,
  updateVisualAnnotation,
  deleteVisualAnnotation,
  createVisualReviewCandidate,
  startVisualReviewGeneration,
  createReleaseCandidate,
  createReviewThread,
  getReleaseGate,
  approveReleaseCandidate,
  publishReleaseCandidate,
  listReleaseCandidates,
  rejectVisualReviewCandidate,
  createProjectMember,
  listProjectMembers,
  updateProjectMember,
  createProductionTask,
  listProductionTasks,
  updateProductionTask,
  createEpisodeVersion,
  listEpisodeVersions,
  restoreEpisodeVersion,
  createDeliveryPackage,
  listDeliveryPackages,
  createLibraryAsset,
  deleteLibraryAsset,
  listLibraryAssets,
  listSceneLibraryAssets,
  bindLibraryAssetToScene,
  unbindLibraryAssetFromScene,
  updateLibraryAsset,
  uploadLibraryAssetMedia,
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

describe('project library asset api',()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it('uses project-scoped catalog CRUD endpoints',async()=>{
    const fetchMock=vi.fn().mockImplementation(async(_path:string,init?:RequestInit)=>new Response(
      init?.method==='DELETE'?null:JSON.stringify([]),
      {status:init?.method==='DELETE'?204:200,headers:init?.method==='DELETE'?undefined:{'content-type':'application/json'}},
    ));
    vi.stubGlobal('fetch',fetchMock);
    const body={kind:'scene' as const,name:'雨夜天台',description:'霓虹雨夜',tags:['雨夜'],metadata:{}};

    await listLibraryAssets('project-1');
    await createLibraryAsset('project-1',body);
    await updateLibraryAsset('asset-1',{name:'暴雨天台'});
    await uploadLibraryAssetMedia('asset-1',new Blob(['png'],{type:'image/png'}),'coat.png');
    await listSceneLibraryAssets('scene-1');
    await bindLibraryAssetToScene('scene-1','asset-1');
    await unbindLibraryAssetFromScene('scene-1','asset-1');
    await deleteLibraryAsset('asset-1');

    expect(fetchMock.mock.calls.map(call=>[String(call[0]),(call[1] as RequestInit|undefined)?.method??'GET'])).toEqual([
      ['/api/projects/project-1/library-assets','GET'],
      ['/api/projects/project-1/library-assets','POST'],
      ['/api/library-assets/asset-1','PATCH'],
      ['/api/library-assets/asset-1/media','POST'],
      ['/api/scenes/scene-1/library-assets','GET'],
      ['/api/scenes/scene-1/library-assets/asset-1','PUT'],
      ['/api/scenes/scene-1/library-assets/asset-1','DELETE'],
      ['/api/library-assets/asset-1','DELETE'],
    ]);
  });
});

describe('character reference api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses character lifecycle and reference deletion endpoints',async()=>{
    const fetchMock=vi.fn().mockImplementation(async(_path:string,init?:RequestInit)=>new Response(
      init?.method==='DELETE'?null:JSON.stringify({}),
      {status:init?.method==='DELETE'?204:200,headers:init?.method==='DELETE'?undefined:{'content-type':'application/json'}},
    ));
    vi.stubGlobal('fetch',fetchMock);
    const data={name:'周然',role:'搭档',appearance_bible:'灰色风衣',personality:'谨慎',continuity_rules:'左手腕表',negative_constraints:'',voice_speaker:'v2',voice_instruction:''};

    await createCharacter('project-1',data);
    await updateCharacter('character-1',{name:'周然·修订'});
    await deleteCharacterReference('reference-1');

    expect(fetchMock.mock.calls.map(call=>[String(call[0]),(call[1] as RequestInit).method])).toEqual([
      ['/api/projects/project-1/characters','POST'],
      ['/api/characters/character-1','PATCH'],
      ['/api/character-references/reference-1','DELETE'],
    ]);
  });

  it('starts a character reference set through the background model runtime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job_id: 'job-1',
      capability: 'image',
      status: 'queued',
    }), {
      status: 202,
      headers: {'content-type': 'application/json'},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateCharacterReferenceSet('character-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/model-runtime/image', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        target_type: 'character',
        target_id: 'character-1',
        mode: 'reference_set',
        activate: true,
      }),
    }));
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
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const blob=new Blob(['png'],{type:'image/png'});
    await uploadDirectorPreview('camera-1',blob);
    const init=fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });
});

describe('narrative structure api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses project and storyline scoped creation endpoints', async () => {
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);

    await createVolume('project-1',{title:'第二卷',summary:'深入裂缝',position:2});
    await createStoryline('project-1',{title:'成长线',kind:'character_arc',color:'#B9473E',description:''});
    await createStorylineEvent('line-1',{episode_id:'episode-3',scene_id:null,shot_id:null,position:3,stage:'payoff',title:'完成选择',description:'',setup_event_id:null,payoff_event_id:null,metadata:{}});

    expect(fetchMock.mock.calls.map(call=>String(call[0]))).toEqual([
      '/api/projects/project-1/volumes',
      '/api/projects/project-1/storylines',
      '/api/storylines/line-1/events',
    ]);
    expect(fetchMock.mock.calls.every(call=>(call[1] as RequestInit).method==='POST')).toBe(true);
  });

  it('uses narrative edit and deletion endpoints', async () => {
    const fetchMock=vi.fn().mockImplementation(async(_path:string,init?:RequestInit)=>new Response(
      init?.method==='DELETE'?null:JSON.stringify({}),
      {status:init?.method==='DELETE'?204:200,headers:init?.method==='DELETE'?undefined:{'content-type':'application/json'}},
    ));
    vi.stubGlobal('fetch',fetchMock);

    await updateVolume('volume-1',{title:'新卷名',summary:'新简介',position:2});
    await moveEpisodeToVolume('episode-1','volume-2');
    await moveEpisodeToVolume('episode-1',null);
    await deleteVolume('volume-1');
    await updateStoryline('line-1',{title:'成长线',kind:'character_arc',color:'#235789',description:'跨集成长'});
    await updateStorylineEvent('event-1',{episode_id:'episode-3',position:4,stage:'payoff',title:'完成选择',description:'回收伏笔'});
    await deleteStorylineEvent('event-1');

    expect(fetchMock.mock.calls.map(call=>[String(call[0]),(call[1] as RequestInit).method])).toEqual([
      ['/api/volumes/volume-1','PATCH'],
      ['/api/episodes/episode-1/volume','PUT'],
      ['/api/episodes/episode-1/volume','PUT'],
      ['/api/volumes/volume-1','DELETE'],
      ['/api/storylines/line-1','PATCH'],
      ['/api/storyline-events/event-1','PATCH'],
      ['/api/storyline-events/event-1','DELETE'],
    ]);
  });
});

describe('asset lineage and visual annotation api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses lineage and review scoped creation endpoints', async () => {
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    await createAssetVariant('character-1',{kind:'episode',label:'雨夜造型',episode_id:'episode-3',parent_variant_id:'variant-1',inherited_fields:['identity'],overrides:{outfit:'雨衣'}});
    await createAssetVariantState('variant-2',{kind:'injury',label:'左臂擦伤',overrides:{injury:'left arm abrasion'}});
    await createAssetVariantUsage('variant-2',{state_id:'state-1',shot_id:'shot-7',usage_kind:'panel'});
    await createVisualAnnotation('thread-1',{kind:'circle',geometry:{cx:.5,cy:.4,rx:.08,ry:.08},color:'#B9473E',label:'脸部'});
    await createVisualReviewCandidate('thread-1',{asset_id:'asset-2',generation_metadata:{scope:'shot'}});
    await startVisualReviewGeneration('thread-1');
    await rejectVisualReviewCandidate('candidate-1');
    expect(fetchMock.mock.calls.map(call=>String(call[0]))).toEqual(['/api/characters/character-1/variants','/api/asset-variants/variant-2/states','/api/asset-variants/variant-2/usages','/api/visual-review-threads/thread-1/annotations','/api/visual-review-threads/thread-1/candidates','/api/visual-review-threads/thread-1/generate','/api/visual-review-candidates/candidate-1/reject']);
  });

  it('uses lineage update and deletion endpoints', async () => {
    const fetchMock=vi.fn().mockImplementation(async(_path:string,init?:RequestInit)=>new Response(
      init?.method==='DELETE'?null:JSON.stringify({}),
      {status:init?.method==='DELETE'?204:200,headers:init?.method==='DELETE'?undefined:{'content-type':'application/json'}},
    ));
    vi.stubGlobal('fetch',fetchMock);
    await updateAssetVariant('variant-1',{label:'雨夜潜行'});
    await updateAssetVariantState('state-1',{label:'雨帽放下'});
    await deleteAssetVariantState('state-1');
    await deleteAssetVariant('variant-1');
    expect(fetchMock.mock.calls.map(call=>[String(call[0]),(call[1] as RequestInit).method])).toEqual([
      ['/api/asset-variants/variant-1','PATCH'],
      ['/api/asset-variant-states/state-1','PATCH'],
      ['/api/asset-variant-states/state-1','DELETE'],
      ['/api/asset-variants/variant-1','DELETE'],
    ]);
  });

  it('uses visual annotation update and deletion endpoints', async () => {
    const fetchMock=vi.fn().mockImplementation(async(_path:string,init?:RequestInit)=>new Response(
      init?.method==='DELETE'?null:JSON.stringify({}),
      {status:init?.method==='DELETE'?204:200,headers:init?.method==='DELETE'?undefined:{'content-type':'application/json'}},
    ));
    vi.stubGlobal('fetch',fetchMock);
    await updateVisualAnnotation('annotation-1',{label:'眉眼区域'});
    await deleteVisualAnnotation('annotation-1');
    expect(fetchMock.mock.calls.map(call=>[String(call[0]),(call[1] as RequestInit).method])).toEqual([
      ['/api/visual-annotations/annotation-1','PATCH'],
      ['/api/visual-annotations/annotation-1','DELETE'],
    ]);
  });
});

describe('operations api',()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it('uses scoped collaboration, task, version, delivery, audit, and preference endpoints',async()=>{
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);

    await listProjectMembers('project-1');
    await createProjectMember('project-1',{name:'陈舟',email:'chen@example.com',role:'storyboard_artist',scope:{episode_ids:['episode-1']},capabilities:{shots:['view','edit']}});
    await updateProjectMember('member-1',{status:'disabled'});
    await listProductionTasks('project-1');
    await createProductionTask('project-1',{title:'修正镜头',priority:'high',episode_id:'episode-1',scene_id:null,shot_id:'shot-1',review_thread_id:null,description:'',assignee:'陈舟',due_at:null,checklist:[]});
    await updateProductionTask('task-1',{status:'completed'});
    await listEpisodeVersions('episode-1');
    await createEpisodeVersion('episode-1',{label:'审核前',source:'manual',author:'张伟'});
    await restoreEpisodeVersion('version-1');
    await listDeliveryPackages('episode-1');
    await createDeliveryPackage('episode-1',{release_candidate_id:'candidate-1',preset_name:'平台包',outputs:[{kind:'landscape_video',format:'mp4',enabled:true}]});

    expect(fetchMock.mock.calls.map(call=>[String(call[0]),(call[1] as RequestInit).method??'GET'])).toEqual([
      ['/api/projects/project-1/members','GET'],
      ['/api/projects/project-1/members','POST'],
      ['/api/project-members/member-1','PATCH'],
      ['/api/projects/project-1/tasks','GET'],
      ['/api/projects/project-1/tasks','POST'],
      ['/api/production-tasks/task-1','PATCH'],
      ['/api/episodes/episode-1/versions','GET'],
      ['/api/episodes/episode-1/versions','POST'],
      ['/api/episode-versions/version-1/restore','POST'],
      ['/api/episodes/episode-1/delivery-packages','GET'],
      ['/api/episodes/episode-1/delivery-packages','POST'],
    ]);
  });
});

describe('release publication api',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('uses release candidate gate, approve, and publish endpoints',async()=>{
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    await createReleaseCandidate('episode-1',{version:'V1',render_path:'projects/p/e/final.mp4',qc_snapshot:{}});
    await listReleaseCandidates('episode-1');
    await getReleaseGate('release-1');
    await approveReleaseCandidate('release-1');
    await publishReleaseCandidate('release-1',{platform:'internal_master',idempotency_key:'episode-1:release-1:internal_master'});
    expect(fetchMock.mock.calls.map(call=>String(call[0]))).toEqual(['/api/episodes/episode-1/release-candidates','/api/episodes/episode-1/release-candidates','/api/release-candidates/release-1/gate','/api/release-candidates/release-1/approve','/api/release-candidates/release-1/publish']);
  });
  it('creates a time-linked final review thread',async()=>{
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    await createReviewThread('episode-1',{shot_id:'shot-2',timecode_seconds:3,severity:'major',title:'芯片反光过强'});
    expect(fetchMock).toHaveBeenCalledWith('/api/episodes/episode-1/review-threads',expect.objectContaining({method:'POST',body:JSON.stringify({shot_id:'shot-2',timecode_seconds:3,severity:'major',title:'芯片反光过强'})}));
  });
});
