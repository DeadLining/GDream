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
import {generationAssetTargetForBlockers,shotGenerationBlockerLabel,type GenerationAssetRequest} from '../../lib/shot-generation-readiness';

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
type BlockedShot={shotId:string;blockers:string[];requirementIds:string[]};
type GenerationReadiness={blockedShots:BlockedShot[];blockers:string[]};
const stringList=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
const generationReadinessFromRun=(run:EpisodeAIRun):GenerationReadiness|null=>{
  const stage=run.stages.find(item=>item.stage===run.current_stage);
  const metadata=stage?.output_metadata;
  if(metadata?.code!=='shot_generation_not_ready'||!metadata.blocked_shots||typeof metadata.blocked_shots!=='object'||Array.isArray(metadata.blocked_shots))return null;
  const blockedShots=Object.entries(metadata.blocked_shots).flatMap(([shotId,value])=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return[];
    const item=value as Record<string,unknown>;
    const blockers=stringList(item.blockers);
    return shotId&&blockers.length?[{shotId,blockers,requirementIds:stringList(item.requirement_ids)}]:[];
  });
  if(!blockedShots.length)return null;
  return{blockedShots,blockers:[...new Set(blockedShots.flatMap(item=>item.blockers))]};
};
const generationReadinessPrefix='Shot generation is not ready:';
const parseGenerationReadinessError=(value:string):GenerationReadiness|null=>{
  if(!value.startsWith(generationReadinessPrefix))return null;
  const blockedShots=value.slice(generationReadinessPrefix.length).split(';').flatMap(entry=>{
    const separator=entry.indexOf(':');
    if(separator<0)return [];
    const shotId=entry.slice(0,separator).trim();
    const blockers=entry.slice(separator+1).split(',').map(item=>item.trim()).filter(Boolean);
    return shotId?[{shotId,blockers,requirementIds:[]}]:[];
  });
  if(!blockedShots.length)return null;
  return {blockedShots,blockers:[...new Set(blockedShots.flatMap(item=>item.blockers))]};
};
const friendlyError=(value:string)=>{
  if(!value)return '';
  if(value.includes('Episode has no shots'))return '本集还没有分镜，请先解析剧本或创建镜头';
  if(value.includes('missing_character_reference'))return '角色参考图未就绪，请进入角色设定补齐主参考';
  if(value.includes('Dialogue has no character'))return '对白尚未绑定角色，请先完善对白角色';
  if(value.includes('Shot is not ready for video'))return '镜头画面尚未审核通过，请先处理画面审核';
  if(value.includes('Episode render quality review failed'))return '整集质检未通过，请查看审核发布中的质检结果';
  if(value.includes('Release gate is blocked'))return '发布门禁未通过，请处理未完成素材或关键审核项';
  if(value.includes('Compositor root is not configured'))return '本地合成服务未配置，请检查 Compositor 设置';
  return value;
};
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(resolve,ms);
  signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
});

export function EpisodeAIRunControls({episodeId,onCompleted,onOpenAssets}:{episodeId:string;onCompleted?:()=>void;onOpenAssets?:(request:GenerationAssetRequest)=>void}){
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
  const displayedError=error||run.error;
  const generationReadiness=generationReadinessFromRun(run)??parseGenerationReadinessError(displayedError);
  const needsAssets=generationReadiness?.blockers.some(item=>['missing_character_reference','missing_background','missing_required_prop'].includes(item));
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
      {STAGES.map(item=>{const stage=run.stages.find(value=>value.stage===item.id);return <li key={item.id} className={`stage-${stage?.status??'pending'}`} title={friendlyError(stage?.error??'')||item.label}><i>{stage?.status==='succeeded'||stage?.status==='skipped'?<Check size={11}/>:stage?.status==='running'?<Loader2 className="spin" size={11}/>:null}</i><span>{item.label}</span></li>;})}
    </ol>
    {displayedError&&(generationReadiness?<div className="episode-ai-error episode-ai-readiness-error" role="alert">
      <strong>{generationReadiness.blockedShots.length} 个镜头尚未满足画面生成条件</strong>
      <span>{generationReadiness.blockers.map(shotGenerationBlockerLabel).join('、')}</span>
      <div className="episode-ai-error-actions">
        {needsAssets&&onOpenAssets?<button type="button" onClick={()=>onOpenAssets({target:generationAssetTargetForBlockers(generationReadiness.blockers),shotId:generationReadiness.blockedShots[0].shotId,requirementIds:generationReadiness.blockedShots[0].requirementIds})}>完善项目资产</button>:null}
      </div>
    </div>:<p className="episode-ai-error" role="alert">{friendlyError(displayedError)}</p>)}
  </section>;
}
