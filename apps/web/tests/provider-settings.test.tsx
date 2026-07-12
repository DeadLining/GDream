import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ProviderSettings} from '../components/ProviderSettings';
import type {ProviderChannelsRead} from '../lib/types';

const mocks = vi.hoisted(() => ({
  getProviderChannels: vi.fn(),
  updateProviderChannel: vi.fn(),
  testProviderChannel: vi.fn(),
  getMockSshHosts: vi.fn(),
  getMockSshStatus: vi.fn(),
  startMockSsh: vi.fn(),
  stopMockSsh: vi.fn(),
}));

vi.mock('../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  getProviderChannels: mocks.getProviderChannels,
  updateProviderChannel: mocks.updateProviderChannel,
  testProviderChannel: mocks.testProviderChannel,
  getMockSshHosts: mocks.getMockSshHosts,
  getMockSshStatus: mocks.getMockSshStatus,
  startMockSsh: mocks.startMockSsh,
  stopMockSsh: mocks.stopMockSsh,
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
  video: {
    name: 'MiniMax Video', enabled: true, base_url: 'https://api.minimaxi.com',
    model: 'MiniMax-Hailuo-02', ssh_host: '', api_key_configured: true, api_key_masked: 'sk-•••vid9',
  },
  persistence: {status: 'saved', file_path: 'data/provider-channels.json'},
  reloaded_at: '2026-07-11T10:00:00Z',
};
const settingsStyles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

function updateResponse(current: ProviderChannelsRead, kind: 'llm' | 'image' | 'tts' | 'video') {
  return {channel: current[kind], current};
}

describe('provider channel API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps provider secrets in JSON request bodies only', async () => {
    const {getProviderChannels, testProviderChannel, updateProviderChannel} = await vi.importActual<typeof import('../lib/api')>('../lib/api');
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
      '/api/provider-channels',
      '/api/provider-channels/llm',
      '/api/provider-channels/llm/test',
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
    mocks.getMockSshHosts.mockResolvedValue([{id: 'a800_94', name: 'A800 94', type: 'ssh'}]);
    mocks.getMockSshStatus.mockResolvedValue({desired_running: false, state: 'stopped', host_id: null, alias: null, port: null, error: null, reused: false});
  });
  afterEach(cleanup);

  it('loads four accessible channel forms without exposing a full key', async () => {
    render(<ProviderSettings/>);

    expect(await screen.findAllByRole('form')).toHaveLength(4);
    expect(screen.getByDisplayValue('MiniMax-Hailuo-02')).toBeVisible();
    expect(screen.getByRole('heading', {name: '模型渠道'})).toBeVisible();
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
      .mockResolvedValueOnce({status: 'failed', model: 'MiniMax-M4', host: 'api.example.com', elapsed_ms: 11, check_scope: 'model', error: 'Model unavailable'})
      .mockRejectedValueOnce(new Error('Provider returned HTTP 503'));
    render(<ProviderSettings/>);
    await screen.findByRole('heading', {name: '模型渠道'});

    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'MiniMax-M4');
    await userEvent.click(screen.getByRole('button', {name: '测试剧本规划连接'}));
    expect(await screen.findByText(/连接成功.*9 ms/)).toHaveClass('provider-test-result', 'success');
    expect(screen.getByText(/连接成功.*9 ms/)).toHaveAttribute('role', 'status');
    expect(mocks.testProviderChannel).toHaveBeenCalledWith('llm', expect.objectContaining({model: 'MiniMax-M4', api_key: '', clear_api_key: false}));

    await userEvent.click(screen.getByRole('button', {name: '测试剧本规划连接'}));
    expect(await screen.findByText('Model unavailable')).toHaveClass('provider-test-result', 'failure');
    expect(screen.getByText('Model unavailable')).toHaveAttribute('role', 'alert');

    await userEvent.click(screen.getByRole('button', {name: '测试剧本规划连接'}));
    expect(await screen.findByText('Provider returned HTTP 503')).toHaveClass('provider-test-result', 'failure');
    expect(screen.getByText('Provider returned HTTP 503')).toHaveAttribute('role', 'alert');
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
    await userEvent.click(screen.getByRole('checkbox', {name: '启用剧本规划渠道'}));
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
    expect(await screen.findByRole('alert')).toHaveTextContent('画面生成保存失败：Unable to save provider channel configuration');
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

  it('locks every section synchronously during save and prevents duplicate writes or lost key edits', async () => {
    const saving = deferred<ReturnType<typeof updateResponse>>();
    const current = structuredClone(snapshot);
    current.llm.name = 'Locked save';
    mocks.updateProviderChannel.mockReturnValue(saving.promise);
    mocks.getProviderChannels.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(current);
    render(<ProviderSettings/>);
    await screen.findAllByRole('form');
    await userEvent.clear(screen.getByLabelText('剧本规划渠道名称'));
    await userEvent.type(screen.getByLabelText('剧本规划渠道名称'), 'Locked save');
    await userEvent.type(screen.getByLabelText('替换剧本规划 API Key'), 'typed-before-save');

    const save = screen.getByRole('button', {name: '保存全部更改'});
    await userEvent.click(save);
    save.click();

    expect(mocks.updateProviderChannel).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.provider-channel-section fieldset[disabled]')).toHaveLength(4);
    expect(screen.getByLabelText('画面生成渠道名称')).toBeDisabled();
    expect(screen.getByLabelText('替换剧本规划 API Key')).toBeDisabled();
    expect(screen.getByRole('button', {name: '测试画面生成连接'})).toBeDisabled();
    expect(screen.getByDisplayValue('typed-before-save')).toBeDisabled();

    saving.resolve(updateResponse(current, 'llm'));
    await waitFor(() => expect(screen.getByLabelText('画面生成渠道名称')).toBeEnabled());
  });

  it('reconciles partial sequential saves and retries only the failed credential operation', async () => {
    const committed = structuredClone(snapshot);
    committed.llm.name = 'Committed LLM';
    committed.llm.api_key_masked = 'sk-•••new';
    mocks.updateProviderChannel
      .mockResolvedValueOnce(updateResponse(committed, 'llm'))
      .mockRejectedValueOnce(new Error('image save failed'))
      .mockResolvedValueOnce(updateResponse({...committed, image: {...committed.image, name: 'Pending Image'}}, 'image'));
    render(<ProviderSettings/>);
    await screen.findAllByRole('form');
    await userEvent.clear(screen.getByLabelText('剧本规划渠道名称'));
    await userEvent.type(screen.getByLabelText('剧本规划渠道名称'), 'Committed LLM');
    await userEvent.type(screen.getByLabelText('替换剧本规划 API Key'), 'one-shot-llm-key');
    await userEvent.clear(screen.getByLabelText('画面生成渠道名称'));
    await userEvent.type(screen.getByLabelText('画面生成渠道名称'), 'Pending Image');
    await userEvent.type(screen.getByLabelText('替换画面生成 API Key'), 'retry-image-key');

    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('剧本规划已保存；画面生成保存失败：image save failed');
    expect(screen.getByLabelText('替换剧本规划 API Key')).toHaveValue('');
    expect(screen.getByLabelText('替换画面生成 API Key')).toHaveValue('retry-image-key');

    await userEvent.click(screen.getByRole('button', {name: '保存全部更改'}));
    expect(mocks.updateProviderChannel.mock.calls.map(call => call[0])).toEqual(['llm', 'image', 'image']);
    expect(mocks.updateProviderChannel.mock.calls[2][1]).toEqual(expect.objectContaining({api_key: 'retry-image-key'}));
    expect(JSON.stringify(mocks.updateProviderChannel.mock.calls[2][1])).not.toContain('one-shot-llm-key');
  });

  it('runs different channel probes in parallel, guards duplicates, and ignores stale edited results', async () => {
    const llm = deferred<{status: 'ok'; model: string; host: string; elapsed_ms: number; check_scope: 'model'; error: null}>();
    const image = deferred<{status: 'ok'; model: string; host: string; elapsed_ms: number; check_scope: 'endpoint'; error: null}>();
    mocks.testProviderChannel.mockImplementation((kind: string) => kind === 'llm' ? llm.promise : image.promise);
    render(<ProviderSettings/>);
    await screen.findAllByRole('form');

    const llmButton = screen.getByRole('button', {name: '测试剧本规划连接'});
    await userEvent.click(llmButton);
    llmButton.click();
    await userEvent.click(screen.getByRole('button', {name: '测试画面生成连接'}));
    expect(mocks.testProviderChannel.mock.calls.map(call => call[0])).toEqual(['llm', 'image']);

    await userEvent.clear(screen.getByLabelText('剧本规划模型'));
    await userEvent.type(screen.getByLabelText('剧本规划模型'), 'edited-while-probing');
    llm.resolve({status: 'ok', model: 'old', host: 'old.example.com', elapsed_ms: 2, check_scope: 'model', error: null});
    image.resolve({status: 'ok', model: 'image', host: 'image.example.com', elapsed_ms: 3, check_scope: 'endpoint', error: null});
    expect(await screen.findByText(/image\.example\.com/)).toBeVisible();
    expect(screen.queryByText(/old\.example\.com/)).not.toBeInTheDocument();
  });

  it('ignores stale retry loads and aborts outstanding loads on unmount', async () => {
    const stale = deferred<ProviderChannelsRead>();
    const latest = deferred<ProviderChannelsRead>();
    mocks.getProviderChannels.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    const view = render(<ProviderSettings/>);
    const retry = await screen.findByRole('button', {name: '重新加载'});
    retry.click();
    retry.click();
    const latestSnapshot = structuredClone(snapshot); latestSnapshot.llm.model = 'latest-model';
    const staleSnapshot = structuredClone(snapshot); staleSnapshot.llm.model = 'stale-model';
    latest.resolve(latestSnapshot);
    expect(await screen.findByDisplayValue('latest-model')).toBeVisible();
    stale.resolve(staleSnapshot);
    await waitFor(() => expect(screen.queryByDisplayValue('stale-model')).not.toBeInTheDocument());
    view.unmount();
    expect(mocks.getProviderChannels.mock.calls.some(call => call[0] instanceof AbortSignal)).toBe(true);
  });

  it('provides a scrollable responsive settings surface with reachable channel sections', () => {
    expect(settingsStyles).toMatch(/\.provider-settings\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/);
    expect(settingsStyles).toMatch(/\.provider-settings-header\s*\{[^}]*min-height:\s*0[^}]*padding:\s*0 0 8px/);
    expect(settingsStyles).toMatch(/\.provider-settings-sections\s*\{[^}]*padding-top:\s*8px/);
    expect(settingsStyles).toMatch(/\.provider-settings-sections\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(settingsStyles).toMatch(/@media \(max-width:\s*1100px\)[\s\S]*\.provider-settings-sections\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(settingsStyles).toMatch(/\.provider-channel-section input\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*height:\s*36px/);
    expect(settingsStyles).toMatch(/\.provider-test-row\s*\{[^}]*min-height:\s*44px/);
    expect(settingsStyles).toMatch(/\.provider-test-result\s*\{[^}]*min-height:\s*34px[^}]*overflow-wrap:\s*anywhere/);
    expect(settingsStyles).toMatch(/\.provider-test-result\.success\s*\{[^}]*background:\s*#edf6f1[^}]*color:\s*#286044/);
    expect(settingsStyles).toMatch(/\.provider-test-result\.failure\s*\{[^}]*background:\s*#f8e4e2[^}]*color:\s*#8c2d27/);
  });

  it('keeps four fixed channel sections linked to stable inline result regions', async () => {
    render(<ProviderSettings/>);

    const forms = await screen.findAllByRole('form');
    expect(forms.map(form => form.getAttribute('aria-label'))).toEqual(['剧本规划渠道', '画面生成渠道', '语音合成渠道', '视频生成渠道']);
    for (const [index, label] of ['剧本规划', '画面生成', '语音合成', '视频生成'].entries()) {
      const button = within(forms[index]).getByRole('button', {name: `测试${label}连接`});
      const statusId = button.getAttribute('aria-describedby');
      expect(statusId).toBe(`provider-${['llm', 'image', 'tts', 'video'][index]}-status`);
      expect(document.getElementById(statusId!)).toHaveAttribute('role', 'status');
    }
  });
});
