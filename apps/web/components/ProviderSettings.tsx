'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {getProviderChannels, testProviderChannel, updateProviderChannel} from '../lib/api';
import type {ProviderChannelKind, ProviderChannelRead, ProviderChannelTestResult, ProviderChannelsRead, ProviderChannelUpdate, ProviderChannelUpdateRead} from '../lib/types';
import {ProviderChannelSection, type ProviderChannelDraft} from './ProviderChannelSection';
import {MockSshControl} from './MockSshControl';

const kinds: ProviderChannelKind[] = ['llm', 'image', 'tts', 'video'];
const labels: Record<ProviderChannelKind, string> = {llm: '剧本规划', image: '画面生成', tts: '语音合成', video: '视频生成'};
type Drafts = Record<ProviderChannelKind, ProviderChannelDraft>;
type KindState<T> = Partial<Record<ProviderChannelKind, T>>;

const toDraft = (channel: ProviderChannelRead): ProviderChannelDraft => ({...channel, api_key: '', clear_api_key: false});
const fallbackVideo: ProviderChannelRead = {name: 'MiniMax Video', enabled: false, base_url: 'https://api.minimaxi.com', model: 'MiniMax-Hailuo-02', ssh_host: '', api_key_configured: false, api_key_masked: ''};
const toDrafts = (snapshot: ProviderChannelsRead): Drafts => ({llm: toDraft(snapshot.llm), image: toDraft(snapshot.image), tts: toDraft(snapshot.tts), video: toDraft(snapshot.video ?? fallbackVideo)});
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
  if ((kind === 'llm' || kind === 'image') && (!draft.api_key_configured || draft.clear_api_key) && !draft.api_key.trim()) return '已启用渠道需要 API Key。';
  return '';
}

export function ProviderSettings({onDirtyChange, onSaved, embedded = false}: {onDirtyChange?: (dirty: boolean) => void; onSaved?: () => void; embedded?: boolean} = {}) {
  const [baseline, setBaseline] = useState<Drafts | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingTests, setPendingTests] = useState<KindState<boolean>>({});
  const [testResults, setTestResults] = useState<KindState<ProviderChannelTestResult>>({});
  const [testErrors, setTestErrors] = useState<KindState<string>>({});
  const [validationErrors, setValidationErrors] = useState<KindState<string>>({});
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const testGeneration = useRef<Record<ProviderChannelKind, number>>({llm: 0, image: 0, tts: 0, video: 0});
  const pendingTestRef = useRef<Record<ProviderChannelKind, boolean>>({llm: false, image: false, tts: false, video: false});

  const load = async () => {
    const generation = ++loadGeneration.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const snapshot = await getProviderChannels(controller.signal);
      if (!mounted.current || generation !== loadGeneration.current) return false;
      const next = toDrafts(snapshot);
      setBaseline(next);
      setDrafts(next);
      setLoadingError('');
      return true;
    } catch (error) {
      if (!mounted.current || generation !== loadGeneration.current || controller.signal.aborted) return false;
      setLoadingError(error instanceof Error ? error.message : '模型渠道加载失败');
      return false;
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
      loadController.current?.abort();
      for (const kind of kinds) testGeneration.current[kind] += 1;
    };
  }, []);

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
    if (savingRef.current) return;
    testGeneration.current[kind] += 1;
    pendingTestRef.current[kind] = false;
    setPendingTests(current => ({...current, [kind]: false}));
    setTestResults(current => ({...current, [kind]: undefined}));
    setTestErrors(current => ({...current, [kind]: ''}));
    setDrafts(current => current ? {...current, [kind]: draft} : current);
    setValidationErrors(current => ({...current, [kind]: ''}));
    setSaved(false);
  };

  const test = async (kind: ProviderChannelKind) => {
    if (!drafts || savingRef.current || pendingTestRef.current[kind]) return;
    const validationError = validate(kind, drafts[kind]);
    setValidationErrors(current => ({...current, [kind]: validationError}));
    if (validationError) return;
    const generation = ++testGeneration.current[kind];
    pendingTestRef.current[kind] = true;
    setPendingTests(current => ({...current, [kind]: true}));
    setTestErrors(current => ({...current, [kind]: ''}));
    setTestResults(current => ({...current, [kind]: undefined}));
    try {
      const result = await testProviderChannel(kind, payload(drafts[kind]));
      if (mounted.current && generation === testGeneration.current[kind]) setTestResults(current => ({...current, [kind]: result}));
    } catch (error) {
      if (mounted.current && generation === testGeneration.current[kind]) setTestErrors(current => ({...current, [kind]: error instanceof Error ? error.message : '连接测试失败'}));
    } finally {
      if (mounted.current && generation === testGeneration.current[kind]) {
        pendingTestRef.current[kind] = false;
        setPendingTests(current => ({...current, [kind]: false}));
      }
    }
  };

  const save = async () => {
    if (!drafts || !dirtyKinds.length || savingRef.current) return;
    const saveDrafts = drafts;
    const saveKinds = dirtyKinds;
    const errors = Object.fromEntries(kinds.map(kind => [kind, validate(kind, saveDrafts[kind])])) as Record<ProviderChannelKind, string>;
    setValidationErrors(errors);
    if (kinds.some(kind => errors[kind])) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    const committed: ProviderChannelKind[] = [];
    try {
      for (const kind of saveKinds) {
        let response: ProviderChannelUpdateRead;
        try {
          response = await updateProviderChannel(kind, payload(saveDrafts[kind]));
        } catch (error) {
          if (mounted.current) {
            const prefix = committed.length ? `${committed.map(item => labels[item]).join('、')}已保存；` : '';
            setSaveError(`${prefix}${labels[kind]}保存失败：${error instanceof Error ? error.message : '保存模型渠道失败'}`);
          }
          return;
        }
        if (!mounted.current) return;
        committed.push(kind);
        const serverDrafts = toDrafts(response.current);
        setBaseline(serverDrafts);
        setDrafts(current => {
          if (!current) return current;
          const reconciled = {...current};
          for (const savedKind of committed) reconciled[savedKind] = serverDrafts[savedKind];
          return reconciled;
        });
      }
      const loaded = await load();
      if (mounted.current && loaded) {
        setSaved(true);
        onSaved?.();
      } else if (mounted.current) {
        setSaveError('渠道已保存，但重新加载脱敏配置失败，请重试。');
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  if (loadingError && !drafts) return <section className={`provider-settings center-state${embedded ? ' provider-settings-embedded' : ''}`}>{!embedded && <h1>模型渠道</h1>}<p role="alert">{loadingError}</p><button onClick={() => void load()}>重新加载</button></section>;
  if (!drafts) return <section className={`provider-settings center-state${embedded ? ' provider-settings-embedded' : ''}`}>{!embedded && <h1>模型渠道</h1>}<p>正在加载渠道配置</p></section>;
  return (
    <section className={`provider-settings${embedded ? ' provider-settings-embedded' : ''}`}>
      <header className="provider-settings-header"><div>{!embedded && <h1>模型渠道</h1>}<p>{dirty ? '有未保存更改' : saved ? '所有更改已保存' : '配置剧本、画面、语音和视频服务'}</p></div><button className="command-button" onClick={() => void save()} disabled={!dirty || saving}>{saving ? '正在保存' : '保存全部更改'}</button></header>
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <div className="provider-settings-sections">
        {kinds.map(kind => <ProviderChannelSection key={kind} kind={kind} label={labels[kind]} draft={drafts[kind]} testing={Boolean(pendingTests[kind])} disabled={saving} testResult={testResults[kind] ?? null} testError={testErrors[kind] ?? ''} validationError={validationErrors[kind] ?? ''} onChange={draft => change(kind, draft)} onTest={() => void test(kind)}/>)}
      </div>
      <MockSshControl/>
    </section>
  );
}
