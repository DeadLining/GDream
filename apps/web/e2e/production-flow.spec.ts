import {expect, test} from '@playwright/test';

const project = {id:'project-1',title:'霓虹夜行',logline:'寻找记忆',story_bible:'近未来重庆',visual_style:'Chinese noir',aspect_ratio:'9:16',language:'Chinese',created_at:'',updated_at:''};
const episodeSummary = {id:'episode-1',project_id:'project-1',title:'失窃的雨夜',premise:'寻找芯片',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''};
const projectDetail = {...project,characters:[],episodes:[episodeSummary]};
const episode = {...episodeSummary,scenes:[{id:'scene-1',position:1,location:'雨夜巷道',time_of_day:'night',summary:'发现芯片',continuity_state:{},estimated_duration_seconds:10,shots:[
  {id:'shot-1',position:1,shot_type:'wide',duration_seconds:4,composition:'林默走入巷道',camera_motion:'push_in',character_state:{},review_status:'approved',render_status:'pending',image_prompt:'wide comic shot',negative_prompt:'',active_panel_asset_id:'asset-1',dialogue:[]},
  {id:'shot-2',position:2,shot_type:'close_up',duration_seconds:5,composition:'银色左眼映出芯片',camera_motion:'push_in',character_state:{},review_status:'draft',render_status:'pending',image_prompt:'close-up comic shot',negative_prompt:'',active_panel_asset_id:null,dialogue:[]},
]}]};

test.beforeEach(async ({page}) => {
  await page.route('**/api/projects', route => route.fulfill({json:[project]}));
  await page.route('**/api/projects/project-1', route => route.fulfill({json:projectDetail}));
  await page.route('**/api/episodes/episode-1', route => route.fulfill({json:episode}));
  await page.route('**/api/episodes/episode-1/production-readiness', route => route.fulfill({json:{episode_id:'episode-1',ready:true,totals:{shots:2,dialogue:0},ready_counts:{panels:2,approved:2,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}}));
  await page.route('**/api/providers/health', route => route.fulfill({json:{minimax:{status:'ok'},gpt_image:{status:'ok'},qwen_tts:{status:'ok'}}}));
  await page.route('**/api/episodes/episode-1/render', route => route.fulfill({status:202,json:{job_id:'render-1',status:'queued'}}));
  await page.route('**/api/jobs/render-1', route => route.fulfill({json:{id:'render-1',operation:'render_episode',target_type:'episode',target_id:'episode-1',status:'succeeded',progress:100,result_metadata:{media_url:'/media/render.mp4',probe:{format:{duration:'60'}}},error:'',retry_count:0,created_at:'',updated_at:''}}));
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
  await expect(page.getByAltText('林默站在雨夜霓虹巷道的漫画分镜')).toBeVisible();
  await page.getByRole('button', {name: /镜头 2/}).click();
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await expect(page.getByRole('button', {name: '生成画面'})).toBeVisible();
  await expect(page.getByLabel('审核状态')).toHaveValue('draft');
});

test('mobile shot selection opens the inspector without overlap', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific behavior');
  await page.goto('/');

  await page.getByRole('button', {name: /镜头 2/}).click();
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await page.getByRole('button', {name: '生成画面'}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', {name: '生成画面'})).toBeInViewport();
  await expect(page.getByRole('main')).toBeHidden();
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
