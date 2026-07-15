'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {ArrowLeft,Check, Circle, GitCompareArrows, MessageSquareText, MousePointer2, PenLine, RectangleHorizontal, Sparkles, Trash2} from 'lucide-react';
import {acceptVisualReviewCandidate,createVisualAnnotation,createVisualReviewMessage,createVisualReviewThread,deleteVisualAnnotation,getAsset,listVisualReviewThreads,mediaUrl,rejectVisualReviewCandidate,startVisualReviewGeneration,updateVisualAnnotation,updateVisualReviewThread} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {EpisodeDetail,VisualReviewThread} from '../lib/types';
import {ReviewVersionStrip} from './ReviewVersionStrip';

type Scope = 'shot' | 'episode' | 'master';
type AnnotationTool = 'select' | 'circle' | 'rectangle' | 'path';
type Point = {x:number; y:number};
type Drawing = {kind:Exclude<AnnotationTool,'select'>;start:Point;current:Point;points:Point[]};
type AnnotationDrag = {id:string;kind:Exclude<AnnotationTool,'select'>;geometry:Record<string,unknown>;start:Point;current:Point};
type AnnotationVisual = {style:CSSProperties; pathPoints?:string; calloutSide:'left'|'right'};

const percent=(value:number)=>`${Number((value*100).toFixed(4))}%`;
const clamp=(value:number,min=0,max=1)=>Math.min(max,Math.max(min,value));
const rounded=(value:number)=>Number(value.toFixed(4));
export const fitImageWithin=(containerWidth:number,containerHeight:number,imageWidth:number,imageHeight:number)=>{
  if(![containerWidth,containerHeight,imageWidth,imageHeight].every(value=>Number.isFinite(value)&&value>0))return{width:0,height:0};
  const scale=Math.min(containerWidth/imageWidth,containerHeight/imageHeight);
  return{width:rounded(imageWidth*scale),height:rounded(imageHeight*scale)};
};
const annotationVisual=(kind:Exclude<AnnotationTool,'select'>,geometry:Record<string,unknown>):AnnotationVisual|null=>{
  if(kind==='circle'){
    const {cx,cy,rx,ry}=geometry as Record<string,number>;
    if(![cx,cy,rx,ry].every(Number.isFinite))return null;
    return{style:{left:percent(cx-rx),top:percent(cy-ry),width:percent(rx*2),height:percent(ry*2)},calloutSide:cx>.58?'left':'right'};
  }
  if(kind==='rectangle'){
    const {x,y,width,height}=geometry as Record<string,number>;
    if(![x,y,width,height].every(Number.isFinite))return null;
    return{style:{left:percent(x),top:percent(y),width:percent(width),height:percent(height)},calloutSide:x+width/2>.58?'left':'right'};
  }
  const points=Array.isArray(geometry.points)?geometry.points.filter((point):point is [number,number]=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)):[];
  if(points.length<2)return null;
  const xs=points.map(point=>point[0]);
  const ys=points.map(point=>point[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=Math.max(maxX-minX,.001),height=Math.max(maxY-minY,.001);
  return{
    style:{left:percent(minX),top:percent(minY),width:percent(width),height:percent(height)},
    pathPoints:points.map(([x,y])=>`${Number((((x-minX)/width)*100).toFixed(4))},${Number((((y-minY)/height)*100).toFixed(4))}`).join(' '),
    calloutSide:(minX+maxX)/2>.58?'left':'right',
  };
};

const drawingGeometry=(drawing:Drawing,end:Point):Record<string,unknown>|null=>{
  const dx=Math.abs(end.x-drawing.start.x),dy=Math.abs(end.y-drawing.start.y);
  if(drawing.kind==='circle')return dx<.01||dy<.01?null:{cx:Number(((drawing.start.x+end.x)/2).toFixed(4)),cy:Number(((drawing.start.y+end.y)/2).toFixed(4)),rx:Number((dx/2).toFixed(4)),ry:Number((dy/2).toFixed(4))};
  if(drawing.kind==='rectangle')return dx<.01||dy<.01?null:{x:Number(Math.min(drawing.start.x,end.x).toFixed(4)),y:Number(Math.min(drawing.start.y,end.y).toFixed(4)),width:Number(dx.toFixed(4)),height:Number(dy.toFixed(4))};
  const points=[...drawing.points,end].map(point=>[point.x,point.y]);
  return points.length<2?null:{points};
};
const translatedGeometry=(kind:Exclude<AnnotationTool,'select'>,geometry:Record<string,unknown>,dx:number,dy:number):Record<string,unknown>|null=>{
  if(kind==='circle'){
    const {cx,cy,rx,ry}=geometry as Record<string,number>;
    if(![cx,cy,rx,ry].every(Number.isFinite))return null;
    return{cx:rounded(clamp(cx+dx,rx,1-rx)),cy:rounded(clamp(cy+dy,ry,1-ry)),rx,ry};
  }
  if(kind==='rectangle'){
    const {x,y,width,height}=geometry as Record<string,number>;
    if(![x,y,width,height].every(Number.isFinite))return null;
    return{x:rounded(clamp(x+dx,0,1-width)),y:rounded(clamp(y+dy,0,1-height)),width,height};
  }
  const points=Array.isArray(geometry.points)?geometry.points.filter((point):point is [number,number]=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)):[];
  if(points.length<2)return null;
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  const safeDx=clamp(dx,-Math.min(...xs),1-Math.max(...xs));
  const safeDy=clamp(dy,-Math.min(...ys),1-Math.max(...ys));
  return{points:points.map(([x,y])=>[rounded(x+safeDx),rounded(y+safeDy)])};
};
const scopeNote: Record<Scope, string> = {
  shot: '不会影响其他镜头或角色主设定',
  episode: '将创建本集变体，不修改作品主设定',
  master: '将更新作品主设定，并提示全部下游影响',
};

export function VisualReviewWorkspace({episode,selectedShotId,onBackToProduction,onCandidateAccepted}: {episode:EpisodeDetail;selectedShotId:string|null;onBackToProduction?:()=>void;onCandidateAccepted?:(assetId:string)=>void|Promise<void>}) {
  const shots = useMemo(() => episode.scenes.flatMap(scene => scene.shots.map(shot => ({shot, scene}))), [episode]);
  const selected = shots.find(item => item.shot.id === selectedShotId) ?? shots[0] ?? null;
  const [threads,setThreads]=useState<VisualReviewThread[]>([]);
  const [threadId,setThreadId]=useState('');
  const [annotationId,setAnnotationId]=useState('');
  const [annotationLabel,setAnnotationLabel]=useState('');
  const [scope, setScope] = useState<Scope>('shot');
  const [panelUrl, setPanelUrl] = useState<string | null>(null);
  const [sourcePanelUrl,setSourcePanelUrl]=useState<string|null>(null);
  const [previewAssetId,setPreviewAssetId]=useState<string|null>(null);
  const [compareBefore,setCompareBefore]=useState(false);
  const [imageNaturalSize,setImageNaturalSize]=useState<{width:number;height:number}|null>(null);
  const [canvasFitSize,setCanvasFitSize]=useState<{width:number;height:number}|null>(null);
  const [messageDraft,setMessageDraft]=useState('');
  const [threadBusy,setThreadBusy]=useState(false);
  const [generationError,setGenerationError]=useState('');
  const [generationProgress,setGenerationProgress]=useState(0);
  const [annotationTool,setAnnotationTool]=useState<AnnotationTool>('select');
  const reviewCanvasFitRef=useRef<HTMLDivElement|null>(null);
  const annotationLayerRef=useRef<HTMLDivElement|null>(null);
  const drawingRef=useRef<Drawing|null>(null);
  const [drawingPreview,setDrawingPreview]=useState<Drawing|null>(null);
  const annotationDragRef=useRef<AnnotationDrag|null>(null);
  const [annotationDrag,setAnnotationDrag]=useState<AnnotationDrag|null>(null);
  const thread=threads.find(item=>item.id===threadId)??threads[0]??null;
  const annotation=thread?.annotations.find(item=>item.id===annotationId)??thread?.annotations[0]??null;
  const imageFrameStyle=useMemo<CSSProperties|undefined>(()=>{if(!imageNaturalSize||!canvasFitSize)return;const fitted=fitImageWithin(canvasFitSize.width,canvasFitSize.height,imageNaturalSize.width,imageNaturalSize.height);return fitted.width&&fitted.height?fitted:undefined;},[canvasFitSize,imageNaturalSize]);

  useEffect(() => {
    let current = true;
    setPanelUrl(null);
    setSourcePanelUrl(null);
    setPreviewAssetId(selected?.shot.active_panel_asset_id??null);
    setCompareBefore(false);
    setImageNaturalSize(null);
    if (!selected?.shot.active_panel_asset_id) return () => {current = false;};
    getAsset(selected.shot.active_panel_asset_id).then(asset => {if(current){const url=mediaUrl(asset.media_url);setPanelUrl(url);setSourcePanelUrl(url);}}).catch(() => {if(current){setPanelUrl(null);setSourcePanelUrl(null);}});
    return () => {current = false;};
  }, [selected?.shot.active_panel_asset_id]);

  useEffect(()=>{const element=reviewCanvasFitRef.current;if(!element)return;const update=()=>{const width=element.clientWidth,height=element.clientHeight;if(width>0&&height>0)setCanvasFitSize({width,height});};update();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();},[]);

  useEffect(()=>{let current=true;setThreads([]);setThreadId('');setAnnotationId('');if(!selected)return()=>{current=false;};listVisualReviewThreads(selected.shot.id).then(items=>{if(!current)return;setThreads(items);setThreadId(items[0]?.id??'');setAnnotationId(items[0]?.annotations[0]?.id??'');setScope(items[0]?.modification_scope??'shot');}).catch(()=>{if(current)setThreads([]);});return()=>{current=false;};},[selected?.shot.id]);
  useEffect(()=>{setAnnotationLabel(annotation?.label??'');},[annotation?.id,annotation?.label]);

  const changeScope=async(next:Scope)=>{setScope(next);if(!thread)return;const updated=await updateVisualReviewThread(thread.id,{modification_scope:next});setThreads(current=>current.map(item=>item.id===updated.id?updated:item));};
  const sendMessage=async()=>{const content=messageDraft.trim();if(!thread||!content||threadBusy)return;setThreadBusy(true);try{const message=await createVisualReviewMessage(thread.id,{author_kind:'user',content});setThreads(current=>current.map(item=>item.id===thread.id?{...item,messages:[...item.messages,message]}:item));setMessageDraft('');}finally{setThreadBusy(false);}};
  const acceptCandidate=async(id:string)=>{if(threadBusy)return;setThreadBusy(true);setGenerationError('');try{const accepted=await acceptVisualReviewCandidate(id);setThreads(current=>current.map(item=>item.id===accepted.thread_id?{...item,status:'resolved',candidates:item.candidates.map(candidate=>candidate.id===accepted.id?accepted:candidate)}:item));setPreviewAssetId(accepted.asset_id);await onCandidateAccepted?.(accepted.asset_id);}catch(cause){setGenerationError(cause instanceof Error?cause.message:'采纳候选失败');}finally{setThreadBusy(false);}};
  const rejectCandidate=async(id:string)=>{const rejected=await rejectVisualReviewCandidate(id);setThreads(current=>current.map(item=>item.id===rejected.thread_id?{...item,candidates:item.candidates.map(candidate=>candidate.id===rejected.id?rejected:candidate)}:item));};
  const normalizedClientPoint=(clientX:number,clientY:number):Point|null=>{const rect=annotationLayerRef.current?.getBoundingClientRect();if(!rect?.width||!rect.height)return null;return{x:rounded(clamp((clientX-rect.left)/rect.width)),y:rounded(clamp((clientY-rect.top)/rect.height))};};
  const normalizedPoint=(event:React.PointerEvent<HTMLDivElement>):Point|null=>normalizedClientPoint(event.clientX,event.clientY);
  const beginAnnotation=(event:React.PointerEvent<HTMLDivElement>)=>{if(!selected||!panelUrl||threadBusy||annotationTool==='select')return;const point=normalizedPoint(event);if(!point)return;const drawing={kind:annotationTool,start:point,current:point,points:[point]};drawingRef.current=drawing;setDrawingPreview(drawing);event.currentTarget.setPointerCapture?.(event.pointerId);};
  const moveAnnotation=(event:React.PointerEvent<HTMLDivElement>)=>{const drawing=drawingRef.current;if(!drawing)return;const point=normalizedPoint(event);if(!point)return;drawing.current=point;if(drawing.kind==='path'&&drawing.points.length<199)drawing.points.push(point);setDrawingPreview({...drawing,points:[...drawing.points]});};
  const cancelAnnotation=()=>{drawingRef.current=null;setDrawingPreview(null);};
  const finishAnnotation=async(event:React.PointerEvent<HTMLDivElement>)=>{const drawing=drawingRef.current;if(!drawing||!selected)return;const end=normalizedPoint(event)??drawing.current;cancelAnnotation();const geometry=drawingGeometry(drawing,end);if(!geometry)return;setThreadBusy(true);try{let targetThread=thread;if(!targetThread){targetThread=await createVisualReviewThread(selected.shot.id,{source_asset_id:selected.shot.active_panel_asset_id,title:'视觉修改',modification_scope:'shot'});setThreads(current=>[...current,targetThread!]);setThreadId(targetThread.id);setScope('shot');}const label=`修改 ${String(targetThread.annotations.length+1).padStart(2,'0')}`;const created=await createVisualAnnotation(targetThread.id,{kind:drawing.kind,geometry,color:'#B9473E',label});setThreads(current=>current.map(item=>item.id===targetThread.id?{...item,annotations:[...item.annotations,created]}:item));setAnnotationId(created.id);}finally{setThreadBusy(false);}};
  const beginAnnotationDrag=(event:React.PointerEvent<HTMLButtonElement>,item:VisualReviewThread['annotations'][number])=>{if(annotationTool!=='select'||threadBusy)return;const point=normalizedClientPoint(event.clientX,event.clientY);if(!point)return;event.stopPropagation();setAnnotationId(item.id);const drag={id:item.id,kind:item.kind,geometry:item.geometry,start:point,current:point};annotationDragRef.current=drag;setAnnotationDrag(drag);event.currentTarget.setPointerCapture?.(event.pointerId);};
  const moveAnnotationDrag=(event:React.PointerEvent<HTMLButtonElement>)=>{const drag=annotationDragRef.current;if(!drag)return;const point=normalizedClientPoint(event.clientX,event.clientY);if(!point)return;event.stopPropagation();drag.current=point;setAnnotationDrag({...drag});};
  const cancelAnnotationDrag=()=>{annotationDragRef.current=null;setAnnotationDrag(null);};
  const finishAnnotationDrag=async(event:React.PointerEvent<HTMLButtonElement>)=>{const drag=annotationDragRef.current;if(!drag)return;event.stopPropagation();const end=normalizedClientPoint(event.clientX,event.clientY)??drag.current;cancelAnnotationDrag();const geometry=translatedGeometry(drag.kind,drag.geometry,end.x-drag.start.x,end.y-drag.start.y);if(!geometry||JSON.stringify(geometry)===JSON.stringify(drag.geometry))return;setThreadBusy(true);try{const updated=await updateVisualAnnotation(drag.id,{geometry});setThreads(current=>current.map(item=>item.id===updated.thread_id?{...item,annotations:item.annotations.map(entry=>entry.id===updated.id?updated:entry)}:item));}finally{setThreadBusy(false);}};
  const saveAnnotation=async()=>{const label=annotationLabel.trim();if(!annotation||!label||threadBusy)return;setThreadBusy(true);try{const updated=await updateVisualAnnotation(annotation.id,{label});setThreads(current=>current.map(item=>item.id===updated.thread_id?{...item,annotations:item.annotations.map(entry=>entry.id===updated.id?updated:entry)}:item));}finally{setThreadBusy(false);}};
  const removeAnnotation=async(confirmDeletion=true)=>{if(!annotation||threadBusy||(confirmDeletion&&!window.confirm(`删除圈点“${annotation.label}”？`)))return;setThreadBusy(true);try{await deleteVisualAnnotation(annotation.id);setThreads(current=>current.map(item=>item.id===annotation.thread_id?{...item,annotations:item.annotations.filter(entry=>entry.id!==annotation.id)}:item));setAnnotationId('');}finally{setThreadBusy(false);}};
  useEffect(()=>{const handleDelete=(event:KeyboardEvent)=>{if(event.key!=='Delete'||annotationTool!=='select'||!annotation||threadBusy)return;const target=event.target;if(target instanceof HTMLElement&&(target.isContentEditable||target.matches('input, textarea, select')))return;event.preventDefault();void removeAnnotation(false);};document.addEventListener('keydown',handleDelete);return()=>document.removeEventListener('keydown',handleDelete);},[annotation,annotationTool,threadBusy]);
  const generateCandidate=async()=>{if(!thread||!selected||threadBusy)return;setThreadBusy(true);setGenerationError('');setGenerationProgress(0);try{const started=await startVisualReviewGeneration(thread.id);const finished=await pollJob(started.job_id,{onUpdate:job=>setGenerationProgress(job.progress)});if(finished.status!=='succeeded')throw new Error(finished.error||'候选生成失败');const candidateId=finished.result_metadata.candidate_id;if(typeof candidateId!=='string'||!candidateId)throw new Error('生成任务未返回审阅候选');const refreshed=await listVisualReviewThreads(selected.shot.id);setThreads(refreshed);setGenerationProgress(100);}catch(cause){setGenerationError(cause instanceof Error?cause.message:'候选生成失败');}finally{setThreadBusy(false);}};
  const canCompare=Boolean(sourcePanelUrl&&panelUrl&&sourcePanelUrl!==panelUrl);
  const displayedPanelUrl=compareBefore&&canCompare?sourcePanelUrl:panelUrl;

  if (!selected) return <main className="visual-review-workspace visual-review-empty"><h1>尚无可审阅镜头</h1></main>;

  return <main className="visual-review-workspace">
    <section className="review-canvas-shell">
      <header className="review-canvas-toolbar"><div>{onBackToProduction&&<button className="review-back-button" aria-label="返回生产画布" onClick={onBackToProduction}><ArrowLeft size={16}/>返回生产画布</button>}<button aria-label="选择工具" aria-pressed={annotationTool==='select'} className={annotationTool==='select'?'active':''} onClick={()=>setAnnotationTool('select')}><MousePointer2 size={16}/></button><button aria-label="圈选工具" aria-pressed={annotationTool==='circle'} className={annotationTool==='circle'?'active':''} onClick={()=>setAnnotationTool('circle')}><Circle size={16}/></button><button aria-label="矩形工具" aria-pressed={annotationTool==='rectangle'} className={annotationTool==='rectangle'?'active':''} onClick={()=>setAnnotationTool('rectangle')}><RectangleHorizontal size={16}/></button><button aria-label="画笔工具" aria-pressed={annotationTool==='path'} className={annotationTool==='path'?'active':''} onClick={()=>setAnnotationTool('path')}><PenLine size={16}/></button></div><span>{onBackToProduction?`本集生产 / 镜头 ${String(selected.shot.position).padStart(2,'0')} / 视觉审阅`:'适应画布 · 82%'}</span><button aria-label="前后对比" aria-pressed={compareBefore} disabled={!canCompare} onClick={()=>setCompareBefore(value=>!value)}><GitCompareArrows size={16}/></button></header>
      <div className="review-canvas" aria-label="审阅画布">
        <div ref={reviewCanvasFitRef} className="review-canvas-fit">
          {displayedPanelUrl ? <div className="review-image-stage" style={imageFrameStyle}><img src={displayedPanelUrl} alt={selected.shot.composition} onLoad={event=>{const {naturalWidth:width,naturalHeight:height}=event.currentTarget;if(width>0&&height>0)setImageNaturalSize({width,height});}}/><div ref={annotationLayerRef} className="review-annotation-layer" aria-label="图片标注层" onPointerDown={beginAnnotation} onPointerMove={moveAnnotation} onPointerUp={event=>void finishAnnotation(event)} onPointerCancel={cancelAnnotation}>{thread?.annotations.map((item,index)=>{const dragGeometry=annotationDrag?.id===item.id?translatedGeometry(item.kind,item.geometry,annotationDrag.current.x-annotationDrag.start.x,annotationDrag.current.y-annotationDrag.start.y):null;const visual=annotationVisual(item.kind,dragGeometry??item.geometry);if(!visual)return null;const number=String(index+1).padStart(2,'0');return <button type="button" key={item.id} className={`annotation-pin annotation-${item.kind} ${annotation?.id===item.id?'active':''} ${annotationDrag?.id===item.id?'dragging':''}`} aria-label={`标注 ${number} ${item.label}`} style={{...visual.style,pointerEvents:annotationTool==='select'?'auto':'none',borderColor:item.color,'--annotation-color':item.color} as CSSProperties} onPointerDown={event=>beginAnnotationDrag(event,item)} onPointerMove={moveAnnotationDrag} onPointerUp={event=>void finishAnnotationDrag(event)} onPointerCancel={cancelAnnotationDrag} onClick={()=>setAnnotationId(item.id)}>{visual.pathPoints?<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={visual.pathPoints}/></svg>:null}<span className="annotation-index">{number}</span><span className={`annotation-callout ${visual.calloutSide}`}>{item.label||'修改'}</span></button>;})}{drawingPreview&&(()=>{const geometry=drawingGeometry(drawingPreview,drawingPreview.current);const visual=geometry?annotationVisual(drawingPreview.kind,geometry):null;return visual?<div data-testid="annotation-draft" className={`annotation-draft annotation-${drawingPreview.kind}`} style={visual.style}>{visual.pathPoints?<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={visual.pathPoints}/></svg>:null}</div>:null;})()}</div></div> : <div className="review-canvas-empty"><span>当前镜头尚无画面</span></div>}
        </div>
      </div>
      <ReviewVersionStrip shotId={selected.shot.id} activeAssetId={selected.shot.active_panel_asset_id} selectedAssetId={previewAssetId} candidateAssetIds={thread?.candidates.filter(candidate=>candidate.status==='ready').map(candidate=>candidate.asset_id)??[]} onSelectAsset={asset=>{setPreviewAssetId(asset.id);setPanelUrl(mediaUrl(asset.media_url));setCompareBefore(false);}}/>
    </section>

    <aside className="review-conversation">
      <header><div><span>{thread?`标记 ${String(threads.indexOf(thread)+1).padStart(2,'0')}`:'未选择标记'}</span><h2>{thread?.title??'创建圈点后开始对话'}</h2></div><MessageSquareText size={18}/></header>
      <div className="review-context"><span>镜头 {String(selected.shot.position).padStart(2, '0')}</span><span>{selected.scene.location}</span><span>V4</span></div>
      {annotation&&<section className="review-annotation-editor"><label>修改说明<input aria-label="修改说明" value={annotationLabel} onChange={event=>setAnnotationLabel(event.target.value)}/></label><div><button type="button" disabled={!annotationLabel.trim()||threadBusy} onClick={()=>void saveAnnotation()}>保存说明</button><button type="button" className="danger-action" disabled={threadBusy} onClick={()=>void removeAnnotation()}><Trash2 size={14}/>删除标注</button></div></section>}
      <div className="conversation-thread">{thread?.messages.map(message=>message.author_kind==='assistant'?<div key={message.id} className="conversation-ai"><Sparkles size={16}/><p>{message.content}</p></div>:<div key={message.id} className="conversation-user">{message.content}</div>)}</div>
      <label className="review-global-note"><span>整图补充说明（可选）</span><div className="review-message-compose"><input aria-label="整图补充说明（可选）" value={messageDraft} onChange={event=>setMessageDraft(event.target.value)} placeholder="仅填写无法圈选的整图要求"/><button aria-label="发送视觉审阅消息" disabled={!thread||!messageDraft.trim()||threadBusy} onClick={()=>void sendMessage()}><MessageSquareText size={15}/></button></div></label>
      <section className="review-scope"><h3>修改范围</h3><div>{([['shot','仅当前镜头'],['episode','本集角色变体'],['master','作品主设定']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scope === value} disabled={!thread} onClick={() => void changeScope(value)}>{label}</button>)}</div><p>{scopeNote[scope]}</p></section>
      <div className="review-locks"><span><Check size={14}/>锁定身份特征</span><span><Check size={14}/>保持服装与构图</span></div>
      <button className="review-generate" disabled={!thread||threadBusy} onClick={()=>void generateCandidate()}><Sparkles size={16}/>{threadBusy&&generationProgress>0?`生成中 ${generationProgress}%`:'生成修改版本'}</button>
      {generationError&&<p className="review-generation-error" role="alert">{generationError}</p>}
      {thread?.candidates.filter(candidate=>candidate.status==='ready').map((candidate,index)=><section key={candidate.id} className="review-candidate"><header><h3>候选版本 V{index+1}</h3><span>待确认</span></header><div className="candidate-comparison"><span>{sourcePanelUrl ? <img src={sourcePanelUrl} alt="修改前"/> : null}<small>修改前</small></span><GitCompareArrows size={18}/><span><small>资产 {candidate.asset_id}</small></span></div><div><button className="accept" onClick={()=>void acceptCandidate(candidate.id)}><Check size={15}/>采纳候选</button><button onClick={()=>void rejectCandidate(candidate.id)}>继续圈点</button></div></section>)}
    </aside>
  </main>;
}
