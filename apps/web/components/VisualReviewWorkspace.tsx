'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {Check, Circle, GitCompareArrows, MessageSquareText, MousePointer2, PenLine, RectangleHorizontal, Sparkles, Trash2} from 'lucide-react';
import {acceptVisualReviewCandidate,createVisualAnnotation,createVisualReviewMessage,createVisualReviewThread,deleteVisualAnnotation,getAsset,listVisualReviewThreads,mediaUrl,rejectVisualReviewCandidate,startVisualReviewGeneration,updateVisualAnnotation,updateVisualReviewThread} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {EpisodeDetail,VisualReviewThread} from '../lib/types';
import {ReviewVersionStrip} from './ReviewVersionStrip';

type Scope = 'shot' | 'episode' | 'master';
type AnnotationTool = 'select' | 'circle' | 'rectangle' | 'path';
type Point = {x:number; y:number};
const scopeNote: Record<Scope, string> = {
  shot: '不会影响其他镜头或角色主设定',
  episode: '将创建本集变体，不修改作品主设定',
  master: '将更新作品主设定，并提示全部下游影响',
};

export function VisualReviewWorkspace({episode, selectedShotId, onSelectShot}: {episode: EpisodeDetail; selectedShotId: string | null; onSelectShot: (shotId: string) => void}) {
  const shots = useMemo(() => episode.scenes.flatMap(scene => scene.shots.map(shot => ({shot, scene}))), [episode]);
  const selected = shots.find(item => item.shot.id === selectedShotId) ?? shots[0] ?? null;
  const [threads,setThreads]=useState<VisualReviewThread[]>([]);
  const [threadId,setThreadId]=useState('');
  const [annotationId,setAnnotationId]=useState('');
  const [annotationLabel,setAnnotationLabel]=useState('');
  const [scope, setScope] = useState<Scope>('shot');
  const [panelUrl, setPanelUrl] = useState<string | null>(null);
  const [messageDraft,setMessageDraft]=useState('');
  const [threadBusy,setThreadBusy]=useState(false);
  const [generationError,setGenerationError]=useState('');
  const [generationProgress,setGenerationProgress]=useState(0);
  const [annotationTool,setAnnotationTool]=useState<AnnotationTool>('circle');
  const drawingRef=useRef<{kind:Exclude<AnnotationTool,'select'>;start:Point;current:Point;points:Point[]}|null>(null);
  const thread=threads.find(item=>item.id===threadId)??threads[0]??null;
  const annotation=thread?.annotations.find(item=>item.id===annotationId)??thread?.annotations[0]??null;

  useEffect(() => {
    let current = true;
    setPanelUrl(null);
    if (!selected?.shot.active_panel_asset_id) return () => {current = false;};
    getAsset(selected.shot.active_panel_asset_id).then(asset => {if (current) setPanelUrl(mediaUrl(asset.media_url));}).catch(() => {if (current) setPanelUrl(null);});
    return () => {current = false;};
  }, [selected?.shot.active_panel_asset_id]);

  useEffect(()=>{let current=true;setThreads([]);setThreadId('');setAnnotationId('');if(!selected)return()=>{current=false;};listVisualReviewThreads(selected.shot.id).then(items=>{if(!current)return;setThreads(items);setThreadId(items[0]?.id??'');setAnnotationId(items[0]?.annotations[0]?.id??'');setScope(items[0]?.modification_scope??'shot');}).catch(()=>{if(current)setThreads([]);});return()=>{current=false;};},[selected?.shot.id]);
  useEffect(()=>{setAnnotationLabel(annotation?.label??'');},[annotation?.id,annotation?.label]);

  const changeScope=async(next:Scope)=>{setScope(next);if(!thread)return;const updated=await updateVisualReviewThread(thread.id,{modification_scope:next});setThreads(current=>current.map(item=>item.id===updated.id?updated:item));};
  const sendMessage=async()=>{const content=messageDraft.trim();if(!thread||!content||threadBusy)return;setThreadBusy(true);try{const message=await createVisualReviewMessage(thread.id,{author_kind:'user',content});setThreads(current=>current.map(item=>item.id===thread.id?{...item,messages:[...item.messages,message]}:item));setMessageDraft('');}finally{setThreadBusy(false);}};
  const createThread=async()=>{if(!selected||threadBusy)return;setThreadBusy(true);try{const created=await createVisualReviewThread(selected.shot.id,{source_asset_id:selected.shot.active_panel_asset_id,title:'新视觉标记',modification_scope:'shot'});setThreads(current=>[...current,created]);setThreadId(created.id);setScope('shot');}finally{setThreadBusy(false);}};
  const acceptCandidate=async(id:string)=>{const accepted=await acceptVisualReviewCandidate(id);setThreads(current=>current.map(item=>item.id===accepted.thread_id?{...item,status:'resolved',candidates:item.candidates.map(candidate=>candidate.id===accepted.id?accepted:candidate)}:item));};
  const rejectCandidate=async(id:string)=>{const rejected=await rejectVisualReviewCandidate(id);setThreads(current=>current.map(item=>item.id===rejected.thread_id?{...item,candidates:item.candidates.map(candidate=>candidate.id===rejected.id?rejected:candidate)}:item));};
  const normalizedPoint=(event:React.PointerEvent<HTMLDivElement>):Point|null=>{const rect=event.currentTarget.getBoundingClientRect();if(!rect.width||!rect.height)return null;const clamp=(value:number)=>Math.min(1,Math.max(0,value));return{x:Number(clamp((event.clientX-rect.left)/rect.width).toFixed(4)),y:Number(clamp((event.clientY-rect.top)/rect.height).toFixed(4))};};
  const beginAnnotation=(event:React.PointerEvent<HTMLDivElement>)=>{if(!selected||!panelUrl||threadBusy||annotationTool==='select')return;const point=normalizedPoint(event);if(!point)return;drawingRef.current={kind:annotationTool,start:point,current:point,points:[point]};event.currentTarget.setPointerCapture?.(event.pointerId);};
  const moveAnnotation=(event:React.PointerEvent<HTMLDivElement>)=>{const drawing=drawingRef.current;if(!drawing)return;const point=normalizedPoint(event);if(!point)return;drawing.current=point;if(drawing.kind==='path'&&drawing.points.length<200)drawing.points.push(point);};
  const finishAnnotation=async(event:React.PointerEvent<HTMLDivElement>)=>{const drawing=drawingRef.current;if(!drawing||!selected)return;const end=normalizedPoint(event)??drawing.current;drawingRef.current=null;const dx=Math.abs(end.x-drawing.start.x);const dy=Math.abs(end.y-drawing.start.y);let geometry:Record<string,unknown>;if(drawing.kind==='circle'){if(dx<.01||dy<.01)return;geometry={cx:Number(((drawing.start.x+end.x)/2).toFixed(4)),cy:Number(((drawing.start.y+end.y)/2).toFixed(4)),rx:Number((dx/2).toFixed(4)),ry:Number((dy/2).toFixed(4))};}else if(drawing.kind==='rectangle'){if(dx<.01||dy<.01)return;geometry={x:Number(Math.min(drawing.start.x,end.x).toFixed(4)),y:Number(Math.min(drawing.start.y,end.y).toFixed(4)),width:Number(dx.toFixed(4)),height:Number(dy.toFixed(4))};}else{const points=[...drawing.points,end].map(point=>[point.x,point.y]);if(points.length<2)return;geometry={points};}setThreadBusy(true);try{let targetThread=thread;if(!targetThread){targetThread=await createVisualReviewThread(selected.shot.id,{source_asset_id:selected.shot.active_panel_asset_id,title:'视觉修改',modification_scope:'shot'});setThreads(current=>[...current,targetThread!]);setThreadId(targetThread.id);setScope('shot');}const label=`修改 ${String(targetThread.annotations.length+1).padStart(2,'0')}`;const created=await createVisualAnnotation(targetThread.id,{kind:drawing.kind,geometry,color:'#B9473E',label});setThreads(current=>current.map(item=>item.id===targetThread.id?{...item,annotations:[...item.annotations,created]}:item));setAnnotationId(created.id);}finally{setThreadBusy(false);}};
  const saveAnnotation=async()=>{const label=annotationLabel.trim();if(!annotation||!label||threadBusy)return;setThreadBusy(true);try{const updated=await updateVisualAnnotation(annotation.id,{label});setThreads(current=>current.map(item=>item.id===updated.thread_id?{...item,annotations:item.annotations.map(entry=>entry.id===updated.id?updated:entry)}:item));}finally{setThreadBusy(false);}};
  const removeAnnotation=async()=>{if(!annotation||threadBusy||!window.confirm(`删除圈点“${annotation.label}”？`))return;setThreadBusy(true);try{await deleteVisualAnnotation(annotation.id);setThreads(current=>current.map(item=>item.id===annotation.thread_id?{...item,annotations:item.annotations.filter(entry=>entry.id!==annotation.id)}:item));setAnnotationId('');}finally{setThreadBusy(false);}};
  const generateCandidate=async()=>{if(!thread||!selected||threadBusy)return;setThreadBusy(true);setGenerationError('');setGenerationProgress(0);try{const started=await startVisualReviewGeneration(thread.id);const finished=await pollJob(started.job_id,{onUpdate:job=>setGenerationProgress(job.progress)});if(finished.status!=='succeeded')throw new Error(finished.error||'候选生成失败');const candidateId=finished.result_metadata.candidate_id;if(typeof candidateId!=='string'||!candidateId)throw new Error('生成任务未返回审阅候选');const refreshed=await listVisualReviewThreads(selected.shot.id);setThreads(refreshed);setGenerationProgress(100);}catch(cause){setGenerationError(cause instanceof Error?cause.message:'候选生成失败');}finally{setThreadBusy(false);}};

  if (!selected) return <main className="visual-review-workspace visual-review-empty"><h1>尚无可审阅镜头</h1></main>;

  return <main className="visual-review-workspace">
    <aside className="review-shot-rail">
      <header><span>镜头与标记</span><strong>{threads.length}</strong></header>
      <label>当前镜头<select aria-label="选择审阅镜头" value={selected.shot.id} onChange={event => onSelectShot(event.target.value)}>{shots.map(({shot, scene}) => <option key={shot.id} value={shot.id}>场景 {scene.position} · 镜头 {shot.position}</option>)}</select></label>
      <div className="annotation-list"><span>本镜头标记 {threads.length}</span>{threads.map((item,index) => <button key={item.id} type="button" className={`${item.status==='open'?'danger':'muted'} ${thread?.id===item.id?'active':''}`} aria-label={`标记 ${String(index+1).padStart(2,'0')} ${item.title}`} aria-pressed={thread?.id===item.id} onClick={() => {setThreadId(item.id);setScope(item.modification_scope);}}><b>{String(index+1).padStart(2,'0')}</b><span>{item.title}</span><i/></button>)}<button className="annotation-create" disabled={threadBusy} onClick={()=>void createThread()}>新建圈点</button></div>
    </aside>

    <section className="review-canvas-shell">
      <header className="review-canvas-toolbar"><div><button aria-label="选择工具" aria-pressed={annotationTool==='select'} className={annotationTool==='select'?'active':''} onClick={()=>setAnnotationTool('select')}><MousePointer2 size={16}/></button><button aria-label="圈选工具" aria-pressed={annotationTool==='circle'} className={annotationTool==='circle'?'active':''} onClick={()=>setAnnotationTool('circle')}><Circle size={16}/></button><button aria-label="矩形工具" aria-pressed={annotationTool==='rectangle'} className={annotationTool==='rectangle'?'active':''} onClick={()=>setAnnotationTool('rectangle')}><RectangleHorizontal size={16}/></button><button aria-label="画笔工具" aria-pressed={annotationTool==='path'} className={annotationTool==='path'?'active':''} onClick={()=>setAnnotationTool('path')}><PenLine size={16}/></button></div><span>适应画布 · 82%</span><button aria-label="前后对比"><GitCompareArrows size={16}/></button></header>
      <div className="review-canvas" aria-label="审阅画布">
        {panelUrl ? <div className="review-image-stage"><img src={panelUrl} alt={selected.shot.composition}/><div className="review-annotation-layer" aria-label="图片标注层" onPointerDown={beginAnnotation} onPointerMove={moveAnnotation} onPointerUp={event=>void finishAnnotation(event)}>{thread?.annotations.map((item,index)=>{const geometry=item.geometry as Record<string,number>;const style=item.kind==='circle'?{left:`${(geometry.cx-geometry.rx)*100}%`,top:`${(geometry.cy-geometry.ry)*100}%`,width:`${geometry.rx*200}%`,height:`${geometry.ry*200}%`}:item.kind==='rectangle'?{left:`${geometry.x*100}%`,top:`${geometry.y*100}%`,width:`${geometry.width*100}%`,height:`${geometry.height*100}%`}:undefined;return <button type="button" key={item.id} className={`annotation-pin annotation-${item.kind} ${annotation?.id===item.id?'active':''}`} aria-label={`标注 ${String(index+1).padStart(2,'0')} ${item.label}`} style={style} onPointerDown={event=>event.stopPropagation()} onClick={()=>setAnnotationId(item.id)}>{String(index+1).padStart(2,'0')}</button>;})}</div></div> : <div className="review-canvas-empty"><span>当前镜头尚无画面</span></div>}
      </div>
      <ReviewVersionStrip shotId={selected.shot.id} activeAssetId={selected.shot.active_panel_asset_id} candidateAssetIds={thread?.candidates.filter(candidate=>candidate.status==='ready').map(candidate=>candidate.asset_id)??[]}/>
    </section>

    <aside className="review-conversation">
      <header><div><span>{thread?`标记 ${String(threads.indexOf(thread)+1).padStart(2,'0')}`:'未选择标记'}</span><h2>{thread?.title??'创建圈点后开始对话'}</h2></div><MessageSquareText size={18}/></header>
      <div className="review-context"><span>镜头 {String(selected.shot.position).padStart(2, '0')}</span><span>{selected.scene.location}</span><span>V4</span></div>
      {annotation&&<section className="review-annotation-editor"><label>修改说明<input aria-label="修改说明" value={annotationLabel} onChange={event=>setAnnotationLabel(event.target.value)}/></label><div><button type="button" disabled={!annotationLabel.trim()||threadBusy} onClick={()=>void saveAnnotation()}>保存说明</button><button type="button" className="danger-action" disabled={threadBusy} onClick={()=>void removeAnnotation()}><Trash2 size={14}/>删除标注</button></div></section>}
      <div className="conversation-thread">{thread?.messages.map(message=>message.author_kind==='assistant'?<div key={message.id} className="conversation-ai"><Sparkles size={16}/><p>{message.content}</p></div>:<div key={message.id} className="conversation-user">{message.content}</div>)}</div>
      <div className="review-message-compose"><input aria-label="回复视觉审阅对话" value={messageDraft} onChange={event=>setMessageDraft(event.target.value)} placeholder="描述需要修改的内容"/><button aria-label="发送视觉审阅消息" disabled={!thread||!messageDraft.trim()||threadBusy} onClick={()=>void sendMessage()}><MessageSquareText size={15}/></button></div>
      <section className="review-scope"><h3>修改范围</h3><div>{([['shot','仅当前镜头'],['episode','本集角色变体'],['master','作品主设定']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scope === value} disabled={!thread} onClick={() => void changeScope(value)}>{label}</button>)}</div><p>{scopeNote[scope]}</p></section>
      <div className="review-locks"><span><Check size={14}/>锁定身份特征</span><span><Check size={14}/>保持服装与构图</span></div>
      <button className="review-generate" disabled={!thread||threadBusy} onClick={()=>void generateCandidate()}><Sparkles size={16}/>{threadBusy&&generationProgress>0?`生成中 ${generationProgress}%`:'生成修改版本'}</button>
      {generationError&&<p className="review-generation-error" role="alert">{generationError}</p>}
      {thread?.candidates.filter(candidate=>candidate.status==='ready').map((candidate,index)=><section key={candidate.id} className="review-candidate"><header><h3>候选版本 V{index+1}</h3><span>待确认</span></header><div className="candidate-comparison"><span>{panelUrl ? <img src={panelUrl} alt="修改前"/> : null}<small>修改前</small></span><GitCompareArrows size={18}/><span><small>资产 {candidate.asset_id}</small></span></div><div><button className="accept" onClick={()=>void acceptCandidate(candidate.id)}><Check size={15}/>采纳候选</button><button onClick={()=>void rejectCandidate(candidate.id)}>继续圈点</button></div></section>)}
    </aside>
  </main>;
}
