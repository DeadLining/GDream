import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ReviewPanel} from '../components/ReviewPanel';
import type {EpisodeDetail, ProductionReadiness} from '../lib/types';
import {readAllStyles} from './_styles';

const mocks=vi.hoisted(()=>({threads:vi.fn(),createThread:vi.fn(),message:vi.fn(),patch:vi.fn(),updateShot:vi.fn(),getAsset:vi.fn(),startRender:vi.fn(),candidate:vi.fn(),candidates:vi.fn(),renderReview:vi.fn(),gate:vi.fn(),approve:vi.fn(),publish:vi.fn(),visualThreads:vi.fn(),createVisualThread:vi.fn(),visualMessage:vi.fn(),visualGenerate:vi.fn(),poll:vi.fn()}));
vi.mock('../lib/api',()=>({listReviewThreads:mocks.threads,createReviewThread:mocks.createThread,createReviewMessage:mocks.message,updateReviewThread:mocks.patch,updateShot:mocks.updateShot,getAsset:mocks.getAsset,startRender:mocks.startRender,createReleaseCandidate:mocks.candidate,listReleaseCandidates:mocks.candidates,getRenderReview:mocks.renderReview,getReleaseGate:mocks.gate,approveReleaseCandidate:mocks.approve,publishReleaseCandidate:mocks.publish,listVisualReviewThreads:mocks.visualThreads,createVisualReviewThread:mocks.createVisualThread,createVisualReviewMessage:mocks.visualMessage,startVisualReviewGeneration:mocks.visualGenerate,mediaUrl:(path:string)=>path}));
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
const readyReadiness:ProductionReadiness={...readiness,ready:true,ready_counts:{panels:3,approved:3,speech:1},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}};
const timedEpisode:EpisodeDetail={...episode,scenes:[{...episode.scenes[0],shots:episode.scenes[0].shots.map((shot,index)=>index===0?{...shot,active_video_asset_id:'video-1',dialogue:[{id:'line-1',character_id:null,position:1,text:'小心路滑',subtitle_text:'小心路滑',emotion:'tense',performance_instruction:'',audio_asset_id:'audio-1',start_seconds:1,duration_seconds:2}]}:{...shot,review_status:'approved'})}]};

describe('ReviewPanel', () => {
  beforeEach(()=>{mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});mocks.candidates.mockResolvedValue([]);mocks.renderReview.mockRejectedValue(new Error('No render review'));mocks.visualThreads.mockResolvedValue([]);});
  afterEach(()=>{cleanup();vi.clearAllMocks();});

  it('does not expose the retired review comment workflow', async () => {
    mocks.threads.mockResolvedValue([]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(screen.queryByRole('heading', {name: '审阅评论'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('待处理评论')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: '新建终审评论'})).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.threads).not.toHaveBeenCalled());
  });

  it('shows time-linked review and blocks publishing on critical issues', () => {
    mocks.threads.mockResolvedValue([]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(screen.getByRole('region', {name: '审阅播放器'})).toBeVisible();
    expect(screen.getByRole('region', {name: '多轨时间线'})).toBeVisible();
    expect(screen.getByText('连续性检查')).toBeVisible();
    expect(screen.getByRole('button', {name: '批准并登记'})).toBeDisabled();
    const ruler=screen.getByLabelText('多轨时间线').querySelector('.timeline-ruler');
    expect(ruler).toHaveTextContent('0:10');
    expect(ruler).not.toHaveTextContent('1:00');
  });

  it('uses compact header groups and a bounded preview-media hook', async () => {
    mocks.threads.mockResolvedValue([]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    const heading=screen.getByRole('heading',{name:'审核队列'});
    expect(heading.parentElement).toHaveClass('review-header-title');
    expect(heading.parentElement?.parentElement).toHaveClass('review-header-copy');
    await userEvent.click(screen.getByRole('button',{name:'上一镜头'}));
    expect(await screen.findByRole('img',{name:'进入巷道'})).toHaveClass('review-player-media');
  });

  it('keeps compact review and publishing controls vertically reachable', () => {
    const styles=readAllStyles();
    expect(styles).toMatch(/\.review-publish-sidebar\s*\{[^}]*overflow-y:\s*auto[^}]*\}/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*899px\)\s*\{[\s\S]*?\.review-publish-workspace\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto[^}]*\}/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*899px\)\s*\{[\s\S]*?\.review-publish-workspace\s*>\s*\.review-panel-header\s*\{(?=[^}]*flex:\s*0\s+0\s+auto)(?=[^}]*min-height:\s*0)[^}]*\}/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.review-publish-workspace\s*>\s*\.review-panel-header\s*\{[^}]*grid-template-columns:\s*1fr[^}]*\}/);
  });

  it('shows honest QC availability and derives the next candidate version', async () => {
    mocks.threads.mockResolvedValue([]);
    mocks.candidates.mockResolvedValue([{id:'old-release',episode_id:'episode-1',version:'V2',render_path:'old.mp4',qc_snapshot:{},status:'draft',created_at:'',updated_at:''}]);
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(await screen.findByDisplayValue('V3 · 下一终审候选')).toBeVisible();
    expect(screen.getByRole('button',{name:'终审成片'})).toBeVisible();
    expect(screen.queryByText('终审版本 V4')).not.toBeInTheDocument();
  });

  it('previews and downloads a persisted final candidate with real QC results',async()=>{
    mocks.threads.mockResolvedValue([]);
    mocks.candidates.mockResolvedValue([{id:'release-2',episode_id:'episode-1',version:'V2',render_path:'projects/p/episodes/e/renders/v2.mp4',qc_snapshot:{},status:'draft',created_at:'',updated_at:''}]);
    mocks.renderReview.mockResolvedValue({id:'review-render',episode_id:'episode-1',job_id:'render-job',render_path:'projects/p/episodes/e/renders/v2.mp4',overall_pass:true,subtitle_present:false,black_frame_positions:[],silence_ranges:[],ffprobe_json:{streams:[{codec_type:'video'},{codec_type:'audio'}]},findings:[{code:'no_subtitle_stream',severity:'info'}],slideshow_risk:{score:.42,level:'warning',dimensions:{},triggered:['motion']},created_at:''});
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'终审成片'}));
    expect(await screen.findByLabelText('终审成片视频')).toHaveAttribute('src','/media/projects/p/episodes/e/renders/v2.mp4');
    expect(screen.getByRole('link',{name:'下载成片'})).toHaveAttribute('href','/media/projects/p/episodes/e/renders/v2.mp4');
    expect(screen.getByText('黑帧检查').parentElement).toHaveTextContent('通过');
    expect(screen.getByText('音频静音').parentElement).toHaveTextContent('通过');
    expect(screen.getByText('字幕轨道').parentElement).toHaveTextContent('未检测到独立字幕流');
    expect(screen.getByText('动态风险').parentElement).toHaveTextContent('中');
  });

  it('uses transport and timeline filters without comment controls', async () => {
    const onSelectShot = vi.fn();
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={onSelectShot}/>);

    await userEvent.click(screen.getByRole('button',{name:'下一镜头'}));
    expect(onSelectShot).toHaveBeenCalledWith('shot-3');
    await userEvent.click(screen.getByRole('button',{name:'上一镜头'}));
    expect(onSelectShot).toHaveBeenCalledWith('shot-2');

    await userEvent.click(screen.getByRole('button',{name:'对白轨道'}));
    expect(screen.queryByText('字幕',{selector:'label'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'显示全部轨道'}));
    expect(screen.getByText('字幕',{selector:'label'})).toBeVisible();
    await userEvent.click(within(screen.getByLabelText('多轨时间线')).getByRole('button',{name:'镜头 3'}));
    expect(screen.queryByRole('button',{name:/画面评论/})).not.toBeInTheDocument();
  });

  it('numbers timeline shots continuously across scenes',async()=>{
    mocks.threads.mockResolvedValue([]);
    const secondScene={...episode.scenes[0],id:'scene-2',position:2,location:'雨巷深处',shots:[{...episode.scenes[0].shots[2],id:'shot-4',position:1}]};
    const multiSceneEpisode={...episode,scenes:[{...episode.scenes[0],shots:episode.scenes[0].shots.slice(0,2)},secondScene]};
    const onSelectShot=vi.fn();
    render(<ReviewPanel episode={multiSceneEpisode} readiness={readiness} onSelectShot={onSelectShot}/>);

    const timeline=within(screen.getByLabelText('多轨时间线'));
    const buttons=[1,2,3].map(index=>timeline.getByRole('button',{name:`镜头 ${index}`}));
    expect(buttons.map(button=>button.textContent)).toEqual(['镜头 01场景 01','镜头 02场景 01','镜头 03场景 02']);

    await userEvent.click(buttons[2]);
    expect(onSelectShot).toHaveBeenCalledWith('shot-4');
  });

  it('controls real video playback and mute state', async () => {
    mocks.threads.mockResolvedValue([]);
    mocks.getAsset.mockResolvedValue({id:'video-1',media_url:'/media/shot.mp4'});
    const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
    const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
    const videoEpisode:EpisodeDetail={...episode,scenes:[{...episode.scenes[0],shots:[{...episode.scenes[0].shots[0],active_video_asset_id:'video-1'}]}]};
    render(<ReviewPanel episode={videoEpisode} readiness={{...readiness,blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}}} onSelectShot={vi.fn()}/>);

    const video=await screen.findByLabelText<HTMLVideoElement>('当前镜头视频');
    expect(video).toHaveClass('review-player-media');
    await userEvent.click(screen.getByRole('button',{name:'播放'}));
    expect(play).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'暂停'}));
    expect(pause).toHaveBeenCalled();
    const unmute=screen.getByRole('button',{name:'取消静音'});
    expect(unmute).toHaveAttribute('aria-pressed','true');
    expect(unmute.querySelector('.lucide-volume-x')).toBeInTheDocument();
    await userEvent.click(unmute);
    expect(video).not.toHaveProperty('muted',true);
    const mute=screen.getByRole('button',{name:'静音'});
    expect(mute).toHaveAttribute('aria-pressed','false');
    expect(mute.querySelector('.lucide-volume2')).toBeInTheDocument();
  });

  it('moves a valid episode playhead with real media time',async()=>{
    mocks.threads.mockResolvedValue([]);
    mocks.getAsset.mockResolvedValue({id:'video-1',media_url:'/media/shot.mp4'});
    render(<ReviewPanel episode={timedEpisode} readiness={readyReadiness} onSelectShot={vi.fn()}/>);

    const video=await screen.findByLabelText<HTMLVideoElement>('当前镜头视频');
    Object.defineProperty(video,'currentTime',{configurable:true,writable:true,value:2});
    fireEvent.timeUpdate(video);

    expect(screen.getByLabelText('时间线播放头')).toHaveStyle({left:'20%'});
  });

  it('renders timed dialogue and subtitle clips and seeks from them',async()=>{
    mocks.threads.mockResolvedValue([]);
    mocks.getAsset.mockResolvedValue({id:'video-1',media_url:'/media/shot.mp4'});
    render(<ReviewPanel episode={timedEpisode} readiness={readyReadiness} onSelectShot={vi.fn()}/>);

    const video=await screen.findByLabelText<HTMLVideoElement>('当前镜头视频');
    const dialogue=screen.getByRole('button',{name:'对白 小心路滑'});
    const subtitle=screen.getByRole('button',{name:'字幕 小心路滑'});
    expect(dialogue).toHaveStyle({left:'25%',width:'50%'});
    expect(subtitle).toHaveStyle({left:'25%',width:'50%'});

    await userEvent.click(dialogue);
    expect(video.currentTime).toBe(1);
    expect(screen.getByLabelText('时间线播放头')).toHaveStyle({left:'10%'});
  });

  it('keeps final-preview playback on the absolute episode timeline',async()=>{
    mocks.threads.mockResolvedValue([]);
    mocks.getAsset.mockResolvedValue({id:'video-1',media_url:'/media/shot.mp4'});
    mocks.candidates.mockResolvedValue([{id:'release-2',episode_id:'episode-1',version:'V2',render_path:'projects/p/episodes/e/renders/v2.mp4',qc_snapshot:{},status:'draft',created_at:'',updated_at:''}]);
    mocks.renderReview.mockResolvedValue({id:'review-render',episode_id:'episode-1',job_id:'render-job',render_path:'projects/p/episodes/e/renders/v2.mp4',overall_pass:true,subtitle_present:true,black_frame_positions:[],silence_ranges:[],ffprobe_json:{},findings:[],slideshow_risk:null,created_at:''});
    render(<ReviewPanel episode={timedEpisode} readiness={readyReadiness} onSelectShot={vi.fn()}/>);

    const timeline=within(screen.getByLabelText('多轨时间线'));
    await userEvent.click(timeline.getAllByRole('button',{name:'镜头 3'})[0]);
    await userEvent.click(await screen.findByRole('button',{name:'终审成片'}));
    const video=await screen.findByLabelText('终审成片视频');
    Object.defineProperty(video,'currentTime',{configurable:true,writable:true,value:2});
    fireEvent.timeUpdate(video);

    expect(screen.getByLabelText('时间线播放头')).toHaveStyle({left:'20%'});
  });

  it('renders a preview before separately gating, approving, and publishing it', async()=>{
    const readyEpisode:EpisodeDetail={...episode,scenes:episode.scenes.map(scene=>({...scene,shots:scene.shots.map((shot,index)=>({...shot,active_panel_asset_id:`asset-${index+1}`,review_status:'approved'}))}))};
    const ready:ProductionReadiness={...readiness,ready:true,ready_counts:{panels:3,approved:3,speech:0},blockers:{missing_panels:[],unapproved_shots:[],missing_speech:[]}};
    mocks.threads.mockResolvedValue([]);
    mocks.startRender.mockResolvedValue({job_id:'render-job',status:'queued'});
    mocks.candidates.mockResolvedValue([]);
    mocks.poll.mockResolvedValue({id:'render-job',status:'succeeded',result_metadata:{output_path:'projects/p/episodes/e/renders/final.mp4',probe:{black_frames:0},review:{overall_pass:true}}});
    mocks.candidate.mockResolvedValue({id:'release-1',episode_id:'episode-1',version:'V3',render_path:'projects/p/episodes/e/renders/final.mp4',qc_snapshot:{black_frames:0},status:'draft',created_at:'',updated_at:''});
    mocks.gate.mockResolvedValue({ready:true,production_ready:true,production_blockers:{},open_critical_threads:[]});
    mocks.approve.mockResolvedValue({id:'release-1',status:'approved'});
    mocks.publish.mockResolvedValue({id:'publication-1',candidate_id:'release-1',platform:'internal_master',idempotency_key:'episode-1:release-1:internal_master',external_reference:'internal://release-1',status:'published',created_at:'',published_at:''});
    render(<ReviewPanel episode={readyEpisode} readiness={ready} onSelectShot={vi.fn()}/>);

    await userEvent.click(screen.getByRole('button',{name:'生成终审预览'}));

    await waitFor(()=>expect(mocks.startRender).toHaveBeenCalledWith('episode-1'));
    expect(mocks.candidate).toHaveBeenCalledWith('episode-1',expect.objectContaining({version:'V1',render_path:'projects/p/episodes/e/renders/final.mp4'}));
    expect(await screen.findByLabelText('终审成片视频')).toHaveAttribute('src','/media/projects/p/episodes/e/renders/final.mp4');

    await userEvent.click(screen.getByRole('button',{name:'批准并登记'}));
    expect(mocks.gate).toHaveBeenCalledWith('release-1');
    expect(mocks.approve).toHaveBeenCalledWith('release-1');
    expect(mocks.publish).toHaveBeenCalledWith('release-1',{platform:'internal_master',idempotency_key:'episode-1:release-1:internal_master'});
    expect(await screen.findByText('内部母版已登记')).toBeVisible();
  });
});
