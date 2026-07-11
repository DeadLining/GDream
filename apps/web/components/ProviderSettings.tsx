'use client';

import {useEffect, useMemo, useState} from 'react';
import {getProviderChannels, testProviderChannel, updateProviderChannel} from '../lib/api';
import type {ProviderChannelKind, ProviderChannelRead, ProviderChannelTestResult, ProviderChannelsRead, ProviderChannelUpdate} from '../lib/types';
import {ProviderChannelSection, type ProviderChannelDraft} from './ProviderChannelSection';

const kinds: ProviderChannelKind[] = ['llm', 'image', 'tts'];
const labels: Record<ProviderChannelKind, string> = {llm: '剧本规划', image: '画面生成', tts: '语音合成'};
type Drafts = Record<ProviderChannelKind, ProviderChannelDraft>;

const toDraft = (channel: ProviderChannelRead): ProviderChannelDraft => ({
  ...channel,
  api_key: '',
  clear_api_key: false,
});
const toDrafts = (snapshot: ProviderChannelsRead): Drafts => ({
  llm: toDraft(snapshot.llm), image: toDraft(snapshot.image), tts: toDraft(snapshot.tts),
});
const payload = (draft: ProviderChannelDraft): ProviderChannelUpdate => ({
  name: draft.name.trim(), enabled: draft.enabled, base_url: draft.base_url.trim(), model: draft.model.trim(),
  api_key: draft.api_key.trim(), clear_api_key: draft.clear_api_key, ssh_host: draft.ssh_host.trim(),
});
const comparable = (draft: ProviderChannelDraft) => JSON.stringify(payload(draft));

function validate(kind: ProviderChannelKind, draft: ProviderChannelDraft) {
  if (!draft.enabled) return '';
  if (!draft.name.trim()) return '已启用渠道需要渠道名称。';
  try {
    const url = new URL(draft.base_url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return '已启用渠道需要有效的 HTTP(S) Base URL。';
  }
  if (!draft.model.trim()) return '已启用渠道需要模型名称。';
  if (kind !== 'tts' && (!draft.api_key_configured || draft.clear_api_key) && !draft.api_key.trim()) {
    return '已启用渠道需要 API Key。';
  }
  return '';
}

export function ProviderSettings({onDirtyChange, onSaved}: {onDirtyChange?: (dirty: boolean) => void; onSaved?: () => void} = {}) {
  const [baseline, setBaseline] = useState<Drafts | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<ProviderChannelKind | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<ProviderChannelKind, ProviderChannelTestResult>>>({});
  const [testErrors, setTestErrors] = useState<Partial<Record<ProviderChannelKind, string>>>({});
  const [validationErrors, setValidationErrors] = useState<Partial<Record<ProviderChannelKind, string>>>({});

  const load = async () => {
    const snapshot = await getProviderChannels();
    const next = toDrafts(snapshot);
    setBaseline(next);
    setDrafts(next);
    setLoadingError('');
    return next;
  };
  useEffect(() => {void load().catch(error => setLoadingError(error instanceof Error ? error.message : '模型渠道加载失败'));}, []);
  const dirtyKinds = useMemo(() => !drafts || !baseline ? [] : kinds.filter(kind => comparable(drafts[kind]) !== comparable(baseline[kind])), [drafts, baseline]);
  const dirty = dirtyKinds.length > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const change = (kind: ProviderChannelKind, draft: ProviderChannelDraft) => {
    setDrafts(current => current ? {...current, [kind]: draft} : current);
    setValidationErrors(current => ({...current, [kind]: ''}));
    setSaved(false);
  };
  const test = async (kind: ProviderChannelKind) => {
    if (!drafts) return;
    const validationError = validate(kind, drafts[kind]);
    setValidationErrors(current => ({...current, [kind]: validationError}));
    if (validationError) return;
    setTesting(kind);
    setTestErrors(current => ({...current, [kind]: ''}));
    setTestResults(current => ({...current, [kind]: undefined}));
    try {
      const result = await testProviderChannel(kind, payload(drafts[kind]));
      setTestResults(current => ({...current, [kind]: result}));
    } catch (error) {
      setTestErrors(current => ({...current, [kind]: error instanceof Error ? error.message : '连接测试失败'}));
    } finally {
      setTesting(null);
    }
  };
  const save = async () => {
    if (!drafts || !dirtyKinds.length || saving) return;
    const errors = Object.fromEntries(kinds.map(kind => [kind, validate(kind, drafts[kind])])) as Record<ProviderChannelKind, string>;
    setValidationErrors(errors);
    if (kinds.some(kind => errors[kind])) return;
    setSaving(true);
    setSaveError('');
    try {
      for (const kind of dirtyKinds) await updateProviderChannel(kind, payload(drafts[kind]));
      await load();
      setSaved(true);
      onSaved?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存模型渠道失败');
    } finally {
      setSaving(false);
    }
  };

  if (loadingError) return <main className="provider-settings center-state"><h1>模型渠道</h1><p role="alert">{loadingError}</p><button onClick={() => void load().catch(error => setLoadingError(error instanceof Error ? error.message : '模型渠道加载失败'))}>重新加载</button></main>;
  if (!drafts) return <main className="provider-settings center-state"><h1>模型渠道</h1><p>正在加载渠道配置</p></main>;
  return (
    <main className="provider-settings">
      <header className="provider-settings-header"><div><h1>模型渠道</h1><p>{dirty ? '有未保存更改' : saved ? '所有更改已保存' : '配置剧本、画面和语音服务'}</p></div><button className="command-button" onClick={() => void save()} disabled={!dirty || saving}>{saving ? '正在保存' : '保存全部更改'}</button></header>
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <div className="provider-settings-sections">
        {kinds.map(kind => <ProviderChannelSection key={kind} kind={kind} label={labels[kind]} draft={drafts[kind]} testing={testing === kind} testResult={testResults[kind] ?? null} testError={testErrors[kind] ?? ''} validationError={validationErrors[kind] ?? ''} onChange={draft => change(kind, draft)} onTest={() => void test(kind)}/>)}
      </div>
    </main>
  );
}
