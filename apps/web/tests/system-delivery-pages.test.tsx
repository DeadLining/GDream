import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ExportDelivery} from '../components/ExportDelivery';
import type {EpisodeDetail,ProjectDetail} from '../lib/types';

const systemMocks=vi.hoisted(()=>({
  listReleaseCandidates:vi.fn(),listDeliveryPackages:vi.fn(),createDeliveryPackage:vi.fn(),
}));
vi.mock('../lib/api',()=>systemMocks);

const project:ProjectDetail={id:'p1',title:'长安风云',logline:'雨夜中的失踪案',story_bible:'三卷悬疑结构',visual_style:'cinematic anime',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'',characters:[],episodes:[{id:'e1',project_id:'p1',title:'雨夜抉择',premise:'寻找失踪同伴',target_duration_seconds:480,status:'approved',created_at:'',updated_at:''}]};
const episode:EpisodeDetail={...project.episodes[0],scenes:[{id:'s1',position:1,location:'雨夜营地',time_of_day:'night',summary:'追踪',continuity_state:{},estimated_duration_seconds:30,shots:[]}]};

describe('system and delivery frontend pages',()=>{
  afterEach(cleanup);
  beforeEach(()=>{
    vi.clearAllMocks();
    systemMocks.listReleaseCandidates.mockResolvedValue([{id:'rc1',episode_id:'e1',version:'V5',render_path:'final.mp4',qc_snapshot:{},status:'approved',created_at:'',updated_at:''}]);
    systemMocks.listDeliveryPackages.mockResolvedValue([]);
    systemMocks.createDeliveryPackage.mockResolvedValue({id:'dp1',project_id:'p1',episode_id:'e1',release_candidate_id:'rc1',preset_name:'平台标准包',outputs:[],checks:{release_candidate_approved:true},status:'queued',artifact_path:'',created_at:'',updated_at:''});
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
