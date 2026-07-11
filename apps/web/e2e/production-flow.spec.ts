import {expect, test} from '@playwright/test';
import path from 'node:path';

const project = {id:'project-1',title:'霓虹夜行',logline:'寻找记忆',story_bible:'近未来重庆',visual_style:'Chinese noir',aspect_ratio:'9:16',language:'Chinese',created_at:'',updated_at:''};
const episodeSummary = {id:'episode-1',project_id:'project-1',title:'失窃的雨夜',premise:'寻找芯片',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''};
const projectDetail = {...project,characters:[],episodes:[episodeSummary]};
const episode = {...episodeSummary,scenes:[{id:'scene-1',position:1,location:'雨夜巷道',time_of_day:'night',summary:'发现芯片',continuity_state:{},estimated_duration_seconds:10,shots:[
  {id:'shot-1',position:1,shot_type:'wide',duration_seconds:4,composition:'林默走入巷道',camera_motion:'push_in',character_state:{},review_status:'approved',render_status:'pending',image_prompt:'wide comic shot',negative_prompt:'',active_panel_asset_id:'asset-1',dialogue:[]},
  {id:'shot-2',position:2,shot_type:'close_up',duration_seconds:5,composition:'银色左眼映出芯片',camera_motion:'push_in',character_state:{},review_status:'draft',render_status:'pending',image_prompt:'close-up comic shot',negative_prompt:'',active_panel_asset_id:null,dialogue:[]},
]}]};
const providerChannels = {
  llm:{name:'MiniMax',enabled:true,base_url:'https://api.example.com/a/very/long/provider/path/that/must/not/overflow',model:'MiniMax-M3-Long-Context-Model',ssh_host:'',api_key_configured:true,api_key_masked:'sk-•••8adr'},
  image:{name:'Internal GPT Image',enabled:true,base_url:'http://192.168.18.80:14000/v1/images/generations',model:'gpt-image-2-production-preview',ssh_host:'',api_key_configured:true,api_key_masked:'sk-•••img9'},
  tts:{name:'A800_94',enabled:true,base_url:'http://192.168.18.94:18080/v1/audio/speech',model:'Qwen3-TTS-12Hz-1.7B-CustomVoice',ssh_host:'ai-comic-tts',api_key_configured:false,api_key_masked:''},
  persistence:{status:'saved',file_path:'data/provider-channels.json'},reloaded_at:'2026-07-11T10:00:00Z',
};

test.beforeEach(async ({page}) => {
  await page.route('**/api/projects', route => route.fulfill({json:[project]}));
  await page.route('**/api/projects/project-1', route => route.fulfill({json:projectDetail}));
  await page.route('**/api/episodes/episode-1', route => route.fulfill({json:episode}));
  await page.route('**/api/episodes/episode-1/production-readiness', route => route.fulfill({json:{episode_id:'episode-1',ready:true,totals:{shots:2,dialogue:0},ready_counts:{panels:2,approved:2,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}}));
  await page.route('**/api/providers/health', route => route.fulfill({json:{minimax:{status:'ok'},gpt_image:{status:'ok'},qwen_tts:{status:'ok'}}}));
  await page.route('**/api/episodes/episode-1/render', route => route.fulfill({status:202,json:{job_id:'render-1',status:'queued'}}));
  await page.route('**/api/jobs/render-1', route => route.fulfill({json:{id:'render-1',operation:'render_episode',target_type:'episode',target_id:'episode-1',status:'succeeded',progress:100,result_metadata:{media_url:'/media/render.mp4',probe:{format:{duration:'60'}}},error:'',retry_count:0,created_at:'',updated_at:''}}));
});

test('provider channel settings stay operable and bounded across studio viewports', async ({page}, testInfo) => {
  let current = structuredClone(providerChannels);
  const writes: Array<Record<string, unknown>> = [];
  let expectedModel = '';
  let probeCount = 0;
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
    const settingsCommand = testInfo.project.name === 'desktop'
      ? page.getByRole('button',{name:'模型渠道'})
      : page.getByRole('tab',{name:'模型渠道'});
    await settingsCommand.click();

    await expect(page.getByRole('heading',{name:'模型渠道'})).toBeVisible();
    await expect(page.getByRole('form')).toHaveCount(3);
    await expect(page.getByLabel('剧本规划 Base URL')).toBeVisible();
    const tabs = page.getByRole('tablist',{name:'工作区'});
    const tabButtons = tabs.getByRole('tab');
    await expect(tabButtons).toHaveCount(5);
    const controls = [
      page.getByLabel('剧本规划 Base URL'),
      page.getByLabel('替换剧本规划 API Key'),
      page.getByRole('button',{name:'清除剧本规划 API Key'}),
      page.getByRole('button',{name:'测试剧本规划连接'}),
      page.getByRole('button',{name:'保存全部更改'}),
    ];
    const dimensions = await page.evaluate(() => ({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    for (const locator of [tabs,...controls]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const [tabBoxes,keyBox,clearBox,testBox,statusBox] = await Promise.all([
      tabButtons.evaluateAll(elements => elements.map(element => {
        const {x,y,width,height} = element.getBoundingClientRect();
        return {x,y,width,height};
      })),
      page.getByLabel('替换剧本规划 API Key').boundingBox(),
      page.getByRole('button',{name:'清除剧本规划 API Key'}).boundingBox(),
      page.getByRole('button',{name:'测试剧本规划连接'}).boundingBox(),
      page.locator('#provider-llm-status').boundingBox(),
    ]);
    expect(tabBoxes.every((box,index) => box.x >= 0 && box.x + box.width <= viewport.width + 1 && (index === 0 || box.x >= tabBoxes[index - 1].x + tabBoxes[index - 1].width - 1))).toBe(true);
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
