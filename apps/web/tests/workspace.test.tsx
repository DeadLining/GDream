import {act, cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {readAllStyles} from './_styles';
import {useState} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Workspace} from '../components/Workspace';
import {WorkspaceTabs, type WorkArea} from '../components/WorkspaceTabs';
import type {EpisodeDetail, Job, ProductionReadiness, Project, ProjectDetail} from '../lib/types';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(), getProject: vi.fn(), getEpisode: vi.fn(), listVolumes:vi.fn(),listStorylines:vi.fn(),
  getProjectOverviewMetrics:vi.fn(),
  getAsset: vi.fn(),
  createProject: vi.fn(), createEpisode: vi.fn(), startPlanning: vi.fn(),
  listPanelVersions: vi.fn(), getProductionReadiness: vi.fn(), getProviderHealth: vi.fn(), startRender: vi.fn(), pollJob: vi.fn(),
  getProductionRun: vi.fn(), createProductionRun: vi.fn(), continueProductionRun: vi.fn(), pauseProductionRun: vi.fn(),
  listProductionItems: vi.fn(), retryProductionRun: vi.fn(),
  getProviderChannels: vi.fn(), updateProviderChannel: vi.fn(), testProviderChannel: vi.fn(),
  getModelRuntimeHealth: vi.fn(), getModelRuntimeInvocations: vi.fn(), retryModelRuntimeJob: vi.fn(),
  getMockSshHosts: vi.fn(), getMockSshStatus: vi.fn(), startMockSsh: vi.fn(), stopMockSsh: vi.fn(),
  listVideoVersions: vi.fn(), startVideoGeneration: vi.fn(), activateVideo: vi.fn(),
  listVisualReviewThreads:vi.fn(),updateVisualReviewThread:vi.fn(),createVisualReviewMessage:vi.fn(),createVisualReviewThread:vi.fn(),acceptVisualReviewCandidate:vi.fn(),
  listReviewThreads:vi.fn(),createReviewMessage:vi.fn(),updateReviewThread:vi.fn(),listReleaseCandidates:vi.fn(),
  listLibraryAssets:vi.fn(),listSceneLibraryAssets:vi.fn(),bindLibraryAssetToScene:vi.fn(),unbindLibraryAssetFromScene:vi.fn(),
}));

vi.mock('../lib/api', () => ({
  listProjects: mocks.listProjects, getProject: mocks.getProject,
  getProjectOverviewMetrics:mocks.getProjectOverviewMetrics,
  listVolumes:mocks.listVolumes,listStorylines:mocks.listStorylines,
  getAsset: mocks.getAsset,
  getEpisode: mocks.getEpisode, createProject: mocks.createProject,
  createEpisode: mocks.createEpisode, startPlanning: mocks.startPlanning,
  listPanelVersions: mocks.listPanelVersions,
  getProductionReadiness: mocks.getProductionReadiness,
  getProviderHealth: mocks.getProviderHealth, startRender: mocks.startRender,
  getProductionRun: mocks.getProductionRun, createProductionRun: mocks.createProductionRun,
  continueProductionRun: mocks.continueProductionRun, pauseProductionRun: mocks.pauseProductionRun,
  listProductionItems: mocks.listProductionItems, retryProductionRun: mocks.retryProductionRun,
  getProviderChannels: mocks.getProviderChannels, updateProviderChannel: mocks.updateProviderChannel,
  testProviderChannel: mocks.testProviderChannel,
  getModelRuntimeHealth: mocks.getModelRuntimeHealth, getModelRuntimeInvocations: mocks.getModelRuntimeInvocations,
  retryModelRuntimeJob: mocks.retryModelRuntimeJob,
  getMockSshHosts: mocks.getMockSshHosts, getMockSshStatus: mocks.getMockSshStatus,
  startMockSsh: mocks.startMockSsh, stopMockSsh: mocks.stopMockSsh,
  listVideoVersions: mocks.listVideoVersions, startVideoGeneration: mocks.startVideoGeneration, activateVideo: mocks.activateVideo,
  listVisualReviewThreads:mocks.listVisualReviewThreads,updateVisualReviewThread:mocks.updateVisualReviewThread,createVisualReviewMessage:mocks.createVisualReviewMessage,createVisualReviewThread:mocks.createVisualReviewThread,acceptVisualReviewCandidate:mocks.acceptVisualReviewCandidate,
  listReviewThreads:mocks.listReviewThreads,createReviewMessage:mocks.createReviewMessage,updateReviewThread:mocks.updateReviewThread,listReleaseCandidates:mocks.listReleaseCandidates,
  listLibraryAssets:mocks.listLibraryAssets,listSceneLibraryAssets:mocks.listSceneLibraryAssets,bindLibraryAssetToScene:mocks.bindLibraryAssetToScene,unbindLibraryAssetFromScene:mocks.unbindLibraryAssetFromScene,
  mediaUrl: (path: string) => path,
}));
vi.mock('../lib/jobs', () => ({pollJob: mocks.pollJob}));
vi.mock('../components/ScriptLibrary',()=>({ScriptLibrary:({initialView,initialStorylineId,onConfirmed}:{initialView?:string;initialStorylineId?:string;onConfirmed:()=>void})=><main><h1>{initialView==='storyline'?'故事线画布':'剧本与版本'}</h1>{initialStorylineId&&<span>聚焦故事线 {initialStorylineId}</span>}<button onClick={onConfirmed}>模拟剧本状态变化</button></main>}));

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
const workspaceStyles = readAllStyles();

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
  return <WorkspaceTabs value="production" onChange={() => false}/>;
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
    mocks.listVolumes.mockResolvedValue([]);
    mocks.listStorylines.mockResolvedValue([]);
    mocks.getProjectOverviewMetrics.mockResolvedValue({project_id:'project-1',scene_count:1,script_locked:true,asset_total:0,asset_ready:0});
    mocks.listVisualReviewThreads.mockResolvedValue([]);
    mocks.listReviewThreads.mockResolvedValue([]);
    mocks.listReleaseCandidates.mockResolvedValue([]);
    mocks.listLibraryAssets.mockResolvedValue([]);
    mocks.listSceneLibraryAssets.mockResolvedValue([]);
    mocks.getAsset.mockResolvedValue({id: 'asset-2', kind: 'panel', media_url: '/media/panel.png', media_type: 'image/png', provider: 'test', model: 'test', generation_attempt: 1, review_status: 'approved', width: 1024, height: 1536, duration_seconds: null, created_at: ''});
    mocks.listVideoVersions.mockResolvedValue([]);
    mocks.getProductionReadiness.mockResolvedValue(readiness);
    mocks.listProductionItems.mockResolvedValue([]);
    mocks.getMockSshHosts.mockResolvedValue([{id: 'a800_94', name: 'A800 94', type: 'ssh'}]);
    mocks.getMockSshStatus.mockResolvedValue({desired_running: false, state: 'stopped', host_id: null, alias: null, port: null, error: null, reused: false});
    mocks.getModelRuntimeHealth.mockResolvedValue({capabilities: {
      text: {status: 'healthy', model: 'M3', host: 'api.example.com', elapsed_ms: 3, last_invocation_elapsed_ms: null, error: null},
      image: {status: 'healthy', model: 'gpt-image-2', host: 'image.example.com', elapsed_ms: 4, last_invocation_elapsed_ms: null, error: null},
      speech: {status: 'disabled', model: 'qwen', host: 'tts.example.com', elapsed_ms: 0, last_invocation_elapsed_ms: null, error: null},
      video: {status: 'disabled', model: '', host: 'local', elapsed_ms: 0, last_invocation_elapsed_ms: null, error: null},
    }, infrastructure: {api: {status: 'healthy'}, mock_ssh: {state: 'stopped'}, queue: {queued: 0, running: 0}, persistence: {status: 'saved'}}, checked_at: '2026-07-12T10:00:00Z'});
    mocks.getModelRuntimeInvocations.mockResolvedValue([]);
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
    await userEvent.click(screen.getByRole('button', {name: '模型中心'}));

    expect(await screen.findByRole('heading', {name: '模型中心'})).toBeVisible();
    expect(mocks.getProviderChannels).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tab', {name: '模型渠道'})).not.toBeInTheDocument();

    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'M4');
    await userEvent.click(screen.getByRole('button', {name: '模型中心'}));
    expect(confirm).toHaveBeenCalledWith('模型渠道有未保存更改，确定离开吗？');
    expect(screen.getByRole('heading', {name: '模型中心'})).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '模型中心'}));
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

    await userEvent.click(await screen.findByRole('button', {name: '模型中心'}));
    expect(await screen.findByRole('heading', {name: '模型中心'})).toBeVisible();
    expect(document.querySelector('.model-center')).toBeVisible();
    expect(screen.queryByRole('tablist', {name: '工作区'})).not.toBeInTheDocument();
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
    expect(screen.queryByRole('tablist', {name: '工作区'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '单集制作'})).toHaveAttribute('aria-current', 'page');
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

    await userEvent.click(await screen.findByRole('button', {name: '模型中心'}));
    expect(await screen.findByRole('heading', {name: '模型中心'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '刷新项目'}));

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', {name: '模型中心'})).toBeVisible();
    expect(screen.queryByRole('tablist', {name: '工作区'})).not.toBeInTheDocument();
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
      llm: {status: 'ok', model: 'M3', host: 'llm.example.com', elapsed_ms: 3, check_scope: 'model', error: null},
      image: {status: 'ok', model: 'image', host: 'image.example.com', elapsed_ms: 4, check_scope: 'endpoint', error: null},
      tts: {status: 'disabled', model: 'tts', host: 'tts.example.com', elapsed_ms: 0, check_scope: 'audio', error: null},
      video: {status: 'failed', model: 'video', host: 'video.example.com', elapsed_ms: 6, check_scope: 'endpoint', error: 'offline'},
    });

    render(<Workspace />);

    expect((await screen.findAllByRole('option', {name: '霓虹夜行'})).every(option => (option as HTMLOptionElement).selected)).toBe(true);
    expect(screen.getByRole('button', {name: '01失窃的雨夜尚未规划'})).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('霓虹夜行 / 失窃的雨夜')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '刷新项目'})).toHaveAttribute('title', '刷新项目');
    expect(screen.getByRole('button', {name: '批量生产'})).toHaveAttribute('title', '批量生产');
    expect(screen.queryByRole('button', {name: '设置'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '渲染本集'})).toHaveAttribute('title', '素材未就绪');
    expect(screen.getByRole('button', {name: '检测模型服务'})).toHaveAttribute('title', '检测模型服务');
    expect(mocks.getProviderHealth).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', {name: '检测模型服务'}));
    expect(await screen.findByText('2/3 正常')).toBeVisible();
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
    expect(screen.getByRole('button', {name: /^01.*失窃的雨夜/})).toHaveAttribute('aria-current', 'page');
  });

  it('loads production readiness for every episode in the project', async () => {
    const secondEpisode = {...projectDetail.episodes[0], id: 'episode-2', title: '第二集'};
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue({...projectDetail, episodes: [projectDetail.episodes[0], secondEpisode]});
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockImplementation((id: string) => Promise.resolve({...readiness, episode_id: id}));

    render(<Workspace/>);

    await screen.findByRole('heading', {name: '失窃的雨夜'});
    await waitFor(() => {
      expect(mocks.getProductionReadiness).toHaveBeenCalledWith('episode-1');
      expect(mocks.getProductionReadiness).toHaveBeenCalledWith('episode-2');
    });
  });

  it('loads authoritative overview metrics with the selected project', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace/>);

    await screen.findByRole('heading',{name:'失窃的雨夜'});
    expect(mocks.getProjectOverviewMetrics).toHaveBeenCalledWith('project-1');
  });

  it('keeps the project usable when overview metrics are unavailable', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProjectOverviewMetrics.mockRejectedValue(new Error('metrics offline'));

    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'作品总览'}));

    expect(screen.getByRole('heading',{name:'霓虹夜行'})).toBeVisible();
    const stageRail=screen.getByLabelText('作品制作阶段');
    expect(within(stageRail).getByText('剧本锁定').parentElement).toHaveTextContent('--');
    expect(within(stageRail).getByText('资产准备').parentElement).toHaveTextContent('--');
  });

  it('opens an overview storyline in the script workspace and refreshes metrics after script changes', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.listStorylines.mockResolvedValue([{id:'line-1',project_id:'project-1',title:'芯片来源',kind:'mystery',color:'#B9473E',description:'跨集谜团',created_at:'',updated_at:'',events:[]}]);
    mocks.getProjectOverviewMetrics
      .mockResolvedValueOnce({project_id:'project-1',scene_count:1,script_locked:false,asset_total:0,asset_ready:0})
      .mockResolvedValueOnce({project_id:'project-1',scene_count:1,script_locked:true,asset_total:0,asset_ready:0});

    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button',{name:'作品总览'}));
    await userEvent.click(screen.getByRole('button',{name:/芯片来源/}));

    expect(screen.getByRole('heading',{name:'故事线画布'})).toBeVisible();
    expect(screen.getByText('聚焦故事线 line-1')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'模拟剧本状态变化'}));
    await waitFor(()=>expect(mocks.getProjectOverviewMetrics).toHaveBeenCalledTimes(2));
  });

  it('preserves successful project readiness when another episode request fails', async () => {
    const secondEpisode = {...projectDetail.episodes[0], id: 'episode-2', title: '第二集'};
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue({...projectDetail, episodes: [projectDetail.episodes[0], secondEpisode]});
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockImplementation((id: string) => id === 'episode-2'
      ? Promise.reject(new Error('readiness offline'))
      : Promise.resolve(readiness));

    render(<Workspace/>);
    await userEvent.click(await screen.findByRole('button', {name: '作品总览'}));

    const firstRow = screen.getAllByText('失窃的雨夜').map(item => item.closest('[role="row"]')).find(Boolean)!;
    const secondRow = screen.getAllByText('第二集').map(item => item.closest('[role="row"]')).find(Boolean)!;
    expect(within(firstRow).getByText('50%')).toBeVisible();
    expect(within(secondRow).getByText('待获取')).toBeVisible();
  });

  it('opens the real model center and confirms leaving dirty channel changes', async () => {
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

    await userEvent.click(await screen.findByRole('button', {name: '模型中心'}));
    expect(screen.getByRole('heading', {name: '模型中心'})).toBeVisible();
    expect(screen.queryByRole('tab', {name: '模型渠道'})).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'M4');

    await userEvent.click(screen.getByRole('button', {name: '模型中心'}));
    expect(confirm).toHaveBeenCalledWith('模型渠道有未保存更改，确定离开吗？');
    expect(screen.getByRole('heading', {name: '模型中心'})).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '模型中心'}));
    expect(screen.getByRole('tab', {name: '概览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
  });

  it('opens on overview and navigates between episode work areas', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace />);

    const overviewTab = await screen.findByRole('tab', {name: '概览'});
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('aria-controls', 'workspace-panel-overview');
    expect(document.getElementById('workspace-panel-overview')).toHaveAttribute('role', 'tabpanel');
    expect(screen.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '场景'}));
    expect(screen.getByRole('heading', {name: '雨夜巷道'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));
    expect(screen.getByRole('tab', {name: '分镜'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));
    expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '生产'}));
    expect(screen.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();

    expect(screen.queryByRole('tab', {name: '视觉审阅'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', {name: '概览'}));
    await userEvent.click(screen.getByRole('button', {name: '处理阻塞项'}));
    expect(screen.getByRole('tab', {name: '生产'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByRole('heading', {name: '创建圈点后开始对话'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'返回生产画布'}));
    expect(screen.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();
    expect(document.querySelector('.workspace-inspector')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', {name: '审核发布'}));
    expect(screen.getByRole('heading', {name: '审核队列'})).toBeVisible();
    expect(document.querySelector('.workspace-inspector')).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByLabelText('待处理评论')).getByRole('button', {name: /镜头 1/}));
    expect(screen.getByRole('heading', {name: '审核队列'})).toBeVisible();
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

  it('shows the shot inspector only in shot-focused work areas', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);

    render(<Workspace />);

    expect(await screen.findByRole('tab', {name: '概览'})).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.workspace-inspector')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));

    expect(document.querySelector('.workspace-inspector')).toBeVisible();
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

    expect(await screen.findByRole('tab', {name: '概览'})).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-overview');
    expect(workspaceStyles).toMatch(/\.mobile-overview \.workspace-inspector\s*\{\s*display:\s*none/);

    await userEvent.click(screen.getByRole('tab', {name: '分镜'}));
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-storyboard');
    expect(workspaceStyles).toMatch(/\.mobile-storyboard \.workspace-inspector\s*\{\s*display:\s*none/);

    await userEvent.click(screen.getByRole('tab', {name: '检查器'}));
    expect(document.querySelector('.workspace-grid')).toHaveClass('mobile-inspector');
    expect(workspaceStyles).toMatch(/\.mobile-inspector \.workspace-center\s*\{\s*display:\s*none/);

    expect(screen.queryByRole('tab', {name: '模型渠道'})).not.toBeInTheDocument();
  });

  it('keeps the four production stages and inspector in one scroll-safe mobile row', () => {
    render(<WorkspaceTabs value="overview" onChange={() => true} mobile areas={['overview', 'scene', 'storyboard', 'production', 'inspector']}/>);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(workspaceStyles).toMatch(/\.workspace-tabs-mobile\s*\{[^}]*flex:\s*0 0 44px[^}]*width:\s*100%[^}]*overflow-x:\s*auto/);
    expect(workspaceStyles).toMatch(/\.workspace-tabs-mobile button\s*\{[^}]*flex:\s*1 0 20%/);
  });

  it('opens the first relevant blocker in the mobile production review from the review action', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => mediaController(true).media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('button', {name: '处理阻塞项'}));

    expect(screen.getByRole('tab', {name: '生产'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button',{name:'返回生产画布'})).toBeVisible();
    expect(screen.getByText('本集生产 / 镜头 01 / 视觉审阅')).toBeVisible();
    expect(screen.queryByRole('tab', {name: '审核'})).not.toBeInTheDocument();
  });

  it('opens the selected shot in mobile production review when there is no blocker', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => mediaController(true).media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockResolvedValue({...readiness, blockers: {missing_panels: [], unapproved_shots: [], missing_speech: []}});
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('button', {name: '处理阻塞项'}));

    expect(screen.getByRole('tab', {name: '生产'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button',{name:'返回生产画布'})).toBeVisible();
    expect(screen.getAllByRole('tab').some(tab => tab.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('reports initial readiness failure without authoritative zero blockers', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProductionReadiness.mockRejectedValue(new Error('readiness offline'));
    render(<Workspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent('渲染准备状态暂时无法获取');
    expect(screen.getByRole('tab', {name: '概览'})).toHaveAttribute('aria-selected', 'true');
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
    const mutedStrong = workspaceStyles.match(/--color-muted:\s*(#[a-f\d]{6})/i)?.[1];
    const accentStrong = workspaceStyles.match(/--color-accent-strong:\s*(#[a-f\d]{6})/i)?.[1];

    expect(mutedStrong).toBeTruthy();
    expect(accentStrong).toBeTruthy();
    expect(contrastRatio(mutedStrong!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mutedStrong!, '#f8f9fa')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', accentStrong!)).toBeGreaterThanOrEqual(4.5);
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

    expect(screen.getByRole('tab', {name: '概览'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', {name: '检查器'})).not.toBeInTheDocument();
  });

  it('keeps visual review inside the selected production stage across viewport changes', async () => {
    const viewport = mediaController(false);
    vi.stubGlobal('matchMedia', vi.fn(() => viewport.media));
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    render(<Workspace />);

    await userEvent.click(await screen.findByRole('button', {name: '处理阻塞项'}));
    expect(screen.getByRole('tab', {name: '生产'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button',{name:'返回生产画布'})).toBeVisible();
    act(() => viewport.setMatches(true));

    expect(screen.getByRole('tab', {name: '生产'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', {name: '审阅'})).not.toBeInTheDocument();
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

  it('does not let stale project readiness overwrite the current project summary', async () => {
    const projectA = {...project, id: 'project-a', title: '项目 A'};
    const projectB = {...project, id: 'project-b', title: '项目 B'};
    const episodeA = {...projectDetail.episodes[0], id: 'episode-a', project_id: 'project-a', title: '剧集 A'};
    const episodeB = {...projectDetail.episodes[0], id: 'episode-b', project_id: 'project-b', title: '剧集 B'};
    const detailA = {...projectDetail, ...projectA, episodes: [episodeA]};
    const detailB = {...projectDetail, ...projectB, episodes: [episodeB]};
    const staleReadiness = deferred<ProductionReadiness>();
    mocks.listProjects.mockResolvedValue([projectA, projectB]);
    mocks.getProject.mockImplementation((id: string) => Promise.resolve(id === 'project-a' ? detailA : detailB));
    mocks.getEpisode.mockImplementation((id: string) => Promise.resolve({...plannedEpisode, ...(id === 'episode-a' ? episodeA : episodeB)}));
    mocks.getProductionReadiness.mockImplementation((id: string) => id === 'episode-b'
      ? staleReadiness.promise
      : Promise.resolve({...readiness, episode_id: 'episode-a'}));
    localStorage.setItem('ai-comic-project', 'project-a');

    render(<Workspace/>);
    await screen.findAllByRole('combobox', {name: '选择项目'});
    const selector = document.querySelector<HTMLSelectElement>('.project-switcher')!;
    await userEvent.selectOptions(selector, 'project-b');
    await waitFor(() => expect(selector).toHaveValue('project-b'));
    await userEvent.selectOptions(selector, 'project-a');
    await waitFor(() => expect(selector).toHaveValue('project-a'));
    await userEvent.click(screen.getByRole('button', {name: '作品总览'}));

    staleReadiness.resolve({...readiness, episode_id: 'episode-b', ready_counts: {panels: 0, approved: 0, speech: 0}});
    await act(async () => {await staleReadiness.promise;});

    expect(screen.getByRole('heading', {name: '项目 A'})).toBeVisible();
    const currentRow = screen.getAllByText('剧集 A').map(item => item.closest('[role="row"]')).find(Boolean)!;
    expect(within(currentRow).getByText('50%')).toBeVisible();
  });

  it('supports roving keyboard navigation across workspace tabs', async () => {
    render(<TabsHarness />);
    const overview = screen.getByRole('tab', {name: '概览'});
    const scene = screen.getByRole('tab', {name: '场景'});
    const storyboard = screen.getByRole('tab', {name: '分镜'});

    expect(overview).toHaveAttribute('tabindex', '0');
    expect(storyboard).toHaveAttribute('tabindex', '-1');
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(scene).toHaveFocus();
    expect(scene).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(storyboard).toHaveFocus();
    expect(storyboard).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', {name: '生产'})).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(overview).toHaveFocus();
  });

  it('keeps selected tab focus when guarded click or keyboard navigation is rejected', async () => {
    render(<RejectedTabsHarness/>);
    const settings = screen.getByRole('tab', {name: '生产'});
    const overview = screen.getByRole('tab', {name: '概览'});
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
