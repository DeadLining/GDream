import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EpisodeAIRunControls} from '../components/production-canvas/EpisodeAIRunControls';

const mocks=vi.hoisted(()=>({
  createEpisodeAIRun:vi.fn(),
  getActiveEpisodeAIRun:vi.fn(),
  getEpisodeAIRun:vi.fn(),
  pauseEpisodeAIRun:vi.fn(),
  continueEpisodeAIRun:vi.fn(),
  retryEpisodeAIRun:vi.fn(),
}));
vi.mock('../lib/api',()=>mocks);

const stages=[
  'scripting','structuring','references','panels','panel_review','speech',
  'videos','rendering','quality_review','release_candidate','release_gate','published',
].map((stage,index)=>({
  id:`stage-${index}`,run_id:'ai-run-1',stage,position:index+1,
  status:index<2?'skipped':index===2?'running':'pending',attempt_count:index===2?1:0,
  input_snapshot:{},output_metadata:{},error:'',started_at:null,completed_at:null,
  created_at:'',updated_at:'',
}));
const queued={
  id:'ai-run-1',episode_id:'ep-1',status:'queued',current_stage:'references',progress:16,
  automation_policy:{approval_mode:'ai_default'},idempotency_key:'key-1',pause_requested:false,
  error:'',stages,created_at:'',updated_at:'',
};

describe('EpisodeAIRunControls',()=>{
  afterEach(cleanup);
  beforeEach(()=>{
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getActiveEpisodeAIRun.mockResolvedValue(null);
    mocks.createEpisodeAIRun.mockResolvedValue(queued);
    mocks.getEpisodeAIRun.mockResolvedValue({...queued,status:'completed',current_stage:'published',progress:100,stages:stages.map(item=>({...item,status:item.status==='skipped'?'skipped':'succeeded'}))});
  });

  it('starts the default AI full-episode run and follows it to completion',async()=>{
    render(<EpisodeAIRunControls episodeId="ep-1"/>);
    await userEvent.click(await screen.findByRole('button',{name:'AI 生成整集'}));
    expect(mocks.createEpisodeAIRun).toHaveBeenCalledWith('ep-1',expect.objectContaining({
      automation_policy:expect.objectContaining({approval_mode:'ai_default'}),
    }));
    expect(await screen.findByText('整集成片已完成')).toBeVisible();
    expect(screen.getByRole('progressbar',{name:'整集 AI 进度'})).toHaveAttribute('aria-valuenow','100');
    expect(localStorage.getItem('ai-comic-episode-ai-ep-1')).toBe('ai-run-1');
  });

  it('restores a paused run and continues from the persisted stage',async()=>{
    localStorage.setItem('ai-comic-episode-ai-ep-1','ai-run-1');
    mocks.getEpisodeAIRun.mockResolvedValueOnce({...queued,status:'paused',pause_requested:true});
    mocks.continueEpisodeAIRun.mockResolvedValue({...queued,status:'queued',pause_requested:false});
    render(<EpisodeAIRunControls episodeId="ep-1"/>);
    await userEvent.click(await screen.findByRole('button',{name:'继续整集生成'}));
    await waitFor(()=>expect(mocks.continueEpisodeAIRun).toHaveBeenCalledWith('ai-run-1'));
    expect(await screen.findByText('整集成片已完成')).toBeVisible();
  });
});
