'use client';

import {useEffect, useState} from 'react';
import {
  continueProductionRun,
  createProductionRun,
  getProductionReadiness,
  getProductionRun,
  listProductionItems,
  pauseProductionRun,
  retryProductionRun,
} from '../lib/api';
import {pollProductionRun} from '../lib/production';
import type {ProductionItem, ProductionReadiness, ProductionRun, ProductionStage} from '../lib/types';
import {ProductionItemRow} from './ProductionItemRow';

export function ProductionPanel({
  episodeId,
  onSelectTarget,
  onReadiness,
}: {
  episodeId: string;
  onSelectTarget: (id: string) => void;
  onReadiness?: (ready: boolean) => void;
}) {
  const [readiness, setReadiness] = useState<ProductionReadiness | null>(null);
  const [stages, setStages] = useState<ProductionStage[]>(['panels', 'speech']);
  const [concurrency, setConcurrency] = useState(2);
  const [regenPanels, setRegenPanels] = useState(false);
  const [regenSpeech, setRegenSpeech] = useState(false);
  const [run, setRun] = useState<ProductionRun | null>(null);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('all');

  const refreshReadiness = async () => {
    const value = await getProductionReadiness(episodeId);
    setReadiness(value);
    onReadiness?.(value.ready);
  };
  const loadItems = async (id: string) => setItems(await listProductionItems(id));

  useEffect(() => {
    void refreshReadiness();
    const runId = localStorage.getItem(`ai-comic-production-${episodeId}`);
    if (runId) {
      void Promise.all([getProductionRun(runId), listProductionItems(runId)]).then(([savedRun, savedItems]) => {
        setRun(savedRun);
        setItems(savedItems);
      });
    }
  }, [episodeId]);

  const start = async () => {
    const created = await createProductionRun(episodeId, {
      stages,
      concurrency,
      regenerate_panels: regenPanels,
      regenerate_speech: regenSpeech,
    });
    localStorage.setItem(`ai-comic-production-${episodeId}`, created.id);
    setRun(created);
    setRun(await continueProductionRun(created.id));
    const finished = await pollProductionRun(created.id);
    setRun(finished);
    await loadItems(created.id);
    await refreshReadiness();
  };
  const pause = async () => run && setRun(await pauseProductionRun(run.id));
  const resume = async () => {
    if (!run) return;
    setRun(await continueProductionRun(run.id));
    const finished = await pollProductionRun(run.id);
    setRun(finished);
    await loadItems(run.id);
    await refreshReadiness();
  };
  const retry = async () => {
    if (!run) return;
    setRun(await retryProductionRun(run.id, selected));
    setSelected([]);
    await resume();
  };

  const visible = items.filter(item => filter === 'all' || (
    filter === 'completed' ? ['succeeded', 'skipped'].includes(item.status) : item.status === filter
  ));

  return <main className="production-panel">
    <header>
      <div><span className="eyebrow">批量生产</span><h1>剧集生产队列</h1></div>
      {readiness && <div className="readiness-summary">
        <span>缺少画面 {readiness.blockers.missing_panels.length}</span>
        <span>未审核 {readiness.blockers.unapproved_shots.length}</span>
        <span>缺少配音 {readiness.blockers.missing_speech.length}</span>
      </div>}
    </header>
    <section className="production-options">
      <label><input aria-label="画面" type="checkbox" checked={stages.includes('panels')} onChange={event => setStages(event.target.checked ? [...stages, 'panels'] : stages.filter(x => x !== 'panels'))}/>画面</label>
      <label><input aria-label="配音" type="checkbox" checked={stages.includes('speech')} onChange={event => setStages(event.target.checked ? [...stages, 'speech'] : stages.filter(x => x !== 'speech'))}/>配音</label>
      <label>并发数<input aria-label="并发数" type="number" min={1} max={4} value={concurrency} onChange={event => setConcurrency(Number(event.target.value))}/></label>
      <label><input type="checkbox" checked={regenPanels} onChange={event => setRegenPanels(event.target.checked)}/>重生成画面</label>
      <label><input type="checkbox" checked={regenSpeech} onChange={event => setRegenSpeech(event.target.checked)}/>重生成配音</label>
    </section>
    <div className="production-actions">
      {!run && <button className="primary-action" disabled={!stages.length} onClick={start}>开始批量生产</button>}
      {run?.status === 'running' && <button onClick={pause}>暂停</button>}
      {run?.status === 'paused' && <button onClick={resume}>继续</button>}
      {run?.failed_items ? <button onClick={retry} disabled={!selected.length}>重试选中失败项</button> : null}
    </div>
    {run && <>
      <div className="production-progress">
        <progress max={run.total_items || 1} value={run.succeeded_items + run.failed_items + run.skipped_items}/>
        <span>成功 {run.succeeded_items}</span><span>失败 {run.failed_items}</span><span>跳过 {run.skipped_items}</span>
      </div>
      <nav className="production-filters">{['all', 'running', 'failed', 'completed'].map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</nav>
      <div className="production-items">{visible.map(item => <ProductionItemRow key={item.id} item={item} selected={selected.includes(item.id)} onSelect={checked => setSelected(checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} onOpen={() => onSelectTarget(item.target_id)}/>)}</div>
    </>}
  </main>;
}
