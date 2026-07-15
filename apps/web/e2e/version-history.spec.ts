import {expect,test} from '@playwright/test';

const project={id:'project-1',title:'霓虹夜行',logline:'寻找记忆',story_bible:'近未来重庆',visual_style:'Chinese noir',aspect_ratio:'9:16',language:'Chinese',created_at:'',updated_at:''};
const episodeSummary={id:'episode-1',project_id:'project-1',title:'当前标题',premise:'当前梗概',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''};
const restoredEpisodeSummary={...episodeSummary,title:'审核前标题',premise:'审核前梗概'};
const projectDetail={...project,characters:[],episodes:[episodeSummary]};
const restoredProjectDetail={...projectDetail,episodes:[restoredEpisodeSummary]};
const currentEpisode={...episodeSummary,scenes:[{id:'scene-1',position:1,location:'天台',time_of_day:'night',summary:'当前场景',continuity_state:{},estimated_duration_seconds:10,shots:[]}]};
const restoredEpisode={...restoredEpisodeSummary,scenes:[{id:'scene-1',position:1,location:'巷道',time_of_day:'night',summary:'审核前场景',continuity_state:{},estimated_duration_seconds:10,shots:[]}]};
const sourceVersion={id:'version-1',episode_id:'episode-1',version:1,label:'审核前',source:'manual',author:'林默',snapshot:{episode:restoredEpisodeSummary,scenes:restoredEpisode.scenes},restored_from_id:null,created_at:'2026-07-15T01:00:00Z'};
const currentVersion={...sourceVersion,id:'version-2',version:2,label:'当前版',author:'张伟',snapshot:{episode:episodeSummary,scenes:currentEpisode.scenes},created_at:'2026-07-15T01:30:00Z'};
const backupVersion={...currentVersion,id:'version-3',version:3,label:'恢复 V1 前自动备份',source:'checkpoint',author:'系统恢复',created_at:'2026-07-15T02:00:00Z'};
const restoredVersion={...sourceVersion,id:'version-4',version:4,label:'从 V1 恢复',source:'restore',author:'系统恢复',restored_from_id:'version-1',created_at:'2026-07-15T02:00:01Z'};

test('restores an episode snapshot, creates a backup, and reloads the workspace',async({page},testInfo)=>{
  let restored=false;
  let restoreRequests=0;
  let projectReadsAfterRestore=0;
  await page.route('**/api/projects',route=>route.fulfill({json:[project]}));
  await page.route('**/api/projects/project-1',route=>{
    if(restored)projectReadsAfterRestore+=1;
    return route.fulfill({json:restored?restoredProjectDetail:projectDetail});
  });
  await page.route('**/api/projects/project-1/volumes',route=>route.fulfill({json:[]}));
  await page.route('**/api/projects/project-1/storylines',route=>route.fulfill({json:[]}));
  await page.route('**/api/episodes/episode-1',route=>route.fulfill({json:restored?restoredEpisode:currentEpisode}));
  await page.route('**/api/episodes/episode-1/production-readiness',route=>route.fulfill({json:{episode_id:'episode-1',ready:false,totals:{shots:0,dialogue:0},ready_counts:{panels:0,approved:0,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}}));
  await page.route('**/api/episodes/episode-1/versions',route=>route.fulfill({json:restored?[restoredVersion,backupVersion,currentVersion,sourceVersion]:[currentVersion,sourceVersion]}));
  await page.route('**/api/episode-versions/version-1/restore',async route=>{
    expect(route.request().method()).toBe('POST');
    restoreRequests+=1;
    restored=true;
    await route.fulfill({status:201,json:restoredVersion});
  });

  await page.goto('/');
  await page.getByRole('button',{name:'版本历史'}).click();
  await expect(page.getByRole('heading',{name:'版本历史'})).toBeVisible();
  await expect(page.getByText('当前标题 · 比较不可变快照并恢复业务状态')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'对比基线'})).toHaveValue('version-1');
  await expect(page.getByRole('combobox',{name:'目标版本'})).toHaveValue('version-2');
  await expect(page.getByRole('heading',{name:'V1 审核前 → V2 当前版'})).toBeVisible();
  await expect(page.getByText('2 项变化')).toBeVisible();
  const dimensions=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.screenshot({path:testInfo.outputPath('version-history-diff.png'),fullPage:false});
  await page.getByRole('combobox',{name:'目标版本'}).selectOption('version-1');
  page.once('dialog',async dialog=>{
    expect(dialog.message()).toBe('恢复 V1“审核前”？当前状态会先自动备份。');
    await dialog.accept();
  });
  await page.getByRole('button',{name:'恢复所选快照'}).click();

  await expect(page.getByRole('status')).toHaveText('已恢复 V1，恢复前状态已自动备份。');
  await expect(page.getByText('审核前标题 · 比较不可变快照并恢复业务状态')).toBeVisible();
  await expect(page.getByRole('button',{name:/V4 从 V1 恢复/})).toBeVisible();
  await expect(page.getByRole('button',{name:/V3 恢复 V1 前自动备份/})).toBeVisible();
  expect(restoreRequests).toBe(1);
  expect(projectReadsAfterRestore).toBeGreaterThan(0);
});
