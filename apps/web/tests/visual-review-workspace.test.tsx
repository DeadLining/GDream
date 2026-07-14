import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {VisualReviewWorkspace} from '../components/VisualReviewWorkspace';
import type {EpisodeDetail} from '../lib/types';

const mocks = vi.hoisted(() => ({getAsset: vi.fn(),threads:vi.fn(),patchThread:vi.fn(),message:vi.fn(),accept:vi.fn(),reject:vi.fn(),createThread:vi.fn(),annotation:vi.fn(),updateAnnotation:vi.fn(),deleteAnnotation:vi.fn(),startReview:vi.fn(),poll:vi.fn()}));
vi.mock('../lib/api', () => ({getAsset: mocks.getAsset,listVisualReviewThreads:mocks.threads,updateVisualReviewThread:mocks.patchThread,createVisualReviewMessage:mocks.message,acceptVisualReviewCandidate:mocks.accept,rejectVisualReviewCandidate:mocks.reject,createVisualReviewThread:mocks.createThread,createVisualAnnotation:mocks.annotation,updateVisualAnnotation:mocks.updateAnnotation,deleteVisualAnnotation:mocks.deleteAnnotation,startVisualReviewGeneration:mocks.startReview,mediaUrl: (path: string) => path}));
vi.mock('../lib/jobs',()=>({pollJob:mocks.poll}));

const episode: EpisodeDetail = {
  id: 'episode-1', project_id: 'project-1', title: '穿越时空', premise: '', target_duration_seconds: 60,
  status: 'planned', created_at: '', updated_at: '', scenes: [{
    id: 'scene-1', position: 1, location: '废弃实验室', time_of_day: 'night', summary: '', continuity_state: {}, estimated_duration_seconds: 20,
    shots: [{id: 'shot-1', position: 2, shot_type: 'close_up', duration_seconds: 8, composition: '角色发现线索', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: 'asset-1', review_status: 'needs_changes', render_status: 'completed', dialogue: []}],
  }],
};
const reviewThread={id:'thread-1',episode_id:'episode-1',shot_id:'shot-1',source_asset_id:'asset-1',title:'表情不符合情绪',status:'open' as const,modification_scope:'shot' as const,created_at:'',updated_at:'',annotations:[{id:'ann-1',thread_id:'thread-1',kind:'circle' as const,geometry:{cx:.4,cy:.3,rx:.1,ry:.1},color:'#B9473E',label:'脸部',created_at:''}],messages:[{id:'msg-1',thread_id:'thread-1',author_kind:'user' as const,content:'这里的表情太惊恐了。',created_at:''}],candidates:[]};

describe('VisualReviewWorkspace', () => {
  afterEach(() => {cleanup(); vi.clearAllMocks();});

  it('binds an annotation to conversation and revision scope', async () => {
    mocks.getAsset.mockResolvedValue({id: 'asset-1', media_url: '/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.patchThread.mockImplementation(async(_id,data)=>({...reviewThread,modification_scope:data.modification_scope}));
    mocks.message.mockResolvedValue({id:'msg-2',thread_id:'thread-1',author_kind:'user',content:'保持脸型',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onSelectShot={vi.fn()}/>);

    expect(await screen.findByRole('img', {name: '角色发现线索'})).toHaveAttribute('src', '/media/frame.png');
    expect(screen.getByRole('button', {name: '标记 01 表情不符合情绪'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/这里的表情太惊恐了/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '本集角色变体'}));
    await waitFor(()=>expect(mocks.patchThread).toHaveBeenCalledWith('thread-1',{modification_scope:'episode'}));
    expect(screen.getByRole('button', {name: '本集角色变体'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('将创建本集变体，不修改作品主设定')).toBeVisible();

    await userEvent.type(screen.getByLabelText('回复视觉审阅对话'),'保持脸型');
    await userEvent.click(screen.getByRole('button',{name:'发送视觉审阅消息'}));
    await waitFor(()=>expect(mocks.message).toHaveBeenCalledWith('thread-1',{author_kind:'user',content:'保持脸型'}));
  });

  it('persists a normalized ellipse when the user drags over the image', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.annotation.mockResolvedValue({id:'ann-2',thread_id:'thread-1',kind:'circle',geometry:{cx:.4,cy:.35,rx:.2,ry:.15},color:'#B9473E',label:'修改 02',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onSelectShot={vi.fn()}/>);
    await screen.findByRole('img',{name:'角色发现线索'});
    const layer=screen.getByLabelText('图片标注层');
    vi.spyOn(layer,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON:()=>({})});

    fireEvent.pointerDown(layer,{pointerId:1,clientX:20,clientY:20});
    fireEvent.pointerMove(layer,{pointerId:1,clientX:60,clientY:50});
    fireEvent.pointerUp(layer,{pointerId:1,clientX:60,clientY:50});

    await waitFor(()=>expect(mocks.annotation).toHaveBeenCalledWith('thread-1',{kind:'circle',geometry:{cx:.4,cy:.35,rx:.2,ry:.15},color:'#B9473E',label:'修改 02'}));
  });

  it('switches tools and persists a normalized rectangle drawn in either direction', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.annotation.mockResolvedValue({id:'ann-2',thread_id:'thread-1',kind:'rectangle',geometry:{x:.2,y:.3,width:.5,height:.5},color:'#B9473E',label:'修改 02',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onSelectShot={vi.fn()}/>);
    await screen.findByRole('img',{name:'角色发现线索'});
    await userEvent.click(screen.getByRole('button',{name:'矩形工具'}));
    const layer=screen.getByLabelText('图片标注层');
    vi.spyOn(layer,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON:()=>({})});

    fireEvent.pointerDown(layer,{pointerId:2,clientX:70,clientY:80});
    fireEvent.pointerMove(layer,{pointerId:2,clientX:20,clientY:30});
    fireEvent.pointerUp(layer,{pointerId:2,clientX:20,clientY:30});

    await waitFor(()=>expect(mocks.annotation).toHaveBeenCalledWith('thread-1',{kind:'rectangle',geometry:{x:.2,y:.3,width:.5,height:.5},color:'#B9473E',label:'修改 02'}));
    expect(screen.getByRole('button',{name:'矩形工具'})).toHaveAttribute('aria-pressed','true');
  });

  it('starts review-aware generation and reloads the server-created candidate', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    const candidate={id:'candidate-1',thread_id:'thread-1',asset_id:'asset-2',status:'ready' as const,generation_metadata:{scope:'shot'},created_at:'',updated_at:''};
    mocks.threads.mockResolvedValueOnce([reviewThread]).mockResolvedValueOnce([{...reviewThread,candidates:[candidate]}]);
    mocks.startReview.mockResolvedValue({job_id:'job-2',status:'queued'});
    mocks.poll.mockResolvedValue({id:'job-2',status:'succeeded',result_metadata:{asset_id:'asset-2',candidate_id:'candidate-1',thread_id:'thread-1'}});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onSelectShot={vi.fn()}/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'生成修改版本'}));

    await waitFor(()=>expect(mocks.startReview).toHaveBeenCalledWith('thread-1'));
    expect(mocks.poll).toHaveBeenCalledWith('job-2',expect.any(Object));
    expect(mocks.threads).toHaveBeenLastCalledWith('shot-1');
    expect(await screen.findByText('资产 asset-2')).toBeVisible();

    mocks.reject.mockResolvedValue({id:'candidate-1',thread_id:'thread-1',asset_id:'asset-2',status:'rejected',generation_metadata:{scope:'shot'},created_at:'',updated_at:''});
    await userEvent.click(screen.getByRole('button',{name:'继续圈点'}));
    await waitFor(()=>expect(mocks.reject).toHaveBeenCalledWith('candidate-1'));
  });

  it('selects, renames, and deletes an image annotation without deleting the conversation', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.updateAnnotation.mockResolvedValue({...reviewThread.annotations[0],label:'眉眼区域'});
    mocks.deleteAnnotation.mockResolvedValue(undefined);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onSelectShot={vi.fn()}/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'标注 01 脸部'}));
    const label=screen.getByRole('textbox',{name:'修改说明'});
    await userEvent.clear(label);
    await userEvent.type(label,'眉眼区域');
    await userEvent.click(screen.getByRole('button',{name:'保存说明'}));
    await waitFor(()=>expect(mocks.updateAnnotation).toHaveBeenCalledWith('ann-1',{label:'眉眼区域'}));

    await userEvent.click(screen.getByRole('button',{name:'删除标注'}));
    await waitFor(()=>expect(mocks.deleteAnnotation).toHaveBeenCalledWith('ann-1'));
    expect(screen.getByText(/这里的表情太惊恐了/)).toBeVisible();
  });
});
