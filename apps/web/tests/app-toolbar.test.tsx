import {act, cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppToolbar} from '../components/AppToolbar';
import type {Job} from '../lib/types';

const mocks = vi.hoisted(() => ({
  getProviderHealth: vi.fn(),
  startRender: vi.fn(),
  pollJob: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  getProviderHealth: mocks.getProviderHealth,
  startRender: mocks.startRender,
  mediaUrl: (path: string) => path,
}));
vi.mock('../lib/jobs', () => ({pollJob: mocks.pollJob}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

const completed = (episodeId: string, path: string): Job => ({
  id: `job-${episodeId}`,
  operation: 'render_episode',
  target_type: 'episode',
  target_id: episodeId,
  status: 'succeeded',
  progress: 100,
  result_metadata: {media_url: path},
  error: '',
  retry_count: 0,
  created_at: '',
  updated_at: '',
});

describe('AppToolbar episode render state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('does not let a deferred render completion overwrite the next episode', async () => {
    const pending = deferred<Job>();
    mocks.startRender.mockResolvedValue({job_id: 'job-a', status: 'queued'});
    mocks.pollJob.mockReturnValue(pending.promise);
    const view = render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" />);

    await userEvent.click(screen.getByRole('button', {name: '渲染本集'}));
    view.rerender(<AppToolbar projectLabel="Project" episodeLabel="B" episodeId="episode-b" />);
    expect(screen.getByRole('button', {name: '渲染本集'})).toBeEnabled();

    await act(async () => pending.resolve(completed('episode-a', '/media/a.mp4')));

    expect(screen.queryByRole('link', {name: '下载 MP4'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '渲染本集'})).toBeEnabled();
  });

  it('removes a rendered download when switching episodes', async () => {
    mocks.startRender.mockResolvedValue({job_id: 'job-a', status: 'queued'});
    mocks.pollJob.mockResolvedValue(completed('episode-a', '/media/a.mp4'));
    const view = render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" />);

    await userEvent.click(screen.getByRole('button', {name: '渲染本集'}));
    expect(await screen.findByRole('link', {name: '下载 MP4'})).toHaveAttribute('href', '/media/a.mp4');

    view.rerender(<AppToolbar projectLabel="Project" episodeLabel="B" episodeId="episode-b" />);

    expect(screen.queryByRole('link', {name: '下载 MP4'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '渲染本集'})).toBeEnabled();
  });

  it('opens the global model center from the platform toolbar', async () => {
    const onModelCenter = vi.fn();
    render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" onModelCenter={onModelCenter}/>);

    await userEvent.click(screen.getByRole('button', {name: '模型中心'}));

    expect(onModelCenter).toHaveBeenCalledOnce();
  });

  it('opens project settings from the platform toolbar', async () => {
    const onProjectSettings=vi.fn();
    render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" onProjectSettings={onProjectSettings}/>);

    await userEvent.click(screen.getByRole('button',{name:'作品设置'}));

    expect(onProjectSettings).toHaveBeenCalledOnce();
  });

  it('opens cross-project operations from the unified toolbar', async () => {
    const onWorkspaceHome=vi.fn();
    const onSearch=vi.fn();
    const onTasks=vi.fn();
    const onVersions=vi.fn();
    render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" onWorkspaceHome={onWorkspaceHome} onSearch={onSearch} onTasks={onTasks} onVersions={onVersions}/>);

    await userEvent.click(screen.getByRole('button',{name:'打开工作台'}));
    await userEvent.click(screen.getByRole('button',{name:'全局搜索'}));
    await userEvent.click(screen.getByRole('button',{name:'任务中心'}));
    await userEvent.click(screen.getByRole('button',{name:'版本历史'}));

    expect(onWorkspaceHome).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onTasks).toHaveBeenCalledOnce();
    expect(onVersions).toHaveBeenCalledOnce();
  });

  it('renders the approved product-level navigation', () => {
    render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" />);

    const navigation = screen.getByRole('navigation', {name: '产品导航'});
    expect(navigation).toHaveTextContent('作品总览');
    expect(navigation).toHaveTextContent('剧本');
    expect(navigation).toHaveTextContent('资产库');
    expect(navigation).toHaveTextContent('单集制作');
    expect(navigation).toHaveTextContent('审核发布');
  });

  it('does not render a global project and episode breadcrumb', () => {
    render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" />);

    expect(screen.queryByText('Project / A')).not.toBeInTheDocument();
  });

  it('shows a retryable status instead of throwing when the local API is unavailable', async () => {
    mocks.getProviderHealth.mockRejectedValueOnce(new Error('connectivity_failure'));
    mocks.getProviderHealth.mockResolvedValueOnce({
      llm: {status: 'ok', model: 'M3', host: 'llm.example.com', elapsed_ms: 3, check_scope: 'model', error: null},
      image: {status: 'ok', model: 'image', host: 'image.example.com', elapsed_ms: 4, check_scope: 'endpoint', error: null},
      tts: {status: 'ok', model: 'tts', host: 'tts.example.com', elapsed_ms: 5, check_scope: 'audio', error: null},
      video: {status: 'ok', model: 'video', host: 'video.example.com', elapsed_ms: 6, check_scope: 'endpoint', error: null},
    });
    render(<AppToolbar projectLabel="Project" episodeLabel="A" episodeId="episode-a" />);

    const health = screen.getByRole('button', {name: '检测模型服务'});
    await userEvent.click(health);
    expect(await screen.findByText('检测失败')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('服务检测失败，请重试');

    await userEvent.click(health);
    expect(await screen.findByText('4/4 正常')).toBeVisible();
  });
});
