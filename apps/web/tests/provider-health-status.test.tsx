import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {readAllStyles} from './_styles';
import {StrictMode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ProviderHealthStatus} from '../components/ProviderHealthStatus';
import type {ProviderHealth} from '../lib/types';

const mocks = vi.hoisted(() => ({getProviderHealth: vi.fn()}));
vi.mock('../lib/api', () => ({getProviderHealth: mocks.getProviderHealth}));

const healthy: ProviderHealth = {
  llm: {status: 'ok', model: 'MiniMax-M3', host: 'api.minimax.chat', elapsed_ms: 21, check_scope: 'model', error: null},
  image: {status: 'ok', model: 'gpt-image-2', host: 'images.example.com', elapsed_ms: 32, check_scope: 'endpoint', error: null},
  tts: {status: 'ok', model: 'qwen3-tts', host: 'audio.example.com', elapsed_ms: 43, check_scope: 'audio', error: null},
  video: {status: 'ok', model: 'wan-video', host: 'video.example.com', elapsed_ms: 54, check_scope: 'endpoint', error: null},
  model3d: {status: 'disabled', model: 'fal-ai/triposr', host: 'fal.run', elapsed_ms: 0, check_scope: 'model', error: null},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

describe('ProviderHealthStatus', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('stays idle until requested and exposes the required accessible command', () => {
    render(<ProviderHealthStatus/>);
    const button = screen.getByRole('button', {name: '检测模型服务'});
    expect(button).toHaveAttribute('title', '检测模型服务');
    expect(button).toHaveTextContent('检测服务');
    expect(mocks.getProviderHealth).not.toHaveBeenCalled();
  });

  it('shows loading and prevents duplicate click checks', async () => {
    const pending = deferred<ProviderHealth>();
    mocks.getProviderHealth.mockReturnValue(pending.promise);
    render(<ProviderHealthStatus/>);

    const button = screen.getByRole('button', {name: '检测模型服务'});
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('检测中');
    await userEvent.click(button);
    expect(mocks.getProviderHealth).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(healthy));
    expect(button).toHaveTextContent('4/4 正常');
  });

  it('opens all four results and reruns the check when the status button is clicked again', async () => {
    mocks.getProviderHealth.mockResolvedValue(healthy);
    render(<ProviderHealthStatus/>);
    const button = screen.getByRole('button', {name: '检测模型服务'});

    await userEvent.click(button);
    expect(await screen.findByText('4/4 正常')).toBeVisible();

    const details = screen.getByRole('region', {name: '模型服务检测详情'});
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(details).toBeVisible();
    for (const label of ['剧本规划', '画面生成', '语音合成', '视频生成']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getAllByText('正常')).toHaveLength(4);
    expect(screen.getByText('21 ms')).toBeVisible();
    expect(screen.getByText('MiniMax-M3')).toBeVisible();
    expect(screen.getByText('api.minimax.chat')).toBeVisible();

    await userEvent.click(button);
    await waitFor(() => expect(mocks.getProviderHealth).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('region', {name: '模型服务检测详情'})).toBeVisible();
  });

  it('closes the result popover when clicking outside it', async () => {
    mocks.getProviderHealth.mockResolvedValue(healthy);
    render(<div><ProviderHealthStatus/><button type="button">页面其他区域</button></div>);

    await userEvent.click(screen.getByRole('button', {name: '检测模型服务'}));
    expect(await screen.findByRole('region', {name: '模型服务检测详情'})).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '页面其他区域'}));
    expect(screen.queryByRole('region', {name: '模型服务检测详情'})).not.toBeInTheDocument();
  });

  it('shows a partial failure and its rendered error after one manual click', async () => {
    const response: ProviderHealth = {
      ...healthy,
      image: {...healthy.image, status: 'failed', error: '<script>alert(1)</script> upstream unavailable'},
    };
    mocks.getProviderHealth.mockResolvedValue(response);
    render(<ProviderHealthStatus/>);

    const button = screen.getByRole('button', {name: '检测模型服务'});
    await userEvent.click(button);
    expect(await screen.findByText('3/4 正常')).toBeVisible();
    expect(screen.getByText('异常')).toBeVisible();
    expect(screen.getByText('<script>alert(1)</script> upstream unavailable')).toBeVisible();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('excludes disabled providers from the denominator', async () => {
    mocks.getProviderHealth.mockResolvedValue({
      ...healthy,
      tts: {...healthy.tts, status: 'disabled'},
      video: {...healthy.video, status: 'failed', error: 'timeout'},
    });
    render(<ProviderHealthStatus/>);
    const button = screen.getByRole('button', {name: '检测模型服务'});
    await userEvent.click(button);
    expect(await screen.findByText('2/3 正常')).toBeVisible();
    expect(screen.getByText('已禁用')).toBeVisible();
  });

  it('shows details when all providers are disabled', async () => {
    const disabled = Object.fromEntries(Object.entries(healthy).map(([key, item]) => [key, {...item, status: 'disabled'}])) as ProviderHealth;
    mocks.getProviderHealth.mockResolvedValue(disabled);
    render(<ProviderHealthStatus/>);
    const button = screen.getByRole('button', {name: '检测模型服务'});
    await userEvent.click(button);
    expect(await screen.findByText('0/0 正常')).toBeVisible();
    expect(screen.getAllByText('已禁用')).toHaveLength(4);
  });

  it('shows a concise retryable aggregate error without a count', async () => {
    mocks.getProviderHealth.mockRejectedValueOnce(new Error('secret upstream details')).mockResolvedValueOnce(healthy);
    render(<ProviderHealthStatus/>);
    const button = screen.getByRole('button', {name: '检测模型服务'});

    await userEvent.click(button);
    expect(await screen.findByText('检测失败')).toBeVisible();
    expect(button).toBeEnabled();
    expect(button).not.toHaveTextContent(/\d+\/\d+/);
    expect(screen.getByRole('alert')).toHaveTextContent('服务检测失败，请重试');
    expect(screen.queryByText('secret upstream details')).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(await screen.findByText('4/4 正常')).toBeVisible();
    expect(mocks.getProviderHealth).toHaveBeenCalledTimes(2);
  });

  it('lets a newer external refresh supersede a pending response', async () => {
    const oldRequest = deferred<ProviderHealth>();
    const newRequest = deferred<ProviderHealth>();
    mocks.getProviderHealth.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const view = render(<ProviderHealthStatus/>);
    await userEvent.click(screen.getByRole('button', {name: '检测模型服务'}));
    expect(await screen.findByText('检测中')).toBeVisible();

    view.rerender(<ProviderHealthStatus healthRefreshKey={1}/>);
    await waitFor(() => expect(mocks.getProviderHealth).toHaveBeenCalledTimes(2));
    await act(async () => newRequest.resolve({...healthy, video: {...healthy.video, status: 'failed', error: 'offline'}}));
    expect(screen.getByText('3/4 正常')).toBeVisible();

    await act(async () => oldRequest.resolve(healthy));
    expect(screen.getByText('3/4 正常')).toBeVisible();
  });

  it('does not check for an initially nonzero refresh key or update after a later refresh unmounts', async () => {
    const pending = deferred<ProviderHealth>();
    mocks.getProviderHealth.mockReturnValue(pending.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<ProviderHealthStatus healthRefreshKey={1}/>);
    await act(async () => undefined);
    expect(mocks.getProviderHealth).not.toHaveBeenCalled();

    view.rerender(<ProviderHealthStatus healthRefreshKey={2}/>);
    await waitFor(() => expect(mocks.getProviderHealth).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => pending.resolve(healthy));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('runs one post-mount refresh check under StrictMode', async () => {
    mocks.getProviderHealth.mockResolvedValue(healthy);
    const view = render(<StrictMode><ProviderHealthStatus healthRefreshKey={4}/></StrictMode>);
    await act(async () => undefined);
    expect(mocks.getProviderHealth).not.toHaveBeenCalled();

    view.rerender(<StrictMode><ProviderHealthStatus healthRefreshKey={5}/></StrictMode>);
    await waitFor(() => expect(mocks.getProviderHealth).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('4/4 正常')).toBeVisible();
  });

  it('does not force closed details open after an external refresh', async () => {
    mocks.getProviderHealth.mockResolvedValue(healthy);
    const view = render(<ProviderHealthStatus healthRefreshKey={7}/>);
    view.rerender(<ProviderHealthStatus healthRefreshKey={8}/>);

    expect(await screen.findByText('4/4 正常')).toBeVisible();
    expect(screen.getByRole('button', {name: '检测模型服务'})).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', {name: '模型服务检测详情'})).not.toBeInTheDocument();
  });

  it('uses bounded wrapping styles for long model, host, and error text', async () => {
    mocks.getProviderHealth.mockResolvedValue({
      ...healthy,
      image: {...healthy.image, status: 'failed', model: 'model-with-an-extremely-long-unbroken-name', host: 'very-long-host-name.example.internal', error: 'X'.repeat(160)},
    });
    render(<ProviderHealthStatus/>);
    const button = screen.getByRole('button', {name: '检测模型服务'});
    await userEvent.click(button);
    await screen.findByText('3/4 正常');
    expect(screen.getByText('model-with-an-extremely-long-unbroken-name')).toHaveClass('provider-health-model');
    expect(screen.getByText('X'.repeat(160))).toHaveClass('provider-health-error');

    const styles = readAllStyles();
    expect(styles).toMatch(/\.provider-health-popover\s*\{[^}]*max-width:[^;}]+[^}]*overflow:/);
    expect(styles).toMatch(/\.provider-health-model[^}]*overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/\.provider-health-error[^}]*overflow-wrap:\s*anywhere/);
  });
});
