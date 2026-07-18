'use client';

import {ArrowLeft,Check,Film,ImagePlus,LoaderCircle,Save,Sparkles,X} from 'lucide-react';
import {useEffect,useMemo,useState} from 'react';

import {activatePanel,activateVideo,getShotGenerationContext,getShotGenerationReadiness,listPanelVersions,listVideoVersions,mediaUrl,startPanelGeneration,startVideoGeneration,suggestMediaPrompt,updateShot} from '../../lib/api';
import {pollJob} from '../../lib/jobs';
import {applyShotGenerationBlockers,generationAssetRequest,shotGenerationBlockerLabels,shotGenerationConflictBlockers,type GenerationAssetRequest} from '../../lib/shot-generation-readiness';
import type {Asset,Job,MediaPromptSuggestion,Shot,ShotGenerationContext,ShotGenerationReadiness} from '../../lib/types';
import {JobStatus} from '../JobStatus';

export type ProductionMediaMode='panel'|'video';

const promptContextLabels:Record<string,string>={character:'角色设定',characters:'角色设定',scene:'场景设定',asset_variant:'角色变体',asset_usages:'角色变体',library_assets:'场景与道具资产',previous_shot:'上一镜头',director_camera:'3D 导演机位',director_blocking:'3D 导演站位',visual_review:'视觉审阅'};
const promptContextLabel=(value:string)=>promptContextLabels[value]??value;
const formatVector=(value:number[])=>value.map(item=>Number.isInteger(item)?String(item):item.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')).join(', ');
const referenceRoleLabels:Record<ShotGenerationContext['references'][number]['role'],string>={previous_shot_tail:'上一镜尾帧',director_preview:'3D 导演构图',director_guidance:'3D 导演引导',character_reference:'角色参考',bound_asset:'绑定素材'};
const guidanceLabels:Record<string,string>={silhouette:'轮廓引导',skeleton_pose:'骨架引导',depth:'深度引导',object_mask:'对象遮罩'};
const generationReferenceLabel=(item:ShotGenerationContext['references'][number])=>item.guidance_kind?guidanceLabels[item.guidance_kind]??referenceRoleLabels[item.role]:referenceRoleLabels[item.role];

export function ProductionMediaWorkspace({mode,shot,onBackToProduction,onShotUpdated,onOpenAssets,onOpenDirector}:{mode:ProductionMediaMode;shot:Shot;onBackToProduction:()=>void;onShotUpdated:(shot:Shot)=>void;onOpenAssets?:(request:GenerationAssetRequest)=>void;onOpenDirector?:()=>void}){
  const [form,setForm]=useState(shot);
  const [panels,setPanels]=useState<Asset[]>([]);
  const [videos,setVideos]=useState<Asset[]>([]);
  const [job,setJob]=useState<Job|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [generating,setGenerating]=useState(false);
  const [suggesting,setSuggesting]=useState(false);
  const [suggestion,setSuggestion]=useState<MediaPromptSuggestion|null>(null);
  const [activatingId,setActivatingId]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [generationReadiness,setGenerationReadiness]=useState<ShotGenerationReadiness|null>(null);
  const [generationContext,setGenerationContext]=useState<ShotGenerationContext|null>(null);
  const [referencePreview,setReferencePreview]=useState<{item:ShotGenerationContext['references'][number];order:number}|null>(null);
  const [readinessLoading,setReadinessLoading]=useState(mode==='panel');
  const [readinessError,setReadinessError]=useState('');
  useEffect(()=>{setForm(shot);setError('');setSuggestion(null);},[shot]);
  useEffect(()=>{let current=true;setLoading(true);Promise.all([listPanelVersions(shot.id),listVideoVersions(shot.id)]).then(([nextPanels,nextVideos])=>{if(current){setPanels(nextPanels);setVideos(nextVideos);}}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'无法加载生成版本');}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[shot.id]);
  useEffect(()=>{let current=true;setGenerationContext(null);getShotGenerationContext(shot.id,mode).then(value=>{if(current)setGenerationContext(value);}).catch(()=>{if(current)setGenerationContext(null);});return()=>{current=false;};},[mode,shot.id]);
  useEffect(()=>{if(!referencePreview)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setReferencePreview(null);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[referencePreview]);
  useEffect(()=>{if(mode!=='panel'){setGenerationReadiness(null);setReadinessLoading(false);setReadinessError('');return;}let current=true;setReadinessLoading(true);setReadinessError('');setGenerationReadiness(null);getShotGenerationReadiness(shot.id).then(value=>{if(current)setGenerationReadiness(value);}).catch(()=>{if(current)setReadinessError('无法获取镜头生成条件');}).finally(()=>{if(current)setReadinessLoading(false);});return()=>{current=false;};},[mode,shot.id]);
  const versions=mode==='panel'?panels:videos;
  const activeId=mode==='panel'?form.active_panel_asset_id:form.active_video_asset_id??null;
  const activeAsset=versions.find(asset=>asset.id===activeId)??null;
  const activePanel=useMemo(()=>panels.find(asset=>asset.id===form.active_panel_asset_id)??null,[panels,form.active_panel_asset_id]);
  const videoBlocked=!form.active_panel_asset_id||form.review_status!=='approved';
  const panelBlocked=mode==='panel'&&(readinessLoading||Boolean(readinessError)||generationReadiness?.ready!==true);
  const busy=saving||generating||suggesting||Boolean(activatingId);
  const suggest=async()=>{
    if(busy)return;
    setSuggesting(true);setError('');setSuggestion(null);
    try{
      const next=await suggestMediaPrompt(shot.id,mode);
      setForm(current=>mode==='panel'?{...current,image_prompt:next.prompt,negative_prompt:next.negative_prompt}:{...current,video_prompt:next.prompt,negative_video_prompt:next.negative_prompt});
      setSuggestion(next);
    }catch(cause){setError(cause instanceof Error?cause.message:'AI 提示词生成失败');}
    finally{setSuggesting(false);}
  };
  const savePrompts=async()=>{
    setSaving(true);setError('');
    try{
      const patch=mode==='panel'?{image_prompt:form.image_prompt,negative_prompt:form.negative_prompt}:{video_prompt:form.video_prompt??'',negative_video_prompt:form.negative_video_prompt??''};
      const updated=await updateShot(shot.id,patch);
      setForm(updated);onShotUpdated(updated);return updated;
    }catch(cause){setError(cause instanceof Error?cause.message:'提示词保存失败');return null;}
    finally{setSaving(false);}
  };
  const generate=async()=>{
    if(busy||(mode==='video'&&videoBlocked)||panelBlocked)return;
    setGenerating(true);setError('');setJob(null);
    try{
      if(mode==='panel'){const latest=await getShotGenerationReadiness(shot.id);setGenerationReadiness(latest);if(!latest.ready){setError('生成条件已变化，请先补齐缺失项');return;}}
      const saved=await savePrompts();
      if(!saved)return;
      const started=mode==='panel'?await startPanelGeneration(shot.id,true):await startVideoGeneration(shot.id,true);
      const finished=await pollJob(started.job_id);setJob(finished);
      if(finished.status!=='succeeded')return;
      const next=mode==='panel'?await listPanelVersions(shot.id):await listVideoVersions(shot.id);
      if(mode==='panel')setPanels(next);else setVideos(next);
      const assetId=String(finished.result_metadata.asset_id??next.at(-1)?.id??'');
      if(assetId){const updated={...saved,...(mode==='panel'?{active_panel_asset_id:assetId}:{active_video_asset_id:assetId})};setForm(updated);onShotUpdated(updated);}
    }catch(cause){const blockers=mode==='panel'?shotGenerationConflictBlockers(cause,shot.id):null;if(blockers){setGenerationReadiness(current=>current?applyShotGenerationBlockers(current,blockers):current);setError('生成条件已变化，请先补齐缺失项');try{const latest=await getShotGenerationReadiness(shot.id);setGenerationReadiness(latest);setReadinessError('');}catch{setReadinessError('无法获取镜头生成条件');}}else setError(cause instanceof Error?cause.message:mode==='panel'?'分镜生成失败':'视频生成失败');}
    finally{setGenerating(false);}
  };
  const activate=async(assetId:string)=>{
    if(busy)return;setActivatingId(assetId);setError('');
    try{const updated=mode==='panel'?await activatePanel(shot.id,assetId):await activateVideo(shot.id,assetId);setForm(updated);onShotUpdated(updated);}
    catch(cause){setError(cause instanceof Error?cause.message:'切换版本失败');}
    finally{setActivatingId(null);}
  };
  const title=mode==='panel'?'分镜生成':'视频生成';
  const generationBlockers=shotGenerationBlockerLabels(generationReadiness);
  return <><main className={`production-media-workspace mode-${mode}`}>
    <header><button type="button" aria-label="返回生产画布" onClick={onBackToProduction}><ArrowLeft size={16}/>返回生产画布</button><div><span>镜头 {String(shot.position).padStart(2,'0')}</span><h1>{title}</h1></div><small>{versions.length} 个版本</small></header>
    <div className="production-media-layout">
      <section className="production-media-preview" aria-label={`${title}预览`}>
        {loading?<div className="production-media-empty"><LoaderCircle className="planning-spinner" size={24}/><span>正在加载版本</span></div>:activeAsset?(mode==='panel'?<img src={mediaUrl(activeAsset.media_url)} alt="当前分镜版本"/>:<video src={mediaUrl(activeAsset.media_url)} controls muted playsInline aria-label="当前视频版本"/>):<div className="production-media-empty">{mode==='panel'?<ImagePlus size={26}/>:<Film size={26}/>}<strong>{mode==='panel'?'尚未生成分镜':'尚未生成视频'}</strong></div>}
        {mode==='video'&&<div className="production-media-source"><span>首帧</span>{activePanel?<img src={mediaUrl(activePanel.media_url)} alt="当前视频首帧"/>:<small>等待已批准分镜</small>}</div>}
      </section>
      <section className="production-media-controls">
        <div><span className="section-kicker">{mode==='panel'?'IMAGE PROMPT':'IMAGE TO VIDEO'}</span><h2>{mode==='panel'?'分镜提示词':'视频动态提示词'}</h2></div>
        <label>{mode==='panel'?'分镜提示词':'视频动态提示词'}<textarea aria-label={mode==='panel'?'分镜提示词':'视频动态提示词'} value={mode==='panel'?form.image_prompt:form.video_prompt??''} onChange={event=>setForm(current=>mode==='panel'?{...current,image_prompt:event.target.value}:{...current,video_prompt:event.target.value})}/></label>
        <label>负面提示词<textarea aria-label={mode==='panel'?'分镜负面提示词':'视频负面提示词'} value={mode==='panel'?form.negative_prompt:form.negative_video_prompt??''} onChange={event=>setForm(current=>mode==='panel'?{...current,negative_prompt:event.target.value}:{...current,negative_video_prompt:event.target.value})}/></label>
        {generationContext&&<section className="production-generation-context" role="group" aria-label="生成时自动附加"><header><strong>生成时自动附加</strong><span>{generationContext.references.length} 张参考图</span></header><div className="production-generation-context-summary">{generationContext.director?.camera&&<span>机位 {generationContext.director.camera.shot_size} · {generationContext.director.camera.focal_length_mm}mm</span>}{generationContext.library_assets.map(item=><span key={item.id}>{item.name}</span>)}</div>{generationContext.references.length?<ol className="production-generation-references">{generationContext.references.map((item,index)=>{const roleLabel=generationReferenceLabel(item);const order=index+1;return <li key={`${item.asset_id}-${index}`}><button type="button" className="production-generation-reference-trigger" aria-label={`查看参考图 ${order}：${item.label}`} onClick={()=>setReferencePreview({item,order})}><img src={mediaUrl(item.media_url)} alt={`参考图 ${order}·${roleLabel}`}/></button><div><strong>参考图 {order}</strong><span>{item.label}</span></div></li>;})}</ol>:null}{generationContext.director?.objects.length?<ul>{generationContext.director.objects.map(item=><li key={item.id}><strong>{item.label}</strong><span>位置 {formatVector(item.position)} · 朝向 {item.horizontal_facing_degrees}°</span></li>)}</ul>:null}{generationContext.prompt_constraints&&<details><summary>完整自动约束</summary><pre>{generationContext.prompt_constraints}</pre></details>}</section>}
        {suggestion&&<div className="production-media-suggestion" role="status"><Sparkles size={13}/><div><strong>AI 建议已回填，等待你确认</strong>{suggestion.rationale&&<p>{suggestion.rationale}</p>}{suggestion.used_context.length>0&&<small>参考：{suggestion.used_context.map(promptContextLabel).join(' · ')}</small>}</div></div>}
        {mode==='video'&&videoBlocked&&<p className="production-media-gate" role="status">请先生成分镜并完成视觉审阅</p>}
        {mode==='panel'&&(readinessLoading||readinessError||generationBlockers.length>0)&&<div className="production-media-readiness" role="status"><strong>{readinessLoading?'正在检查生成条件':'生成条件未完成'}</strong>{readinessError&&<p>{readinessError}</p>}{generationBlockers.length>0&&<ul>{generationBlockers.map(item=><li key={item}>{item}</li>)}</ul>}<div>{generationReadiness&&!generationReadiness.asset_ready&&onOpenAssets&&<button type="button" onClick={()=>onOpenAssets(generationAssetRequest(generationReadiness))}>去完善资产</button>}{generationReadiness&&(!generationReadiness.blocking_ready||!generationReadiness.camera_ready)&&onOpenDirector&&<button type="button" onClick={onOpenDirector}>打开 3D 导演台</button>}</div></div>}
        {error&&<p className="production-media-error" role="alert">{error}</p>}
        <div className="production-media-actions"><button type="button" disabled={busy} onClick={()=>void suggest()}>{suggesting?<LoaderCircle className="planning-spinner" size={15}/>:<Sparkles size={15}/>}AI 生成提示词</button><button type="button" disabled={busy} onClick={()=>void savePrompts()}><Save size={15}/>{saving?'保存中':'保存提示词'}</button><button type="button" className="primary-action" disabled={busy||(mode==='video'&&videoBlocked)||panelBlocked} onClick={()=>void generate()}>{generating?<LoaderCircle className="planning-spinner" size={15}/>:mode==='panel'?<ImagePlus size={15}/>:<Film size={15}/>}生成新{mode==='panel'?'分镜':'视频'}</button></div>
        <JobStatus job={job}/>
      </section>
      <section className="production-media-versions" aria-label={`${title}版本`}><header><strong>版本记录</strong><span>{versions.length}</span></header><div>{versions.map(asset=>{const active=asset.id===activeId;return <button key={asset.id} type="button" aria-label={`${mode==='panel'?'分镜':'视频'}版本 ${asset.generation_attempt}`} aria-pressed={active} className={active?'active':''} disabled={Boolean(activatingId)} onClick={()=>void activate(asset.id)}>{mode==='panel'?<img src={mediaUrl(asset.media_url)} alt=""/>:<video src={mediaUrl(asset.media_url)} muted playsInline/>}<span>V{asset.generation_attempt}</span>{active&&<i><Check size={12}/></i>}</button>;})}{!versions.length&&!loading&&<p>尚无生成版本</p>}</div></section>
    </div>
  </main>{referencePreview&&<div className="dialog-backdrop production-reference-preview-backdrop" onClick={()=>setReferencePreview(null)}><section className="form-dialog production-reference-preview-dialog" role="dialog" aria-modal="true" aria-label="参考图预览" onClick={event=>event.stopPropagation()}><header><div><h2>参考图 {referencePreview.order}</h2><small>{referencePreview.item.label}</small></div><button type="button" aria-label="关闭参考图预览" title="关闭" onClick={()=>setReferencePreview(null)}><X size={18}/></button></header><img src={mediaUrl(referencePreview.item.media_url)} alt={`${referencePreview.item.label}大图`}/></section></div>}</>;
}
