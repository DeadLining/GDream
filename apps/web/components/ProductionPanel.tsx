'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {
  continueProductionRun,
  createProductionRun,
  getEpisodeProductionGraph,
  getProductionCanvasLayout,
  getProductionReadiness,
  getProductionRun,
  listProductionItems,
  pauseProductionRun,
  putProductionCanvasLayout,
  retryProductionRun,
} from '../lib/api';
import {pollProductionRun} from '../lib/production';
import type {EpisodeProductionGraph,ProductionCanvasLayout,ProductionItem, ProductionReadiness, ProductionRun, ProductionStage} from '../lib/types';
import {ProductionCanvas} from './production-canvas/ProductionCanvas';
import type {ProductionMediaMode} from './production-canvas/ProductionMediaWorkspace';
import {ProductionRunControls} from './production-canvas/ProductionRunControls';
import {ShotGroupRerun} from './production-canvas/ShotGroupRerun';
import {ProductionTaskDrawer} from './production-canvas/ProductionTaskDrawer';

export function ProductionPanel({
  episodeId,
  onSelectTarget,
  onSelectCanvasShot,
  onOpenVisualReview,
  onOpenDirector,
  onOpenDialogue,
  onOpenMedia,
  onReadiness,
  refreshKey,
}: {
  episodeId: string;
  onSelectTarget: (id: string) => void;
  onSelectCanvasShot?: (id: string) => void;
  onOpenVisualReview?: (id: string) => void;
  onOpenDirector?: (id: string) => void;
  onOpenDialogue?: (id: string) => void;
  onOpenMedia?: (id: string, mode: ProductionMediaMode) => void;
  onReadiness?: (ready: boolean) => void;
  refreshKey?: number;
}) {
  const [readiness, setReadiness] = useState<ProductionReadiness | null>(null);
  const [stages, setStages] = useState<ProductionStage[]>(['panels', 'speech']);
  const [concurrency, setConcurrency] = useState(2);
  const [regenPanels, setRegenPanels] = useState(false);
  const [regenSpeech, setRegenSpeech] = useState(false);
  const [regenVideos, setRegenVideos] = useState(false);
  const [panelGenerationMode, setPanelGenerationMode] = useState<'solo'|'grid'>('solo');
  const [budgetCapUsd, setBudgetCapUsd] = useState(0);
  const [budgetMode, setBudgetMode] = useState<'observe'|'warn'|'cap'>('observe');
  const [run, setRun] = useState<ProductionRun | null>(null);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('all');
  const [stateEpisodeId, setStateEpisodeId] = useState(episodeId);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [canvasError,setCanvasError]=useState('');
  const [graph,setGraph]=useState<EpisodeProductionGraph|null>(null);
  const [canvasLayout,setCanvasLayout]=useState<ProductionCanvasLayout|null>(null);
  const [selectedShotId,setSelectedShotId]=useState<string|null>(null);
  const [configOpen,setConfigOpen]=useState(false);
  const [queueOpen,setQueueOpen]=useState(false);
  const [selectedCanvasShotIds,setSelectedCanvasShotIds]=useState<string[]>([]);
  const [rerunStarting,setRerunStarting]=useState(false);
  const [rerunError,setRerunError]=useState('');
  const startingRef = useRef(false);
  const sessionRef = useRef({generation: 0, controller: new AbortController()});
  const layoutSaveRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const externalRefreshRef=useRef(refreshKey);

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
  const loadCanvas = async (id:string,generation:number,signal:AbortSignal) => {
    const [nextGraph,nextLayout]=await Promise.all([getEpisodeProductionGraph(id),getProductionCanvasLayout(id)]);
    if(!isCurrent(generation,signal))return;
    setGraph(nextGraph);setCanvasLayout(nextLayout.layout);setCanvasError('');
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
    await loadCanvas(episodeId,generation,signal);
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
    setCanvasError('');
    setGraph(null);setCanvasLayout(null);setSelectedShotId(null);
    setConfigOpen(false);setQueueOpen(false);
    void refreshReadiness(episodeId, generation, controller.signal);
    void loadCanvas(episodeId,generation,controller.signal).catch(cause=>{if(isCurrent(generation,controller.signal))setCanvasError(cause instanceof Error?cause.message:'生产画布加载失败');});
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
    return () => {controller.abort();if(layoutSaveRef.current)clearTimeout(layoutSaveRef.current);};
  }, [episodeId]);

  useEffect(()=>{if(refreshKey===undefined||refreshKey===externalRefreshRef.current)return;externalRefreshRef.current=refreshKey;const {generation,controller}=sessionRef.current;void Promise.all([refreshReadiness(episodeId,generation,controller.signal),loadCanvas(episodeId,generation,controller.signal)]).catch(cause=>{if(isCurrent(generation,controller.signal))setCanvasError(cause instanceof Error?cause.message:'生产画布刷新失败');});},[refreshKey]);

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setConfigOpen(false);
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
        panel_generation_mode: panelGenerationMode,
        budget_cap_usd: budgetCapUsd || undefined,
        budget_mode: budgetMode,
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
  const startShotGroupRerun = async (stages: ProductionStage[]) => {
    if (selectedCanvasShotIds.length === 0 || rerunStarting) return;
    setRerunStarting(true);
    setRerunError('');
    const {generation, controller} = sessionRef.current;
    try {
      const created = await createProductionRun(episodeId, {
        stages,
        concurrency,
        regenerate_panels: stages.includes('panels'),
        regenerate_speech: stages.includes('speech'),
        regenerate_videos: stages.includes('videos'),
        panel_generation_mode: panelGenerationMode,
        budget_cap_usd: budgetCapUsd || undefined,
        budget_mode: budgetMode,
        shot_ids: selectedCanvasShotIds,
      });
      if (!isCurrent(generation, controller.signal)) return;
      // Mirror the new run into the panel state so the operator can watch progress.
      setRun(created);
      setSelectedCanvasShotIds([]);
      await finishActiveRun(created.id, generation, controller.signal, true);
    } catch (cause) {
      if (isCurrent(generation, controller.signal)) {
        setRerunError(cause instanceof Error ? cause.message : '补跑启动失败');
      }
    } finally {
      if (isCurrent(generation, controller.signal)) setRerunStarting(false);
    }
  };

  const currentEpisodeState = stateEpisodeId === episodeId;
  const displayedReadiness = currentEpisodeState ? readiness : null;
  const displayedRun = currentEpisodeState ? run : null;
  const displayedItems = currentEpisodeState ? items : [];
  const selectCanvasShot=(id:string)=>{setSelectedShotId(id);(onSelectCanvasShot??onSelectTarget)(id);};
  const saveCanvasLayout=(next:ProductionCanvasLayout)=>{
    if(layoutSaveRef.current)clearTimeout(layoutSaveRef.current);
    layoutSaveRef.current=setTimeout(()=>{void putProductionCanvasLayout(episodeId,next).catch(cause=>setActionError(cause instanceof Error?cause.message:'画布布局保存失败'));},500);
  };
  const canvasGraph=useMemo(()=>graph?{...graph,production_items:displayedItems.length?displayedItems:graph.production_items}:null,[graph,displayedItems]);
  const retryCanvas=()=>{
    const {generation,controller}=sessionRef.current;
    setCanvasError('');
    void loadCanvas(episodeId,generation,controller.signal).catch(cause=>{if(isCurrent(generation,controller.signal))setCanvasError(cause instanceof Error?cause.message:'生产画布加载失败');});
  };
  return <main className="production-panel production-workbench">
    <header>
      <div><span className="eyebrow">批量生产</span><h1>剧集生产队列</h1></div>
      {displayedReadiness && <div className="readiness-summary">
        <span>缺少画面 {displayedReadiness.blockers.missing_panels.length}</span>
        <span>过期画面 {displayedReadiness.blockers.stale_panels?.length ?? 0}</span>
        <span>未审核 {displayedReadiness.blockers.unapproved_shots.length}</span>
        <span>缺少配音 {displayedReadiness.blockers.missing_speech.length}</span>
        <span>缺少视频 {displayedReadiness.blockers.missing_videos?.length ?? 0}</span>
      </div>}
    </header>
    <div className="production-canvas-stage">
      {canvasGraph?<ProductionCanvas graph={canvasGraph} layout={canvasLayout} selectedShotId={selectedShotId} onSelectShot={selectCanvasShot} onOpenVisualReview={onOpenVisualReview} onOpenDirector={onOpenDirector} onOpenDialogue={onOpenDialogue} onOpenMedia={onOpenMedia} onLayoutChange={saveCanvasLayout} onSelectedShotIdsChange={setSelectedCanvasShotIds}/>:canvasError?<section className="production-canvas-error" role="alert" aria-label="生产画布加载失败"><strong>生产画布暂时无法加载</strong><p>{canvasError}</p><button type="button" onClick={retryCanvas}>重试加载画布</button></section>:<section className="production-canvas-loading" aria-label="单集生产画布">正在加载生产画布…</section>}
      <ShotGroupRerun selectedShotIds={selectedCanvasShotIds} starting={rerunStarting} error={rerunError} onSubmit={stages=>void startShotGroupRerun(stages)}/>
      <ProductionRunControls open={configOpen} onOpenChange={setConfigOpen} stages={stages} setStages={setStages} concurrency={concurrency} setConcurrency={setConcurrency}
        regenerate={{panels:regenPanels,speech:regenSpeech,videos:regenVideos}} setRegenerate={next=>{setRegenPanels(next.panels);setRegenSpeech(next.speech);setRegenVideos(next.videos);}}
        panelGenerationMode={panelGenerationMode} setPanelGenerationMode={setPanelGenerationMode}
        budgetCapUsd={budgetCapUsd} setBudgetCapUsd={setBudgetCapUsd}
        budgetMode={budgetMode} setBudgetMode={setBudgetMode}
        run={displayedRun} starting={starting} onStart={()=>void start()} onPause={()=>void pause()} onResume={()=>void resume()} onOpenQueue={()=>setQueueOpen(true)}/>
      <ProductionTaskDrawer open={queueOpen} run={displayedRun} items={displayedItems} filter={filter} onFilter={setFilter} selected={selected}
        onSelect={(id,checked)=>setSelected(checked?[...selected,id]:selected.filter(itemId=>itemId!==id))} onRetry={()=>void retry()} onOpenItem={onSelectTarget} onClose={()=>setQueueOpen(false)}/>
    </div>
    {actionError && <p className="production-action-error" role="alert">{actionError}</p>}
  </main>;
}
