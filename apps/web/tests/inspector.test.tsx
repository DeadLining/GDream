import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Inspector} from '../components/Inspector';
import type {Job, Shot} from '../lib/types';

const mocks = vi.hoisted(() => ({
  listPanelVersions: vi.fn(), updateShot: vi.fn(), startPanelGeneration: vi.fn(),
  activatePanel: vi.fn(), updateDialogue: vi.fn(), startSpeech: vi.fn(), retryJob: vi.fn(),
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

describe('Inspector', () => {
  afterEach(cleanup);
  beforeEach(() => {vi.clearAllMocks();mocks.listPanelVersions.mockResolvedValue([]);});

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

  it('generates a panel and speech through persisted jobs', async () => {
    mocks.startPanelGeneration.mockResolvedValue({job_id:'job-1',status:'queued'});
    mocks.startSpeech.mockResolvedValue({job_id:'job-2',status:'queued'});
    mocks.pollJob.mockResolvedValue(succeeded);
    render(<Inspector shot={shot}/>);
    await userEvent.click(screen.getByRole('button',{name:'生成画面'}));
    await waitFor(()=>expect(mocks.listPanelVersions).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button',{name:'生成配音'}));
    expect(await screen.findByLabelText('对白音频')).toBeVisible();
  });
});
