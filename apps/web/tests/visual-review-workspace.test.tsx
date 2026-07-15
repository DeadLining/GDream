import {act,cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fitImageWithin,VisualReviewWorkspace} from '../components/VisualReviewWorkspace';
import type {EpisodeDetail} from '../lib/types';
import {readAllStyles} from './_styles';

const mocks = vi.hoisted(() => ({getAsset: vi.fn(),panelVersions:vi.fn(),threads:vi.fn(),patchThread:vi.fn(),message:vi.fn(),accept:vi.fn(),reject:vi.fn(),createThread:vi.fn(),annotation:vi.fn(),updateAnnotation:vi.fn(),deleteAnnotation:vi.fn(),startReview:vi.fn(),poll:vi.fn()}));
vi.mock('../lib/api', () => ({getAsset: mocks.getAsset,listPanelVersions:mocks.panelVersions,listVisualReviewThreads:mocks.threads,updateVisualReviewThread:mocks.patchThread,createVisualReviewMessage:mocks.message,acceptVisualReviewCandidate:mocks.accept,rejectVisualReviewCandidate:mocks.reject,createVisualReviewThread:mocks.createThread,createVisualAnnotation:mocks.annotation,updateVisualAnnotation:mocks.updateAnnotation,deleteVisualAnnotation:mocks.deleteAnnotation,startVisualReviewGeneration:mocks.startReview,mediaUrl: (path: string) => path}));
vi.mock('../lib/jobs',()=>({pollJob:mocks.poll}));

const episode: EpisodeDetail = {
  id: 'episode-1', project_id: 'project-1', title: '穿越时空', premise: '', target_duration_seconds: 60,
  status: 'planned', created_at: '', updated_at: '', scenes: [{
    id: 'scene-1', position: 1, location: '废弃实验室', time_of_day: 'night', summary: '', continuity_state: {}, estimated_duration_seconds: 20,
    shots: [{id: 'shot-1', position: 2, shot_type: 'close_up', duration_seconds: 8, composition: '角色发现线索', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: 'asset-1', review_status: 'needs_changes', render_status: 'completed', dialogue: []}],
  }],
};
const reviewThread={id:'thread-1',episode_id:'episode-1',shot_id:'shot-1',source_asset_id:'asset-1',title:'表情不符合情绪',status:'open' as const,modification_scope:'shot' as const,created_at:'',updated_at:'',annotations:[{id:'ann-1',thread_id:'thread-1',kind:'circle' as const,geometry:{cx:.4,cy:.3,rx:.1,ry:.1},color:'#B9473E',label:'脸部',created_at:''}],messages:[{id:'msg-1',thread_id:'thread-1',author_kind:'user' as const,content:'这里的表情太惊恐了。',created_at:''}],candidates:[]};
const styles=readAllStyles();

describe('VisualReviewWorkspace', () => {
  beforeEach(()=>mocks.panelVersions.mockResolvedValue([]));
  afterEach(() => {cleanup(); vi.clearAllMocks();});

  it('binds an annotation to conversation and revision scope', async () => {
    mocks.getAsset.mockResolvedValue({id: 'asset-1', media_url: '/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.patchThread.mockImplementation(async(_id,data)=>({...reviewThread,modification_scope:data.modification_scope}));
    mocks.message.mockResolvedValue({id:'msg-2',thread_id:'thread-1',author_kind:'user',content:'保持脸型',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);

    expect(await screen.findByRole('img', {name: '角色发现线索'})).toHaveAttribute('src', '/media/frame.png');
    expect(screen.getByRole('button',{name:'选择工具'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('button',{name:'圈选工具'})).toHaveAttribute('aria-pressed','false');
    expect(screen.queryByLabelText('选择审阅镜头')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'标记 01 表情不符合情绪'})).not.toBeInTheDocument();
    expect(within(screen.getByRole('button',{name:'标注 01 脸部'})).getByText('脸部')).toBeVisible();
    expect(screen.getByText(/这里的表情太惊恐了/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '本集角色变体'}));
    await waitFor(()=>expect(mocks.patchThread).toHaveBeenCalledWith('thread-1',{modification_scope:'episode'}));
    expect(screen.getByRole('button', {name: '本集角色变体'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('将创建本集变体，不修改作品主设定')).toBeVisible();

    expect(screen.getByLabelText('整图补充说明（可选）')).toHaveAttribute('placeholder','仅填写无法圈选的整图要求');
    await userEvent.type(screen.getByLabelText('整图补充说明（可选）'),'保持脸型');
    await userEvent.click(screen.getByRole('button',{name:'发送视觉审阅消息'}));
    await waitFor(()=>expect(mocks.message).toHaveBeenCalledWith('thread-1',{author_kind:'user',content:'保持脸型'}));
  });

  it('shows its production path and returns to the preserved production canvas', async () => {
    const onBackToProduction=vi.fn();
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onBackToProduction={onBackToProduction}/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    expect(screen.getByText('本集生产 / 镜头 02 / 视觉审阅')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'返回生产画布'}));
    expect(onBackToProduction).toHaveBeenCalledTimes(1);
  });

  it('persists a normalized ellipse when the user drags over the image', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.annotation.mockResolvedValue({id:'ann-2',thread_id:'thread-1',kind:'circle',geometry:{cx:.4,cy:.35,rx:.2,ry:.15},color:'#B9473E',label:'修改 02',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});
    await userEvent.click(screen.getByRole('button',{name:'圈选工具'}));
    const layer=screen.getByLabelText('图片标注层');
    vi.spyOn(layer,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON:()=>({})});

    fireEvent.pointerDown(layer,{pointerId:1,clientX:20,clientY:20});
    fireEvent.pointerMove(layer,{pointerId:1,clientX:60,clientY:50});
    fireEvent.pointerUp(layer,{pointerId:1,clientX:60,clientY:50});

    await waitFor(()=>expect(mocks.annotation).toHaveBeenCalledWith('thread-1',{kind:'circle',geometry:{cx:.4,cy:.35,rx:.2,ry:.15},color:'#B9473E',label:'修改 02'}));
  });

  it('creates the first review thread automatically when the user draws directly', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([]);
    const emptyThread={...reviewThread,annotations:[],messages:[],candidates:[],title:'视觉修改'};
    mocks.createThread.mockResolvedValue(emptyThread);
    mocks.annotation.mockResolvedValue({id:'ann-1',thread_id:'thread-1',kind:'circle',geometry:{cx:.4,cy:.35,rx:.2,ry:.15},color:'#B9473E',label:'修改 01',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});
    await userEvent.click(screen.getByRole('button',{name:'圈选工具'}));
    const layer=screen.getByLabelText('图片标注层');
    vi.spyOn(layer,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON:()=>({})});

    fireEvent.pointerDown(layer,{pointerId:3,clientX:20,clientY:20});
    fireEvent.pointerMove(layer,{pointerId:3,clientX:60,clientY:50});
    fireEvent.pointerUp(layer,{pointerId:3,clientX:60,clientY:50});

    await waitFor(()=>expect(mocks.createThread).toHaveBeenCalledWith('shot-1',{source_asset_id:'asset-1',title:'视觉修改',modification_scope:'shot'}));
    expect(mocks.annotation).toHaveBeenCalledWith('thread-1',{kind:'circle',geometry:{cx:.4,cy:.35,rx:.2,ry:.15},color:'#B9473E',label:'修改 01'});
    expect(screen.queryByRole('button',{name:'新建圈点'})).not.toBeInTheDocument();
  });

  it('switches tools and persists a normalized rectangle drawn in either direction', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.annotation.mockResolvedValue({id:'ann-2',thread_id:'thread-1',kind:'rectangle',geometry:{x:.2,y:.3,width:.5,height:.5},color:'#B9473E',label:'修改 02',created_at:''});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});
    await userEvent.click(screen.getByRole('button',{name:'矩形工具'}));
    expect(screen.getByRole('button',{name:'标注 01 脸部'})).toHaveStyle({pointerEvents:'none'});
    const layer=screen.getByLabelText('图片标注层');
    vi.spyOn(layer,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON:()=>({})});

    fireEvent.pointerDown(layer,{pointerId:2,clientX:70,clientY:80});
    fireEvent.pointerMove(layer,{pointerId:2,clientX:20,clientY:30});

    expect(screen.getByTestId('annotation-draft')).toHaveStyle({left:'20%',top:'30%',width:'50%',height:'50%'});

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
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
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

  it('notifies production after accepting a candidate so the active shot and graph can refresh', async () => {
    const candidate={id:'candidate-1',thread_id:'thread-1',asset_id:'asset-2',status:'ready' as const,generation_metadata:{scope:'shot'},created_at:'',updated_at:''};
    const onCandidateAccepted=vi.fn();
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([{...reviewThread,candidates:[candidate]}]);
    mocks.accept.mockResolvedValue({...candidate,status:'accepted'});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1" onCandidateAccepted={onCandidateAccepted}/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'采纳候选'}));

    await waitFor(()=>expect(mocks.accept).toHaveBeenCalledWith('candidate-1'));
    expect(onCandidateAccepted).toHaveBeenCalledWith('asset-2');
    expect(screen.queryByRole('button',{name:'采纳候选'})).not.toBeInTheDocument();
  });

  it('shows real generation progress and keeps the original image when generation fails', async () => {
    let finish!: (job:{status:string;error:string;result_metadata:Record<string,unknown>})=>void;
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.startReview.mockResolvedValue({job_id:'job-failed',status:'queued'});
    mocks.poll.mockImplementation(async(_id,options)=>{options.onUpdate({progress:42});return new Promise(resolve=>{finish=resolve;});});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    const original=await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'生成修改版本'}));
    expect(await screen.findByRole('button',{name:'生成中 42%'})).toBeDisabled();
    await act(async()=>finish({status:'failed',error:'图片服务暂时不可用',result_metadata:{}}));

    expect(await screen.findByRole('alert')).toHaveTextContent('图片服务暂时不可用');
    expect(original).toHaveAttribute('src','/media/frame.png');
  });

  it('toggles between the review source and the selected candidate', async () => {
    const candidate={id:'candidate-1',thread_id:'thread-1',asset_id:'asset-2',status:'ready' as const,generation_metadata:{scope:'shot'},created_at:'',updated_at:''};
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.panelVersions.mockResolvedValue([
      {id:'asset-1',media_url:'/media/frame.png',generation_attempt:1},
      {id:'asset-2',media_url:'/media/candidate.png',generation_attempt:2},
    ]);
    mocks.threads.mockResolvedValue([{...reviewThread,candidates:[candidate]}]);
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    const image=await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(await screen.findByRole('button',{name:'画面版本 V2，审阅候选'}));
    expect(image).toHaveAttribute('src','/media/candidate.png');

    const compare=screen.getByRole('button',{name:'前后对比'});
    await userEvent.click(compare);
    expect(compare).toHaveAttribute('aria-pressed','true');
    expect(image).toHaveAttribute('src','/media/frame.png');

    await userEvent.click(compare);
    expect(compare).toHaveAttribute('aria-pressed','false');
    expect(image).toHaveAttribute('src','/media/candidate.png');
  });

  it('selects, renames, and deletes an image annotation without deleting the conversation', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.updateAnnotation.mockResolvedValue({...reviewThread.annotations[0],label:'眉眼区域'});
    mocks.deleteAnnotation.mockResolvedValue(undefined);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'选择工具'}));
    const annotationButton=screen.getByRole('button',{name:'标注 01 脸部'});
    expect(annotationButton).toHaveStyle({pointerEvents:'auto'});
    expect(annotationButton.getAttribute('style')).toContain('--annotation-color: #B9473E');
    await userEvent.click(annotationButton);
    const label=screen.getByRole('textbox',{name:'修改说明'});
    await userEvent.clear(label);
    await userEvent.type(label,'眉眼区域');
    await userEvent.click(screen.getByRole('button',{name:'保存说明'}));
    await waitFor(()=>expect(mocks.updateAnnotation).toHaveBeenCalledWith('ann-1',{label:'眉眼区域'}));

    await userEvent.click(screen.getByRole('button',{name:'删除标注'}));
    await waitFor(()=>expect(mocks.deleteAnnotation).toHaveBeenCalledWith('ann-1'));
    expect(screen.queryByRole('button',{name:'标注 01 眉眼区域'})).not.toBeInTheDocument();
    expect(screen.getByText(/这里的表情太惊恐了/)).toBeVisible();
  });

  it('drags a selected annotation over the image and persists its new geometry', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.updateAnnotation.mockResolvedValue({...reviewThread.annotations[0],geometry:{cx:.6,cy:.5,rx:.1,ry:.1}});
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    const layer=screen.getByLabelText('图片标注层');
    vi.spyOn(layer,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON:()=>({})});
    await userEvent.click(screen.getByRole('button',{name:'选择工具'}));
    const annotationButton=screen.getByRole('button',{name:'标注 01 脸部'});

    fireEvent.pointerDown(annotationButton,{pointerId:4,clientX:40,clientY:30});
    fireEvent.pointerMove(annotationButton,{pointerId:4,clientX:60,clientY:50});
    expect(annotationButton).toHaveStyle({left:'50%',top:'40%'});
    fireEvent.pointerUp(annotationButton,{pointerId:4,clientX:60,clientY:50});

    await waitFor(()=>expect(mocks.updateAnnotation).toHaveBeenCalledWith('ann-1',{geometry:{cx:.6,cy:.5,rx:.1,ry:.1}}));
  });

  it('deletes the selected annotation with Delete without firing while editing text', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([reviewThread]);
    mocks.deleteAnnotation.mockResolvedValue(undefined);
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'选择工具'}));
    await userEvent.click(screen.getByRole('button',{name:'标注 01 脸部'}));
    const labelInput=screen.getByRole('textbox',{name:'修改说明'});
    labelInput.focus();
    fireEvent.keyDown(labelInput,{key:'Delete'});
    expect(mocks.deleteAnnotation).not.toHaveBeenCalled();

    labelInput.blur();
    fireEvent.keyDown(document,{key:'Delete'});
    await waitFor(()=>expect(mocks.deleteAnnotation).toHaveBeenCalledWith('ann-1'));
    expect(screen.queryByRole('button',{name:'标注 01 脸部'})).not.toBeInTheDocument();
  });

  it('renders a saved freehand annotation as a selectable path over its real bounds', async () => {
    mocks.getAsset.mockResolvedValue({id:'asset-1',media_url:'/media/frame.png'});
    mocks.threads.mockResolvedValue([{...reviewThread,annotations:[{
      id:'ann-path',thread_id:'thread-1',kind:'path' as const,
      geometry:{points:[[.2,.3],[.45,.2],[.7,.55]]},color:'#B9473E',label:'头饰轮廓',created_at:'',
    }]}]);
    render(<VisualReviewWorkspace episode={episode} selectedShotId="shot-1"/>);
    await screen.findByRole('img',{name:'角色发现线索'});

    await userEvent.click(screen.getByRole('button',{name:'选择工具'}));
    const pathButton=screen.getByRole('button',{name:'标注 01 头饰轮廓'});
    expect(pathButton).toHaveStyle({left:'20%',top:'20%',width:'50%',height:'35%',pointerEvents:'auto'});
    expect(pathButton.querySelector('polyline')).toHaveAttribute('points','0,28.5714 50,0 100,100');
  });

  it('fits the version strip into the review page without a horizontal scrollbar', () => {
    expect(styles).toMatch(/\.review-version-strip\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.review-version-strip button\s*\{[^}]*flex:\s*1 1 54px[^}]*min-width:\s*0[^}]*max-width:\s*78px/);
  });

  it('keeps annotation interiors transparent while drawing and after saving', () => {
    expect(styles).toMatch(/\.review-annotation-layer \.annotation-pin\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.review-annotation-layer \.annotation-draft\s*\{[^}]*background:\s*transparent/);
  });

  it('fits the complete source image inside both canvas dimensions', () => {
    expect(fitImageWithin(1400,700,900,1600)).toEqual({width:393.75,height:700});
    expect(fitImageWithin(1000,500,1600,900)).toEqual({width:888.8889,height:500});
  });
});
