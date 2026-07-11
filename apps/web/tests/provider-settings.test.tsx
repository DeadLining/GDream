import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ProviderSettings} from '../components/ProviderSettings';
import {getProviderChannels, testProviderChannel, updateProviderChannel} from '../lib/api';
import type {ProviderChannelsRead} from '../lib/types';

const mocks = vi.hoisted(() => ({
  getProviderChannels: vi.fn(),
  updateProviderChannel: vi.fn(),
  testProviderChannel: vi.fn(),
}));

vi.mock('../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  getProviderChannels: mocks.getProviderChannels,
  updateProviderChannel: mocks.updateProviderChannel,
  testProviderChannel: mocks.testProviderChannel,
}));

const snapshot: ProviderChannelsRead = {
  llm: {
    name: 'MiniMax', enabled: true, base_url: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M3', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••8adr',
  },
  image: {
    name: 'Internal GPT Image', enabled: true, base_url: 'http://192.168.18.80:14000',
    model: 'gpt-image-2', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••img9',
  },
  tts: {
    name: 'A800_94', enabled: true, base_url: 'http://192.168.18.94:18080',
    model: 'Qwen3-TTS-12Hz-1.7B-CustomVoice', ssh_host: 'ai-comic-tts',
    api_key_configured: false, api_key_masked: '',
  },
  persistence: {status: 'saved', file_path: 'data/provider-channels.json'},
  reloaded_at: '2026-07-11T10:00:00Z',
};

describe('provider channel API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps provider secrets in JSON request bodies only', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({channel: snapshot.llm, current: snapshot}), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status: 'ok', model: 'M3', host: 'api.example.com', elapsed_ms: 4, check_scope: 'model', error: null}), {status: 200}));
    vi.stubGlobal('fetch', fetch);
    const candidate = {name: 'MiniMax', enabled: true, base_url: 'https://api.example.com', model: 'M3', api_key: 'full-secret', clear_api_key: false, ssh_host: ''};

    await getProviderChannels();
    await updateProviderChannel('llm', candidate);
    await testProviderChannel('llm', candidate);

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:8000/api/provider-channels',
      'http://127.0.0.1:8000/api/provider-channels/llm',
      'http://127.0.0.1:8000/api/provider-channels/llm/test',
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({method: 'PUT', body: JSON.stringify(candidate)});
    expect(fetch.mock.calls[2][1]).toMatchObject({method: 'POST', body: JSON.stringify(candidate)});
    expect(fetch.mock.calls.flatMap(call => call.slice(0, 1)).join(' ')).not.toContain('full-secret');
  });
});

describe('ProviderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getProviderChannels.mockResolvedValue(structuredClone(snapshot));
    mocks.updateProviderChannel.mockResolvedValue({channel: snapshot.llm, current: snapshot});
    mocks.testProviderChannel.mockResolvedValue({status: 'ok', model: 'MiniMax-M3', host: 'api.minimaxi.com', elapsed_ms: 12, check_scope: 'model', error: null});
  });
  afterEach(cleanup);

  it('loads three accessible channel forms without exposing a full key', async () => {
    render(<ProviderSettings/>);

    expect(await screen.findByRole('heading', {name: '模型渠道'})).toBeVisible();
    expect(screen.getAllByRole('form')).toHaveLength(3);
    expect(screen.getByDisplayValue('MiniMax-M3')).toBeVisible();
    expect(screen.getByLabelText('语音合成 SSH Host')).toHaveValue('ai-comic-tts');
    expect(screen.queryByLabelText('剧本规划 SSH Host')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('full-secret')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('full-secret');
    expect(localStorage.length).toBe(0);
  });

  it('tests unsaved values and reports sanitized success or failure inline', async () => {
    mocks.testProviderChannel
      .mockResolvedValueOnce({status: 'ok', model: 'MiniMax-M4', host: 'api.example.com', elapsed_ms: 9, check_scope: 'model', error: null})
      .mockRejectedValueOnce(new Error('Provider returned HTTP 503'));
    render(<ProviderSettings/>);
    await screen.findByRole('heading', {name: '模型渠道'});

    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'MiniMax-M4');
    await userEvent.click(screen.getByRole('button', {name: '测试剧本规划连接'}));
    expect(await screen.findByText(/连接成功.*9 ms/)).toBeVisible();
    expect(mocks.testProviderChannel).toHaveBeenCalledWith('llm', expect.objectContaining({model: 'MiniMax-M4', api_key: '', clear_api_key: false}));

    await userEvent.click(screen.getByRole('button', {name: '测试剧本规划连接'}));
    expect(await screen.findByText('Provider returned HTTP 503')).toHaveAttribute('role', 'status');
  });

  it('preserves, replaces, and clears keys with explicit payload semantics', async () => {
    render(<ProviderSettings/>);
    await screen.findByRole('heading', {name: '模型渠道'});

    await userEvent.clear(screen.getByLabelText('剧本规划渠道名称'));
    await userEvent.type(screen.getByLabelText('剧本规划渠道名称'), 'MiniMax Production');
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(mocks.updateProviderChannel).toHaveBeenLastCalledWith('llm', expect.objectContaining({api_key: '', clear_api_key: false}));

    await userEvent.clear(screen.getByLabelText('剧本规划渠道名称'));
    await userEvent.type(screen.getByLabelText('剧本规划渠道名称'), 'MiniMax Replacement');
    await userEvent.type(screen.getByLabelText('替换剧本规划 API Key'), 'replacement-secret');
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(mocks.updateProviderChannel).toHaveBeenLastCalledWith('llm', expect.objectContaining({api_key: 'replacement-secret', clear_api_key: false}));

    await userEvent.clear(screen.getByLabelText('剧本规划渠道名称'));
    await userEvent.type(screen.getByLabelText('剧本规划渠道名称'), 'MiniMax Clear');
    await userEvent.click(screen.getByRole('button', {name: '清除剧本规划 API Key'}));
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(mocks.updateProviderChannel).toHaveBeenLastCalledWith('llm', expect.objectContaining({api_key: '', clear_api_key: true}));
    expect(JSON.stringify(localStorage)).not.toContain('replacement-secret');
  });

  it('validates enabled channels and keeps a failed save dirty', async () => {
    mocks.updateProviderChannel.mockRejectedValue(new Error('Unable to save provider channel configuration'));
    const onDirtyChange = vi.fn();
    render(<ProviderSettings onDirtyChange={onDirtyChange}/>);
    await screen.findByRole('heading', {name: '模型渠道'});

    await userEvent.clear(screen.getByLabelText('画面生成 Base URL'));
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(await screen.findByText('已启用渠道需要有效的 HTTP(S) Base URL。')).toHaveAttribute('role', 'alert');
    expect(mocks.updateProviderChannel).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('画面生成 Base URL'), 'https://images.example.com');
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(await screen.findByText('Unable to save provider channel configuration')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('有未保存更改')).toBeVisible();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('saves changed sections in fixed order then reloads the redacted snapshot', async () => {
    const reloaded = structuredClone(snapshot);
    reloaded.llm.name = 'LLM Updated';
    reloaded.tts.ssh_host = 'tts-updated';
    mocks.getProviderChannels.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(reloaded);
    const onSaved = vi.fn();
    render(<ProviderSettings onSaved={onSaved}/>);
    await screen.findByRole('heading', {name: '模型渠道'});

    await userEvent.clear(screen.getByLabelText('语音合成 SSH Host'));
    await userEvent.type(screen.getByLabelText('语音合成 SSH Host'), 'tts-updated');
    await userEvent.clear(screen.getByLabelText('剧本规划渠道名称'));
    await userEvent.type(screen.getByLabelText('剧本规划渠道名称'), 'LLM Updated');
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));

    await waitFor(() => expect(mocks.updateProviderChannel).toHaveBeenCalledTimes(2));
    expect(mocks.updateProviderChannel.mock.calls.map(call => call[0])).toEqual(['llm', 'tts']);
    expect(await screen.findByDisplayValue('LLM Updated')).toBeVisible();
    expect(screen.getByLabelText('语音合成 SSH Host')).toHaveValue('tts-updated');
    expect(screen.queryByDisplayValue('replacement-secret')).not.toBeInTheDocument();
    expect(screen.getByText('所有更改已保存')).toBeVisible();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('lets disabled channels clear credentials while preserving stable form labels', async () => {
    render(<ProviderSettings/>);
    await screen.findByRole('heading', {name: '模型渠道'});
    const section = screen.getByRole('form', {name: '画面生成渠道'});

    await userEvent.click(within(section).getByRole('checkbox', {name: '启用画面生成渠道'}));
    await userEvent.click(within(section).getByRole('button', {name: '清除画面生成 API Key'}));
    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));

    expect(mocks.updateProviderChannel).toHaveBeenCalledWith('image', expect.objectContaining({enabled: false, clear_api_key: true}));
  });
});
