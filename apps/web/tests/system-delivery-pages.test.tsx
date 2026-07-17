import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ExportDelivery} from '../components/ExportDelivery';
import type {EpisodeDetail,ProjectDetail} from '../lib/types';

const systemMocks=vi.hoisted(()=>({
  listReleaseCandidates:vi.fn(),listDeliveryPackages:vi.fn(),createDeliveryPackage:vi.fn(),deliveryPackageDownloadUrl:vi.fn(),
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
    systemMocks.createDeliveryPackage.mockResolvedValue({id:'dp1',project_id:'p1',episode_id:'e1',release_candidate_id:'rc1',preset_name:'个人交付包',outputs:[],checks:{release_candidate_approved:true,render_complete:true,archive_created:true},status:'completed',artifact_path:'delivery/dp1.zip',created_at:'',updated_at:''});
    systemMocks.deliveryPackageDownloadUrl.mockReturnValue('/api/delivery-packages/dp1/download');
  });
  it('creates and exposes a downloadable package with only real outputs',async()=>{
    render(<ExportDelivery project={project} episode={episode}/>);
    expect(screen.getByRole('heading',{name:'导出与交付'})).toBeVisible();
    expect(screen.getByText('尚未创建交付任务')).toBeVisible();
    expect(screen.getByRole('checkbox',{name:'包含横屏成片'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'包含字幕'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'包含资产清单'})).toBeChecked();
    expect(screen.queryByRole('checkbox',{name:'包含竖屏成片'})).not.toBeInTheDocument();
    expect(screen.queryByText('无字幕母版')).not.toBeInTheDocument();
    expect(screen.queryByText('混音音轨')).not.toBeInTheDocument();
    const create=await screen.findByRole('button',{name:'生成交付包'});
    expect(create).toBeEnabled();
    await userEvent.click(create);
    expect(systemMocks.createDeliveryPackage).toHaveBeenCalledWith('e1',expect.objectContaining({
      release_candidate_id:'rc1',
      preset_name:'个人交付包',
      outputs:[
        expect.objectContaining({kind:'landscape_video',enabled:true}),
        expect.objectContaining({kind:'subtitles',enabled:true}),
        expect.objectContaining({kind:'asset_manifest',enabled:true}),
      ],
    }));
    expect(await screen.findByRole('link',{name:'下载交付包'})).toHaveAttribute('href','/api/delivery-packages/dp1/download');
  });
});
