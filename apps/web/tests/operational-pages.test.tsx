import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {GlobalSearchOverlay} from '../components/GlobalSearchOverlay';
import {RecycleBin} from '../components/RecycleBin';
import {TaskCenter} from '../components/TaskCenter';
import {VersionHistory,serializeEpisodeVersionsCsv} from '../components/VersionHistory';
import {WorkspaceHome} from '../components/WorkspaceHome';
import type {EpisodeDetail,EpisodeVersion,Project,ProjectDetail,ProjectSearchResult} from '../lib/types';

const operationMocks=vi.hoisted(()=>({
  listProductionTasks:vi.fn(),updateProductionTask:vi.fn(),createProductionTask:vi.fn(),deleteProductionTask:vi.fn(),
  listEpisodeVersions:vi.fn(),createEpisodeVersion:vi.fn(),restoreEpisodeVersion:vi.fn(),
  listTrashItems:vi.fn(),restoreTrashItem:vi.fn(),permanentlyDeleteTrashItem:vi.fn(),
  getWorkspaceSummary:vi.fn(),searchProject:vi.fn(),previewProjectDeletion:vi.fn(),
}));
vi.mock('../lib/api',()=>operationMocks);

const projects:Project[]=[
  {id:'p1',title:'长安风云',logline:'雨夜中的失踪案',story_bible:'三卷悬疑结构',visual_style:'cinematic anime',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'2026-07-12T10:24:00Z'},
  {id:'p2',title:'星海奇旅',logline:'跨星系追踪',story_bible:'太空歌剧',visual_style:'space opera',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'2026-07-11T09:00:00Z'},
];
const project:ProjectDetail={...projects[0],characters:[{id:'c1',project_id:'p1',name:'林默',role:'主角',appearance_bible:'黑发少年',personality:'克制',continuity_rules:'左臂伤势必须连续',negative_constraints:'',voice_speaker:'',voice_instruction:'',created_at:'',updated_at:''}],episodes:[{id:'e1',project_id:'p1',title:'雨夜抉择',premise:'寻找失踪同伴',target_duration_seconds:480,status:'production',created_at:'',updated_at:''}]};
const episode:EpisodeDetail={...project.episodes[0],scenes:[{id:'s1',position:1,location:'珊瑚营地',time_of_day:'night',summary:'雨夜追踪',continuity_state:{},estimated_duration_seconds:30,shots:[{id:'shot-1',position:1,shot_type:'wide',duration_seconds:3,composition:'林默进入营地',camera_motion:'push_in',character_state:{injury:'左臂擦伤'},image_prompt:'rain camp',negative_prompt:'',active_panel_asset_id:null,review_status:'draft',render_status:'pending',dialogue:[]}]}]};

describe('operational frontend pages',()=>{
  afterEach(cleanup);
  beforeEach(()=>{
    vi.clearAllMocks();
    operationMocks.listProductionTasks.mockResolvedValue([{id:'t1',project_id:'p1',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',review_thread_id:null,title:'补齐场景04环境音',description:'完成环境音设计',priority:'medium',status:'in_progress',due_at:'2026-07-14T12:00:00Z',checklist:[{label:'收集素材',done:true},{label:'提交审核',done:false}],created_at:'',updated_at:''}]);
    operationMocks.updateProductionTask.mockImplementation(async(_id:string,data:Record<string,unknown>)=>({...await operationMocks.listProductionTasks.mock.results[0]?.value?.then((items:any[])=>items[0]),...data}));
    operationMocks.createProductionTask.mockResolvedValue({id:'t2',project_id:'p1',episode_id:'e1',scene_id:null,shot_id:null,review_thread_id:null,title:'审核镜头连续性',description:'检查角色状态',priority:'high',status:'todo',due_at:null,checklist:[],created_at:'',updated_at:''});
    operationMocks.listEpisodeVersions.mockResolvedValue([
      {id:'v2',episode_id:'e1',version:2,label:'当前版',source:'manual',author:'林默',snapshot:{episode:{id:'e1',project_id:'p1',title:'雨夜抉择·修订',premise:'寻找失踪同伴',target_duration_seconds:480,status:'production'},scenes:[{id:'s1',position:1,location:'天台',time_of_day:'night',summary:'雨夜追踪',continuity_state:{},estimated_duration_seconds:30,shots:[]}]},restored_from_id:null,created_at:''},
      {id:'v1',episode_id:'e1',version:1,label:'审核前',source:'manual',author:'张伟',snapshot:{episode:{id:'e1',project_id:'p1',title:'雨夜抉择',premise:'寻找失踪同伴',target_duration_seconds:480,status:'planned'},scenes:[{id:'s1',position:1,location:'珊瑚营地',time_of_day:'night',summary:'雨夜追踪',continuity_state:{},estimated_duration_seconds:30,shots:[]}]},restored_from_id:null,created_at:''},
    ]);
    operationMocks.createEpisodeVersion.mockResolvedValue({id:'v2',episode_id:'e1',version:2,label:'当前版',source:'manual',author:'林默',snapshot:{},restored_from_id:null,created_at:''});
    operationMocks.restoreEpisodeVersion.mockResolvedValue({id:'v3',episode_id:'e1',version:3,label:'从 V1 恢复',source:'restore',author:'林默',snapshot:{},restored_from_id:'v1',created_at:''});
    operationMocks.listTrashItems.mockResolvedValue([{id:'trash-1',project_id:'p1',resource_type:'asset_variant_state',resource_id:'state-1',name:'左臂擦伤',original_location:['作品主设定','第03集雨夜造型','左臂擦伤'],lineage:['作品主设定','第03集雨夜造型','左臂擦伤'],deleted_by:'林默',deleted_at:'2026-07-13T08:00:00Z',expires_at:'2026-08-12T08:00:00Z',reference_count:14,can_permanently_delete:false}]);
    operationMocks.restoreTrashItem.mockResolvedValue({restored:true,resource_type:'asset_variant_state',resource_id:'state-1'});
    operationMocks.getWorkspaceSummary.mockResolvedValue({active_project_count:2,active_task_count:4,pending_review_count:3,updated_today_count:1,projects:[{project_id:'p1',title:'长安风云',logline:'雨夜中的失踪案',volume_count:3,episode_count:1,scene_count:1,shot_count:1,open_task_count:3,pending_review_count:1,completion_percent:62,current_stage:'分镜制作中',latest_task_titles:['审核分镜草稿','生成角色状态参考','补齐环境音'],updated_at:'2026-07-12T10:24:00Z'}]});
    operationMocks.previewProjectDeletion.mockResolvedValue({project_id:'p1',title:'长安风云',deleted:{episodes:1,characters:1,assets:8}});
    operationMocks.searchProject.mockResolvedValue({query:'左臂',results:[{kind:'asset_state',id:'state-1',title:'左臂擦伤',subtitle:'雨夜造型',hierarchy:['作品主设定','集级变体','左臂擦伤'],status:'',project_id:'p1',episode_id:'e1',scene_id:null,shot_id:null,character_id:'c1',variant_id:'v1',state_id:'state-1',library_asset_id:null,library_asset_kind:null,reference_count:14},{kind:'library_asset',id:'library-1',title:'左臂护具',subtitle:'雨夜行动使用',hierarchy:['长安风云','道具资产','左臂护具'],status:'ready',project_id:'p1',episode_id:null,scene_id:null,shot_id:null,character_id:null,variant_id:null,state_id:null,library_asset_id:'library-1',library_asset_kind:'prop',reference_count:1},{kind:'shot',id:'shot-1',title:'镜头 01',subtitle:'林默进入营地',hierarchy:['长安风云','雨夜抉择','珊瑚营地','镜头 01'],status:'draft',project_id:'p1',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',character_id:null,variant_id:null,state_id:null,library_asset_id:null,library_asset_kind:null,reference_count:0}]});
  });

  it('renders the cross-project workspace and opens a selected project',async()=>{
    const onOpenProject=vi.fn();
    render(<WorkspaceHome projects={projects} selectedProject={project} onOpenProject={onOpenProject} onCreateProject={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.getByRole('heading',{name:'工作台'})).toBeVisible();
    expect(screen.getByText('作品总数')).toBeVisible();
    expect(await screen.findByText('3卷 · 1集 · 1场景 · 1镜头')).toBeVisible();
    expect(operationMocks.getWorkspaceSummary).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button',{name:'进入单集制作'}));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('labels workspace metrics with the backend counts they actually represent',async()=>{
    render(<WorkspaceHome projects={projects} selectedProject={project} onOpenProject={vi.fn()} onCreateProject={vi.fn()} onNavigate={vi.fn()}/>);

    expect(await screen.findByText('作品总数')).toBeVisible();
    expect(screen.getByText('未通过镜头')).toBeVisible();
    expect(screen.getByText('未完成任务')).toBeVisible();
    expect(screen.getByText('今日更新')).toBeVisible();
    expect(screen.queryByText('进行中作品')).not.toBeInTheDocument();
    expect(screen.queryByText('今日待审核')).not.toBeInTheDocument();
    expect(screen.queryByText('生成任务')).not.toBeInTheDocument();
  });

  it('shows task counts instead of inventing an overall project status',async()=>{
    render(<WorkspaceHome projects={projects} selectedProject={project} onOpenProject={vi.fn()} onCreateProject={vi.fn()} onNavigate={vi.fn()}/>);

    const row=await screen.findByRole('row',{name:/长安风云/});
    expect(within(row).getByText('3 个未完成')).toBeVisible();
    expect(screen.getByRole('columnheader',{name:'任务'})).toBeVisible();
    expect(screen.queryByRole('columnheader',{name:'状态'})).not.toBeInTheDocument();
    expect(within(row).queryByText('制作中')).not.toBeInTheDocument();
    expect(within(row).queryByText('待安排')).not.toBeInTheDocument();
  });

  it('separates recent projects from all personal projects without fake controls',async()=>{
    const manyProjects:Project[]=Array.from({length:6},(_,index)=>({...projects[0],id:`project-${index+1}`,title:`个人作品 ${index+1}`,updated_at:`2026-07-${String(17-index).padStart(2,'0')}T10:00:00Z`}));
    render(<WorkspaceHome projects={manyProjects} selectedProject={null} onOpenProject={vi.fn()} onCreateProject={vi.fn()} onNavigate={vi.fn()}/>);

    expect(screen.getByRole('button',{name:'最近访问'})).toHaveAttribute('aria-current','page');
    expect(screen.queryByText('个人作品 6')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'已归档'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/更多操作/})).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button',{name:'我的作品'}));

    expect(screen.getByRole('heading',{name:'我的作品'})).toBeVisible();
    expect(screen.getByText('个人作品 6')).toBeVisible();
    expect(screen.getByRole('button',{name:'我的作品'})).toHaveAttribute('aria-current','page');
  });

  it('previews project impact before permanently deleting a personal project',async()=>{
    const onDeleteProject=vi.fn().mockResolvedValue({project_id:'p1',title:'长安风云',deleted:{episodes:1,characters:1,assets:8},deleted_project_id:'p1',cleanup_warnings:[]});
    render(<WorkspaceHome projects={projects} selectedProject={project} onOpenProject={vi.fn()} onCreateProject={vi.fn()} onDeleteProject={onDeleteProject} onNavigate={vi.fn()}/>);

    await userEvent.click(screen.getByRole('button',{name:'删除作品'}));

    expect(await screen.findByRole('dialog',{name:'永久删除作品'})).toBeVisible();
    expect(screen.getByText('1 个剧集')).toBeVisible();
    expect(screen.getByText('1 个角色')).toBeVisible();
    expect(screen.getByText('8 个媒体素材')).toBeVisible();
    expect(operationMocks.previewProjectDeletion).toHaveBeenCalledWith('p1');
    expect(onDeleteProject).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button',{name:'永久删除'}));

    expect(onDeleteProject).toHaveBeenCalledWith('p1');
  });

  it('searches across assets, shots, scripts, and review work',async()=>{
    const onClose=vi.fn();
    render(<GlobalSearchOverlay project={project} episode={episode} onClose={onClose} onOpenResult={vi.fn()}/>);
    expect(screen.getByRole('dialog',{name:'全局搜索'})).toBeVisible();
    const input=screen.getByRole('textbox',{name:'搜索作品内容'});
    await userEvent.clear(input);
    await userEvent.type(input,'左臂');
    expect(await screen.findByText('作品主设定 → 集级变体 → 左臂擦伤')).toBeVisible();
    expect(screen.getByText('左臂护具')).toBeVisible();
    expect(screen.getByText('镜头与画面')).toBeVisible();
    expect(operationMocks.searchProject).toHaveBeenCalledWith('p1','左臂');
    await userEvent.click(screen.getByRole('button',{name:'关闭全局搜索'}));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opens the task selected by a global search result',async()=>{
    operationMocks.listProductionTasks.mockResolvedValue([
      {id:'t1',project_id:'p1',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',review_thread_id:null,title:'补齐环境音',description:'环境音设计',priority:'medium',status:'in_progress',due_at:null,checklist:[],created_at:'',updated_at:''},
      {id:'t2',project_id:'p1',episode_id:null,scene_id:null,shot_id:null,review_thread_id:null,title:'整理交付清单',description:'核对文件',priority:'low',status:'todo',due_at:null,checklist:[],created_at:'',updated_at:''},
    ]);
    render(<TaskCenter project={project} episode={episode} initialTaskId="t2"/>);

    const inspector=await screen.findByRole('complementary');
    expect(within(inspector).getByRole('heading',{name:'整理交付清单'})).toBeVisible();
  });

  it('selects a search result before explicitly opening its destination',async()=>{
    const episodeResult:ProjectSearchResult={kind:'episode',id:'e1',title:'雨夜抉择',subtitle:'寻找失踪同伴',hierarchy:['长安风云','雨夜抉择'],status:'production',project_id:'p1',episode_id:'e1',scene_id:null,shot_id:null,character_id:null,variant_id:null,state_id:null,library_asset_id:null,library_asset_kind:null,reference_count:0};
    operationMocks.searchProject.mockResolvedValue({query:'雨夜',results:[episodeResult]});
    const onOpenResult=vi.fn();
    render(<GlobalSearchOverlay project={project} episode={episode} onClose={vi.fn()} onOpenResult={onOpenResult}/>);
    await userEvent.type(screen.getByRole('textbox',{name:'搜索作品内容'}),'雨夜');
    await userEvent.click(await screen.findByRole('button',{name:/雨夜抉择/}));
    expect(onOpenResult).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'打开剧集'}));
    expect(onOpenResult).toHaveBeenCalledWith(episodeResult);
  });

  it('supports arrow selection, Enter opening, and Escape closing',async()=>{
    const onClose=vi.fn();
    const onOpenResult=vi.fn();
    render(<GlobalSearchOverlay project={project} episode={episode} onClose={onClose} onOpenResult={onOpenResult}/>);
    const input=screen.getByRole('textbox',{name:'搜索作品内容'});
    await userEvent.type(input,'左臂');
    await screen.findByText('镜头与画面');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({kind:'shot',id:'shot-1'}));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('loads tasks from the API and persists completion',async()=>{
    render(<TaskCenter project={project} episode={episode}/>);
    expect(screen.getByRole('heading',{name:'任务中心'})).toBeVisible();
    expect((await screen.findAllByText('补齐场景04环境音'))[0]).toBeVisible();
    expect(screen.getByText('作品 → 卷/篇章 → 集 → 场景 → 镜头')).toBeVisible();
    expect(screen.getByText('关联视觉审阅')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'标记完成'}));
    expect(operationMocks.listProductionTasks).toHaveBeenCalledWith('p1');
    expect(operationMocks.updateProductionTask).toHaveBeenCalledWith('t1',{status:'completed'});
    await userEvent.type(screen.getByRole('textbox',{name:'搜索任务'}),'不存在');
    expect(screen.getByText('没有匹配的任务。')).toBeVisible();
  });

  it('creates a production task from the task center',async()=>{
    render(<TaskCenter project={project} episode={episode}/>);
    await screen.findAllByText('补齐场景04环境音');
    await userEvent.click(screen.getByRole('button',{name:'新建任务'}));
    const dialog=screen.getByRole('dialog',{name:'新建任务'});
    await userEvent.type(within(dialog).getByRole('textbox',{name:'任务标题'}),'审核镜头连续性');
    await userEvent.type(within(dialog).getByRole('textbox',{name:'任务说明'}),'检查角色状态');
    expect(within(dialog).queryByRole('textbox',{name:'执行人'})).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox',{name:'优先级'}),'high');
    await userEvent.selectOptions(within(dialog).getByRole('combobox',{name:'任务范围'}),'shot');
    await userEvent.type(within(dialog).getByLabelText('到期时间'),'2026-07-20T10:30');
    await userEvent.click(within(dialog).getByRole('button',{name:'创建任务'}));
    expect(operationMocks.createProductionTask).toHaveBeenCalledWith('p1',expect.objectContaining({title:'审核镜头连续性',priority:'high',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',due_at:expect.stringContaining('2026-07-20')}));
    expect((await screen.findAllByText('审核镜头连续性'))[0]).toBeVisible();
  });

  it('keeps task management personal and supports editing and deleting tasks',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<TaskCenter project={project} episode={episode}/>);
    expect((await screen.findAllByText('补齐场景04环境音'))[0]).toBeVisible();
    expect(screen.queryByRole('combobox',{name:'执行人'})).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button',{name:'编辑任务'}));
    const dialog=screen.getByRole('dialog',{name:'编辑任务'});
    await userEvent.clear(within(dialog).getByRole('textbox',{name:'任务标题'}));
    await userEvent.type(within(dialog).getByRole('textbox',{name:'任务标题'}),'补齐钟表铺环境音');
    await userEvent.selectOptions(within(dialog).getByRole('combobox',{name:'优先级'}),'high');
    await userEvent.click(within(dialog).getByRole('button',{name:'保存任务'}));
    expect(operationMocks.updateProductionTask).toHaveBeenCalledWith('t1',expect.objectContaining({title:'补齐钟表铺环境音',priority:'high'}));

    await userEvent.click(screen.getByRole('button',{name:'删除任务'}));
    expect(operationMocks.deleteProductionTask).toHaveBeenCalledWith('t1');
    expect(screen.queryByText('补齐钟表铺环境音')).not.toBeInTheDocument();
  });

  it('switches task views and applies status filters',async()=>{
    operationMocks.listProductionTasks.mockResolvedValue([
      {id:'t1',project_id:'p1',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',review_thread_id:null,title:'补齐场景04环境音',description:'完成环境音设计',priority:'medium',status:'in_progress',due_at:'2026-07-20T10:30:00Z',checklist:[],created_at:'',updated_at:''},
      {id:'t2',project_id:'p1',episode_id:null,scene_id:null,shot_id:null,review_thread_id:null,title:'整理项目交付清单',description:'核对交付格式',priority:'low',status:'todo',due_at:null,checklist:[],created_at:'',updated_at:''},
    ]);
    render(<TaskCenter project={project} episode={episode}/>);
    expect(await screen.findByText('整理项目交付清单')).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'任务状态筛选'}),'in_progress');
    expect(screen.getAllByText('补齐场景04环境音')[0]).toBeVisible();
    expect(screen.queryByText('整理项目交付清单')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'看板'}));
    expect(screen.getByRole('button',{name:'看板'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('heading',{name:'进行中'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'时间线'}));
    expect(screen.getByText('07/20')).toBeVisible();
  });

  it('updates task status and checklist and opens the linked production target',async()=>{
    const onOpenTarget=vi.fn();
    render(<TaskCenter project={project} episode={episode} onOpenTarget={onOpenTarget}/>);
    expect((await screen.findAllByText('补齐场景04环境音'))[0]).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'任务状态'}),'review');
    expect(operationMocks.updateProductionTask).toHaveBeenCalledWith('t1',{status:'review'});
    await userEvent.click(screen.getByRole('checkbox',{name:'提交审核'}));
    expect(operationMocks.updateProductionTask).toHaveBeenCalledWith('t1',{checklist:[{label:'收集素材',done:true},{label:'提交审核',done:true}]});
    await userEvent.click(screen.getByRole('button',{name:'打开关联镜头'}));
    expect(onOpenTarget).toHaveBeenCalledWith(expect.objectContaining({id:'t1',shot_id:'shot-1'}));
  });

  it('compares two saved snapshots and restores the selected target version',async()=>{
    const onRestored=vi.fn();
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<VersionHistory episode={episode} onRestored={onRestored}/>);
    expect(screen.getByRole('heading',{name:'版本历史'})).toBeVisible();
    expect((await screen.findAllByText('V2 当前版'))[0]).toBeVisible();
    expect(screen.getByRole('combobox',{name:'对比基线'})).toHaveValue('v1');
    expect(screen.getByRole('combobox',{name:'目标版本'})).toHaveValue('v2');
    expect(screen.getByRole('heading',{name:'V1 审核前 → V2 当前版'})).toBeVisible();
    expect(screen.getByText('2 项变化')).toBeVisible();
    expect(screen.getByText('雨夜抉择')).toBeVisible();
    expect(screen.getByText('雨夜抉择·修订')).toBeVisible();
    expect(screen.getByText('珊瑚营地')).toBeVisible();
    expect(screen.getByText('天台')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'恢复所选快照'}));
    expect(window.confirm).toHaveBeenCalledWith('恢复 V2“当前版”？当前状态会先自动备份。');
    expect(operationMocks.restoreEpisodeVersion).toHaveBeenCalledWith('v2');
    expect(onRestored).toHaveBeenCalledOnce();
    expect(screen.getByText('已恢复 V2，恢复前状态已自动备份。')).toBeVisible();
    expect(serializeEpisodeVersionsCsv(await operationMocks.listEpisodeVersions.mock.results[0].value)).toContain('V1');
    expect(serializeEpisodeVersionsCsv(await operationMocks.listEpisodeVersions.mock.results[0].value)).toContain('审核前');
  });

  it('creates the first manual episode snapshot from the empty version state',async()=>{
    operationMocks.listEpisodeVersions.mockResolvedValue([]);
    const created={id:'v1',episode_id:'e1',version:1,label:'导演确认版',source:'manual',author:'林默',snapshot:{episode:{id:'e1',project_id:'p1',title:'雨夜抉择',premise:'寻找失踪同伴',target_duration_seconds:480,status:'production'},scenes:[]},restored_from_id:null,created_at:'2026-07-17T08:00:00Z'};
    operationMocks.createEpisodeVersion.mockResolvedValue(created);
    render(<VersionHistory episode={episode}/>);
    expect(await screen.findByText('暂无版本记录。')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'保存当前版本'}));
    const dialog=screen.getByRole('dialog',{name:'保存当前版本'});
    await userEvent.type(within(dialog).getByRole('textbox',{name:'版本标签'}),'导演确认版');
    expect(within(dialog).queryByRole('textbox',{name:'创建者'})).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button',{name:'保存版本'}));
    expect(operationMocks.createEpisodeVersion).toHaveBeenCalledWith('e1',{label:'导演确认版',source:'manual'});
    expect((await screen.findAllByText('V1 导演确认版'))[0]).toBeVisible();
  });

  it('clears stale versions when switching episodes fails to load',async()=>{
    const secondEpisode={...episode,id:'e2',title:'第二集'};
    const view=render(<VersionHistory episode={episode}/>);
    expect((await screen.findAllByText('V2 当前版'))[0]).toBeVisible();
    operationMocks.listEpisodeVersions.mockRejectedValueOnce(new Error('版本服务不可用'));

    view.rerender(<VersionHistory episode={secondEpisode}/>);

    expect(await screen.findByRole('alert')).toHaveTextContent('版本服务不可用');
    expect(screen.queryByText('V2 当前版')).not.toBeInTheDocument();
  });

  it('exports personal version metadata without spreadsheet formulas',()=>{
    const dangerous:EpisodeVersion={id:'v-safe',episode_id:'e1',version:1,label:'=HYPERLINK("bad")',source:'manual',author:'旧作者',snapshot:{},restored_from_id:null,created_at:''};
    const csv=serializeEpisodeVersionsCsv([dangerous]);
    expect(csv).not.toContain('作者');
    expect(csv).not.toContain('"=HYPERLINK');
    expect(csv).toContain("'=HYPERLINK");
  });

  it('loads deleted lineage nodes, protects references, and restores them',async()=>{
    render(<RecycleBin project={project}/>);
    const row=await screen.findByRole('row',{name:/左臂擦伤/});
    expect(within(row).getByText('仍被 14 镜头引用')).toBeVisible();
    expect(within(row).getByRole('button',{name:'永久删除左臂擦伤'})).toBeDisabled();
    expect(screen.getAllByText('作品主设定 → 第03集雨夜造型 → 左臂擦伤')[0]).toBeVisible();
    await userEvent.click(within(row).getByRole('button',{name:'恢复左臂擦伤'}));
    expect(operationMocks.listTrashItems).toHaveBeenCalledWith('p1');
    expect(operationMocks.restoreTrashItem).toHaveBeenCalledWith('trash-1');
  });

  it('labels the recycle bin as asset-only instead of implying project recovery',async()=>{
    render(<RecycleBin project={project}/>);

    expect(screen.getByRole('button',{name:'资产回收站'})).toHaveAttribute('aria-current','page');
    expect(screen.getByRole('heading',{name:'资产回收站'})).toBeVisible();
    expect(screen.getByText('这里只保留角色资产变体与状态；作品和剧集永久删除后无法恢复。')).toBeVisible();
    expect(screen.queryByRole('button',{name:'回收站'})).not.toBeInTheDocument();
  });

  it('filters recycle items by content type without team actor controls',async()=>{
    operationMocks.listTrashItems.mockResolvedValue([
      {id:'trash-1',project_id:'p1',resource_type:'asset_variant_state',resource_id:'state-1',name:'左臂擦伤',original_location:['作品主设定','雨夜造型','左臂擦伤'],lineage:['作品主设定','雨夜造型','左臂擦伤'],deleted_by:'林默',deleted_at:'2026-07-13T08:00:00Z',expires_at:'2026-08-12T08:00:00Z',reference_count:0,can_permanently_delete:true},
      {id:'trash-2',project_id:'p1',resource_type:'asset_variant',resource_id:'variant-2',name:'白昼造型',original_location:['作品主设定','白昼造型'],lineage:['作品主设定','白昼造型'],deleted_by:'张伟',deleted_at:'2026-07-14T08:00:00Z',expires_at:'2026-08-13T08:00:00Z',reference_count:0,can_permanently_delete:true},
    ]);
    render(<RecycleBin project={project}/>);
    expect(await screen.findByText('白昼造型')).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'内容类型'}),'asset_variant_state');
    expect(screen.getByRole('row',{name:/左臂擦伤/})).toBeVisible();
    expect(screen.queryByText('白昼造型')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox',{name:'删除者'})).not.toBeInTheDocument();
    expect(screen.getByRole('table')).not.toHaveTextContent('林默');
  });

  it('clears stale recycle items when switching projects and loading fails',async()=>{
    operationMocks.listTrashItems
      .mockResolvedValueOnce([{id:'trash-old',project_id:'p1',resource_type:'asset_variant',resource_id:'variant-old',name:'旧作品造型',original_location:['旧作品造型'],lineage:['旧作品造型'],deleted_by:'本人',deleted_at:'2026-07-14T08:00:00Z',expires_at:'2026-08-13T08:00:00Z',reference_count:0,can_permanently_delete:true}])
      .mockRejectedValueOnce(new Error('回收站服务不可用'));
    const view=render(<RecycleBin project={project}/>);
    expect(await screen.findByRole('row',{name:/旧作品造型/})).toBeVisible();

    view.rerender(<RecycleBin project={{...project,id:'p2',title:'新作品'}}/>);

    expect(screen.queryByRole('row',{name:/旧作品造型/})).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('回收站服务不可用');
    expect(screen.queryByRole('row',{name:/旧作品造型/})).not.toBeInTheDocument();
  });

  it('locks every recycle action while one request is pending',async()=>{
    let finishRestore:(value:{restored:true;resource_type:'asset_variant';resource_id:string})=>void=()=>{};
    operationMocks.restoreTrashItem.mockReturnValue(new Promise(resolve=>{finishRestore=resolve;}));
    operationMocks.listTrashItems.mockResolvedValue([
      {id:'trash-1',project_id:'p1',resource_type:'asset_variant',resource_id:'variant-1',name:'雨夜造型',original_location:['雨夜造型'],lineage:['雨夜造型'],deleted_by:'本人',deleted_at:'2026-07-13T08:00:00Z',expires_at:'2026-08-12T08:00:00Z',reference_count:0,can_permanently_delete:true},
      {id:'trash-2',project_id:'p1',resource_type:'asset_variant',resource_id:'variant-2',name:'白昼造型',original_location:['白昼造型'],lineage:['白昼造型'],deleted_by:'本人',deleted_at:'2026-07-14T08:00:00Z',expires_at:'2026-08-13T08:00:00Z',reference_count:0,can_permanently_delete:true},
    ]);
    render(<RecycleBin project={project}/>);
    await userEvent.click(await screen.findByRole('button',{name:'恢复雨夜造型'}));

    expect(screen.getByRole('button',{name:'恢复白昼造型'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'永久删除白昼造型'})).toBeDisabled();
    finishRestore({restored:true,resource_type:'asset_variant',resource_id:'variant-1'});
  });

  it('marks expired recycle items and disables restoration',async()=>{
    operationMocks.listTrashItems.mockResolvedValue([{id:'trash-expired',project_id:'p1',resource_type:'asset_variant',resource_id:'variant-expired',name:'过期造型',original_location:['过期造型'],lineage:['过期造型'],deleted_by:'本人',deleted_at:'2026-05-01T08:00:00Z',expires_at:'2026-05-31T08:00:00Z',reference_count:0,can_permanently_delete:true}]);
    render(<RecycleBin project={project}/>);
    const row=await screen.findByRole('row',{name:/过期造型/});
    expect(within(row).getByText('已过期')).toBeVisible();
    expect(within(row).getByRole('button',{name:'恢复过期造型'})).toBeDisabled();
  });

  it('requires confirmation before permanently deleting a recycle item',async()=>{
    operationMocks.listTrashItems.mockResolvedValue([{id:'trash-2',project_id:'p1',resource_type:'asset_variant',resource_id:'variant-2',name:'白昼造型',original_location:['作品主设定','白昼造型'],lineage:['作品主设定','白昼造型'],deleted_by:'张伟',deleted_at:'2026-07-14T08:00:00Z',expires_at:'2026-08-13T08:00:00Z',reference_count:0,can_permanently_delete:true}]);
    vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RecycleBin project={project}/>);
    const purge=await screen.findByRole('button',{name:'永久删除白昼造型'});
    await userEvent.click(purge);
    expect(operationMocks.permanentlyDeleteTrashItem).not.toHaveBeenCalled();
    await userEvent.click(purge);
    expect(window.confirm).toHaveBeenCalledWith('永久删除“白昼造型”？此操作无法撤销。');
    expect(operationMocks.permanentlyDeleteTrashItem).toHaveBeenCalledWith('trash-2');
  });
});
