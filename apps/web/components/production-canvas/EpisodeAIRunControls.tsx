'use client';

import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,Check,Loader2,Pause,Play,RefreshCw,Sparkles} from 'lucide-react';
import {
  continueEpisodeAIRun,
  createEpisodeAIRun,
  getActiveEpisodeAIRun,
  getEpisodeAIRun,
  pauseEpisodeAIRun,
  retryEpisodeAIRun,
} from '../../lib/api';
import type {EpisodeAIRun,EpisodeAIStageName} from '../../lib/types';

const STAGES:Array<{id:EpisodeAIStageName;label:string}>=[
  {id:'scripting',label:'剧本'},
  {id:'structuring',label:'结构'},
  {id:'references',label:'角色'},
  {id:'panels',label:'画面'},
  {id:'panel_review',label:'审图'},
  {id:'speech',label:'配音'},
  {id:'videos',label:'视频'},
  {id:'rendering',label:'合成'},
  {id:'quality_review',label:'质检'},
  {id:'release_candidate',label:'候选'},
  {id:'release_gate',label:'门禁'},
  {id:'published',label:'母版'},
];

const ACTIVE=new Set(['queued','running']);
const storageKey=(episodeId:string)=>`ai-comic-episode-ai-${episodeId}`;
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(resolve,ms);
  signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
});

export function EpisodeAIRunControls({episodeId,onCompleted}:{episodeId:string;onCompleted?:()=>void}){
  const [run,setRun]=useState<EpisodeAIRun|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const generationRef=useRef(0);
  const actionRef=useRef(false);

  const follow=async(runId:string,generation:number,signal:AbortSignal)=>{
    while(!signal.aborted&&generationRef.current===generation){
      const next=await getEpisodeAIRun(runId,signal);
      if(signal.aborted||generationRef.current!==generation)return;
      setRun(next);
      if(!ACTIVE.has(next.status)){
        if(next.status==='completed')onCompleted?.();
        return;
      }
      await sleep(1000,signal);
    }
  };

  useEffect(()=>{
    const controller=new AbortController();
    const generation=generationRef.current+1;
    generationRef.current=generation;
    setRun(null);setLoading(true);setBusy(false);setError('');actionRef.current=false;
    void (async()=>{
      const saved=localStorage.getItem(storageKey(episodeId));
      let restored:EpisodeAIRun|null=null;
      if(saved){
        try{restored=await getEpisodeAIRun(saved,controller.signal);}catch{localStorage.removeItem(storageKey(episodeId));}
      }
      if(!restored)restored=await getActiveEpisodeAIRun(episodeId,controller.signal);
      if(controller.signal.aborted||generationRef.current!==generation)return;
      setRun(restored);setLoading(false);
      if(restored){
        localStorage.setItem(storageKey(episodeId),restored.id);
        if(ACTIVE.has(restored.status))await follow(restored.id,generation,controller.signal);
      }
    })().catch(cause=>{
      if(controller.signal.aborted)return;
      setLoading(false);setError(cause instanceof Error?cause.message:'整集任务加载失败');
    });
    return()=>controller.abort();
  },[episodeId]);

  const execute=async(action:()=>Promise<EpisodeAIRun>)=>{
    if(actionRef.current)return;
    actionRef.current=true;setBusy(true);setError('');
    const generation=generationRef.current;
    const controller=new AbortController();
    try{
      const next=await action();
      if(generationRef.current!==generation)return;
      setRun(next);localStorage.setItem(storageKey(episodeId),next.id);
      if(ACTIVE.has(next.status))await follow(next.id,generation,controller.signal);
    }catch(cause){if(generationRef.current===generation)setError(cause instanceof Error?cause.message:'整集任务操作失败');}
    finally{if(generationRef.current===generation){actionRef.current=false;setBusy(false);}}
  };
  const start=()=>execute(()=>createEpisodeAIRun(episodeId,{
    idempotency_key:`${episodeId}:${Date.now()}`,
    automation_policy:{approval_mode:'ai_default',panel_generation_mode:'solo'},
  }));

  if(loading)return <section className="episode-ai-run episode-ai-run-loading" aria-label="整集 AI 任务"><Loader2 className="spin" size={16}/><span>正在恢复整集任务</span></section>;
  if(!run)return <section className="episode-ai-run episode-ai-run-empty" aria-label="整集 AI 任务">
    <div><Sparkles size={17}/><span><strong>整集 AI 成片</strong><small>角色、画面、配音、视频、合成与发布门禁</small></span></div>
    <button className="primary-action" disabled={busy} onClick={()=>void start()}><Sparkles size={16}/>AI 生成整集</button>
    {error&&<p role="alert">{error}</p>}
  </section>;

  const currentLabel=STAGES.find(item=>item.id===run.current_stage)?.label??run.current_stage;
  const completed=run.status==='completed';
  return <section className={`episode-ai-run status-${run.status}`} aria-label="整集 AI 任务">
    <header>
      <div className="episode-ai-run-title">{completed?<Check size={18}/>:run.status==='failed'||run.status==='needs_review'?<AlertTriangle size={18}/>:<Sparkles size={18}/>}<span><strong>{completed?'整集成片已完成':'整集 AI 成片'}</strong><small>{completed?'已通过质检并登记内部母版':`当前：${currentLabel}`}</small></span></div>
      <div className="episode-ai-run-actions">
        {run.status==='running'||run.status==='queued'?<button disabled={busy} aria-label="暂停整集生成" onClick={()=>void execute(()=>pauseEpisodeAIRun(run.id))}><Pause size={15}/>暂停</button>:null}
        {run.status==='paused'?<button disabled={busy} aria-label="继续整集生成" onClick={()=>void execute(()=>continueEpisodeAIRun(run.id))}><Play size={15}/>继续</button>:null}
        {run.status==='failed'||run.status==='needs_review'?<button disabled={busy} aria-label="重试当前阶段" onClick={()=>void execute(()=>retryEpisodeAIRun(run.id))}><RefreshCw size={15}/>重试</button>:null}
        {run.status==='cancelled'?<button disabled={busy} onClick={()=>void start()}><Sparkles size={15}/>重新生成</button>:null}
      </div>
    </header>
    <div className="episode-ai-progress" role="progressbar" aria-label="整集 AI 进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={run.progress}>
      <div><span style={{width:`${run.progress}%`}}/></div><b>{run.progress}%</b>
    </div>
    <ol className="episode-ai-stages">
      {STAGES.map(item=>{const stage=run.stages.find(value=>value.stage===item.id);return <li key={item.id} className={`stage-${stage?.status??'pending'}`} title={stage?.error||item.label}><i>{stage?.status==='succeeded'||stage?.status==='skipped'?<Check size={11}/>:stage?.status==='running'?<Loader2 className="spin" size={11}/>:null}</i><span>{item.label}</span></li>;})}
    </ol>
    {(run.error||error)&&<p className="episode-ai-error" role="alert">{error||run.error}</p>}
  </section>;
}
