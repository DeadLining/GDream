import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MockSshControl} from '../components/MockSshControl';
import type {MockSshHost, MockSshStatus} from '../lib/types';

const mocks = vi.hoisted(() => ({
  getMockSshHosts: vi.fn(),
  getMockSshStatus: vi.fn(),
  startMockSsh: vi.fn(),
  stopMockSsh: vi.fn(),
}));

vi.mock('../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  ...mocks,
}));

const hosts: MockSshHost[] = [
  {id: 'workstation', name: 'Workstation', type: 'ssh'},
  {id: 'a800_94', name: 'A800 94', type: 'ssh'},
];
const stopped: MockSshStatus = {desired_running: false, state: 'stopped', host_id: null, alias: null, port: null, error: null, reused: false};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

describe('mock SSH API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses only the fixed lifecycle endpoints and safe JSON fields', async () => {
    const {getMockSshHosts, getMockSshStatus, startMockSsh, stopMockSsh} = await vi.importActual<typeof import('../lib/api')>('../lib/api');
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(stopped), {status: 200})));
    vi.stubGlobal('fetch', fetch);

    await getMockSshHosts();
    await getMockSshStatus();
    await startMockSsh({host_id: 'a800_94', alias: 'ai-comic-tts'});
    await stopMockSsh();

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/mock-ssh/hosts',
      '/api/mock-ssh/status',
      '/api/mock-ssh/start',
      '/api/mock-ssh/stop',
    ]);
    expect(fetch.mock.calls[2][1]).toMatchObject({method: 'POST', body: JSON.stringify({host_id: 'a800_94', alias: 'ai-comic-tts'})});
    expect(fetch.mock.calls[3][1]).toMatchObject({method: 'POST', body: JSON.stringify({})});
  });
});

describe('MockSshControl', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getMockSshHosts.mockResolvedValue(hosts);
    mocks.getMockSshStatus.mockResolvedValue(stopped);
    mocks.startMockSsh.mockResolvedValue({...stopped, desired_running: true, state: 'running', host_id: 'a800_94', alias: 'ai-comic-tts', port: 22001});
    mocks.stopMockSsh.mockResolvedValue(stopped);
  });
  afterEach(cleanup);

  it('loads hosts and status together and defaults to A800 with the standard alias', async () => {
    const hostsLoad = deferred<MockSshHost[]>();
    const statusLoad = deferred<MockSshStatus>();
    mocks.getMockSshHosts.mockReturnValue(hostsLoad.promise);
    mocks.getMockSshStatus.mockReturnValue(statusLoad.promise);
    render(<MockSshControl/>);

    expect(screen.getByRole('status')).toHaveTextContent('正在加载');
    expect(mocks.getMockSshHosts).toHaveBeenCalledOnce();
    expect(mocks.getMockSshStatus).toHaveBeenCalledOnce();
    hostsLoad.resolve(hosts);
    statusLoad.resolve(stopped);

    expect(await screen.findByLabelText('HostBridge 主机')).toHaveValue('a800_94');
    expect(screen.getByLabelText('SSH Alias')).toHaveValue('ai-comic-tts');
    expect(screen.getByText('已停止')).toBeVisible();
  });

  it('preserves the backend running host and alias and displays its exact endpoint', async () => {
    mocks.getMockSshStatus.mockResolvedValue({...stopped, desired_running: true, state: 'running', host_id: 'workstation', alias: 'studio-tts', port: 22994});
    render(<MockSshControl/>);

    expect(await screen.findByText('studio-tts :22994')).toBeVisible();
    expect(screen.getByLabelText('HostBridge 主机')).toHaveValue('workstation');
    expect(screen.getByLabelText('SSH Alias')).toHaveValue('studio-tts');
    expect(screen.getByRole('button', {name: '启动 Mock SSH'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '停止 Mock SSH'})).toBeEnabled();
  });

  it('shows empty and load errors as retryable alerts', async () => {
    mocks.getMockSshHosts.mockRejectedValueOnce(new Error('主机列表不可用'));
    render(<MockSshControl/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('主机列表不可用');

    mocks.getMockSshHosts.mockResolvedValueOnce([]);
    mocks.getMockSshStatus.mockResolvedValueOnce(stopped);
    await userEvent.click(screen.getByRole('button', {name: '刷新 Mock SSH 状态'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('没有可用的 HostBridge 主机');
    expect(screen.getByRole('button', {name: '启动 Mock SSH'})).toBeDisabled();
  });

  it('starts once, reports a reused bridge, and blocks duplicate clicks', async () => {
    const start = deferred<MockSshStatus>();
    mocks.startMockSsh.mockReturnValue(start.promise);
    mocks.getMockSshStatus
      .mockResolvedValueOnce(stopped)
      .mockResolvedValueOnce({...stopped, desired_running: true, state: 'running', host_id: 'a800_94', alias: 'authoritative-tts', port: 22003, reused: false});
    render(<MockSshControl/>);
    await screen.findByLabelText('HostBridge 主机');

    const button = screen.getByRole('button', {name: '启动 Mock SSH'});
    await userEvent.click(button);
    await userEvent.click(button);
    expect(mocks.startMockSsh).toHaveBeenCalledOnce();
    expect(mocks.startMockSsh).toHaveBeenCalledWith({host_id: 'a800_94', alias: 'ai-comic-tts'});
    expect(screen.getByText('启动中')).toBeVisible();
    expect(button).toBeDisabled();

    start.resolve({...stopped, desired_running: true, state: 'running', host_id: 'a800_94', alias: 'ai-comic-tts', port: 22002, reused: true});
    expect(await screen.findByText('authoritative-tts :22003')).toBeVisible();
    expect(mocks.getMockSshStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText('已复用现有桥接')).toHaveAttribute('role', 'status');
  });

  it('stops once while preserving the selected host and alias', async () => {
    mocks.getMockSshStatus.mockResolvedValue({...stopped, desired_running: true, state: 'running', host_id: 'workstation', alias: 'studio-tts', port: 22994});
    const stop = deferred<MockSshStatus>();
    mocks.stopMockSsh.mockReturnValue(stop.promise);
    mocks.getMockSshStatus
      .mockResolvedValueOnce({...stopped, desired_running: true, state: 'running', host_id: 'workstation', alias: 'studio-tts', port: 22994})
      .mockResolvedValueOnce({...stopped, state: 'failed', host_id: null, alias: null, error: 'authoritative stop state'});
    render(<MockSshControl/>);
    await screen.findByText('studio-tts :22994');

    const button = screen.getByRole('button', {name: '停止 Mock SSH'});
    await userEvent.click(button);
    await userEvent.click(button);
    expect(mocks.stopMockSsh).toHaveBeenCalledOnce();
    expect(screen.getByText('停止中')).toBeVisible();
    stop.resolve(stopped);

    expect(await screen.findByText('启动失败')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('authoritative stop state');
    expect(mocks.getMockSshStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('HostBridge 主机')).toHaveValue('workstation');
    expect(screen.getByLabelText('SSH Alias')).toHaveValue('studio-tts');
  });

  it('keeps a successful mutation result and exposes a retryable status sync error', async () => {
    mocks.getMockSshStatus.mockResolvedValueOnce(stopped).mockRejectedValueOnce(new Error('状态同步失败'));
    render(<MockSshControl/>);
    await screen.findByLabelText('HostBridge 主机');

    await userEvent.click(screen.getByRole('button', {name: '启动 Mock SSH'}));

    expect(await screen.findByText('ai-comic-tts :22001')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Mock SSH 已启动，但状态同步失败：状态同步失败');
    expect(screen.getByRole('button', {name: '刷新 Mock SSH 状态'})).toBeEnabled();
  });

  it('validates host and alias before starting and reconciles operation failures', async () => {
    render(<MockSshControl/>);
    await screen.findByLabelText('SSH Alias');
    await userEvent.clear(screen.getByLabelText('SSH Alias'));
    await userEvent.type(screen.getByLabelText('SSH Alias'), 'bad;alias');
    await userEvent.click(screen.getByRole('button', {name: '启动 Mock SSH'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Alias 仅允许 1-64 位字母、数字、点、下划线或连字符');
    expect(mocks.startMockSsh).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('SSH Alias'));
    await userEvent.type(screen.getByLabelText('SSH Alias'), 'safe-alias');
    mocks.startMockSsh.mockRejectedValueOnce(new Error('HostBridge 启动失败'));
    await userEvent.click(screen.getByRole('button', {name: '启动 Mock SSH'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('HostBridge 启动失败');
    expect(screen.getByText('已停止')).toBeVisible();
  });

  it('renders authoritative running state when start transport rejects after applying', async () => {
    mocks.startMockSsh.mockRejectedValueOnce(new Error('连接中断'));
    mocks.getMockSshStatus
      .mockResolvedValueOnce(stopped)
      .mockResolvedValueOnce({...stopped, desired_running: true, state: 'running', host_id: 'a800_94', alias: 'ai-comic-tts', port: 22008});
    render(<MockSshControl/>);
    await screen.findByLabelText('HostBridge 主机');

    await userEvent.click(screen.getByRole('button', {name: '启动 Mock SSH'}));

    expect(await screen.findByText('ai-comic-tts :22008')).toBeVisible();
    expect(screen.queryByText('启动失败')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('启动请求未确认，已同步最新状态');
  });

  it('renders authoritative stopped state when stop transport rejects after applying', async () => {
    const running = {...stopped, desired_running: true, state: 'running' as const, host_id: 'workstation', alias: 'studio-tts', port: 22994};
    mocks.getMockSshStatus.mockResolvedValueOnce(running).mockResolvedValueOnce(stopped);
    mocks.stopMockSsh.mockRejectedValueOnce(new Error('连接中断'));
    render(<MockSshControl/>);
    await screen.findByText('studio-tts :22994');

    await userEvent.click(screen.getByRole('button', {name: '停止 Mock SSH'}));

    expect(await screen.findByText('已停止')).toBeVisible();
    expect(screen.queryByText('运行中')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('停止请求未确认，已同步最新状态');
  });

  it('locks lifecycle actions when mutation and reconciliation both fail until refresh succeeds', async () => {
    mocks.startMockSsh.mockRejectedValueOnce(new Error('连接中断'));
    mocks.getMockSshStatus.mockResolvedValueOnce(stopped).mockRejectedValueOnce(new Error('同步失败'));
    render(<MockSshControl/>);
    await screen.findByLabelText('HostBridge 主机');

    await userEvent.click(screen.getByRole('button', {name: '启动 Mock SSH'}));

    expect(await screen.findByText('状态未知')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('无法确认 Mock SSH 最新状态');
    expect(screen.getByRole('button', {name: '启动 Mock SSH'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '停止 Mock SSH'})).toBeDisabled();

    mocks.getMockSshStatus.mockResolvedValueOnce(stopped);
    await userEvent.click(screen.getByRole('button', {name: '刷新 Mock SSH 状态'}));
    expect(await screen.findByText('已停止')).toBeVisible();
    expect(screen.getByRole('button', {name: '启动 Mock SSH'})).toBeEnabled();
  });

  it('ignores stale load results after a newer action', async () => {
    const statusLoad = deferred<MockSshStatus>();
    mocks.getMockSshStatus.mockReturnValue(statusLoad.promise);
    render(<MockSshControl/>);
    await waitFor(() => expect(mocks.getMockSshStatus).toHaveBeenCalledOnce());

    statusLoad.resolve(stopped);
    await screen.findByLabelText('HostBridge 主机');
    const firstRefresh = deferred<MockSshStatus>();
    mocks.getMockSshStatus
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce({...stopped, desired_running: true, state: 'running', host_id: 'a800_94', alias: 'ai-comic-tts', port: 22001});
    await userEvent.click(screen.getByRole('button', {name: '刷新 Mock SSH 状态'}));
    await userEvent.click(screen.getByRole('button', {name: '启动 Mock SSH'}));
    await screen.findByText('ai-comic-tts :22001');
    firstRefresh.resolve({...stopped, state: 'failed', error: 'stale failure'});

    await waitFor(() => expect(screen.queryByText('stale failure')).not.toBeInTheDocument());
    expect(screen.getByText('ai-comic-tts :22001')).toBeVisible();
  });

  it('does not update state after unmount', async () => {
    const statusLoad = deferred<MockSshStatus>();
    mocks.getMockSshStatus.mockReturnValue(statusLoad.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<MockSshControl/>);
    view.unmount();
    statusLoad.resolve(stopped);
    await Promise.resolve();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
