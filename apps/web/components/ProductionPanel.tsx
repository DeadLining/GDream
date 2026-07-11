'use client';

import {useEffect, useRef, useState} from 'react';
import {Film, Image, Mic2, Pause, Play, RefreshCw} from 'lucide-react';
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
  const [regenVideos, setRegenVideos] = useState(false);
  const [run, setRun] = useState<ProductionRun | null>(null);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('all');
  const [stateEpisodeId, setStateEpisodeId] = useState(episodeId);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState('');
  const startingRef = useRef(false);
  const sessionRef = useRef({generation: 0, controller: new AbortController()});

  const isCurrent = (generation: number, signal: AbortSignal) => sessionRef.current.generation === generation && !signal.aborted;
  const refreshReadiness = async (id: string, generation: number, signal: AbortSignal) => {
    const value = await getProductionReadiness(id);
    if (!isCurrent(generation, signal)) return;
    setReadiness(value);
    onReadiness?.(value.ready);
  };
  const loadItems = async (id: string, generation: number, signal: AbortSignal) => {
    const value = await listProductionItems(id);
    if (isCurrent(generation, signal)) setItems(value);
  };
  const finishActiveRun = async (id: string, generation: number, signal: AbortSignal, shouldContinue: boolean) => {
    if (shouldContinue) {
      const continued = await continueProductionRun(id);
      if (!isCurrent(generation, signal)) return;
      setRun(continued);
    }
    const finished = await pollProductionRun(id, {signal});
    if (!isCurrent(generation, signal)) return;
    setRun(finished);
    await loadItems(id, generation, signal);
    await refreshReadiness(episodeId, generation, signal);
  };

  useEffect(() => {
    sessionRef.current.controller.abort();
    const controller = new AbortController();
    const generation = sessionRef.current.generation + 1;
    sessionRef.current = {generation, controller};
    setStateEpisodeId(episodeId);
    setReadiness(null);
    setRun(null);
    setItems([]);
    setSelected([]);
    setFilter('all');
    startingRef.current = false;
    setStarting(false);
    setActionError('');
    void refreshReadiness(episodeId, generation, controller.signal);
    const runId = localStorage.getItem(`ai-comic-production-${episodeId}`);
    if (runId) {
      void (async () => {
        const savedRun = await getProductionRun(runId);
        if (!isCurrent(generation, controller.signal)) return;
        setRun(savedRun);
        if (savedRun.status === 'queued') await finishActiveRun(runId, generation, controller.signal, true);
        else if (savedRun.status === 'running') await finishActiveRun(runId, generation, controller.signal, false);
        else await loadItems(runId, generation, controller.signal);
      })().catch(cause => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
      });
    }
    return () => controller.abort();
  }, [episodeId]);

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setActionError('');
    const {generation, controller} = sessionRef.current;
    const id = episodeId;
    try {
      const created = await createProductionRun(id, {
        stages,
        concurrency,
        regenerate_panels: regenPanels,
        regenerate_speech: regenSpeech,
        regenerate_videos: regenVideos,
      });
      if (!isCurrent(generation, controller.signal)) return;
      localStorage.setItem(`ai-comic-production-${id}`, created.id);
      setRun(created);
      await finishActiveRun(created.id, generation, controller.signal, true);
    } catch (cause) {
      if (isCurrent(generation, controller.signal)) setActionError(cause instanceof Error ? cause.message : '启动失败');
    } finally {
      if (isCurrent(generation, controller.signal)) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  };
  const pause = async () => {
    if (!run) return;
    const {generation, controller} = sessionRef.current;
    const paused = await pauseProductionRun(run.id);
    if (isCurrent(generation, controller.signal)) setRun(paused);
  };
  const resume = async () => {
    if (!run) return;
    const {generation, controller} = sessionRef.current;
    await finishActiveRun(run.id, generation, controller.signal, true);
  };
  const retry = async () => {
    if (!run) return;
    const {generation, controller} = sessionRef.current;
    const retried = await retryProductionRun(run.id, selected);
    if (!isCurrent(generation, controller.signal)) return;
    setRun(retried);
    setSelected([]);
    await finishActiveRun(run.id, generation, controller.signal, true);
  };

  const currentEpisodeState = stateEpisodeId === episodeId;
  const displayedReadiness = currentEpisodeState ? readiness : null;
  const displayedRun = currentEpisodeState ? run : null;
  const displayedItems = currentEpisodeState ? items : [];
  const visible = displayedItems.filter(item => filter === 'all' || (
    filter === 'completed' ? ['succeeded', 'skipped'].includes(item.status) : item.status === filter
  ));
  const filters = [
    {value: 'all', label: '全部'},
    {value: 'running', label: '进行中'},
    {value: 'failed', label: '失败'},
    {value: 'completed', label: '已完成'},
  ];

  return <main className="production-panel">
    <header>
      <div><span className="eyebrow">批量生产</span><h1>剧集生产队列</h1></div>
      {displayedReadiness && <div className="readiness-summary">
        <span>缺少画面 {displayedReadiness.blockers.missing_panels.length}</span>
        <span>未审核 {displayedReadiness.blockers.unapproved_shots.length}</span>
        <span>缺少配音 {displayedReadiness.blockers.missing_speech.length}</span>
        <span>缺少视频 {displayedReadiness.blockers.missing_videos?.length ?? 0}</span>
      </div>}
    </header>
    <section className="production-options" aria-label="生产选项">
      <label><input aria-label="画面" type="checkbox" checked={stages.includes('panels')} onChange={event => setStages(event.target.checked ? [...stages, 'panels'] : stages.filter(x => x !== 'panels'))}/><Image size={15} aria-hidden="true"/>画面</label>
      <label><input aria-label="配音" type="checkbox" checked={stages.includes('speech')} onChange={event => setStages(event.target.checked ? [...stages, 'speech'] : stages.filter(x => x !== 'speech'))}/><Mic2 size={15} aria-hidden="true"/>配音</label>
      <label><input aria-label="视频" type="checkbox" checked={stages.includes('videos')} onChange={event => setStages(event.target.checked ? [...stages, 'videos'] : stages.filter(x => x !== 'videos'))}/><Film size={15} aria-hidden="true"/>视频</label>
      <label>并发数<input aria-label="并发数" type="number" min={1} max={4} value={concurrency} onChange={event => setConcurrency(Number(event.target.value))}/></label>
      <label><input type="checkbox" checked={regenPanels} onChange={event => setRegenPanels(event.target.checked)}/>重生成画面</label>
      <label><input type="checkbox" checked={regenSpeech} onChange={event => setRegenSpeech(event.target.checked)}/>重生成配音</label>
      <label><input type="checkbox" checked={regenVideos} onChange={event => setRegenVideos(event.target.checked)}/>重生成视频</label>
    </section>
    <div className="production-actions">
      {!displayedRun && <button className="primary-action" disabled={!stages.length || starting} aria-busy={starting} onClick={start}><Play size={15} aria-hidden="true"/>{starting ? '正在启动' : '开始批量生产'}</button>}
      {displayedRun?.status === 'running' && <button onClick={pause}><Pause size={15} aria-hidden="true"/>暂停</button>}
      {displayedRun?.status === 'paused' && <button onClick={resume}><Play size={15} aria-hidden="true"/>继续</button>}
      {displayedRun?.failed_items ? <button onClick={retry} disabled={!selected.length}><RefreshCw size={15} aria-hidden="true"/>重试选中失败项</button> : null}
    </div>
    {actionError && <p className="production-action-error" role="alert">{actionError}</p>}
    {displayedRun && <>
      <div className="production-progress">
        <progress max={displayedRun.total_items || 1} value={displayedRun.succeeded_items + displayedRun.failed_items + displayedRun.skipped_items}/>
        <span>成功 {displayedRun.succeeded_items}</span><span>失败 {displayedRun.failed_items}</span><span>跳过 {displayedRun.skipped_items}</span>
      </div>
      <nav className="production-filters" aria-label="生产队列筛选">{filters.map(({value, label}) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</nav>
      <div className="production-items">{visible.map(item => <ProductionItemRow key={item.id} item={item} selected={selected.includes(item.id)} onSelect={checked => setSelected(checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} onOpen={() => onSelectTarget(item.target_id)}/>)}</div>
    </>}
  </main>;
}
