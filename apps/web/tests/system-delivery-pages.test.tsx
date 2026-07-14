import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ExportDelivery} from '../components/ExportDelivery';
import {TeamPermissions} from '../components/TeamPermissions';
import type {EpisodeDetail,ProjectDetail} from '../lib/types';

const systemMocks=vi.hoisted(()=>({
  listProjectMembers:vi.fn(),updateProjectMember:vi.fn(),createProjectMember:vi.fn(),
  listReleaseCandidates:vi.fn(),listDeliveryPackages:vi.fn(),createDeliveryPackage:vi.fn(),
}));
vi.mock('../lib/api',()=>systemMocks);

const project:ProjectDetail={id:'p1',title:'长安风云',logline:'雨夜中的失踪案',story_bible:'三卷悬疑结构',visual_style:'cinematic anime',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'',characters:[],episodes:[{id:'e1',project_id:'p1',title:'雨夜抉择',premise:'寻找失踪同伴',target_duration_seconds:480,status:'approved',created_at:'',updated_at:''}]};
const episode:EpisodeDetail={...project.episodes[0],scenes:[{id:'s1',position:1,location:'雨夜营地',time_of_day:'night',summary:'追踪',continuity_state:{},estimated_duration_seconds:30,shots:[]}]};

describe('system and delivery frontend pages',()=>{
  afterEach(cleanup);
  beforeEach(()=>{
    vi.clearAllMocks();
    systemMocks.listProjectMembers.mockResolvedValue([{id:'m1',project_id:'p1',name:'陈舟',email:'chen@example.com',role:'storyboard_artist',scope:{episode_ids:['e1']},capabilities:{shots:['view','edit'],publish:[]},status:'active',created_at:'',updated_at:''}]);
    systemMocks.updateProjectMember.mockImplementation(async(_id:string,data:Record<string,unknown>)=>({...await systemMocks.listProjectMembers.mock.results[0]?.value?.then((items:any[])=>items[0]),...data}));
    systemMocks.createProjectMember.mockResolvedValue({id:'m2',project_id:'p1',name:'林默',email:'lin@example.com',role:'writer',scope:{episode_ids:['e1']},capabilities:{scripts:['view','edit']},status:'invited',created_at:'',updated_at:''});
    systemMocks.listReleaseCandidates.mockResolvedValue([{id:'rc1',episode_id:'e1',version:'V5',render_path:'final.mp4',qc_snapshot:{},status:'approved',created_at:'',updated_at:''}]);
    systemMocks.listDeliveryPackages.mockResolvedValue([]);
    systemMocks.createDeliveryPackage.mockResolvedValue({id:'dp1',project_id:'p1',episode_id:'e1',release_candidate_id:'rc1',preset_name:'平台标准包',outputs:[],checks:{release_candidate_approved:true},status:'queued',artifact_path:'',created_at:'',updated_at:''});
  });
  it('scopes team permissions down to volume and episode',async()=>{
    const onSave=vi.fn();
    render(<TeamPermissions project={project} onSave={onSave}/>);
    expect(screen.getByRole('heading',{name:'团队与权限'})).toBeVisible();
    expect((await screen.findAllByText('chen@example.com'))[0]).toBeVisible();
    expect(screen.getByText('作品 / 第一卷 / 第03集')).toBeVisible();
    const member=screen.getByRole('row',{name:/陈舟/});
    expect(within(member).getByText('分镜师')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'保存权限'}));
    expect(systemMocks.listProjectMembers).toHaveBeenCalledWith('p1');
    expect(systemMocks.updateProjectMember).toHaveBeenCalledWith('m1',expect.objectContaining({capabilities:expect.any(Object)}));
    expect(onSave).toHaveBeenCalledOnce();
    await userEvent.type(screen.getByRole('textbox',{name:'搜索成员'}),'不存在');
    expect(screen.getByText('没有匹配的成员。')).toBeVisible();
  });

  it('invites a member and persists edited capabilities',async()=>{
    render(<TeamPermissions project={project} onSave={vi.fn()}/>);
    await screen.findAllByText('chen@example.com');
    await userEvent.click(screen.getByRole('checkbox',{name:'镜头编辑'}));
    await userEvent.click(screen.getByRole('button',{name:'保存权限'}));
    expect(systemMocks.updateProjectMember).toHaveBeenCalledWith('m1',expect.objectContaining({capabilities:expect.objectContaining({shots:['view']})}));
    await userEvent.click(screen.getByRole('button',{name:'邀请成员'}));
    const dialog=screen.getByRole('dialog',{name:'邀请成员'});
    await userEvent.type(within(dialog).getByRole('textbox',{name:'成员姓名'}),'林默');
    await userEvent.type(within(dialog).getByRole('textbox',{name:'成员邮箱'}),'lin@example.com');
    await userEvent.selectOptions(within(dialog).getByRole('combobox',{name:'成员角色'}),'writer');
    await userEvent.click(within(dialog).getByRole('button',{name:'发送邀请'}));
    expect(systemMocks.createProjectMember).toHaveBeenCalledWith('p1',expect.objectContaining({name:'林默',email:'lin@example.com',role:'writer'}));
    expect((await screen.findAllByText('lin@example.com'))[0]).toBeVisible();
  });

  it('creates an honest delivery task without fabricating validation results',async()=>{
    render(<ExportDelivery project={project} episode={episode}/>);
    expect(screen.getByRole('heading',{name:'导出与交付'})).toBeVisible();
    expect(screen.queryByText('render complete')).not.toBeInTheDocument();
    expect(screen.queryByText('-16 LUFS，符合预设')).not.toBeInTheDocument();
    expect(screen.getByText('尚未创建交付任务')).toBeVisible();
    expect(screen.queryByRole('button',{name:'保存为预设'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'下载历史包'})).not.toBeInTheDocument();
    const create=await screen.findByRole('button',{name:'创建交付任务记录'});
    expect(create).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox',{name:'包含竖屏视频'}));
    await userEvent.click(create);
    expect(systemMocks.createDeliveryPackage).toHaveBeenCalledWith('e1',expect.objectContaining({release_candidate_id:'rc1',outputs:expect.arrayContaining([expect.objectContaining({kind:'vertical_video',enabled:false})])}));
    expect(await screen.findByText('任务已排队，打包执行器尚未接入')).toBeVisible();
  });
});
