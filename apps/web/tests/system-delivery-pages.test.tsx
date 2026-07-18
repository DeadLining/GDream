import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ExportDelivery} from '../components/ExportDelivery';
import type {EpisodeDetail,ProjectDetail} from '../lib/types';

const systemMocks=vi.hoisted(()=>({
  listReleaseCandidates:vi.fn(),getReleaseGate:vi.fn(),listDeliveryPackages:vi.fn(),createDeliveryPackage:vi.fn(),deliveryPackageDownloadUrl:vi.fn(),
}));
vi.mock('../lib/api',()=>systemMocks);

const project:ProjectDetail={id:'p1',title:'长安风云',logline:'雨夜中的失踪案',story_bible:'三卷悬疑结构',visual_style:'cinematic anime',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'',characters:[],episodes:[{id:'e1',project_id:'p1',title:'雨夜抉择',premise:'寻找失踪同伴',target_duration_seconds:480,status:'approved',created_at:'',updated_at:''}]};
const episode:EpisodeDetail={...project.episodes[0],scenes:[{id:'s1',position:1,location:'雨夜营地',time_of_day:'night',summary:'追踪',continuity_state:{},estimated_duration_seconds:30,shots:[]}]};

describe('system and delivery frontend pages',()=>{
  afterEach(cleanup);
  beforeEach(()=>{
    vi.clearAllMocks();
    systemMocks.listReleaseCandidates.mockResolvedValue([{id:'rc1',episode_id:'e1',version:'V5',render_path:'final.mp4',qc_snapshot:{},status:'approved',created_at:'',updated_at:''}]);
    systemMocks.getReleaseGate.mockResolvedValue({ready:true,production_ready:true,production_blockers:{},open_critical_threads:[]});
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

  it('uses the latest approved candidate by natural version order',async()=>{
    systemMocks.listReleaseCandidates.mockResolvedValue([
      {id:'rc10',episode_id:'e1',version:'V10',render_path:'v10.mp4',qc_snapshot:{},status:'approved',created_at:'2026-07-17T10:00:00Z',updated_at:''},
      {id:'rc2',episode_id:'e1',version:'V2',render_path:'v2.mp4',qc_snapshot:{},status:'approved',created_at:'2026-07-16T10:00:00Z',updated_at:''},
    ]);
    render(<ExportDelivery project={project} episode={episode}/>);

    expect(await screen.findByText('V10 已审核通过')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'生成交付包'}));
    expect(systemMocks.createDeliveryPackage).toHaveBeenCalledWith('e1',expect.objectContaining({release_candidate_id:'rc10'}));
  });

  it('blocks delivery before submission when the approved render is stale',async()=>{
    systemMocks.getReleaseGate.mockResolvedValue({ready:false,production_ready:true,production_blockers:{stale_render:['rc1']},open_critical_threads:[]});

    render(<ExportDelivery project={project} episode={episode}/>);

    expect(await screen.findByRole('alert')).toHaveTextContent('V5 的成片已过期，请重新渲染并审核');
    expect(screen.getByRole('button',{name:'生成交付包'})).toBeDisabled();
    expect(systemMocks.getReleaseGate).toHaveBeenCalledWith('rc1');
    expect(systemMocks.createDeliveryPackage).not.toHaveBeenCalled();
  });

  it('shows the release candidate version for each historical package',async()=>{
    systemMocks.listReleaseCandidates.mockResolvedValue([
      {id:'rc1',episode_id:'e1',version:'V1',render_path:'v1.mp4',qc_snapshot:{},status:'published',created_at:'2026-07-16T10:00:00Z',updated_at:''},
      {id:'rc2',episode_id:'e1',version:'V2',render_path:'v2.mp4',qc_snapshot:{},status:'approved',created_at:'2026-07-17T10:00:00Z',updated_at:''},
    ]);
    systemMocks.listDeliveryPackages.mockResolvedValue([{id:'dp1',project_id:'p1',episode_id:'e1',release_candidate_id:'rc1',preset_name:'个人交付包',outputs:[],checks:{release_candidate_approved:true,render_complete:true,archive_created:true},status:'completed',artifact_path:'delivery/dp1.zip',created_at:'',updated_at:''}]);

    render(<ExportDelivery project={project} episode={episode}/>);

    expect(await screen.findByRole('button',{name:/个人交付包.*V1.*已完成/})).toBeVisible();
  });

  it('clears stale delivery state when switching episodes and loading fails',async()=>{
    const oldPackage={id:'dp-old',project_id:'p1',episode_id:'e1',release_candidate_id:'rc1',preset_name:'旧单集交付包',outputs:[],checks:{release_candidate_approved:true,render_complete:true,archive_created:true},status:'completed',artifact_path:'delivery/dp-old.zip',created_at:'',updated_at:''};
    systemMocks.listDeliveryPackages.mockImplementation((episodeId:string)=>episodeId==='e1'?Promise.resolve([oldPackage]):Promise.reject(new Error('交付服务不可用')));
    systemMocks.listReleaseCandidates.mockImplementation((episodeId:string)=>episodeId==='e1'?Promise.resolve([{id:'rc1',episode_id:'e1',version:'V5',render_path:'final.mp4',qc_snapshot:{},status:'approved',created_at:'',updated_at:''}]):Promise.resolve([]));
    const view=render(<ExportDelivery project={project} episode={episode}/>);
    expect(await screen.findByRole('button',{name:/旧单集交付包/})).toBeVisible();
    const nextEpisode:EpisodeDetail={...episode,id:'e2',title:'下一集'};

    view.rerender(<ExportDelivery project={project} episode={nextEpisode}/>);

    expect(await screen.findByRole('alert')).toHaveTextContent('交付服务不可用');
    expect(screen.queryAllByText('旧单集交付包')).toHaveLength(0);
    expect(screen.queryByRole('link',{name:'下载交付包'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'生成交付包'})).toBeDisabled();
  });

  it('explains failed packages without exposing a broken download',async()=>{
    systemMocks.listDeliveryPackages.mockResolvedValue([{id:'dp-failed',project_id:'p1',episode_id:'e1',release_candidate_id:'rc1',preset_name:'失败交付包',outputs:[],checks:{release_candidate_approved:true,render_complete:true,archive_created:false},status:'failed',artifact_path:'',created_at:'',updated_at:''}]);
    render(<ExportDelivery project={project} episode={episode}/>);

    expect(await screen.findByText('交付产物不存在或生成已中断，请重新生成交付包。')).toBeVisible();
    expect(screen.queryByRole('link',{name:'下载交付包'})).not.toBeInTheDocument();
  });
});
