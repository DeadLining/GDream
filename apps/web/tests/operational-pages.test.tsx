import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {GlobalSearchOverlay} from '../components/GlobalSearchOverlay';
import {RecycleBin} from '../components/RecycleBin';
import {TaskCenter} from '../components/TaskCenter';
import {VersionHistory,serializeEpisodeVersionsCsv} from '../components/VersionHistory';
import {WorkspaceHome} from '../components/WorkspaceHome';
import type {EpisodeDetail,Project,ProjectDetail} from '../lib/types';

const operationMocks=vi.hoisted(()=>({
  listProductionTasks:vi.fn(),updateProductionTask:vi.fn(),createProductionTask:vi.fn(),
  listEpisodeVersions:vi.fn(),createEpisodeVersion:vi.fn(),restoreEpisodeVersion:vi.fn(),
  listTrashItems:vi.fn(),restoreTrashItem:vi.fn(),permanentlyDeleteTrashItem:vi.fn(),
  getWorkspaceSummary:vi.fn(),searchProject:vi.fn(),
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
    operationMocks.listProductionTasks.mockResolvedValue([{id:'t1',project_id:'p1',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',review_thread_id:null,title:'补齐场景04环境音',description:'完成环境音设计',priority:'medium',status:'in_progress',assignee:'王磊',due_at:'2026-07-14T12:00:00Z',checklist:[{label:'收集素材',done:true},{label:'提交审核',done:false}],created_at:'',updated_at:''}]);
    operationMocks.updateProductionTask.mockImplementation(async(_id:string,data:Record<string,unknown>)=>({...await operationMocks.listProductionTasks.mock.results[0]?.value?.then((items:any[])=>items[0]),...data}));
    operationMocks.createProductionTask.mockResolvedValue({id:'t2',project_id:'p1',episode_id:'e1',scene_id:null,shot_id:null,review_thread_id:null,title:'审核镜头连续性',description:'检查角色状态',priority:'high',status:'todo',assignee:'张伟',due_at:null,checklist:[],created_at:'',updated_at:''});
    operationMocks.listEpisodeVersions.mockResolvedValue([{id:'v1',episode_id:'e1',version:1,label:'审核前',source:'manual',author:'张伟',snapshot:{episode:{title:'雨夜抉择'}},restored_from_id:null,created_at:''}]);
    operationMocks.createEpisodeVersion.mockResolvedValue({id:'v2',episode_id:'e1',version:2,label:'当前版',source:'manual',author:'林默',snapshot:{},restored_from_id:null,created_at:''});
    operationMocks.restoreEpisodeVersion.mockResolvedValue({id:'v3',episode_id:'e1',version:3,label:'从 V1 恢复',source:'restore',author:'林默',snapshot:{},restored_from_id:'v1',created_at:''});
    operationMocks.listTrashItems.mockResolvedValue([{id:'trash-1',project_id:'p1',resource_type:'asset_variant_state',resource_id:'state-1',name:'左臂擦伤',original_location:['作品主设定','第03集雨夜造型','左臂擦伤'],lineage:['作品主设定','第03集雨夜造型','左臂擦伤'],deleted_by:'林默',deleted_at:'2026-07-13T08:00:00Z',expires_at:'2026-08-12T08:00:00Z',reference_count:14,can_permanently_delete:false}]);
    operationMocks.restoreTrashItem.mockResolvedValue({restored:true,resource_type:'asset_variant_state',resource_id:'state-1'});
    operationMocks.getWorkspaceSummary.mockResolvedValue({active_project_count:2,active_task_count:4,pending_review_count:3,updated_today_count:1,projects:[{project_id:'p1',title:'长安风云',logline:'雨夜中的失踪案',volume_count:3,episode_count:1,scene_count:1,shot_count:1,open_task_count:3,pending_review_count:1,completion_percent:62,current_stage:'分镜制作中',latest_task_titles:['审核分镜草稿','生成角色状态参考','补齐环境音'],updated_at:'2026-07-12T10:24:00Z'}]});
    operationMocks.searchProject.mockResolvedValue({query:'左臂',results:[{kind:'asset_state',id:'state-1',title:'左臂擦伤',subtitle:'雨夜造型',hierarchy:['作品主设定','集级变体','左臂擦伤'],status:'',project_id:'p1',episode_id:'e1',scene_id:null,shot_id:null,character_id:'c1',variant_id:'v1',state_id:'state-1',reference_count:14},{kind:'shot',id:'shot-1',title:'镜头 01',subtitle:'林默进入营地',hierarchy:['长安风云','雨夜抉择','珊瑚营地','镜头 01'],status:'draft',project_id:'p1',episode_id:'e1',scene_id:'s1',shot_id:'shot-1',character_id:null,variant_id:null,state_id:null,reference_count:0}]});
  });

  it('renders the cross-project workspace and opens a selected project',async()=>{
    const onOpenProject=vi.fn();
    render(<WorkspaceHome projects={projects} selectedProject={project} onOpenProject={onOpenProject} onCreateProject={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.getByRole('heading',{name:'工作台'})).toBeVisible();
    expect(screen.getByText('进行中作品')).toBeVisible();
    expect(await screen.findByText('3卷 · 1集 · 1场景 · 1镜头')).toBeVisible();
    expect(operationMocks.getWorkspaceSummary).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button',{name:'进入单集制作'}));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('searches across assets, shots, scripts, and review work',async()=>{
    const onClose=vi.fn();
    render(<GlobalSearchOverlay project={project} episode={episode} onClose={onClose} onOpenAsset={vi.fn()} onOpenShot={vi.fn()}/>);
    expect(screen.getByRole('dialog',{name:'全局搜索'})).toBeVisible();
    const input=screen.getByRole('textbox',{name:'搜索作品内容'});
    await userEvent.clear(input);
    await userEvent.type(input,'左臂');
    expect(await screen.findByText('作品主设定 → 集级变体 → 左臂擦伤')).toBeVisible();
    expect(screen.getByText('镜头与画面')).toBeVisible();
    expect(operationMocks.searchProject).toHaveBeenCalledWith('p1','左臂');
    await userEvent.click(screen.getByRole('button',{name:'关闭全局搜索'}));
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
    await userEvent.type(within(dialog).getByRole('textbox',{name:'执行人'}),'张伟');
    await userEvent.selectOptions(within(dialog).getByRole('combobox',{name:'优先级'}),'high');
    await userEvent.click(within(dialog).getByRole('button',{name:'创建任务'}));
    expect(operationMocks.createProductionTask).toHaveBeenCalledWith('p1',expect.objectContaining({title:'审核镜头连续性',priority:'high',episode_id:'e1'}));
    expect((await screen.findAllByText('审核镜头连续性'))[0]).toBeVisible();
  });

  it('loads version snapshots without inventing a comparison',async()=>{
    const onRestored=vi.fn();
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<VersionHistory episode={episode} onRestored={onRestored}/>);
    expect(screen.getByRole('heading',{name:'版本历史'})).toBeVisible();
    expect((await screen.findAllByText('V1 审核前'))[0]).toBeVisible();
    expect(screen.queryByText('雨夜造型 → 左臂擦伤')).not.toBeInTheDocument();
    expect(screen.queryByText('雨夜造型 → 左臂包扎')).not.toBeInTheDocument();
    expect(screen.getByText('当前仅保存完整快照，尚未生成结构化版本差异。')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'恢复所选快照'}));
    expect(window.confirm).toHaveBeenCalledWith('恢复 V1“审核前”？当前状态会先自动备份。');
    expect(operationMocks.restoreEpisodeVersion).toHaveBeenCalledWith('v1');
    expect(onRestored).toHaveBeenCalledOnce();
    expect(screen.getByText('已恢复 V1，恢复前状态已自动备份。')).toBeVisible();
    expect(serializeEpisodeVersionsCsv(await operationMocks.listEpisodeVersions.mock.results[0].value)).toContain('V1');
    expect(serializeEpisodeVersionsCsv(await operationMocks.listEpisodeVersions.mock.results[0].value)).toContain('审核前');
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
});
