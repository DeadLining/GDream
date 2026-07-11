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
  listPanelVersions: vi.fn(), getProductionReadiness: vi.fn(), getProviderHealth: vi.fn(), startRender: vi.fn(), pollJob: vi.fn(),
  getProductionRun: vi.fn(), createProductionRun: vi.fn(), continueProductionRun: vi.fn(), pauseProductionRun: vi.fn(),
  listProductionItems: vi.fn(), retryProductionRun: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  listProjects: mocks.listProjects, getProject: mocks.getProject,
  getEpisode: mocks.getEpisode, createProject: mocks.createProject,
  createEpisode: mocks.createEpisode, startPlanning: mocks.startPlanning,
  listPanelVersions: mocks.listPanelVersions,
  getProductionReadiness: mocks.getProductionReadiness,
  getProviderHealth: mocks.getProviderHealth, startRender: mocks.startRender,
  getProductionRun: mocks.getProductionRun, createProductionRun: mocks.createProductionRun,
  continueProductionRun: mocks.continueProductionRun, pauseProductionRun: mocks.pauseProductionRun,
  listProductionItems: mocks.listProductionItems, retryProductionRun: mocks.retryProductionRun,
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

describe('Workspace', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.listPanelVersions.mockResolvedValue([]);
    mocks.getProductionReadiness.mockResolvedValue(readiness);
    mocks.listProductionItems.mockResolvedValue([]);
  });

  it('loads an explicit empty state when no projects exist', async () => {
    mocks.listProjects.mockResolvedValue([]);

    render(<Workspace />);

    expect(await screen.findByRole('heading', {name: '新建第一个项目'})).toBeVisible();
    expect(screen.getByRole('button', {name: '创建项目'})).toBeEnabled();
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
    await userEvent.click(screen.getByRole('button', {name: '生成剧本与分镜'}));

    expect(await screen.findByText('场景 1')).toBeVisible();
    expect(screen.getByRole('button', {name: /镜头 1/})).toBeEnabled();
    await waitFor(() => expect(mocks.startPlanning).toHaveBeenCalledWith('episode-1'));
  });

  it('exposes the active project context and accessible studio commands', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode.mockResolvedValue(plannedEpisode);
    mocks.getProviderHealth.mockResolvedValue({
      planning: {status: 'ok'},
      image: {status: 'ok'},
      speech: {status: 'unavailable'},
    });

    render(<Workspace />);

    expect(await screen.findByText('霓虹夜行 / 失窃的雨夜')).toBeVisible();
    expect(screen.getByRole('button', {name: '刷新项目'})).toHaveAttribute('title', '刷新项目');
    expect(screen.getByRole('button', {name: '批量生产'})).toHaveAttribute('title', '批量生产');
    expect(screen.getByRole('button', {name: '设置'})).toHaveAttribute('title', '设置');
    expect(screen.getByRole('button', {name: '渲染本集'})).toHaveAttribute('title', '素材未就绪');

    await userEvent.click(screen.getByRole('button', {name: '模型服务状态'}));
    expect(await screen.findByText('2/3 服务')).toBeVisible();
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
    expect(screen.getByRole('button', {name: /失窃的雨夜/})).toHaveAttribute('aria-current', 'page');
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

    await userEvent.click(screen.getByRole('tab', {name: '生产'}));
    expect(screen.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: '审核'}));
    expect(screen.getByTestId('review-placeholder')).toBeVisible();
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
  });

  it('uses a non-clipping flex layout for toolbar, tabs, and workspace', () => {
    expect(workspaceStyles).toMatch(/\.app-shell\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
    expect(workspaceStyles).toMatch(/\.workspace-grid\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*height:\s*auto/);
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
    const storyboard = screen.getByRole('tab', {name: '分镜'});

    expect(overview).toHaveAttribute('tabindex', '0');
    expect(storyboard).toHaveAttribute('tabindex', '-1');
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(storyboard).toHaveFocus();
    expect(storyboard).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', {name: '审核'})).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(overview).toHaveFocus();
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
