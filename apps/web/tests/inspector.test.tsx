import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Inspector} from '../components/Inspector';
import type {Asset, Job, Shot} from '../lib/types';

const mocks = vi.hoisted(() => ({
  listPanelVersions: vi.fn(), updateShot: vi.fn(), startPanelGeneration: vi.fn(),
  activatePanel: vi.fn(), listVideoVersions: vi.fn(),
  pollJob: vi.fn(),
}));
vi.mock('../lib/api', () => ({...mocks, mediaUrl: (path:string) => path}));
vi.mock('../lib/jobs', () => ({pollJob: mocks.pollJob}));

const shot: Shot = {
  id:'shot-1',position:1,shot_type:'close_up',duration_seconds:5,composition:'芯片特写',
  camera_motion:'push_in',character_state:{},image_prompt:'comic close-up',negative_prompt:'',
  active_panel_asset_id:null,review_status:'draft',render_status:'pending',dialogue:[{
    id:'line-1',character_id:null,position:1,text:'别回头。',subtitle_text:'别回头。',emotion:'tense',
    performance_instruction:'低声',audio_asset_id:null,start_seconds:0,duration_seconds:0,
  }],
};
const succeeded: Job = {id:'job-1',operation:'generate_panel',target_type:'shot',target_id:'shot-1',status:'succeeded',progress:100,result_metadata:{media_url:'/media/panel.png'},error:'',retry_count:0,created_at:'',updated_at:''};
const asset: Asset = {id:'asset-1',kind:'panel',media_url:'/media/panel.png',media_type:'image/png',provider:'openai',model:'gpt-image-2',generation_attempt:2,review_status:'approved',width:1024,height:1536,duration_seconds:null,created_at:''};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {resolve = next;});
  return {promise, resolve};
}

describe('Inspector', () => {
  afterEach(cleanup);
  beforeEach(() => {vi.clearAllMocks();mocks.listPanelVersions.mockResolvedValue([]);mocks.listVideoVersions.mockResolvedValue([]);});

  it('keeps only shot controls in the inspector and routes heavy workflows to production', async () => {
    mocks.listPanelVersions.mockResolvedValue([asset]);
    const onOpenMedia=vi.fn();
    const onOpenDialogue=vi.fn();
    render(<Inspector shot={{...shot,active_panel_asset_id:'asset-1'}} onOpenMedia={onOpenMedia} onOpenDialogue={onOpenDialogue}/>);
    expect(screen.getByRole('heading',{name:'镜头状态'})).toBeVisible();
    expect(screen.getByRole('heading',{name:'构图与运动'})).toBeVisible();
    expect(screen.getByRole('heading',{name:'生成提示'})).toBeVisible();
    expect(await screen.findByRole('heading',{name:'画面版本'})).toBeVisible();
    expect(screen.queryByRole('heading',{name:'图 + 文生成视频'})).not.toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'对白与配音'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('视频动态提示词')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:/画面版本 2.*当前版本/})).toHaveAttribute('aria-pressed','true');
    await userEvent.click(screen.getByRole('button',{name:'管理分镜版本'}));
    await userEvent.click(screen.getByRole('button',{name:'打开视频生成'}));
    await userEvent.click(screen.getByRole('button',{name:'打开对白配音'}));
    expect(onOpenMedia).toHaveBeenNthCalledWith(1,'panel');
    expect(onOpenMedia).toHaveBeenNthCalledWith(2,'video');
    expect(onOpenDialogue).toHaveBeenCalledTimes(1);
  });

  it('explains stale active panel inputs and exposes regeneration', async () => {
    mocks.listPanelVersions.mockResolvedValue([{...asset,is_stale:true,stale_reason:'inputs_changed'}]);
    render(<Inspector shot={{...shot,active_panel_asset_id:'asset-1',review_status:'approved'}}/>);

    expect(await screen.findByText('当前画面使用的角色、场景或导演输入已变化')).toBeVisible();
    expect(screen.getByRole('button',{name:'重新生成画面'})).toBeEnabled();
    expect(screen.getByRole('button',{name:/画面版本 2.*输入已变化/})).toBeVisible();
    expect(screen.queryByText('当前画面已过期，请重新生成后再生成视频。')).not.toBeInTheDocument();
  });

  it('ignores panel versions returned for a previously selected shot', async () => {
    const firstRequest = deferred<Asset[]>();
    const secondAsset = {...asset,id:'asset-2',media_url:'/media/current-shot.png',generation_attempt:3};
    mocks.listPanelVersions
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce([secondAsset]);
    const {rerender} = render(<Inspector shot={shot}/>);

    rerender(<Inspector shot={{...shot,id:'shot-2',position:2,active_panel_asset_id:'asset-2'}}/>);
    expect(await screen.findByRole('button',{name:/画面版本 3.*当前版本/})).toBeVisible();

    firstRequest.resolve([asset]);

    await waitFor(() => expect(screen.queryByRole('button',{name:/画面版本 2/})).not.toBeInTheDocument());
    expect(screen.getByRole('button',{name:/画面版本 3.*当前版本/})).toBeVisible();
  });

  it('saves edited shot fields explicitly', async () => {
    mocks.updateShot.mockResolvedValue({...shot,duration_seconds:7.5,review_status:'approved'});
    const onShotUpdated = vi.fn();
    render(<Inspector shot={shot} onShotUpdated={onShotUpdated}/>);
    const duration = screen.getByLabelText('时长（秒）');
    await userEvent.clear(duration); await userEvent.type(duration,'7.5');
    await userEvent.selectOptions(screen.getByLabelText('审核状态'),'approved');
    await userEvent.click(screen.getByRole('button',{name:'保存镜头'}));
    await waitFor(()=>expect(mocks.updateShot).toHaveBeenCalledWith('shot-1',expect.objectContaining({duration_seconds:7.5,review_status:'approved'})));
    expect(onShotUpdated).toHaveBeenCalled();
  });

  it('generates a panel through a persisted job', async () => {
    mocks.startPanelGeneration.mockResolvedValue({job_id:'job-1',status:'queued'});
    mocks.pollJob.mockResolvedValue(succeeded);
    render(<Inspector shot={shot}/>);
    await userEvent.click(screen.getByRole('button',{name:'生成画面'}));
    await waitFor(()=>expect(mocks.listPanelVersions).toHaveBeenCalledTimes(2));
  });

  it('shows panel generation request failures and releases the action', async () => {
    mocks.startPanelGeneration.mockRejectedValue(new Error('本地 API 暂时不可用，请稍后重试'));
    render(<Inspector shot={shot}/>);

    await userEvent.click(screen.getByRole('button',{name:'生成画面'}));

    expect(await screen.findByText('本地 API 暂时不可用，请稍后重试')).toBeVisible();
    expect(screen.getByRole('button',{name:'生成画面'})).toBeEnabled();
  });

  it('activates panel versions without embedding dialogue editing', async () => {
    mocks.listPanelVersions.mockResolvedValue([asset]);
    mocks.activatePanel.mockResolvedValue({...shot,active_panel_asset_id:'asset-1'});
    render(<Inspector shot={shot}/>);
    await userEvent.click(await screen.findByRole('button',{name:/画面版本 2/}));
    await waitFor(()=>expect(mocks.activatePanel).toHaveBeenCalledWith('shot-1','asset-1'));
    expect(screen.queryByLabelText('对白文本')).not.toBeInTheDocument();
  });
});
