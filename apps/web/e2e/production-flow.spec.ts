import {expect, test} from '@playwright/test';
import path from 'node:path';
import type {MockSshHost, MockSshStatus, ProviderHealth} from '../lib/types';

const project = {id:'project-1',title:'霓虹夜行',logline:'寻找记忆',story_bible:'近未来重庆',visual_style:'Chinese noir',aspect_ratio:'9:16',language:'Chinese',created_at:'',updated_at:''};
const episodeSummary = {id:'episode-1',project_id:'project-1',title:'失窃的雨夜',premise:'寻找芯片',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''};
const character = {id:'character-1',project_id:'project-1',name:'林夏',role:'主角',appearance_bible:'黑色风衣，银色耳钉',personality:'冷静',continuity_rules:'保持银色耳钉',negative_constraints:'',voice_speaker:'female-1',voice_instruction:'',created_at:'',updated_at:''};
const projectDetail = {...project,characters:[character],episodes:[episodeSummary]};
const episode = {...episodeSummary,scenes:[{id:'scene-1',position:1,location:'雨夜巷道',time_of_day:'night',summary:'发现芯片',continuity_state:{},estimated_duration_seconds:10,shots:[
  {id:'shot-1',position:1,shot_type:'wide',duration_seconds:4,composition:'林默走入巷道',camera_motion:'push_in',character_state:{},review_status:'approved',render_status:'pending',image_prompt:'wide comic shot',negative_prompt:'',active_panel_asset_id:'asset-1',dialogue:[]},
  {id:'shot-2',position:2,shot_type:'close_up',duration_seconds:5,composition:'银色左眼映出芯片',camera_motion:'push_in',character_state:{},review_status:'draft',render_status:'pending',image_prompt:'close-up comic shot',negative_prompt:'',active_panel_asset_id:null,dialogue:[]},
]}]};
const providerChannels = {
  llm:{name:'MiniMax',enabled:true,base_url:'https://api.example.com/a/very/long/provider/path/that/must/not/overflow',model:'MiniMax-M3-Long-Context-Model',ssh_host:'',api_key_configured:true,api_key_masked:'sk-•••8adr'},
  image:{name:'Internal GPT Image',enabled:true,base_url:'http://192.168.18.80:14000/v1/images/generations',model:'gpt-image-2-production-preview',ssh_host:'',api_key_configured:true,api_key_masked:'sk-•••img9'},
  tts:{name:'A800_94',enabled:true,base_url:'http://192.168.18.94:18080/v1/audio/speech',model:'Qwen3-TTS-12Hz-1.7B-CustomVoice',ssh_host:'ai-comic-tts',api_key_configured:false,api_key_masked:''},
  video:{name:'MiniMax Video',enabled:true,base_url:'https://api.minimaxi.com',model:'MiniMax-Hailuo-02',ssh_host:'',api_key_configured:true,api_key_masked:'sk-•••vid9'},
  persistence:{status:'saved',file_path:'data/provider-channels.json'},reloaded_at:'2026-07-11T10:00:00Z',
};
const providerHealth: ProviderHealth = {
  llm:{status:'ok',model:'MiniMax-M3',host:'api.minimaxi.com',elapsed_ms:7,check_scope:'model',error:null},
  image:{status:'ok',model:'gpt-image-2',host:'192.168.18.80',elapsed_ms:9,check_scope:'model',error:null},
  tts:{status:'ok',model:'Qwen3-TTS-12Hz-1.7B-CustomVoice',host:'192.168.18.94',elapsed_ms:12,check_scope:'audio',error:null},
  video:{status:'ok',model:'MiniMax-Hailuo-02',host:'api.minimaxi.com',elapsed_ms:11,check_scope:'endpoint',error:null},
};
const directorStage={id:'stage-1',scene_id:'scene-1',version:2,environment:{background_color:'#263238'},objects:[{id:'object-1',stage_id:'stage-1',kind:'primitive',source_type:'placeholder',source_id:null,label:'线索箱',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{color:'#4f7b95'},metadata:{},visible:true}],shot_cameras:[{id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:.1,far:1000,shot_size:'wide',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null},{id:'camera-2',stage_id:'stage-1',shot_id:'shot-2',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:85,near:.1,far:1000,shot_size:'close_up',camera_motion:'push_in',framing_guides:{},object_overrides:{},preview_asset_id:null}]};

test.beforeEach(async ({page}) => {
  await page.route('**/api/projects', route => route.fulfill({json:[project]}));
  await page.route('**/api/projects/project-1', route => route.fulfill({json:projectDetail}));
  await page.route('**/api/episodes/episode-1', route => route.fulfill({json:episode}));
  await page.route('**/api/assets/asset-1', route => route.fulfill({json:{id:'asset-1',kind:'panel',media_url:'/media/panel.png',media_type:'image/png',provider:'test',model:'test',generation_attempt:1,review_status:'approved',width:1024,height:1536,duration_seconds:null,created_at:''}}));
  await page.route('**/api/episodes/episode-1/production-readiness', route => route.fulfill({json:{episode_id:'episode-1',ready:true,totals:{shots:2,dialogue:0},ready_counts:{panels:2,approved:2,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}}));
  await page.route('**/api/providers/health', route => route.fulfill({json:providerHealth}));
  await page.route('**/api/episodes/episode-1/render', route => route.fulfill({status:202,json:{job_id:'render-1',status:'queued'}}));
  await page.route('**/api/jobs/render-1', route => route.fulfill({json:{id:'render-1',operation:'render_episode',target_type:'episode',target_id:'episode-1',status:'succeeded',progress:100,result_metadata:{media_url:'/media/render.mp4',probe:{format:{duration:'60'}}},error:'',retry_count:0,created_at:'',updated_at:''}}));
});

test('3D director renders, captures preview, and applies selected AI fields',async({page},testInfo)=>{
  let previewUploads=0;let appliedFields:string[]=[];
  await page.route('**/api/scenes/scene-1/director-stage',route=>route.fulfill({json:directorStage}));
  await page.route('**/api/director-cameras/camera-1/preview',async route=>{expect(route.request().headers()['content-type']).toContain('multipart/form-data');previewUploads+=1;await route.fulfill({status:201,json:{id:'preview-1',kind:'director_preview:camera-1',media_url:'/media/preview.png',media_type:'image/png',provider:'director',model:'threejs',generation_attempt:1,review_status:'draft',width:1262,height:900,duration_seconds:null,created_at:''}});});
  await page.route('**/api/director-stages/stage-1/suggestions',route=>route.fulfill({status:201,json:{id:'suggestion-1',stage_id:'stage-1',shot_id:'shot-1',kind:'shot_composition',status:'ready',request_context:{},suggested_patch:{composition:'低机位雨夜对峙',camera_motion:'pan_left',image_prompt:'cinematic rain',rationale:'强化压迫感'},error_category:'',error:'',created_at:'',applied_at:null}}));
  await page.route('**/api/director-stages/stage-1/shots/shot-1/apply-to-shot',async route=>{appliedFields=(await route.request().postDataJSON()).fields;await route.fulfill({json:{...episode.scenes[0].shots[0],composition:'低机位雨夜对峙'}});});
  await page.goto('/');
  await page.getByRole('tab',{name:testInfo.project.name==='mobile'?'导演':'3D导演',exact:true}).click();
  await expect(page.getByRole('heading',{name:'3D 导演台'})).toBeVisible();
  const pixelVariance=()=>page.locator('canvas').evaluate(canvas=>{const copy=document.createElement('canvas');copy.width=160;copy.height=100;const context=copy.getContext('2d',{willReadFrequently:true});if(!context)return 0;context.drawImage(canvas as HTMLCanvasElement,0,0,copy.width,copy.height);const pixels=context.getImageData(0,0,copy.width,copy.height).data;let min=765,max=0;for(let index=0;index<pixels.length;index+=16){const value=pixels[index]+pixels[index+1]+pixels[index+2];min=Math.min(min,value);max=Math.max(max,value);}return max-min;});
  await expect.poll(pixelVariance,{timeout:10000}).toBeGreaterThan(6);
  await page.getByRole('button',{name:'保存相机预览'}).click();await expect.poll(()=>previewUploads).toBe(1);
  await page.getByRole('button',{name:'AI构图建议'}).click();await expect(page.getByRole('dialog',{name:'AI 导演建议'})).toBeVisible();await page.getByLabel('运镜').uncheck();await page.getByRole('button',{name:'应用选中字段'}).click();await expect.poll(()=>appliedFields).toEqual(['composition']);
  const dimensions=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test('model channels manage Mock SSH through authoritative route-backed status', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Mock SSH lifecycle is covered once on desktop');
  const hosts: MockSshHost[] = [{id:'a800_94',name:'A800_94',type:'hostbridge'}];
  const stopped: MockSshStatus = {desired_running:false,state:'stopped',host_id:null,alias:null,port:null,error:null,reused:false};
  const running: MockSshStatus = {desired_running:true,state:'running',host_id:'a800_94',alias:'ai-comic-tts',port:2230,error:null,reused:false};
  let status: MockSshStatus = stopped;
  let statusReads = 0;
  let startStatusReadBaseline = 0;
  let stopStatusReadBaseline = 0;
  let startRequests = 0;
  let stopRequests = 0;

  await page.route('**/api/provider-channels', route => route.fulfill({json:providerChannels}));
  await page.route('**/api/mock-ssh/hosts', route => route.fulfill({json:hosts}));
  await page.route('**/api/mock-ssh/status', async route => {
    expect(route.request().method()).toBe('GET');
    statusReads += 1;
    await route.fulfill({json:status});
  });
  await page.route('**/api/mock-ssh/start', async route => {
    expect(route.request().method()).toBe('POST');
    expect(await route.request().postDataJSON()).toEqual({host_id:'a800_94',alias:'ai-comic-tts'});
    startRequests += 1;
    startStatusReadBaseline = statusReads;
    status = running;
    const mutationResult: MockSshStatus = {...running,port:2229,reused:true};
    await route.fulfill({json:mutationResult});
  });
  await page.route('**/api/mock-ssh/stop', async route => {
    expect(route.request().method()).toBe('POST');
    expect(await route.request().postDataJSON()).toEqual({});
    stopRequests += 1;
    stopStatusReadBaseline = statusReads;
    status = stopped;
    const mutationResult: MockSshStatus = {
      desired_running:false,state:'failed',host_id:'a800_94',alias:'ai-comic-tts',port:2230,error:'Stale stop response',reused:false,
    };
    await route.fulfill({json:mutationResult});
  });

  await page.goto('/');
  await page.getByRole('button',{name:'模型中心',exact:true}).click();
  const bridge = page.getByRole('heading',{name:'Mock SSH 桥接'}).locator('..').locator('..');
  await expect(bridge.getByText('已停止',{exact:true})).toBeVisible();
  await bridge.getByRole('button',{name:'启动 Mock SSH'}).click();
  await expect(bridge.getByText('运行中',{exact:true})).toBeVisible();
  await expect(bridge.getByText('ai-comic-tts :2230',{exact:true})).toBeVisible();
  await expect(bridge.getByText('ai-comic-tts :2229',{exact:true})).toHaveCount(0);
  await expect(bridge.getByText('已复用现有桥接',{exact:true})).toBeVisible();
  expect(statusReads).toBeGreaterThan(startStatusReadBaseline);
  await bridge.getByRole('button',{name:'停止 Mock SSH'}).click();
  await expect(bridge.getByText('已停止',{exact:true})).toBeVisible();
  await expect(bridge.getByRole('alert')).toHaveCount(0);
  await expect(bridge.getByLabel('HostBridge 主机')).toHaveValue('a800_94');
  await expect(bridge.getByLabel('SSH Alias')).toHaveValue('ai-comic-tts');
  expect(statusReads).toBeGreaterThan(stopStatusReadBaseline);

  expect(startRequests).toBe(1);
  expect(stopRequests).toBe(1);
});

test('toolbar reports live health for every enabled provider', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Provider health details are covered once on desktop');
  let healthRequests = 0;
  await page.route('**/api/providers/health', async route => {
    expect(route.request().method()).toBe('GET');
    healthRequests += 1;
    await route.fulfill({json:providerHealth});
  });

  await page.goto('/');
  await page.getByRole('button',{name:'检测模型服务'}).click();
  await expect(page.getByRole('button',{name:'检测模型服务'})).toContainText('4/4 正常');
  const details = page.getByRole('region',{name:'模型服务检测详情'});
  await expect(details).toBeVisible();
  await expect(details.locator('.provider-health-row')).toHaveCount(4);
  const planning = details.locator('.provider-health-row').filter({hasText:'剧本规划'});
  await expect(planning.getByText('MiniMax-M3',{exact:true})).toBeVisible();
  await expect(planning.getByText('api.minimaxi.com',{exact:true})).toBeVisible();
  await expect(planning.getByText('7 ms',{exact:true})).toBeVisible();
  await expect(details.getByText('画面生成')).toBeVisible();
  const speech = details.locator('.provider-health-row').filter({hasText:'语音合成'});
  await expect(speech.getByText('Qwen3-TTS-12Hz-1.7B-CustomVoice',{exact:true})).toBeVisible();
  await expect(speech.getByText('192.168.18.94',{exact:true})).toBeVisible();
  await expect(speech.getByText('12 ms',{exact:true})).toBeVisible();
  await expect(details.getByText('视频生成')).toBeVisible();
  expect(healthRequests).toBe(1);
});

test('toolbar health count excludes a failed provider and sanitizes its detail', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Provider health failure is covered once on desktop');
  await page.route('**/api/providers/health', route => route.fulfill({json:{
    ...providerHealth,
    image:{...providerHealth.image,status:'failed',elapsed_ms:18,error:'Provider returned HTTP 503\nrequest-id:\t safe-check'},
  }}));

  await page.goto('/');
  await page.getByRole('button',{name:'检测模型服务'}).click();
  await expect(page.getByRole('button',{name:'检测模型服务'})).toContainText('3/4 正常');
  const details = page.getByRole('region',{name:'模型服务检测详情'});
  await expect(details.getByText('Provider returned HTTP 503 request-id: safe-check',{exact:true})).toBeVisible();
  await expect(details.getByText('异常',{exact:true})).toHaveCount(1);
});

test('provider channel settings stay operable and bounded across studio viewports', async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Mobile Model Center layout is covered by component tests and the 390px browser check');
  let current = structuredClone(providerChannels);
  const writes: Array<Record<string, unknown>> = [];
  let expectedModel = '';
  let probeCount = 0;
  await page.route('**/api/model-runtime/health', route => route.fulfill({json:{
    capabilities:{
      text:{status:'healthy',model:'MiniMax-M3',host:'api.example.com',elapsed_ms:4,last_invocation_elapsed_ms:null,error:null},
      image:{status:'healthy',model:'gpt-image-2',host:'image.example.com',elapsed_ms:5,last_invocation_elapsed_ms:null,error:null},
      speech:{status:'disabled',model:'qwen',host:'tts.example.com',elapsed_ms:0,last_invocation_elapsed_ms:null,error:null},
      video:{status:'disabled',model:'video',host:'video.example.com',elapsed_ms:0,last_invocation_elapsed_ms:null,error:null},
    },
    infrastructure:{api:{status:'healthy'},mock_ssh:{state:'stopped'},queue:{queued:0,running:0},persistence:{status:'saved'}},checked_at:'2026-07-12T10:00:00Z',
  }}));
  await page.route('**/api/model-runtime/invocations?*', route => route.fulfill({json:[]}));
  await page.route('**/api/provider-channels', route => route.fulfill({json:current}));
  await page.route('**/api/provider-channels/llm/test', async route => {
    expect((await route.request().postDataJSON()).model).toBe(expectedModel);
    probeCount += 1;
    await route.fulfill({json:probeCount % 2 === 1
      ? {status:'ok',model:expectedModel,host:'api.example.com',elapsed_ms:7,check_scope:'model',error:null}
      : {status:'failed',model:expectedModel,host:'api.example.com',elapsed_ms:8,check_scope:'model',error:'Provider rejected model'}});
  });
  await page.route('**/api/provider-channels/llm', async route => {
    const body = await route.request().postDataJSON();
    writes.push(body);
    current = {...current,llm:{...current.llm,...body,api_key_configured:true,api_key_masked:'sk-•••saved'}};
    await route.fulfill({json:{channel:current.llm,current}});
  });

  const viewports = testInfo.project.name === 'desktop'
    ? [{width:1440,height:900},{width:1024,height:768}]
    : [{width:390,height:844},{width:360,height:800}];

  for (const viewport of viewports) {
    expectedModel = `MiniMax-M4-${viewport.width}`;
    await page.setViewportSize(viewport);
    await page.goto('/');
    const settingsCommand = page.getByRole('button',{name:'模型中心',exact:true});
    await settingsCommand.click();

    await expect(page.getByRole('heading',{name:'模型中心'})).toBeVisible();
    await expect(page.getByRole('form')).toHaveCount(4);
    await expect(page.getByLabel('剧本规划 Base URL')).toBeVisible();
    await expect(page.getByRole('tablist',{name:'工作区'})).toHaveCount(0);
    const controls = [
      page.getByLabel('剧本规划 Base URL'),
      page.getByLabel('替换剧本规划 API Key'),
      page.getByRole('button',{name:'清除剧本规划 API Key'}),
      page.getByRole('button',{name:'测试剧本规划连接'}),
      page.getByRole('button',{name:'保存全部更改'}),
    ];
    const dimensions = await page.evaluate(() => ({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    for (const locator of [page.locator('.model-center'),...controls]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const [keyBox,clearBox,testBox,statusBox] = await Promise.all([
      page.getByLabel('替换剧本规划 API Key').boundingBox(),
      page.getByRole('button',{name:'清除剧本规划 API Key'}).boundingBox(),
      page.getByRole('button',{name:'测试剧本规划连接'}).boundingBox(),
      page.locator('#provider-llm-status').boundingBox(),
    ]);
    expect(keyBox).not.toBeNull(); expect(clearBox).not.toBeNull(); expect(testBox).not.toBeNull(); expect(statusBox).not.toBeNull();
    const separate = (a: NonNullable<typeof keyBox>, b: NonNullable<typeof keyBox>) =>
      a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
    expect(separate(keyBox!,clearBox!)).toBe(true);
    expect(separate(testBox!,statusBox!)).toBe(true);

    await page.getByLabel('剧本规划模型').fill(expectedModel);
    await expect(page.getByText('有未保存更改')).toBeVisible();
    await page.getByRole('button',{name:'测试剧本规划连接'}).click();
    await expect(page.getByText(/连接成功.*7 ms/)).toHaveClass(/success/);
    await page.getByRole('button',{name:'测试剧本规划连接'}).click();
    await expect(page.getByRole('alert').filter({hasText:'Provider rejected model'})).toHaveClass(/failure/);
    await page.getByLabel('语音合成 SSH Host').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('语音合成 SSH Host')).toBeInViewport();
    await page.getByRole('button',{name:'保存全部更改'}).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'保存全部更改'})).toBeInViewport();
    await page.getByRole('button',{name:'保存全部更改'}).click();
    await expect(page.getByText('所有更改已保存')).toBeVisible();
  }
  expect(writes).toHaveLength(viewports.length);
  expect(writes.map(write => write.model)).toEqual(viewports.map(viewport => `MiniMax-M4-${viewport.width}`));
});

test('provider channel settings persist safely and affect the next planning operation', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Persistence behavior only needs one deterministic browser project');
  const replacementKey = 'e2e-replacement-key-never-render';
  const savedModel = 'MiniMax-M4-Persisted';
  let current = structuredClone(providerChannels);
  let getCount = 0;
  let putCount = 0;
  let planningModel = '';

  await page.route('**/api/provider-channels', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    getCount += 1;
    await route.fulfill({json: current});
  });
  await page.route('**/api/provider-channels/llm', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = await route.request().postDataJSON();
    expect(body.api_key).toBe(replacementKey);
    expect(body.model).toBe(savedModel);
    putCount += 1;
    current = {
      ...current,
      llm: {
        ...current.llm,
        name: body.name,
        enabled: body.enabled,
        base_url: body.base_url,
        model: body.model,
        ssh_host: body.ssh_host,
        api_key_configured: true,
        api_key_masked: 'e2e****nder',
      },
      persistence: {status: 'saved', file_path: 'data/provider-channels.json'},
      reloaded_at: '2026-07-11T11:00:00Z',
    };
    await route.fulfill({json: {channel: current.llm, current}});
  });
  await page.route('**/api/episodes/episode-1/plan', async route => {
    planningModel = current.llm.model;
    await route.fulfill({status: 202, json: {id: 'plan-1', operation: 'plan_episode', target_type: 'episode', target_id: 'episode-1', status: 'queued', progress: 0, result_metadata: {}, error: '', retry_count: 0, created_at: '', updated_at: ''}});
  });

  await page.goto('/');
  await page.getByRole('button', {name: '模型中心',exact:true}).click();
  await expect(page.getByLabel('剧本规划模型')).toHaveValue(providerChannels.llm.model);

  await page.getByLabel('剧本规划模型').fill('MiniMax-Unsaved');
  await expect(page.getByText('有未保存更改')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', {name: '模型中心',exact:true}).click();
  await expect(page.getByLabel('剧本规划模型')).toHaveValue(providerChannels.llm.model);
  expect(putCount).toBe(0);

  await page.getByLabel('剧本规划模型').fill(savedModel);
  await page.getByLabel('替换剧本规划 API Key').fill(replacementKey);
  await page.getByRole('button', {name: '保存全部更改'}).click();
  await expect(page.getByText('所有更改已保存')).toBeVisible();
  await expect(page.getByLabel('剧本规划模型')).toHaveValue(savedModel);
  await expect(page.getByLabel('替换剧本规划 API Key')).toHaveValue('');
  expect(putCount).toBe(1);
  expect(getCount).toBeGreaterThanOrEqual(3);
  expect(await page.locator('body').textContent()).not.toContain(replacementKey);
  expect(await page.locator('html').evaluate(element => element.outerHTML)).not.toContain(replacementKey);

  await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:8000/api/episodes/episode-1/plan', {method: 'POST', headers: {'content-type': 'application/json'}});
    if (!response.ok) throw new Error(`Planning request failed: ${response.status}`);
  });
  expect(planningModel).toBe(savedModel);
});

test('render success exposes the verified MP4 download', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'渲染本集'}).click();
  const download = page.getByRole('link',{name:'下载 MP4'});
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', /render\.mp4$/);
});

test('workspace shows generated panel and shot production controls', async ({page}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
  await expect(page.getByAltText('林默走入巷道')).toBeVisible();
  await page.getByRole('button', {name: /镜头 2/}).click();
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await expect(page.getByRole('button', {name: '生成画面'})).toBeVisible();
  await expect(page.getByLabel('审核状态')).toHaveValue('draft');
});

test('dynamic production workflow exposes import references and shot video', async ({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Full workflow is covered once on desktop');
  const draft={project:{title:'雨夜',logline:'追查芯片'},characters:[{draft_id:'c1',name:'林夏',aliases:[],role:'主角',appearance_bible:'黑色风衣',personality:'冷静',continuity_rules:'银色耳钉',negative_constraints:'',voice_speaker:'female-1',voice_instruction:''}],episodes:[{draft_id:'e2',enabled:true,title:'第二集',premise:'继续追查',target_duration_seconds:60,scenes:[{location:'天台',time_of_day:'night',summary:'追逐',continuity_state:{},estimated_duration_seconds:5,shots:[{shot_type:'wide',duration_seconds:5,composition:'天台',camera_motion:'push_in',character_state:{},image_prompt:'roof',negative_prompt:'',dialogue:[]}]}]}],warnings:[]};
  const imported={id:'import-1',project_id:'project-1',status:'ready',mode:'auto',source_format:'paste',original_filename:'',checksum:'x',extracted_text:'雨夜剧本',structured_draft:draft,error:'',error_category:'',created_at:'',updated_at:'',applied_at:null};
  let reference={id:'ref-1',character_id:'character-1',reference_type:'primary',label:'主参考',position:0,is_active:false,review_status:'draft',created_at:'',asset:{id:'ref-asset',kind:'character-reference',media_url:'/demo-panel.png',media_type:'image/png',provider:'upload',model:'local',generation_attempt:1,review_status:'draft',width:1,height:1,duration_seconds:null,created_at:''}};
  let videos:any[]=[];
  await page.route('**/api/projects/project-1/script-imports',route=>route.fulfill({status:201,json:{...imported,status:'uploaded',structured_draft:{}}}));
  await page.route('**/api/script-imports/import-1/parse',route=>route.fulfill({json:imported}));
  await page.route('**/api/script-imports/import-1/draft',route=>route.fulfill({json:imported}));
  await page.route('**/api/script-imports/import-1/confirm',route=>route.fulfill({json:{...imported,status:'applied'}}));
  await page.route('**/api/characters/character-1/references',route=>route.fulfill({json:[reference]}));
  await page.route('**/api/character-references/ref-1',async route=>{reference={...reference,review_status:'approved'};await route.fulfill({json:reference});});
  await page.route('**/api/characters/character-1/references/ref-1/active',async route=>{reference={...reference,is_active:true};await route.fulfill({json:reference});});
  await page.route('**/api/shots/shot-1/videos*',route=>route.request().method()==='POST'?route.fulfill({status:202,json:{job_id:'video-1',status:'queued'}}):route.fulfill({json:videos}));
  await page.route('**/api/jobs/video-1',route=>{videos=[{id:'video-asset',kind:'video:shot-1',media_url:'/render.mp4',media_type:'video/mp4',provider:'minimax-video',model:'MiniMax-Hailuo-02',generation_attempt:1,review_status:'draft',width:null,height:null,duration_seconds:6,created_at:''}];return route.fulfill({json:{id:'video-1',operation:'generate_video',target_type:'shot',target_id:'shot-1',status:'succeeded',progress:100,result_metadata:{asset_id:'video-asset'},error:'',retry_count:0,created_at:'',updated_at:''}});});

  await page.goto('/'); await page.getByRole('tab',{name:'剧本创作'}).click(); await page.getByRole('button',{name:'自动识别'}).click(); await page.getByPlaceholder('粘贴剧本、小说或故事文本').fill('雨夜剧本'); await page.getByRole('button',{name:'解析并预览'}).click(); await expect(page.locator('input[value="第二集"]')).toBeVisible(); await page.getByRole('button',{name:/确认导入/}).click();
  await page.getByRole('tab',{name:'角色'}).click(); await page.getByRole('button',{name:/批准/}).click(); await page.getByRole('button',{name:'设为使用'}).click(); await expect(page.getByText(/使用中/)).toBeVisible();
  await page.getByRole('tab',{name:'分镜'}).click(); await page.getByRole('button',{name:/镜头 1/}).click(); await page.getByRole('button',{name:'生成视频'}).click(); await expect(page.locator('.video-versions video')).toHaveCount(1);
});

test('AI script creation streams before completion and waits for manual parsing',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Streaming interaction is covered once on desktop');
  const draft={project:{title:'雨夜',logline:'追查芯片'},characters:[],episodes:[],warnings:[]};
  const imported={id:'import-stream',project_id:'project-1',status:'ready',mode:'auto',source_format:'paste',original_filename:'',checksum:'x',extracted_text:'第一集：雨夜\n场景一',structured_draft:draft,error:'',error_category:'',created_at:'',updated_at:'',applied_at:null};
  let parseRequests=0;
  await page.addInitScript(()=>{
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      if(!url.includes('/api/projects/project-1/script-generation/stream'))return nativeFetch(input,init);
      const encoder=new TextEncoder();
      const body=new ReadableStream({start(controller){controller.enqueue(encoder.encode('event: chunk\ndata: {"text":"第一集：雨夜\\n"}\n\n'));setTimeout(()=>{controller.enqueue(encoder.encode('event: chunk\ndata: {"text":"场景一"}\n\nevent: done\ndata: {"finish_reason":"stop"}\n\n'));controller.close();(window as typeof window&{scriptStreamFinished?:boolean}).scriptStreamFinished=true;},250);}});
      return new Response(body,{status:200,headers:{'content-type':'text/event-stream'}});
    };
  });
  await page.route('**/api/projects/project-1/script-imports',async route=>{parseRequests+=1;await route.fulfill({status:201,json:{...imported,status:'uploaded',structured_draft:{}}});});
  await page.route('**/api/script-imports/import-stream/parse',route=>route.fulfill({json:imported}));

  await page.goto('/');
  await page.getByRole('tab',{name:'剧本创作'}).click();
  await page.getByLabel('本次创作要求（可选）').fill('生成一集雨夜追逐戏');
  await page.getByRole('button',{name:'开始 AI 创作'}).click();
  await expect(page.getByLabel('AI 剧本草稿')).toHaveValue('第一集：雨夜\n');
  expect(await page.evaluate(()=>(window as typeof window&{scriptStreamFinished?:boolean}).scriptStreamFinished??false)).toBe(false);
  await expect(page.getByLabel('AI 剧本草稿')).toHaveValue('第一集：雨夜\n场景一');
  expect(parseRequests).toBe(0);
  await page.getByRole('button',{name:'解析并预览'}).click();
  await expect.poll(()=>parseRequests).toBe(1);
});

test('deletes an episode and selects the adjacent episode',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Episode deletion is covered once on desktop');
  const second={...episodeSummary,id:'episode-2',title:'第二集',premise:'继续追查'};
  let currentProject={...projectDetail,episodes:[episodeSummary,second]};
  let deleteRequests=0;
  await page.route('**/api/projects/project-1',route=>route.fulfill({json:currentProject}));
  await page.route('**/api/episodes/episode-2',route=>route.fulfill({json:{...episode,id:'episode-2',title:'第二集',premise:'继续追查'}}));
  await page.route('**/api/episodes/episode-2/production-readiness',route=>route.fulfill({json:{episode_id:'episode-2',ready:false,totals:{shots:2,dialogue:0},ready_counts:{panels:1,approved:1,speech:0},blockers:{missing_panels:['shot-1'],unapproved_shots:['shot-1'],missing_speech:[]}}}));
  await page.route('**/api/episodes/episode-1/deletion-preview',route=>route.fulfill({json:{episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:3}}}));
  await page.route('**/api/episodes/episode-1',async route=>{
    if(route.request().method()!=='DELETE')return route.fallback();
    deleteRequests+=1;
    currentProject={...currentProject,episodes:[second]};
    await route.fulfill({json:{episode_id:'episode-1',deleted_episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:3},cleanup_warnings:[]}});
  });

  await page.goto('/');
  await page.getByRole('button',{name:'删除剧集：失窃的雨夜'}).click();
  await expect(page.getByRole('dialog',{name:'永久删除剧集'})).toContainText('3 个媒体素材');
  await page.getByRole('button',{name:'取消'}).click();
  expect(deleteRequests).toBe(0);
  await page.getByRole('button',{name:'删除剧集：失窃的雨夜'}).click();
  await page.getByRole('button',{name:'永久删除'}).click();
  await expect(page.locator('.episode-item[aria-current="page"]')).toContainText('第二集');
  await expect(page.getByRole('button',{name:'删除剧集：失窃的雨夜'})).toHaveCount(0);
  expect(deleteRequests).toBe(1);
});

test('desktop shot selection keeps the storyboard work area active', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-specific behavior');
  await page.goto('/');

  const storyboardTab = page.getByRole('tab', {name: '分镜'});
  await storyboardTab.click();
  await page.getByRole('button', {name: /镜头 2/}).click();

  await expect(storyboardTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', {name: /镜头 2/})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
});

test('compact desktop keeps the inspector inside the viewport at the mobile breakpoint edge', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-specific behavior');

  for (const width of [900, 905, 906]) {
    await page.setViewportSize({width, height: 800});
    await page.goto('/');
    await expect(page.getByRole('tab', {name: '审核'})).toBeVisible();

    const [gridBox, inspectorBox, controlBox, dimensions] = await Promise.all([
      page.locator('.workspace-grid').boundingBox(),
      page.locator('.workspace-inspector').boundingBox(),
      page.getByLabel('审核状态').boundingBox(),
      page.evaluate(() => ({clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})),
    ]);
    expect(gridBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(width + 1);
    expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(width + 1);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(width + 1);
  }
});

test('compact overview keeps primary content inside the first viewport', async ({page}, testInfo) => {
  const viewports = testInfo.project.name === 'desktop'
    ? [{width: 1440, height: 900}, {width: 1024, height: 768}]
    : [{width: 390, height: 844}];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const shotCard = page.getByRole('button', {name: /镜头 1/});
    const header = page.locator('.episode-overview-header');
    const metrics = page.getByTestId('overview-metric');
    const blockers = page.locator('.readiness-blockers');
    const shotWallHeading = page.locator('.episode-overview-shots-heading');
    await expect(shotCard).toBeInViewport();
    await expect(blockers).toContainText('素材已就绪');
    await expect(blockers).not.toContainText(/缺少画面|未审核镜头|缺少配音/);
    await expect(page.getByRole('button', {name: '处理阻塞项'})).toHaveCount(0);
    await expect(metrics).toHaveCount(3);

    const [headerBox, metricBoxes, blockersBox, shotWallHeadingBox] = await Promise.all([
      header.boundingBox(),
      metrics.evaluateAll(elements => elements.map(element => {
        const {x, y, width, height} = element.getBoundingClientRect();
        return {x, y, width, height};
      })),
      blockers.boundingBox(),
      shotWallHeading.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(blockersBox).not.toBeNull();
    expect(shotWallHeadingBox).not.toBeNull();
    expect(headerBox!.height).toBeLessThanOrEqual(140);
    expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(metricBoxes[0].y + 1);
    expect(metricBoxes.at(-1)!.y + metricBoxes.at(-1)!.height).toBeLessThanOrEqual(blockersBox!.y + 1);
    expect(blockersBox!.y + blockersBox!.height).toBeLessThanOrEqual(shotWallHeadingBox!.y + 1);

    if (testInfo.project.name === 'mobile') {
      const commands = [page.getByRole('button', {name: '打开生产'})];
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);

      for (const element of [...commands, ...await metrics.all()]) {
        await expect(element).toBeInViewport();
        const box = await element.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      }
    } else {
      expect(new Set(metricBoxes.map(box => Math.round(box.y))).size).toBe(1);
      expect(new Set(metricBoxes.map(box => Math.round(box.height))).size).toBe(1);
    }

    const viewportName = viewport.width === 1440 ? 'desktop-1440x900' : viewport.width === 1024 ? 'tablet-1024x768' : 'mobile-390x844';
    await page.screenshot({
      path: path.resolve(process.cwd(), '../../output/compact-overview', `${viewportName}.png`),
      animations: 'disabled',
      scale: 'css',
    });
  }
});

test('mobile navigation keeps work areas separated and within the viewport', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific behavior');
  await page.goto('/');

  await expect(page.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
  await page.getByRole('tab', {name: '分镜'}).click();
  const shotCards = page.getByRole('button', {name: /镜头 [12]/});
  const [firstShotBox, secondShotBox] = await Promise.all([shotCards.nth(0).boundingBox(), shotCards.nth(1).boundingBox()]);
  expect(firstShotBox).not.toBeNull();
  expect(secondShotBox).not.toBeNull();
  expect(secondShotBox!.y).toBe(firstShotBox!.y);
  expect(secondShotBox!.x).toBeGreaterThan(firstShotBox!.x + firstShotBox!.width - 1);
  await page.getByRole('button', {name: /镜头 2/}).click();
  await expect(page.getByRole('tab', {name: '检查器'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await page.getByRole('button', {name: '生成画面'}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', {name: '生成画面'})).toBeInViewport();

  await page.getByRole('tab', {name: '分镜'}).click();
  await expect(page.getByRole('button', {name: /镜头 2/})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', {name: '生产'}).click();
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();

  const toolbar = page.locator('.app-toolbar');
  const selectors = page.locator('.mobile-project-bar');
  const tabs = page.getByRole('tablist', {name: '工作区'});
  const [toolbarBox, selectorsBox, tabsBox, mainBox, dimensions] = await Promise.all([
    toolbar.boundingBox(),
    selectors.boundingBox(),
    tabs.boundingBox(),
    main.boundingBox(),
    page.evaluate(() => ({clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})),
  ]);
  expect(toolbarBox).not.toBeNull();
  expect(selectorsBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  const tabBoxes = await tabs.getByRole('tab').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
  expect(new Set(tabBoxes.map(width => Math.round(width))).size).toBe(1);
  await expect(selectors).toHaveCSS('position', 'sticky');
  expect(selectorsBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
  expect(tabsBox!.y).toBeGreaterThanOrEqual(selectorsBox!.y + selectorsBox!.height);
  expect(mainBox!.y).toBeGreaterThanOrEqual(tabsBox!.y + tabsBox!.height);
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  for (const control of await page.locator('button:visible, select:visible, input:visible, textarea:visible').all()) {
    const box = await control.boundingBox();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test('mobile review action opens a relevant shot in the inspector', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific behavior');
  await page.unroute('**/api/episodes/episode-1/production-readiness');
  await page.route('**/api/episodes/episode-1/production-readiness', route => route.fulfill({json:{episode_id:'episode-1',ready:false,totals:{shots:2,dialogue:0},ready_counts:{panels:1,approved:1,speech:0},blockers:{missing_panels:['shot-2'],unapproved_shots:['shot-2'],missing_speech:[]}}}));
  await page.goto('/');

  await page.getByRole('button', {name: '处理阻塞项'}).click();

  await expect(page.getByRole('tab', {name: '检查器'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await expect(page.getByLabel('审核状态')).toHaveValue('draft');
});

test('narrow mobile layout uses one shot column without clipping controls', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific behavior');
  await page.setViewportSize({width: 360, height: 800});
  await page.goto('/');
  await page.getByRole('tab', {name: '分镜'}).click();

  const shotCards = page.getByRole('button', {name: /镜头 [12]/});
  const [firstShotBox, secondShotBox, toolbarBox, tabsBox, dimensions] = await Promise.all([
    shotCards.nth(0).boundingBox(),
    shotCards.nth(1).boundingBox(),
    page.locator('.app-toolbar').boundingBox(),
    page.getByRole('tablist', {name: '工作区'}).boundingBox(),
    page.evaluate(() => ({clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})),
  ]);
  expect(firstShotBox).not.toBeNull();
  expect(secondShotBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(secondShotBox!.y).toBeGreaterThanOrEqual(firstShotBox!.y + firstShotBox!.height - 1);
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);

  for (const box of [toolbarBox!, tabsBox!]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
  for (const control of await page.locator('button:visible, select:visible, input:visible, textarea:visible').all()) {
    const box = await control.boundingBox();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test('mixed production retry clears readiness blockers and enables render', async ({page}) => {
  let retried = false;
  const run = (status: 'queued'|'running'|'completed_with_failures'|'completed') => ({
    id:'run-1',episode_id:'episode-1',status,stages:['panels'],concurrency:2,
    regenerate_panels:false,regenerate_speech:false,pause_requested:false,total_items:3,
    queued_items:status==='queued'?1:0,running_items:status==='running'?1:0,
    succeeded_items:retried?2:1,failed_items:retried?0:1,skipped_items:1,
    summary_error:'',created_at:'',updated_at:'',
  });
  const items = () => [
    {id:'item-skipped',run_id:'run-1',stage:'panel',target_type:'shot',target_id:'shot-1',position:1,status:'skipped',attempt_count:0,result_metadata:{reason:'already_ready'},error:'',created_at:'',updated_at:''},
    {id:'item-success',run_id:'run-1',stage:'panel',target_type:'shot',target_id:'shot-2',position:2,status:'succeeded',attempt_count:1,result_metadata:{},error:'',created_at:'',updated_at:''},
    {id:'item-failed',run_id:'run-1',stage:'panel',target_type:'shot',target_id:'shot-2',position:3,status:retried?'succeeded':'failed',attempt_count:retried?2:1,result_metadata:{},error:retried?'':'provider timeout',created_at:'',updated_at:''},
  ];

  await page.unroute('**/api/episodes/episode-1/production-readiness');
  await page.route('**/api/episodes/episode-1/production-readiness', route => route.fulfill({json:retried
    ? {episode_id:'episode-1',ready:true,totals:{shots:2,dialogue:0},ready_counts:{panels:2,approved:2,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}
    : {episode_id:'episode-1',ready:false,totals:{shots:2,dialogue:0},ready_counts:{panels:1,approved:1,speech:0},blockers:{missing_panels:['shot-2'],unapproved_shots:['shot-2'],missing_speech:[]}}}));
  await page.route('**/api/episodes/episode-1/production-runs', route => route.fulfill({json:run('queued')}));
  await page.route('**/api/production-runs/run-1/continue', route => route.fulfill({json:run('running')}));
  await page.route('**/api/production-runs/run-1', route => route.fulfill({json:run(retried?'completed':'completed_with_failures')}));
  await page.route('**/api/production-runs/run-1/items', route => route.fulfill({json:items()}));
  await page.route('**/api/production-runs/run-1/retry', async route => {
    expect((await route.request().postDataJSON()).item_ids).toEqual(['item-failed']);
    retried = true;
    await route.fulfill({json:run('queued')});
  });

  await page.goto('/');
  await expect(page.getByRole('button',{name:'渲染本集'})).toBeDisabled();
  await page.getByRole('button',{name:'批量生产'}).click();
  await page.getByRole('button',{name:'开始批量生产'}).click();
  await expect(page.getByText('失败 1')).toBeVisible();
  await expect(page.getByText('跳过 1')).toBeVisible();
  await page.getByLabel('选择失败项 item-failed').check();
  await page.getByRole('button',{name:'重试选中失败项'}).click();
  await expect(page.getByText('失败 0')).toBeVisible();
  await expect(page.getByRole('button',{name:'渲染本集'})).toBeEnabled();
});
