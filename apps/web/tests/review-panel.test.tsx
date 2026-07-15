import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ReviewPanel} from '../components/ReviewPanel';
import type {EpisodeDetail, ProductionReadiness} from '../lib/types';

const mocks=vi.hoisted(()=>({threads:vi.fn(),createThread:vi.fn(),message:vi.fn(),patch:vi.fn(),updateShot:vi.fn(),getAsset:vi.fn(),startRender:vi.fn(),candidate:vi.fn(),candidates:vi.fn(),gate:vi.fn(),approve:vi.fn(),publish:vi.fn(),poll:vi.fn()}));
vi.mock('../lib/api',()=>({listReviewThreads:mocks.threads,createReviewThread:mocks.createThread,createReviewMessage:mocks.message,updateReviewThread:mocks.patch,updateShot:mocks.updateShot,getAsset:mocks.getAsset,startRender:mocks.startRender,createReleaseCandidate:mocks.candidate,listReleaseCandidates:mocks.candidates,getReleaseGate:mocks.gate,approveReleaseCandidate:mocks.approve,publishReleaseCandidate:mocks.publish,mediaUrl:(path:string)=>path}));
vi.mock('../lib/jobs',()=>({pollJob:mocks.poll}));

const episode: EpisodeDetail = {
  id: 'episode-1', project_id: 'project-1', title: '失窃的雨夜', premise: '寻找芯片',
  target_duration_seconds: 60, status: 'planned', created_at: '', updated_at: '',
  scenes: [{
    id: 'scene-1', position: 1, location: '雨夜巷道', time_of_day: 'night', summary: '发现芯片',
    continuity_state: {}, estimated_duration_seconds: 10,
    shots: [
      {id: 'shot-1', position: 1, shot_type: 'wide', duration_seconds: 4, composition: '进入巷道', camera_motion: 'push_in', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: 'asset-1', review_status: 'approved', render_status: 'completed', dialogue: []},
      {id: 'shot-2', position: 2, shot_type: 'close_up', duration_seconds: 3, composition: '拾起芯片', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: null, review_status: 'draft', render_status: 'pending', dialogue: []},
      {id: 'shot-3', position: 3, shot_type: 'medium', duration_seconds: 3, composition: '观察芯片', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: 'asset-3', review_status: 'draft', render_status: 'completed', dialogue: []},
    ],
  }],
};

const readiness: ProductionReadiness = {
  episode_id: 'episode-1', ready: false,
  totals: {shots: 3, dialogue: 0}, ready_counts: {panels: 2, approved: 1, speech: 0},
  blockers: {missing_panels: ['shot-2'], unapproved_shots: ['shot-2', 'shot-3'], missing_speech: []},
};

describe('ReviewPanel', () => {
  beforeEach(()=>{mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});mocks.candidates.mockResolvedValue([]);});
  afterEach(()=>{cleanup();vi.clearAllMocks();});

  it('derives one row per blocker shot and deduplicates blocker labels', () => {
    mocks.threads.mockResolvedValue([]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(screen.getByRole('heading', {name: '审核队列'})).toBeVisible();
    const comments = within(screen.getByLabelText('待处理评论'));
    expect(comments.getAllByRole('button')).toHaveLength(2);
    expect(comments.getByRole('button', {name: /镜头 2/})).toHaveTextContent('缺少画面');
    expect(comments.getByRole('button', {name: /镜头 2/})).toHaveTextContent('待审核');
    expect(comments.getByRole('button', {name: /镜头 3/})).toHaveTextContent('待审核');
    expect(comments.queryByRole('button', {name: /镜头 1/})).not.toBeInTheDocument();
  });

  it('paginates the review queue so the workspace stays on one screen', async () => {
    const threads=Array.from({length:7},(_,index)=>({id:`review-${index+1}`,episode_id:'episode-1',shot_id:'shot-1',timecode_seconds:index,severity:'major' as const,title:`审阅问题 ${index+1}`,status:'open' as const,created_at:'',updated_at:'',messages:[]}));
    mocks.threads.mockResolvedValue(threads);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={vi.fn()}/>);

    const queue=within(screen.getByLabelText('待处理评论'));
    expect(await queue.findByRole('button',{name:'审阅问题 1 镜头评论'})).toBeVisible();
    expect(queue.queryByRole('button',{name:'审阅问题 5 镜头评论'})).not.toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeVisible();

    await userEvent.click(screen.getByRole('button',{name:'下一页评论'}));
    expect(await queue.findByRole('button',{name:'审阅问题 5 镜头评论'})).toBeVisible();
    expect(queue.queryByRole('button',{name:'审阅问题 1 镜头评论'})).not.toBeInTheDocument();
  });

  it('shows time-linked review and blocks publishing on critical issues', () => {
    mocks.threads.mockResolvedValue([]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(screen.getByRole('region', {name: '审阅播放器'})).toBeVisible();
    expect(screen.getByRole('region', {name: '多轨时间线'})).toBeVisible();
    expect(screen.getByText('连续性检查')).toBeVisible();
    expect(screen.getByRole('button', {name: '批准并登记'})).toBeDisabled();
  });

  it('uses compact header groups and a bounded preview-media hook', async () => {
    mocks.threads.mockResolvedValue([]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    const heading=screen.getByRole('heading',{name:'审核队列'});
    expect(heading.parentElement).toHaveClass('review-header-title');
    expect(heading.parentElement?.parentElement).toHaveClass('review-header-copy');
    expect(await screen.findByRole('img',{name:'进入巷道'})).toHaveClass('review-player-media');
  });

  it('shows honest QC availability and derives the next candidate version', async () => {
    mocks.threads.mockResolvedValue([]);
    mocks.candidates.mockResolvedValue([{id:'old-release',episode_id:'episode-1',version:'V2',render_path:'old.mp4',qc_snapshot:{},status:'draft',created_at:'',updated_at:''}]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(await screen.findByDisplayValue('V3 · 下一终审候选')).toBeVisible();
    expect(screen.getByText('黑帧检查').parentElement).toHaveTextContent('待终审渲染');
    expect(screen.getByText('音频峰值').parentElement).toHaveTextContent('尚无检测器');
    expect(screen.getByText('片尾信息').parentElement).toHaveTextContent('尚无检测器');
    expect(screen.queryByText('终审版本 V4')).not.toBeInTheDocument();
  });

  it('routes a blocker row to the existing shot selection callback', async () => {
    mocks.threads.mockResolvedValue([]);
    const onSelectShot = vi.fn();
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={onSelectShot} />);

    await userEvent.click(within(screen.getByLabelText('待处理评论')).getByRole('button', {name: /镜头 2/}));

    expect(onSelectShot).toHaveBeenCalledWith('shot-2');
  });

  it('loads persisted review threads, sends a message, and resolves the selected issue', async()=>{
    const thread={id:'review-1',episode_id:'episode-1',shot_id:'shot-1',timecode_seconds:2.5,severity:'critical' as const,title:'角色脸型漂移',status:'open' as const,created_at:'',updated_at:'',messages:[]};
    mocks.threads.mockResolvedValue([thread]);
    mocks.message.mockResolvedValue({id:'message-1',thread_id:'review-1',author_kind:'user',content:'恢复主设定脸型',created_at:''});
    mocks.patch.mockResolvedValue({...thread,status:'resolved'});
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={vi.fn()}/>);

    expect(await screen.findByRole('button',{name:'角色脸型漂移 镜头评论'})).toBeVisible();
    await userEvent.type(screen.getByLabelText('添加审阅评论'),'恢复主设定脸型');
    await userEvent.click(screen.getByRole('button',{name:'发送评论'}));
    await waitFor(()=>expect(mocks.message).toHaveBeenCalledWith('review-1',{author_kind:'user',content:'恢复主设定脸型'}));
    await userEvent.click(screen.getByRole('button',{name:'解决角色脸型漂移'}));
    await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith('review-1',{status:'resolved'}));
  });

  it('creates a time-linked review thread and reopens a resolved thread', async()=>{
    const resolved={id:'review-resolved',episode_id:'episode-1',shot_id:'shot-1',timecode_seconds:1.5,severity:'minor' as const,title:'字幕位置',status:'resolved' as const,created_at:'',updated_at:'',messages:[]};
    const created={id:'review-new',episode_id:'episode-1',shot_id:'shot-2',timecode_seconds:3,severity:'major' as const,title:'芯片反光过强',status:'open' as const,created_at:'',updated_at:'',messages:[]};
    mocks.threads.mockResolvedValue([resolved]);
    mocks.createThread.mockResolvedValue(created);
    mocks.patch.mockResolvedValue({...resolved,status:'open'});
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={vi.fn()}/>);

    await userEvent.click(screen.getByRole('button',{name:'新建终审评论'}));
    await userEvent.type(screen.getByRole('textbox',{name:'评论标题'}),'芯片反光过强');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'严重级别'}),'major');
    await userEvent.clear(screen.getByRole('spinbutton',{name:'时间码秒数'}));
    await userEvent.type(screen.getByRole('spinbutton',{name:'时间码秒数'}),'3');
    await userEvent.click(screen.getByRole('button',{name:'保存评论'}));
    await waitFor(()=>expect(mocks.createThread).toHaveBeenCalledWith('episode-1',{shot_id:'shot-2',timecode_seconds:3,severity:'major',title:'芯片反光过强'}));

    await userEvent.click(screen.getByRole('button',{name:'已解决'}));
    expect(await screen.findByRole('button',{name:'字幕位置 镜头评论'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'重开字幕位置'}));
    await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith('review-resolved',{status:'open'}));
  });

  it('uses transport, timeline filters, comment pins, and approves the selected shot', async () => {
    mocks.threads.mockResolvedValue([{id:'review-1',episode_id:'episode-1',shot_id:'shot-3',timecode_seconds:1.5,severity:'major',title:'动作节奏',status:'open',created_at:'',updated_at:'',messages:[]}]);
    mocks.updateShot.mockResolvedValue({...episode.scenes[0].shots[2],review_status:'approved'});
    const onSelectShot = vi.fn();
    const onEpisodeChanged = vi.fn();
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={onSelectShot} onEpisodeChanged={onEpisodeChanged}/>);

    await userEvent.click(screen.getByRole('button',{name:'下一镜头'}));
    expect(onSelectShot).toHaveBeenCalledWith('shot-3');
    await userEvent.click(screen.getByRole('button',{name:'上一镜头'}));
    expect(onSelectShot).toHaveBeenCalledWith('shot-2');

    await userEvent.click(screen.getByRole('button',{name:'对白轨道'}));
    expect(screen.queryByText('字幕',{selector:'label'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'显示全部轨道'}));
    expect(screen.getByText('字幕',{selector:'label'})).toBeVisible();
    await userEvent.click(within(screen.getByLabelText('多轨时间线')).getByRole('button',{name:'镜头 3'}));

    await userEvent.click(await screen.findByRole('button',{name:'画面评论 动作节奏'}));
    expect(screen.getByRole('button',{name:'动作节奏 镜头评论'}).closest('article')).toHaveClass('active');

    await userEvent.click(screen.getByRole('button',{name:'通过当前镜头审核'}));
    await waitFor(() => expect(mocks.updateShot).toHaveBeenCalledWith('shot-3',{review_status:'approved'}));
    expect(onEpisodeChanged).toHaveBeenCalled();
  });

  it('controls real video playback and mute state', async () => {
    mocks.threads.mockResolvedValue([]);
    mocks.getAsset.mockResolvedValue({id:'video-1',media_url:'/media/shot.mp4'});
    const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
    const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
    const videoEpisode:EpisodeDetail={...episode,scenes:[{...episode.scenes[0],shots:[{...episode.scenes[0].shots[0],active_video_asset_id:'video-1'}]}]};
    render(<ReviewPanel episode={videoEpisode} readiness={{...readiness,blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}} onSelectShot={vi.fn()}/>);

    const video=await screen.findByLabelText('当前镜头视频');
    expect(video).toHaveClass('review-player-media');
    await userEvent.click(screen.getByRole('button',{name:'播放'}));
    expect(play).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'暂停'}));
    expect(pause).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'取消静音'}));
    expect(video).not.toHaveProperty('muted',true);
  });

  it('renders, gates, approves, and publishes a ready episode', async()=>{
    const readyEpisode:EpisodeDetail={...episode,scenes:episode.scenes.map(scene=>({...scene,shots:scene.shots.map((shot,index)=>({...shot,active_panel_asset_id:`asset-${index+1}`,review_status:'approved'}))}))};
    const ready:ProductionReadiness={...readiness,ready:true,ready_counts:{panels:3,approved:3,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}};
    mocks.threads.mockResolvedValue([]);
    mocks.startRender.mockResolvedValue({job_id:'render-job',status:'queued'});
    mocks.candidates.mockResolvedValue([{id:'old-release',episode_id:'episode-1',version:'V2',render_path:'old.mp4',qc_snapshot:{},status:'draft',created_at:'',updated_at:''}]);
    mocks.poll.mockResolvedValue({id:'render-job',status:'succeeded',result_metadata:{output_path:'projects/p/episodes/e/renders/final.mp4',probe:{black_frames:0}}});
    mocks.candidate.mockResolvedValue({id:'release-1',episode_id:'episode-1',version:'V3',render_path:'projects/p/episodes/e/renders/final.mp4',qc_snapshot:{black_frames:0},status:'draft',created_at:'',updated_at:''});
    mocks.gate.mockResolvedValue({ready:true,production_ready:true,production_blockers:{},open_critical_threads:[]});
    mocks.approve.mockResolvedValue({id:'release-1',status:'approved'});
    mocks.publish.mockResolvedValue({id:'publication-1',candidate_id:'release-1',platform:'internal_master',idempotency_key:'episode-1:release-1:internal_master',external_reference:'internal://release-1',status:'published',created_at:'',published_at:''});
    render(<ReviewPanel episode={readyEpisode} readiness={ready} onSelectShot={vi.fn()}/>);

    await userEvent.click(screen.getByRole('button',{name:'批准并登记'}));

    await waitFor(()=>expect(mocks.startRender).toHaveBeenCalledWith('episode-1'));
    expect(mocks.candidate).toHaveBeenCalledWith('episode-1',expect.objectContaining({version:'V3',render_path:'projects/p/episodes/e/renders/final.mp4'}));
    expect(mocks.gate).toHaveBeenCalledWith('release-1');
    expect(mocks.approve).toHaveBeenCalledWith('release-1');
    expect(mocks.publish).toHaveBeenCalledWith('release-1',{platform:'internal_master',idempotency_key:'episode-1:release-1:internal_master'});
    expect(await screen.findByText('内部母版已登记')).toBeVisible();
  });
});
