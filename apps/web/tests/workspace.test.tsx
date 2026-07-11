import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {useState} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Workspace} from '../components/Workspace';
import {WorkspaceTabs, type WorkArea} from '../components/WorkspaceTabs';
import type {EpisodeDetail, Job, ProductionReadiness, Project, ProjectDetail} from '../lib/types';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(), getProject: vi.fn(), getEpisode: vi.fn(),
  createProject: vi.fn(), createEpisode: vi.fn(), startPlanning: vi.fn(),
  previewEpisodeDeletion: vi.fn(), deleteEpisode: vi.fn(),
  listPanelVersions: vi.fn(), getProductionReadiness: vi.fn(), getProviderHealth: vi.fn(), startRender: vi.fn(), pollJob: vi.fn(),
  getProductionRun: vi.fn(), createProductionRun: vi.fn(), continueProductionRun: vi.fn(), pauseProductionRun: vi.fn(),
  listProductionItems: vi.fn(), retryProductionRun: vi.fn(),
  getProviderChannels: vi.fn(), updateProviderChannel: vi.fn(), testProviderChannel: vi.fn(),
  listVideoVersions: vi.fn(), startVideoGeneration: vi.fn(), activateVideo: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  listProjects: mocks.listProjects, getProject: mocks.getProject,
  getEpisode: mocks.getEpisode, createProject: mocks.createProject,
  createEpisode: mocks.createEpisode, startPlanning: mocks.startPlanning,
  previewEpisodeDeletion: mocks.previewEpisodeDeletion, deleteEpisode: mocks.deleteEpisode,
  listPanelVersions: mocks.listPanelVersions,
  getProductionReadiness: mocks.getProductionReadiness,
  getProviderHealth: mocks.getProviderHealth, startRender: mocks.startRender,
  getProductionRun: mocks.getProductionRun, createProductionRun: mocks.createProductionRun,
  continueProductionRun: mocks.continueProductionRun, pauseProductionRun: mocks.pauseProductionRun,
  listProductionItems: mocks.listProductionItems, retryProductionRun: mocks.retryProductionRun,
  getProviderChannels: mocks.getProviderChannels, updateProviderChannel: mocks.updateProviderChannel,
  testProviderChannel: mocks.testProviderChannel,
  listVideoVersions: mocks.listVideoVersions, startVideoGeneration: mocks.startVideoGeneration, activateVideo: mocks.activateVideo,
  mediaUrl: (path: string) => path,
}));
vi.mock('../lib/jobs', () => ({pollJob: mocks.pollJob}));

const project: Project = {
  id: 'project-1', title: '霓虹夜行', logline: '寻找记忆', story_bible: '近未来重庆',
  visual_style: 'Chinese noir', aspect_ratio: '9:16', language: 'Chinese',
  created_at: '', updated_at: '',
};
const projectDetail: ProjectDetail = {
  ...project, characters: [], episodes: [{
    id: 'episode-1', project_id: project.id, title: '失窃的雨夜', premise: '寻找芯片',
    target_duration_seconds: 60, status: 'draft', created_at: '', updated_at: '',
  }],
};
const plannedEpisode: EpisodeDetail = {
  ...projectDetail.episodes[0], status: 'planned', scenes: [{
    id: 'scene-1', position: 1, location: '雨夜巷道', time_of_day: 'night',
    summary: '发现芯片', continuity_state: {}, estimated_duration_seconds: 10,
    shots: [{
      id: 'shot-1', position: 1, shot_type: 'wide', duration_seconds: 4,
      composition: '林默走入巷道', camera_motion: 'push_in', character_state: {},
      review_status: 'draft', render_status: 'pending', image_prompt: 'wide comic shot',
      negative_prompt: '', active_panel_asset_id: null, dialogue: [],
    }, {
      id: 'shot-2', position: 2, shot_type: 'close_up', duration_seconds: 3,
      composition: '林默拾起发光芯片', camera_motion: 'still', character_state: {},
      review_status: 'approved', render_status: 'completed', image_prompt: 'close comic shot',
      negative_prompt: '', active_panel_asset_id: 'asset-2', dialogue: [],
    }],
  }],
};
const readiness: ProductionReadiness = {
  episode_id: 'episode-1', ready: false,
  totals: {shots: 2, dialogue: 0},
  ready_counts: {panels: 1, approved: 1, speech: 0},
  blockers: {missing_panels: ['shot-1'], unapproved_shots: ['shot-1'], missing_speech: []},
};
const succeededJob: Job = {
  id: 'job-1', operation: 'plan_episode', target_type: 'episode', target_id: 'episode-1',
  status: 'succeeded', progress: 100, result_metadata: {}, error: '', retry_count: 0,
  created_at: '', updated_at: '',
};
const workspaceStyles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

function mediaController(initialMatches: boolean) {
  let matches = initialMatches;
  let listener: (() => void) | undefined;
  const media = {
    get matches() {return matches;},
    media: '(max-width: 899px)',
    onchange: null,
    addEventListener: vi.fn((_event: string, next: () => void) => {listener = next;}),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  return {
    media,
    setMatches(next: boolean) {
      matches = next;
      listener?.();
    },
  };
}

function TabsHarness() {
  const [value, setValue] = useState<WorkArea>('overview');
  return <WorkspaceTabs value={value} onChange={setValue}/>;
}

function RejectedTabsHarness() {
  return <WorkspaceTabs value="settings" onChange={() => false}/>;
}

describe('Workspace', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.listPanelVersions.mockResolvedValue([]);
    mocks.listVideoVersions.mockResolvedValue([]);
    mocks.getProductionReadiness.mockResolvedValue(readiness);
    mocks.listProductionItems.mockResolvedValue([]);
    mocks.previewEpisodeDeletion.mockResolvedValue({
      episode_id:'episode-2',title:'第二集',
      deleted:{scenes:2,shots:3,dialogue_lines:4,assets:5},
    });
  });

  it('opens episode deletion impact without selecting the requested episode', async () => {
    const second={...projectDetail.episodes[0],id:'episode-2',title:'第二集'};
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue({...projectDetail,episodes:[projectDetail.episodes[0],second]});
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace/>);

    expect(await screen.findByRole('heading',{name:'失窃的雨夜'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'删除剧集：第二集'}));

    expect(await screen.findByRole('dialog',{name:'永久删除剧集'})).toBeVisible();
    expect(screen.getByText('2 个场景')).toBeVisible();
    expect(screen.getByText('3 个分镜')).toBeVisible();
    expect(screen.getByText('4 条对白')).toBeVisible();
    expect(screen.getByText('5 个媒体素材')).toBeVisible();
    expect(mocks.previewEpisodeDeletion).toHaveBeenCalledWith('episode-2');
    expect(mocks.getEpisode).not.toHaveBeenCalledWith('episode-2');
  });

  it('selects the next episode after deleting the active first episode',async()=>{
    const second={...projectDetail.episodes[0],id:'episode-2',title:'第二集'};
    const before={...projectDetail,episodes:[projectDetail.episodes[0],second]};
    const after={...projectDetail,episodes:[second]};
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    mocks.getEpisode.mockImplementation(async(id:string)=>({...plannedEpisode,id,title:id==='episode-2'?'第二集':'失窃的雨夜'}));
    mocks.previewEpisodeDeletion.mockResolvedValue({episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0}});
    mocks.deleteEpisode.mockResolvedValue({episode_id:'episode-1',deleted_episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0},cleanup_warnings:[]});
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：失窃的雨夜'}));
    await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    await waitFor(()=>expect(mocks.getEpisode).toHaveBeenLastCalledWith('episode-2'));
    expect(localStorage.getItem('ai-comic-episode')).toBe('episode-2');
  });

  it('selects the previous episode after deleting the active last episode',async()=>{
    const first={...projectDetail.episodes[0],id:'episode-1',title:'第一集'};
    const second={...projectDetail.episodes[0],id:'episode-2',title:'第二集'};
    const third={...projectDetail.episodes[0],id:'episode-3',title:'第三集'};
    localStorage.setItem('ai-comic-episode','episode-3');
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValueOnce({...projectDetail,episodes:[first,second,third]}).mockResolvedValueOnce({...projectDetail,episodes:[first,second]});
    mocks.getEpisode.mockImplementation(async(id:string)=>({...plannedEpisode,id,title:id==='episode-3'?'第三集':'第二集'}));
    mocks.previewEpisodeDeletion.mockResolvedValue({episode_id:'episode-3',title:'第三集',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0}});
    mocks.deleteEpisode.mockResolvedValue({episode_id:'episode-3',deleted_episode_id:'episode-3',title:'第三集',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0},cleanup_warnings:[]});
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：第三集'}));
    await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    await waitFor(()=>expect(mocks.getEpisode).toHaveBeenLastCalledWith('episode-2'));
  });

  it('clears the selected episode after deleting the only episode',async()=>{
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValueOnce(projectDetail).mockResolvedValueOnce({...projectDetail,episodes:[]});
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.previewEpisodeDeletion.mockResolvedValue({episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0}});
    mocks.deleteEpisode.mockResolvedValue({episode_id:'episode-1',deleted_episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0},cleanup_warnings:[]});
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：失窃的雨夜'}));
    await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    await waitFor(()=>expect(localStorage.getItem('ai-comic-episode')).toBeNull());
    expect(await screen.findByRole('button',{name:'新建剧集'})).toBeVisible();
  });

  it('keeps the dialog open when episode deletion fails',async()=>{
    mocks.listProjects.mockResolvedValue([project]);mocks.getProject.mockResolvedValue(projectDetail);mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.previewEpisodeDeletion.mockResolvedValue({episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0}});
    mocks.deleteEpisode.mockRejectedValue(new Error('删除服务不可用'));
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：失窃的雨夜'}));
    await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除服务不可用');
    expect(screen.getByRole('dialog',{name:'永久删除剧集'})).toBeVisible();
  });

  it('preserves the active episode when deleting another episode',async()=>{
    const second={...projectDetail.episodes[0],id:'episode-2',title:'第二集'};
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValueOnce({...projectDetail,episodes:[projectDetail.episodes[0],second]}).mockResolvedValueOnce(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.deleteEpisode.mockResolvedValue({episode_id:'episode-2',deleted_episode_id:'episode-2',title:'第二集',deleted:{scenes:2,shots:3,dialogue_lines:4,assets:5},cleanup_warnings:[]});
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：第二集'}));
    await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    await waitFor(()=>expect(mocks.deleteEpisode).toHaveBeenCalledWith('episode-2'));
    expect(mocks.getEpisode).toHaveBeenLastCalledWith('episode-1');
    expect(localStorage.getItem('ai-comic-episode')).toBe('episode-1');
  });

  it('shows a cleanup warning after the episode has been deleted',async()=>{
    mocks.listProjects.mockResolvedValue([project]);mocks.getProject.mockResolvedValueOnce(projectDetail).mockResolvedValueOnce({...projectDetail,episodes:[]});mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.previewEpisodeDeletion.mockResolvedValue({episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:1}});
    mocks.deleteEpisode.mockResolvedValue({episode_id:'episode-1',deleted_episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:1},cleanup_warnings:['Could not remove one local media file']});
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：失窃的雨夜'}));await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    expect(await screen.findByRole('status')).toHaveTextContent('本地文件未能清理');
    expect(screen.queryByRole('button',{name:'永久删除'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'关闭清理提示'})).toBeVisible();
  });

  it('ignores a deletion completion after navigating to another project',async()=>{
    const pending=deferred<Awaited<ReturnType<typeof mocks.deleteEpisode>>>();
    const projectB={...project,id:'project-2',title:'另一个项目'};
    const episodeB={...projectDetail.episodes[0],id:'episode-b',project_id:'project-2',title:'另一集'};
    mocks.listProjects.mockResolvedValue([project,projectB]);
    mocks.getProject.mockImplementation(async(id:string)=>id==='project-2'?{...projectB,characters:[],episodes:[episodeB]}:projectDetail);
    mocks.getEpisode.mockImplementation(async(id:string)=>({...plannedEpisode,id,project_id:id==='episode-b'?'project-2':'project-1',title:id==='episode-b'?'另一集':'失窃的雨夜'}));
    mocks.previewEpisodeDeletion.mockResolvedValue({episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0}});
    mocks.deleteEpisode.mockReturnValue(pending.promise);
    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'删除剧集：失窃的雨夜'}));await userEvent.click(await screen.findByRole('button',{name:'永久删除'}));
    await userEvent.selectOptions(screen.getAllByLabelText('选择项目')[1],'project-2');
    expect(await screen.findByRole('heading',{name:'另一集'})).toBeVisible();
    pending.resolve({episode_id:'episode-1',deleted_episode_id:'episode-1',title:'失窃的雨夜',deleted:{scenes:1,shots:2,dialogue_lines:0,assets:0},cleanup_warnings:[]});
    await act(async()=>{await Promise.resolve();});
    expect(screen.getByRole('heading',{name:'另一集'})).toBeVisible();
    expect(screen.queryByRole('dialog',{name:'永久删除剧集'})).not.toBeInTheDocument();
  });

  it('opens provider settings without a project and returns to the create-project empty state', async () => {
    mocks.listProjects.mockResolvedValue([]);
    mocks.getProviderChannels.mockResolvedValue({
      llm: {name: 'MiniMax', enabled: true, base_url: 'https://api.example.com', model: 'M3', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      image: {name: 'Image', enabled: true, base_url: 'https://image.example.com', model: 'gpt-image-2', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      tts: {name: 'TTS', enabled: true, base_url: 'https://tts.example.com', model: 'qwen', ssh_host: '', api_key_configured: false, api_key_masked: ''},
      persistence: {status: 'saved', file_path: 'data/provider-channels.json'}, reloaded_at: '',
    });

    render(<Workspace />);

    expect(await screen.findByRole('heading', {name: '新建第一个项目'})).toBeVisible();
    expect(screen.getByRole('button', {name: '创建项目'})).toBeEnabled();
    await userEvent.click(screen.getByRole('tab', {name: '模型渠道'}));

    expect(await screen.findByRole('heading', {name: '模型渠道'})).toBeVisible();
    expect(mocks.getProviderChannels).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', {name: '模型渠道'})).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('workspace-panel-settings')).toHaveAttribute('role', 'tabpanel');

    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'M4');
    await userEvent.click(screen.getByRole('tab', {name: '总览'}));
    expect(confirm).toHaveBeenCalledWith('模型渠道有未保存更改，确定离开吗？');
    expect(screen.getByRole('heading', {name: '模型渠道'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '总览'}));
    expect(screen.getByRole('heading', {name: '新建第一个项目'})).toBeVisible();
    expect(screen.getByRole('button', {name: '创建项目'})).toBeEnabled();
  });

  it('keeps provider settings reachable on mobile without a project', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 899px)', media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    mocks.listProjects.mockResolvedValue([]);
    mocks.getProviderChannels.mockResolvedValue({
      llm: {name: 'MiniMax', enabled: true, base_url: 'https://api.example.com', model: 'M3', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      image: {name: 'Image', enabled: true, base_url: 'https://image.example.com', model: 'gpt-image-2', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      tts: {name: 'TTS', enabled: true, base_url: 'https://tts.example.com', model: 'qwen', ssh_host: '', api_key_configured: false, api_key_masked: ''},
      persistence: {status: 'saved', file_path: 'data/provider-channels.json'}, reloaded_at: '',
    });

    render(<Workspace/>);

    await userEvent.click(await screen.findByRole('tab', {name: '模型渠道'}));
    expect(await screen.findByRole('heading', {name: '模型渠道'})).toBeVisible();
    expect(document.querySelector('.workspace-tabs-mobile')).toHaveClass('workspace-tabs-full');
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-settings', 'workspace-grid-empty');
    expect(workspaceStyles).toMatch(/\.workspace-tabs-mobile\.workspace-tabs-full\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('returns to overview when refresh removes the active project', async () => {
    mocks.listProjects.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace/>);

    await userEvent.click(await screen.findByRole('tab', {name: '生产'}));
    expect(screen.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '刷新项目'}));

    expect(await screen.findByRole('heading', {name: '新建第一个项目'})).toBeVisible();
    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('tabindex', '0');
    expect(document.getElementById('workspace-panel-overview')).toHaveAttribute('role', 'tabpanel');
  });

  it('keeps provider settings active when refresh removes the active project', async () => {
    mocks.listProjects.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProviderChannels.mockResolvedValue({
      llm: {name: 'MiniMax', enabled: true, base_url: 'https://api.example.com', model: 'M3', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      image: {name: 'Image', enabled: true, base_url: 'https://image.example.com', model: 'gpt-image-2', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      tts: {name: 'TTS', enabled: true, base_url: 'https://tts.example.com', model: 'qwen', ssh_host: '', api_key_configured: false, api_key_masked: ''},
      persistence: {status: 'saved', file_path: 'data/provider-channels.json'}, reloaded_at: '',
    });

    render(<Workspace/>);

    await userEvent.click(await screen.findByRole('tab', {name: '模型渠道'}));
    expect(await screen.findByRole('heading', {name: '模型渠道'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '刷新项目'}));

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('tab', {name: '模型渠道'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: '模型渠道'})).toHaveAttribute('tabindex', '0');
    expect(document.getElementById('workspace-panel-settings')).toHaveAttribute('role', 'tabpanel');
  });

  it('loads persisted projects and plans an empty episode', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode
      .mockResolvedValueOnce({...projectDetail.episodes[0], scenes: []})
      .mockResolvedValueOnce(plannedEpisode);
    mocks.startPlanning.mockResolvedValue(succeededJob);
    mocks.pollJob.mockResolvedValue(succeededJob);

    render(<Workspace />);

    expect(await screen.findByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));
    await userEvent.click(screen.getByRole('button', {name: '根据本集设定生成分镜'}));

    expect(await screen.findByText('场景 1')).toBeVisible();
    expect(screen.getByRole('button', {name: /镜头 1/})).toBeEnabled();
    await waitFor(() => expect(mocks.startPlanning).toHaveBeenCalledWith('episode-1'));
  });

  it('shows immediate feedback while the planning request is starting', async () => {
    const pending = deferred<Job>();
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue({...projectDetail.episodes[0], scenes: []});
    mocks.startPlanning.mockReturnValue(pending.promise);

    render(<Workspace />);

    await userEvent.click(await screen.findByRole('tab', {name: '分镜'}));
    await userEvent.click(screen.getByRole('button', {name: '根据本集设定生成分镜'}));

    expect(screen.getByRole('button', {name: '正在启动分镜规划'})).toBeDisabled();
    expect(screen.getByLabelText('分镜规划启动中')).toBeVisible();
  });

  it('does not expose whole-episode planning for an existing storyboard', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.startPlanning.mockResolvedValue(succeededJob);
    mocks.pollJob.mockResolvedValue(succeededJob);
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('tab', {name: '分镜'}));
    expect(screen.queryByRole('button', {name: '重新生成分镜'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: '根据本集设定生成分镜'})).not.toBeInTheDocument();
    expect(mocks.startPlanning).not.toHaveBeenCalled();
  });

  it('exposes the active project context and accessible studio commands', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProviderHealth.mockResolvedValue({
      planning: {status: 'configured'},
      image: {status: 'configured'},
      speech: {status: 'disabled'},
    });

    render(<Workspace />);

    expect(await screen.findByText('霓虹夜行 / 失窃的雨夜')).toBeVisible();
    expect(screen.getByRole('button', {name: '刷新项目'})).toHaveAttribute('title', '刷新项目');
    expect(screen.getByRole('button', {name: '批量生产'})).toHaveAttribute('title', '批量生产');
    expect(screen.queryByRole('button', {name: '设置'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '渲染本集'})).toHaveAttribute('title', '素材未就绪');

    await userEvent.click(screen.getByRole('button', {name: '模型渠道配置状态'}));
    expect(await screen.findByText('2/3 已配置')).toBeVisible();
  });

  it('groups episodes and project resources while marking the active episode', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace />);

    expect(await screen.findByRole('heading', {name: '剧集'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '项目资料'})).toBeVisible();
    expect(screen.getByRole('button', {name: '故事圣经'})).toBeVisible();
    expect(screen.getByRole('button', {name: '角色设定'})).toBeVisible();
    expect(screen.getByRole('button', {current: 'page'})).toHaveAccessibleName(/失窃的雨夜/);
  });

  it('opens the real provider settings workspace and confirms leaving dirty changes', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProviderChannels.mockResolvedValue({
      llm: {name: 'MiniMax', enabled: true, base_url: 'https://api.example.com', model: 'M3', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      image: {name: 'Image', enabled: true, base_url: 'https://image.example.com', model: 'gpt-image-2', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••'},
      tts: {name: 'TTS', enabled: true, base_url: 'https://tts.example.com', model: 'qwen', ssh_host: '', api_key_configured: false, api_key_masked: ''},
      persistence: {status: 'saved', file_path: 'data/provider-channels.json'}, reloaded_at: '',
    });
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    render(<Workspace/>);

    await userEvent.click(await screen.findByRole('button', {name: '模型渠道'}));
    expect(screen.getByRole('heading', {name: '模型渠道'})).toBeVisible();
    expect(screen.getByRole('tab', {name: '模型渠道'})).toHaveAttribute('aria-selected', 'true');
    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'M4');

    await userEvent.click(screen.getByRole('tab', {name: '总览'}));
    expect(confirm).toHaveBeenCalledWith('模型渠道有未保存更改，确定离开吗？');
    expect(screen.getByRole('heading', {name: '模型渠道'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '总览'}));
    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
  });

  it('opens on overview and navigates between episode work areas', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace />);

    const overviewTab = await screen.findByRole('tab', {name: '总览'});
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('aria-controls', 'workspace-panel-overview');
    expect(document.getElementById('workspace-panel-overview')).toHaveAttribute('role', 'tabpanel');
    expect(screen.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));
    expect(screen.getByRole('tab', {name: '分镜'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));
    expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '生产'}));
    expect(screen.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '审核'}));
    expect(screen.getByRole('heading', {name: '审核队列'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: /镜头 1/}));
    expect(screen.getByRole('heading', {name: '镜头 1'})).toBeVisible();
  });

  it('numbers an opaque episode id from its later ordered project position', async () => {
    const opaqueId = '550e8400-e29b-41d4-a716-44665544abcd';
    const opaqueSummary = {...projectDetail.episodes[0], id: opaqueId};
    const opaqueProject = {...projectDetail, episodes: [
      {...projectDetail.episodes[0], id: 'first-episode', title: '第一集'},
      {...projectDetail.episodes[0], id: 'second-episode', title: '第二集'},
      opaqueSummary,
    ]};
    const opaqueEpisode = {...plannedEpisode, ...opaqueSummary};
    localStorage.setItem('ai-comic-episode', opaqueId);
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(opaqueProject);
    mocks.getEpisode.mockResolvedValue(opaqueEpisode);
    mocks.getProductionReadiness.mockResolvedValue({...readiness, episode_id: opaqueId});

    render(<Workspace />);

    expect(await screen.findByText('第 03 集')).toBeVisible();
  });

  it('preserves the selected shot when switching from overview to storyboard', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace />);

    await userEvent.click(await screen.findByRole('button', {name: /镜头 2/}));
    expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));

    expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();
    expect(screen.getByRole('button', {name: /镜头 2/})).toHaveClass('selected');
  });

  it('keeps only the selected mobile work area visible', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 899px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace />);

    expect(await screen.findByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-overview');
    expect(workspaceStyles).toMatch(/\.mobile-overview \.workspace-inspector\s*\{\s*display:\s*none/);

    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-storyboard');
    expect(workspaceStyles).toMatch(/\.mobile-storyboard \.workspace-inspector\s*\{\s*display:\s*none/);

    await userEvent.click(screen.getByRole('tab', {name: '检查器'}));
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-inspector');
    expect(workspaceStyles).toMatch(/\.mobile-inspector \.workspace-center\s*\{\s*display:\s*none/);

    await userEvent.click(screen.getByRole('tab', {name: '模型渠道'}));
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-settings');
    expect(workspaceStyles).toMatch(/\.mobile-settings \.workspace-inspector[^}]*display:\s*none/);
  });

  it('keeps seven mobile work areas in one stable 44px tab row', () => {
    const mobileTabsRule = workspaceStyles.match(/\.workspace-tabs-mobile\s*\{[^}]*grid-template-columns:\s*repeat\((\d+),\s*minmax\(0,\s*1fr\)\)[^}]*\}/);

    expect(mobileTabsRule?.[1]).toBe('7');
    expect(workspaceStyles).toMatch(/\.workspace-tabs-mobile\s*\{[^}]*flex:\s*0 0 44px[^}]*width:\s*100%[^}]*display:\s*grid/);
    expect(workspaceStyles).toMatch(/\.workspace-tabs-mobile button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*none/);
  });

  it('opens the first relevant blocker in the mobile inspector from the review action', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => mediaController(true).media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('button', {name: '处理阻塞项'}));

    expect(screen.getByRole('tab', {name: '检查器'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', {name: '镜头 1'})).toBeVisible();
    expect(screen.getByLabelText('审核状态')).toHaveValue('draft');
    expect(screen.queryByRole('tab', {name: '审核'})).not.toBeInTheDocument();
  });

  it('keeps a valid mobile overview tab when review has no relevant shot', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => mediaController(true).media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockResolvedValue({...readiness, blockers: {missing_panels: [], unapproved_shots: [], missing_speech: []}});
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('button', {name: '处理阻塞项'}));

    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').some(tab => tab.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('reports initial readiness failure without authoritative zero blockers', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockRejectedValue(new Error('readiness offline'));
    render(<Workspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent('渲染准备状态暂时无法获取');
    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', {name: '剧集总览暂不可用'})).toBeVisible();
    expect(screen.queryByText('制作剧集')).not.toBeInTheDocument();
    expect(screen.queryByText('缺少画面 0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '渲染本集'})).toBeDisabled();
  });

  it('preserves the last valid readiness when refresh fails', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockResolvedValueOnce(readiness).mockRejectedValueOnce(new Error('readiness offline'));
    render(<Workspace />);
    expect(await screen.findByText('缺少画面 1')).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '刷新项目'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('渲染准备状态暂时无法获取');
    expect(screen.getByText('缺少画面 1')).toBeVisible();
    expect(screen.getByRole('button', {name: '渲染本集'})).toBeDisabled();
  });

  it('uses a non-clipping flex layout for toolbar, tabs, and workspace', () => {
    expect(workspaceStyles).toMatch(/\.app-shell\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
    expect(workspaceStyles).toMatch(/\.workspace-grid\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*height:\s*auto/);
  });

  it('keeps responsive workspace grid overrides after the modern desktop rule', () => {
    const modernDesktopRule = workspaceStyles.lastIndexOf('.workspace-grid { grid-template-columns: 248px minmax(480px, 1fr) 326px;');
    const compactDesktopRule = workspaceStyles.lastIndexOf('.workspace-grid { grid-template-columns: 210px minmax(400px, 1fr) 296px;');
    const mobileRule = workspaceStyles.lastIndexOf('.workspace-grid { grid-template-columns: 1fr;');

    expect(modernDesktopRule).toBeGreaterThan(-1);
    expect(compactDesktopRule).toBeGreaterThan(modernDesktopRule);
    expect(mobileRule).toBeGreaterThan(compactDesktopRule);
  });

  it('keeps the empty workspace grid full-width after responsive grid overrides', () => {
    const compactDesktopRule = workspaceStyles.lastIndexOf('.workspace-grid { grid-template-columns: 210px minmax(400px, 1fr) 296px;');
    const narrowDesktopRule = workspaceStyles.lastIndexOf('.workspace-grid { grid-template-columns: 200px minmax(0, 1fr) 280px;');
    const emptyRule = workspaceStyles.lastIndexOf('.workspace-grid.workspace-grid-empty { grid-template-columns: minmax(0, 1fr);');
    const compactTabsRule = workspaceStyles.lastIndexOf('.workspace-tabs { padding-left: 210px;');
    const narrowTabsRule = workspaceStyles.lastIndexOf('.workspace-tabs { padding-left: 200px;');
    const fullTabsRule = workspaceStyles.lastIndexOf('.workspace-tabs.workspace-tabs-full { padding-left: 0;');

    expect(emptyRule).toBeGreaterThan(compactDesktopRule);
    expect(emptyRule).toBeGreaterThan(narrowDesktopRule);
    expect(fullTabsRule).toBeGreaterThan(compactTabsRule);
    expect(fullTabsRule).toBeGreaterThan(narrowTabsRule);
  });

  it('uses stronger semantic colors with accessible shell contrast', () => {
    const mutedStrong = workspaceStyles.match(/--muted-strong:\s*(#[a-f\d]{6})/i)?.[1];
    const accentStrong = workspaceStyles.match(/--accent-strong:\s*(#[a-f\d]{6})/i)?.[1];

    expect(mutedStrong).toBeTruthy();
    expect(accentStrong).toBeTruthy();
    expect(contrastRatio(mutedStrong!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mutedStrong!, '#f8f9fa')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', accentStrong!)).toBeGreaterThanOrEqual(4.5);
    expect(workspaceStyles).toMatch(/\.workspace-breadcrumb\s*\{[^}]*color:\s*var\(--muted-strong\)/);
    expect(workspaceStyles).toMatch(/\.nav-footer\s*\{[^}]*color:\s*var\(--muted-strong\)/);
    expect(workspaceStyles).toMatch(/\.center-state p, \.episode-empty p\s*\{[^}]*color:\s*var\(--muted-strong\)/);
    expect(workspaceStyles).toMatch(/\.empty-inspector\s*\{[^}]*color:\s*var\(--muted-strong\)/);
    expect(workspaceStyles).toMatch(/\.command-button\s*\{[^}]*background:\s*var\(--accent-strong\)/);
    expect(workspaceStyles).toMatch(/\.inspector-actions \.primary-action[^}]*background:\s*var\(--accent-strong\)/);
  });

  it('normalizes inspector when the viewport switches from mobile to desktop', async () => {
    const viewport = mediaController(true);
    vi.stubGlobal('matchMedia', vi.fn(() => viewport.media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('tab', {name: '检查器'}));
    expect(screen.getByRole('tab', {name: '检查器'})).toHaveAttribute('aria-selected', 'true');
    act(() => viewport.setMatches(false));

    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', {name: '检查器'})).not.toBeInTheDocument();
  });

  it('normalizes review when the viewport switches from desktop to mobile', async () => {
    const viewport = mediaController(false);
    vi.stubGlobal('matchMedia', vi.fn(() => viewport.media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('tab', {name: '审核'}));
    expect(screen.getByRole('tab', {name: '审核'})).toHaveAttribute('aria-selected', 'true');
    act(() => viewport.setMatches(true));

    expect(screen.getByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', {name: '审核'})).not.toBeInTheDocument();
  });

  it('keeps the latest episode when an older request resolves last', async () => {
    const episodeA = {...projectDetail.episodes[0], id: 'episode-a', title: '剧集 A'};
    const episodeB = {...projectDetail.episodes[0], id: 'episode-b', title: '剧集 B'};
    const episodeC = {...projectDetail.episodes[0], id: 'episode-c', title: '剧集 C'};
    const detail = {...projectDetail, episodes: [episodeA, episodeB, episodeC]};
    const requestA = deferred<EpisodeDetail>();
    const requestB = deferred<EpisodeDetail>();
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(detail);
    mocks.getEpisode.mockImplementation((id: string) => {
      if (id === 'episode-a') return requestA.promise;
      if (id === 'episode-b') return requestB.promise;
      return Promise.resolve({...plannedEpisode, ...episodeC});
    });
    localStorage.setItem('ai-comic-episode', 'episode-c');
    render(<Workspace />);
    const selector = await screen.findByRole('combobox', {name: '选择剧集'});

    await userEvent.selectOptions(selector, 'episode-a');
    await userEvent.selectOptions(selector, 'episode-b');
    requestB.resolve({...plannedEpisode, ...episodeB});
    expect(await screen.findByRole('heading', {name: '剧集 B'})).toBeVisible();
    requestA.resolve({...plannedEpisode, ...episodeA});
    await act(async () => {await requestA.promise;});

    expect(selector).toHaveValue('episode-b');
    expect(screen.getByRole('heading', {name: '剧集 B'})).toBeVisible();
    expect(localStorage.getItem('ai-comic-episode')).toBe('episode-b');
  });

  it('supports roving keyboard navigation across workspace tabs', async () => {
    render(<TabsHarness />);
    const overview = screen.getByRole('tab', {name: '总览'});
    const scriptImport = screen.getByRole('tab', {name: '剧本创作'});
    const characters = screen.getByRole('tab', {name: '角色'});
    const storyboard = screen.getByRole('tab', {name: '分镜'});

    expect(overview).toHaveAttribute('tabindex', '0');
    expect(storyboard).toHaveAttribute('tabindex', '-1');
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(scriptImport).toHaveFocus();
    expect(scriptImport).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(characters).toHaveFocus();
    expect(characters).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(storyboard).toHaveFocus();
    expect(storyboard).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', {name: '模型渠道'})).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(overview).toHaveFocus();
  });

  it('keeps selected tab focus when guarded click or keyboard navigation is rejected', async () => {
    render(<RejectedTabsHarness/>);
    const settings = screen.getByRole('tab', {name: '模型渠道'});
    const overview = screen.getByRole('tab', {name: '总览'});
    settings.focus();

    await userEvent.keyboard('{Home}');
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '-1');

    await userEvent.click(overview);
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute('aria-selected', 'true');
  });

  it('provides a matching tabpanel for every visible tab', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    render(<Workspace />);

    const tabs = await screen.findAllByRole('tab');
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId!)).toHaveAttribute('role', 'tabpanel');
    }
  });
});
