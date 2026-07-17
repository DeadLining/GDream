import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ModelCenter} from '../components/ModelCenter';

const mocks = vi.hoisted(() => ({
  getModelRuntimeHealth: vi.fn(),
  getModelRuntimeInvocations: vi.fn(),
  retryModelRuntimeJob: vi.fn(),
  getProviderChannels: vi.fn(), updateProviderChannel: vi.fn(), testProviderChannel: vi.fn(),
  getMockSshHosts: vi.fn(), getMockSshStatus: vi.fn(), startMockSsh: vi.fn(), stopMockSsh: vi.fn(),
}));

vi.mock('../lib/api', () => mocks);

const health = {
  capabilities: {
    text: {status: 'healthy', model: 'MiniMax-M3', host: 'api.minimaxi.com', elapsed_ms: 18, last_invocation_elapsed_ms: 1200, error: null},
    image: {status: 'healthy', model: 'gpt-image-2', host: '192.168.18.80', elapsed_ms: 35, last_invocation_elapsed_ms: 9200, error: null},
    speech: {status: 'unavailable', model: 'Qwen3-TTS', host: '192.168.18.94', elapsed_ms: 0, last_invocation_elapsed_ms: null, error: 'Mock SSH is not running'},
    video: {status: 'disabled', model: 'MiniMax-Hailuo-02', host: 'api.minimaxi.com', elapsed_ms: 0, last_invocation_elapsed_ms: null, error: null},
    model3d: {status: 'disabled', model: 'fal-ai/triposr', host: 'fal.run', elapsed_ms: 0, last_invocation_elapsed_ms: null, error: null},
  },
  infrastructure: {
    api: {status: 'healthy'},
    mock_ssh: {state: 'stopped', error: null},
    queue: {queued: 2, running: 1},
    persistence: {status: 'saved'},
  },
  checked_at: '2026-07-12T10:00:00Z',
};

describe('ModelCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelRuntimeHealth.mockResolvedValue(health);
    mocks.getModelRuntimeInvocations.mockResolvedValue([
      {id: 'inv-1', capability: 'image', provider: 'Internal GPT Image', model: 'gpt-image-2', target_type: 'shot', target_id: 'shot-1', status: 'failed', elapsed_ms: 8000, error_code: 'provider_timeout', retryable: true, job_id: 'job-1', created_at: '2026-07-12T09:58:00Z'},
    ]);
    mocks.retryModelRuntimeJob.mockResolvedValue({job_id: 'job-1', capability: 'image', status: 'queued'});
    mocks.getProviderChannels.mockResolvedValue({
      llm: {name: 'MiniMax', enabled: true, base_url: 'https://api.minimaxi.com', model: 'MiniMax-M3', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-****'},
      image: {name: 'Internal GPT Image', enabled: true, base_url: 'http://192.168.18.80:14000', model: 'gpt-image-2', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-****'},
      tts: {name: 'Qwen TTS', enabled: true, base_url: 'http://192.168.18.94:18080', model: 'Qwen3-TTS', ssh_host: 'ai-comic-tts', api_key_configured: false, api_key_masked: ''},
      video: {name: 'MiniMax Video', enabled: false, base_url: 'https://api.minimaxi.com', model: 'MiniMax-Hailuo-02', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-****'},
      model3d: {name: 'fal.ai TripoSR', enabled: false, base_url: 'https://fal.run', model: 'fal-ai/triposr', ssh_host: '', api_key_configured: false, api_key_masked: ''},
      persistence: {status: 'saved', file_path: 'data/provider-channels.json'}, reloaded_at: '',
    });
    mocks.getMockSshHosts.mockResolvedValue([]);
    mocks.getMockSshStatus.mockResolvedValue({desired_running: false, state: 'stopped', host_id: null, alias: null, port: null, error: null, reused: false});
  });
  afterEach(cleanup);

  it('shows capability health, infrastructure, recent invocations, and embedded channel settings', async () => {
    render(<ModelCenter/>);

    expect(await screen.findByRole('heading', {name: '模型中心'})).toBeVisible();
    expect(screen.getByText('MiniMax-M3')).toBeVisible();
    expect(screen.getByText('Qwen3-TTS')).toBeVisible();
    expect(screen.getByText('Mock SSH 未运行')).toBeVisible();
    expect(screen.getByText(/排队 2/)).toBeVisible();
    expect(screen.getByText('provider_timeout')).toBeVisible();
    expect(screen.getByRole('heading', {name: '渠道配置'})).toBeVisible();
    expect(await screen.findAllByRole('form')).toHaveLength(5);
  });

  it('keeps runtime health available when invocation history fails', async () => {
    mocks.getModelRuntimeInvocations.mockRejectedValue(new Error('调用记录暂时不可用'));

    render(<ModelCenter/>);

    expect(await screen.findByText('MiniMax-M3')).toBeVisible();
    expect(screen.getByText('运行正常')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('调用记录暂时不可用');
    expect(await screen.findAllByRole('form')).toHaveLength(5);
  });

  it('retries a retryable invocation and refreshes runtime state', async () => {
    render(<ModelCenter/>);
    await userEvent.click(await screen.findByRole('button', {name: '重试画面调用'}));

    expect(mocks.retryModelRuntimeJob).toHaveBeenCalledWith('job-1');
    await waitFor(() => expect(mocks.getModelRuntimeHealth).toHaveBeenCalledTimes(2));
    expect(mocks.getModelRuntimeInvocations).toHaveBeenCalledTimes(2);
  });

  it('provides stable in-page navigation for operations and channel settings', async () => {
    render(<ModelCenter/>);

    expect(await screen.findByRole('navigation', {name: '模型中心分区'})).toBeVisible();
    expect(screen.getByRole('link', {name: '能力概览'})).toHaveAttribute('href', '#model-capabilities');
    expect(screen.getByRole('link', {name: '运行记录'})).toHaveAttribute('href', '#model-operations');
    expect(screen.getByRole('link', {name: '渠道配置'})).toHaveAttribute('href', '#model-settings');
  });
});
