'use client';

import {type MouseEvent, useEffect, useMemo, useRef, useState} from 'react';
import {AlertCircle, Check, ChevronLeft, ChevronRight, Clock3, Download, ImageOff, MessageSquareText, Pause, Play, Plus, RotateCcw, Send, ShieldCheck, Volume2, VolumeX, X} from 'lucide-react';
import {approveReleaseCandidate,createReleaseCandidate,createReviewMessage,createReviewThread,createVisualReviewMessage,createVisualReviewThread,getAsset,getReleaseGate,getRenderReview,listReleaseCandidates,listReviewThreads,listVisualReviewThreads,mediaUrl,publishReleaseCandidate,startRender,startVisualReviewGeneration,updateReviewThread,updateShot} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {EpisodeDetail, ProductionReadiness,ReleaseCandidate,RenderReview,ReviewThread} from '../lib/types';

export function ReviewPanel({episode, readiness, onSelectShot, onEpisodeChanged}: {episode: EpisodeDetail; readiness: ProductionReadiness; onSelectShot: (id: string) => void; onEpisodeChanged?: () => Promise<void> | void}) {
  const missingPanels = new Set(readiness.blockers.missing_panels);
  const unapprovedShots = new Set(readiness.blockers.unapproved_shots);
  const allShots = useMemo(() => episode.scenes.flatMap(scene => scene.shots.map(shot => ({shot, scenePosition: scene.position, sceneLocation: scene.location}))), [episode]);
  const shots = allShots.filter(({shot}) => missingPanels.has(shot.id) || unapprovedShots.has(shot.id));
  const [selectedId, setSelectedId] = useState(shots[0]?.shot.id ?? allShots[0]?.shot.id ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image');
  const [previewMode,setPreviewMode]=useState<'shot'|'final'>('shot');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [visibleTrack, setVisibleTrack] = useState<'all'|'video'|'dialogue'|'music'|'subtitle'>('all');
  const [reviewBusy, setReviewBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [threads,setThreads]=useState<ReviewThread[]>([]);
  const [selectedThreadId,setSelectedThreadId]=useState('');
  const [commentDraft,setCommentDraft]=useState('');
  const [commentBusy,setCommentBusy]=useState(false);
  const [commentFilter,setCommentFilter]=useState<'open'|'resolved'|'all'>('open');
  const [commentPage,setCommentPage]=useState(0);
  const [threadForm,setThreadForm]=useState(false);
  const [threadTitle,setThreadTitle]=useState('');
  const [threadSeverity,setThreadSeverity]=useState<ReviewThread['severity']>('major');
  const [threadTimecode,setThreadTimecode]=useState('0');
  const [threadShotId,setThreadShotId]=useState('');
  const [platform,setPlatform]=useState<'internal_master'|'short_video'|'widescreen'>('internal_master');
  const [publishBusy,setPublishBusy]=useState(false);
  const [publishStatus,setPublishStatus]=useState('');
  const [publishError,setPublishError]=useState('');
  const [nextCandidateVersion,setNextCandidateVersion]=useState(1);
  const [releaseCandidates,setReleaseCandidates]=useState<ReleaseCandidate[]>([]);
  const [selectedCandidateId,setSelectedCandidateId]=useState('');
  const [renderReview,setRenderReview]=useState<RenderReview|null>(null);
  const [reviewActionStatus,setReviewActionStatus]=useState('');
  const pendingSeekRef=useRef<number|null>(null);
  const selected = allShots.find(item => item.shot.id === selectedId) ?? allShots[0] ?? null;
  const openThreads=threads.filter(thread=>thread.status==='open');
  const persistedShotIds=new Set(openThreads.map(thread=>thread.shot_id).filter(Boolean));
  const blockerRows=shots.filter(({shot})=>!persistedShotIds.has(shot.id));
  const criticalCount = blockerRows.length+openThreads.filter(thread=>thread.severity==='critical').length;
  const pendingCount=blockerRows.length+openThreads.length;
  const selectedThread=threads.find(thread=>thread.id===selectedThreadId)??openThreads.find(thread=>thread.shot_id===selected?.shot.id)??openThreads[0]??null;
  const threadTarget=allShots.find(item=>item.shot.id===threadShotId)??selected;
  const visibleThreads=commentFilter==='open'?openThreads:commentFilter==='resolved'?threads.filter(thread=>thread.status==='resolved'):threads;
  const queueItems = commentFilter==='open'
    ? [...visibleThreads.map(thread=>({kind:'thread' as const,thread})),...blockerRows.map(item=>({kind:'blocker' as const,item}))]
    : visibleThreads.map(thread=>({kind:'thread' as const,thread}));
  const reviewPageSize=4;
  const reviewPageCount=Math.max(1,Math.ceil(queueItems.length/reviewPageSize));
  const pagedQueueItems=queueItems.slice(commentPage*reviewPageSize,(commentPage+1)*reviewPageSize);
  const totalDuration = allShots.reduce((sum, item) => sum + item.shot.duration_seconds, 0);
  const selectedIndex = selected ? allShots.findIndex(item => item.shot.id === selected.shot.id) : -1;
  const selectedShotStart = selectedIndex < 1 ? 0 : allShots.slice(0, selectedIndex).reduce((sum, item) => sum + item.shot.duration_seconds, 0);
  const selectedShotThreads = threads.filter(thread => thread.shot_id === selected?.shot.id);
  const formatTime = (seconds:number) => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const timelineTicks=Array.from({length:5},(_,index)=>formatTime(totalDuration*index/4));
  const selectedCandidate=releaseCandidates.find(candidate=>candidate.id===selectedCandidateId)??releaseCandidates[0]??null;
  const finalPreviewUrl=selectedCandidate?mediaUrl(`/media/${selectedCandidate.render_path.replace(/^\/?media\//,'')}`):null;
  const finalPreviewActive=previewMode==='final'&&Boolean(finalPreviewUrl);
  const episodeTime=Math.min(totalDuration,Math.max(0,finalPreviewActive?currentTime:selectedShotStart+currentTime));
  const playheadPercent=totalDuration>0?episodeTime/totalDuration*100:0;
  const qcRows=renderReview
    ? [
        ['连续性检查',criticalCount?'待处理':'通过',criticalCount===0],
        ['黑帧检查',renderReview.black_frame_positions.length?'检测到黑帧':'通过',renderReview.black_frame_positions.length===0],
        ['音频静音',renderReview.silence_ranges.length?'检测到长静音':'通过',renderReview.silence_ranges.length===0],
        ['字幕轨道',renderReview.subtitle_present?'已检测':'未检测到独立字幕流',renderReview.subtitle_present],
        ['动态风险',renderReview.slideshow_risk?.level==='critical'?'高':renderReview.slideshow_risk?.level==='warning'?'中':renderReview.slideshow_risk?.level==='ok'?'低':'未检测',renderReview.slideshow_risk?.level==='ok'],
      ] as const
    : [
        ['连续性检查',criticalCount?'待处理':'通过',criticalCount===0],
        ['黑帧检查','待终审渲染',false],
        ['音频静音','待终审渲染',false],
        ['字幕轨道','待终审渲染',false],
        ['动态风险','待终审渲染',false],
      ] as const;

  useEffect(()=>{setCommentPage(0);},[commentFilter]);
  useEffect(()=>{if(commentPage>=reviewPageCount)setCommentPage(reviewPageCount-1);},[commentPage,reviewPageCount]);
  useEffect(() => {
    let current = true;
    if(previewMode==='final')return()=>{current=false;};
    setPreviewUrl(null);
    setPlaying(false);
    setCurrentTime(pendingSeekRef.current??0);
    const assetId = selected?.shot.active_video_asset_id ?? selected?.shot.active_panel_asset_id;
    setPreviewType(selected?.shot.active_video_asset_id ? 'video' : 'image');
    if (!assetId) return () => {current = false;};
    getAsset(assetId).then(asset => {if (current) setPreviewUrl(mediaUrl(asset.media_url));}).catch(() => {if (current) setPreviewUrl(null);});
    return () => {current = false;};
  }, [previewMode,selected?.shot.id, selected?.shot.active_panel_asset_id, selected?.shot.active_video_asset_id]);
  useEffect(()=>{let current=true;listReviewThreads(episode.id).then(items=>{if(!current)return;setThreads(items);setSelectedThreadId(items.find(item=>item.status==='open')?.id??'');}).catch(()=>{if(current)setThreads([]);});return()=>{current=false;};},[episode.id]);
  useEffect(()=>{let current=true;listReleaseCandidates(episode.id).then(items=>{if(!current)return;setReleaseCandidates(items);setSelectedCandidateId(value=>items.some(item=>item.id===value)?value:items[0]?.id??'');setNextCandidateVersion(Math.max(0,...items.map(item=>Number(item.version.match(/^V(\d+)$/)?.[1]??0)))+1);if(items.length)getRenderReview(episode.id).then(review=>{if(current)setRenderReview(review);}).catch(()=>{if(current)setRenderReview(null);});else setRenderReview(null);}).catch(()=>{if(current){setReleaseCandidates([]);setSelectedCandidateId('');setRenderReview(null);setNextCandidateVersion(1);}});return()=>{current=false;};},[episode.id]);

  const shotStartFor=(id:string)=>{const index=allShots.findIndex(item=>item.shot.id===id);return index<1?0:allShots.slice(0,index).reduce((sum,item)=>sum+item.shot.duration_seconds,0);};
  const shotAtEpisodeTime=(seconds:number)=>{let offset=0;for(const item of allShots){const end=offset+item.shot.duration_seconds;if(seconds<end||item===allShots.at(-1))return{item,offset,localTime:Math.min(item.shot.duration_seconds,Math.max(0,seconds-offset))};offset=end;}return null;};
  const selectShot = (id: string,localTime?:number) => {pendingSeekRef.current=localTime??null;setSelectedId(id);if(localTime!==undefined)setCurrentTime(localTime);const linked=threads.find(thread=>thread.shot_id===id&&thread.status==='open');if(linked)setSelectedThreadId(linked.id);onSelectShot(id);};
  const seekToEpisodeTime=(seconds:number)=>{const absolute=Math.min(totalDuration,Math.max(0,seconds));const target=shotAtEpisodeTime(absolute);if(!target)return;if(finalPreviewActive){if(target.item.shot.id!==selected?.shot.id)selectShot(target.item.shot.id);setCurrentTime(absolute);if(videoRef.current)videoRef.current.currentTime=absolute;return;}if(target.item.shot.id===selected?.shot.id){pendingSeekRef.current=null;setCurrentTime(target.localTime);if(videoRef.current)videoRef.current.currentTime=target.localTime;}else selectShot(target.item.shot.id,target.localTime);};
  const seekFromRuler=(event:MouseEvent<HTMLButtonElement>)=>{const bounds=event.currentTarget.getBoundingClientRect();if(bounds.width<=0)return;seekToEpisodeTime((event.clientX-bounds.left)/bounds.width*totalDuration);};
  const syncPendingSeek=(video:HTMLVideoElement)=>{const pending=pendingSeekRef.current;if(pending===null)return;video.currentTime=pending;setCurrentTime(pending);pendingSeekRef.current=null;};
  const moveShot=(offset:number)=>{if(!allShots.length)return;const current=Math.max(0,selectedIndex);const next=Math.min(allShots.length-1,Math.max(0,current+offset));selectShot(allShots[next].shot.id);};
  const togglePlayback=async()=>{if((finalPreviewActive||previewType==='video')&&videoRef.current){if(playing){videoRef.current.pause();setPlaying(false);}else{await videoRef.current.play();setPlaying(true);}}else{setPlaying(value=>!value);}};
  const toggleMuted=()=>{const next=!muted;setMuted(next);if(videoRef.current)videoRef.current.muted=next;};
  const selectThread=(thread:ReviewThread)=>{setSelectedThreadId(thread.id);if(thread.shot_id)seekToEpisodeTime(shotStartFor(thread.shot_id)+thread.timecode_seconds);};
  const sendComment=async()=>{const content=commentDraft.trim();if(!selectedThread||!content||commentBusy)return;setCommentBusy(true);try{const message=await createReviewMessage(selectedThread.id,{author_kind:'user',content});setThreads(current=>current.map(thread=>thread.id===selectedThread.id?{...thread,messages:[...thread.messages,message]}:thread));setCommentDraft('');}finally{setCommentBusy(false);}};
  const resolveThread=async(thread:ReviewThread)=>{const updated=await updateReviewThread(thread.id,{status:'resolved'});setThreads(current=>current.map(item=>item.id===updated.id?updated:item));};
  const reopenThread=async(thread:ReviewThread)=>{const updated=await updateReviewThread(thread.id,{status:'open'});setThreads(current=>current.map(item=>item.id===updated.id?updated:item));setSelectedThreadId(updated.id);setCommentFilter('open');};
  const openThreadForm=()=>{const target=shotAtEpisodeTime(episodeTime);setThreadTitle('');setThreadSeverity('major');setThreadShotId(target?.item.shot.id??selected?.shot.id??'');setThreadTimecode(String(Number((target?.localTime??currentTime).toFixed(2))));setThreadForm(true);};
  const saveThread=async()=>{const title=threadTitle.trim();const timecode=Number(threadTimecode);if(!title||!Number.isFinite(timecode)||timecode<0||commentBusy)return;setCommentBusy(true);try{const created=await createReviewThread(episode.id,{shot_id:threadShotId||null,timecode_seconds:timecode,severity:threadSeverity,title});setThreads(current=>[...current,created]);setSelectedThreadId(created.id);setCommentFilter('open');setThreadForm(false);}finally{setCommentBusy(false);}};
  const approveSelectedShot=async()=>{if(!selected||!selected.shot.active_panel_asset_id||reviewBusy)return;setReviewBusy(true);setPublishError('');try{await updateShot(selected.shot.id,{review_status:'approved'});await onEpisodeChanged?.();}catch(cause){setPublishError(cause instanceof Error?cause.message:'镜头审核失败');}finally{setReviewBusy(false);}};
  const requestShotChanges=async()=>{if(!selected||reviewBusy)return;setReviewBusy(true);setPublishError('');setReviewActionStatus('');try{await updateShot(selected.shot.id,{review_status:'needs_changes'});const visualThreads=await listVisualReviewThreads(selected.shot.id);const visualThread=visualThreads.find(thread=>thread.status==='open')??await createVisualReviewThread(selected.shot.id,{source_asset_id:selected.shot.active_panel_asset_id??null,title:'终审修改',modification_scope:'shot'});const relatedThreads=threads.filter(thread=>thread.shot_id===selected.shot.id&&thread.status==='open');const feedback=relatedThreads.length?relatedThreads.flatMap(thread=>[thread.title,...thread.messages.map(message=>message.content)]).filter(Boolean).join('\n'):`请根据终审意见修改镜头 ${selected.shot.position}`;await createVisualReviewMessage(visualThread.id,{author_kind:'user',content:feedback});const started=await startVisualReviewGeneration(visualThread.id);const finished=await pollJob(started.job_id);if(finished.status!=='succeeded')throw new Error(finished.error||'修改候选生成失败');setReviewActionStatus('修改候选已生成，请到视觉审阅确认');await onEpisodeChanged?.();}catch(cause){setPublishError(cause instanceof Error?cause.message:'镜头修改请求失败');}finally{setReviewBusy(false);}};
  const generateFinalPreview=async()=>{if(publishBusy||criticalCount>0||!readiness.ready)return;setPublishBusy(true);setPublishError('');setPublishStatus('正在渲染终审预览');try{const nextVersion=nextCandidateVersion;const started=await startRender(episode.id);const finished=await pollJob(started.job_id,{onUpdate:job=>setPublishStatus(`正在渲染 ${job.progress}%`)});if(finished.status!=='succeeded')throw new Error(finished.error||'终审渲染失败');const renderPath=finished.result_metadata.output_path;if(typeof renderPath!=='string'||!renderPath)throw new Error('渲染任务未返回输出路径');const candidate=await createReleaseCandidate(episode.id,{version:`V${nextVersion}`,render_path:renderPath,qc_snapshot:typeof finished.result_metadata.probe==='object'&&finished.result_metadata.probe?finished.result_metadata.probe as Record<string,unknown>:{}});setReleaseCandidates(current=>[candidate,...current.filter(item=>item.id!==candidate.id)]);setSelectedCandidateId(candidate.id);setNextCandidateVersion(nextVersion+1);setPreviewMode('final');setCurrentTime(0);try{setRenderReview(await getRenderReview(episode.id));}catch{setRenderReview(null);}setPublishStatus('终审预览已生成，请检查成片与质检结果');}catch(cause){setPublishStatus('');setPublishError(cause instanceof Error?cause.message:'终审预览生成失败');}finally{setPublishBusy(false);}};
  const publishEpisode=async()=>{if(!selectedCandidate||publishBusy||criticalCount>0||!readiness.ready)return;setPublishBusy(true);setPublishError('');setPublishStatus('正在检查发布门禁');try{const gate=await getReleaseGate(selectedCandidate.id);if(!gate.ready)throw new Error('服务端发布门禁未通过');await approveReleaseCandidate(selectedCandidate.id);setPublishStatus(platform==='internal_master'?'正在登记内部母版':'正在登记发布记录');await publishReleaseCandidate(selectedCandidate.id,{platform,idempotency_key:`${episode.id}:${selectedCandidate.id}:${platform}`});setReleaseCandidates(current=>current.map(item=>item.id===selectedCandidate.id?{...item,status:'published'}:item));setPublishStatus(platform==='internal_master'?'内部母版已登记':'发布记录已登记（未上传外部平台）');}catch(cause){setPublishStatus('');setPublishError(cause instanceof Error?cause.message:'发布失败');}finally{setPublishBusy(false);}};

  return <main className="review-panel review-publish-workspace">
    <header className="review-panel-header">
      <div className="review-header-copy"><div className="review-header-title"><span className="eyebrow">审核发布</span><h1>审核队列</h1></div><p>{episode.title} · 下一候选 V{nextCandidateVersion}</p></div>
      <div className="review-header-status"><span className="review-count">{pendingCount} 个待处理问题</span><span className={readiness.ready&&criticalCount===0 ? 'ready' : 'blocked'}>{readiness.ready&&criticalCount===0 ? <Check size={14}/> : <AlertCircle size={14}/>} {readiness.ready&&criticalCount===0 ? '可提交终审' : '存在关键问题'}</span></div>
    </header>

    <div className="review-publish-layout">
      <section className="review-player-column">
        <section className="review-player" aria-label="审阅播放器">
          <div className="review-preview-toolbar"><div className="review-preview-modes"><button className={previewMode==='shot'?'active':''} onClick={()=>{setPreviewMode('shot');setCurrentTime(0);}}>镜头审阅</button><button className={previewMode==='final'?'active':''} aria-label="终审成片" disabled={!selectedCandidate} onClick={()=>{setPreviewMode('final');setCurrentTime(0);}}>终审成片</button></div>{releaseCandidates.length>0&&<><select aria-label="终审候选版本" value={selectedCandidate?.id??''} onChange={event=>{setSelectedCandidateId(event.target.value);setPreviewMode('final');setCurrentTime(0);}}>{releaseCandidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.version} · {candidate.status==='published'?'已登记':candidate.status==='approved'?'已批准':'草稿'}</option>)}</select>{finalPreviewUrl&&<a href={finalPreviewUrl} download aria-label="下载成片"><Download size={15}/><span>下载成片</span></a>}</>}</div>
          <div className="review-player-stage">
            {finalPreviewActive?<video className="review-player-media" ref={videoRef} aria-label="终审成片视频" src={finalPreviewUrl??undefined} muted={muted} playsInline onLoadedMetadata={event=>syncPendingSeek(event.currentTarget)} onTimeUpdate={event=>setCurrentTime(event.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/>:previewUrl && previewType === 'video' ? <video className="review-player-media" ref={videoRef} aria-label="当前镜头视频" src={previewUrl} muted={muted} playsInline onLoadedMetadata={event=>syncPendingSeek(event.currentTarget)} onTimeUpdate={event=>setCurrentTime(event.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/> : previewUrl ? <img className="review-player-media" src={previewUrl} alt={selected?.shot.composition ?? '审阅画面'}/> : <div className="review-player-empty"><ImageOff size={34}/><span>{selected ? '当前镜头尚无可播放结果' : '尚无镜头'}</span></div>}
            {selected && <><span className="review-timecode">{formatTime(episodeTime)} / {formatTime(totalDuration)}</span><span className="review-safe-frame"/>{!finalPreviewActive&&selectedShotThreads.map((thread,index)=><button key={thread.id} className="review-comment-pin" style={{left:`${Math.min(90,10+(thread.timecode_seconds/Math.max(.1,selected.shot.duration_seconds))*80)}%`}} aria-label={`画面评论 ${thread.title}`} onClick={()=>selectThread(thread)}>{String(index+1).padStart(2,'0')}</button>)}</>}
          </div>
          <div className="review-transport"><button aria-label="上一镜头" disabled={finalPreviewActive||selectedIndex<=0} onClick={()=>moveShot(-1)}><ChevronLeft size={16}/></button><button className="play" aria-label={playing ? '暂停' : '播放'} onClick={()=>void togglePlayback()}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button><button aria-label="下一镜头" disabled={finalPreviewActive||selectedIndex<0||selectedIndex>=allShots.length-1} onClick={()=>moveShot(1)}><ChevronRight size={16}/></button><span>{formatTime(episodeTime)} / {formatTime(totalDuration)}</span><button className={`audio-toggle ${muted?'muted':'audible'}`} aria-label={muted?'取消静音':'静音'} aria-pressed={muted} title={muted?'当前已静音，点击恢复声音':'当前已开启声音，点击静音'} onClick={toggleMuted}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button><span className="review-quality">{finalPreviewActive?selectedCandidate?.version:previewType==='video'?'视频源':'画面预览'}</span></div>
        </section>

        <section className="review-timeline" aria-label="多轨时间线">
          <header><span>多轨时间线</span><div><button aria-label="显示全部轨道" className={visibleTrack==='all'?'active':''} onClick={()=>setVisibleTrack('all')}>全部</button><button aria-label="视频轨道" className={visibleTrack==='video'?'active':''} onClick={()=>setVisibleTrack('video')}>镜头</button><button aria-label="对白轨道" className={visibleTrack==='dialogue'?'active':''} onClick={()=>setVisibleTrack('dialogue')}>对白</button><button aria-label="音乐轨道" className={visibleTrack==='music'?'active':''} onClick={()=>setVisibleTrack('music')}>音乐</button><button aria-label="字幕轨道" className={visibleTrack==='subtitle'?'active':''} onClick={()=>setVisibleTrack('subtitle')}>字幕</button></div></header>
          <button type="button" className="timeline-ruler" aria-label="跳转时间线" onClick={seekFromRuler}>{timelineTicks.map((tick,index)=><span key={`${tick}-${index}`}>{tick}</span>)}</button>
          {(visibleTrack==='all'||visibleTrack==='video')&&<div className="timeline-track video-track"><label>视频</label><div>{allShots.map(({shot,scenePosition,sceneLocation},globalIndex) => <button key={shot.id} aria-label={`镜头 ${globalIndex+1}`} title={`场景 ${String(scenePosition).padStart(2,'0')} · ${sceneLocation} · 场景内镜头 ${String(shot.position).padStart(2,'0')}`} className={`${shot.id === selected?.shot.id ? 'active' : ''} ${missingPanels.has(shot.id) ? 'missing' : ''}`} style={{flexGrow: Math.max(1, shot.duration_seconds)}} onClick={() => seekToEpisodeTime(shotStartFor(shot.id))}><strong>镜头 {String(globalIndex+1).padStart(2,'0')}</strong><small>场景 {String(scenePosition).padStart(2,'0')}</small></button>)}</div></div>}
          {(visibleTrack==='all'||visibleTrack==='dialogue')&&<div className="timeline-track audio-track"><label>对白</label><div>{allShots.map(({shot}) => <div className="timeline-shot-segment" key={shot.id} style={{flexGrow:Math.max(1,shot.duration_seconds)}}>{shot.dialogue.map(line=>{const start=Math.min(shot.duration_seconds,Math.max(0,line.start_seconds));const duration=Math.min(Math.max(.1,line.duration_seconds),Math.max(.1,shot.duration_seconds-start));return <button key={line.id} className={`timeline-clip ${line.audio_asset_id?'ready':''}`} aria-label={`对白 ${line.text}`} title={`${formatTime(shotStartFor(shot.id)+start)} ${line.text}`} style={{left:`${start/Math.max(.1,shot.duration_seconds)*100}%`,width:`${duration/Math.max(.1,shot.duration_seconds)*100}%`}} onClick={()=>seekToEpisodeTime(shotStartFor(shot.id)+start)}>{line.text}</button>;})}</div>)}</div></div>}
          {(visibleTrack==='all'||visibleTrack==='music')&&<div className="timeline-track music-track"><label>音乐</label><div><span className="timeline-empty-track">本集未配置音乐轨</span></div></div>}
          {(visibleTrack==='all'||visibleTrack==='subtitle')&&<div className="timeline-track subtitle-track"><label>字幕</label><div>{allShots.map(({shot}) => <div className="timeline-shot-segment" key={shot.id} style={{flexGrow:Math.max(1,shot.duration_seconds)}}>{shot.dialogue.filter(line=>line.subtitle_text.trim()).map(line=>{const start=Math.min(shot.duration_seconds,Math.max(0,line.start_seconds));const duration=Math.min(Math.max(.1,line.duration_seconds),Math.max(.1,shot.duration_seconds-start));return <button key={line.id} className="timeline-clip" aria-label={`字幕 ${line.subtitle_text}`} title={`${formatTime(shotStartFor(shot.id)+start)} ${line.subtitle_text}`} style={{left:`${start/Math.max(.1,shot.duration_seconds)*100}%`,width:`${duration/Math.max(.1,shot.duration_seconds)*100}%`}} onClick={()=>seekToEpisodeTime(shotStartFor(shot.id)+start)}>{line.subtitle_text}</button>;})}</div>)}</div></div>}
          <span className="timeline-playhead-lane"><span className="timeline-playhead" aria-label="时间线播放头" style={{left:`${playheadPercent}%`}}/></span>
        </section>

        <section className="qc-summary" aria-label="质量检查">
          {qcRows.map(([label,status,pass]) => <div key={label} className={pass?'pass':'warning'}><ShieldCheck size={15}/><span>{label}</span><strong>{status}</strong></div>)}
        </section>
      </section>

      <aside className="review-discussion">
        <header><div><h2>审阅评论</h2><p>评论与精确时间码、场景和镜头绑定。</p></div><div className="review-discussion-header-actions"><span>{criticalCount}</span><button type="button" aria-label="新建终审评论" onClick={openThreadForm}><Plus size={14}/></button></div></header>
        <div className="review-comment-filters"><button className={commentFilter==='open'?'active':''} onClick={()=>setCommentFilter('open')}>未解决</button><button className={commentFilter==='resolved'?'active':''} onClick={()=>setCommentFilter('resolved')}>已解决</button><button className={commentFilter==='all'?'active':''} onClick={()=>setCommentFilter('all')}>全部</button></div>
        {threadForm&&<form className="review-thread-form" onSubmit={event=>{event.preventDefault();void saveThread();}}><header><strong>新建终审评论</strong><button type="button" aria-label="关闭终审评论表单" onClick={()=>setThreadForm(false)}><X size={14}/></button></header><label>评论标题<input aria-label="评论标题" value={threadTitle} onChange={event=>setThreadTitle(event.target.value)} autoFocus/></label><div><label>严重级别<select aria-label="严重级别" value={threadSeverity} onChange={event=>setThreadSeverity(event.target.value as ReviewThread['severity'])}><option value="critical">关键</option><option value="major">主要</option><option value="minor">次要</option></select></label><label>时间码秒数<input aria-label="时间码秒数" type="number" min="0" max={threadTarget?.shot.duration_seconds} step="0.01" value={threadTimecode} onChange={event=>setThreadTimecode(event.target.value)}/></label></div><small>{threadTarget?`绑定镜头 ${threadTarget.shot.position} · ${threadTarget.sceneLocation}`:'整集评论'}</small><button className="primary-action" type="submit" disabled={!threadTitle.trim()||!Number.isFinite(Number(threadTimecode))||Number(threadTimecode)<0||Number(threadTimecode)>(threadTarget?.shot.duration_seconds??Infinity)||commentBusy}>保存评论</button></form>}
        <section className="review-queue" aria-label="待处理评论">
          {pagedQueueItems.map((entry,index)=>entry.kind==='thread'?<article className={`review-thread-row ${entry.thread.id===selectedThread?.id?'active':''}`} key={entry.thread.id}><button className="review-row" aria-label={`${entry.thread.title} 镜头评论`} onClick={()=>selectThread(entry.thread)}><span className="review-comment-index">{String(commentPage*reviewPageSize+index+1).padStart(2,'0')}</span><span className="review-shot-context"><strong>{entry.thread.title}</strong><small>{entry.thread.shot_id?`镜头 ${allShots.find(item=>item.shot.id===entry.thread.shot_id)?.shot.position??'已删除'}`:'整集评论'}</small><time><Clock3 size={12}/>{entry.thread.timecode_seconds.toFixed(2)}s</time></span><span className="review-blockers"><span className={`review-blocker ${entry.thread.severity==='critical'?'missing':'pending'}`}>{entry.thread.severity}</span></span></button>{entry.thread.id===selectedThread?.id&&entry.thread.messages.length>0&&<div className="review-message-history">{entry.thread.messages.map(message=><p key={message.id}><span>{message.author_kind==='user'?'创作者':message.author_kind==='assistant'?'AI':'系统'}</span>{message.content}</p>)}</div>}{entry.thread.status==='open'?<button className="review-resolve" aria-label={`解决${entry.thread.title}`} onClick={()=>void resolveThread(entry.thread)}><Check size={14}/>解决</button>:<button className="review-resolve" aria-label={`重开${entry.thread.title}`} onClick={()=>void reopenThread(entry.thread)}><RotateCcw size={14}/>重开</button>}</article>:<button className={`review-row ${entry.item.shot.id===selected?.shot.id?'active':''}`} key={entry.item.shot.id} onClick={()=>selectShot(entry.item.shot.id)}><span className="review-comment-index">{String(commentPage*reviewPageSize+index+1).padStart(2,'0')}</span><span className="review-shot-context"><strong>镜头 {entry.item.shot.position}</strong><small>场景 {entry.item.scenePosition} · {entry.item.sceneLocation}</small><small>{entry.item.shot.composition}</small></span><span className="review-blockers">{missingPanels.has(entry.item.shot.id)&&<span className="review-blocker missing"><ImageOff size={14} aria-hidden="true"/>缺少画面</span>}{unapprovedShots.has(entry.item.shot.id)&&<span className="review-blocker pending"><AlertCircle size={14} aria-hidden="true"/>待审核</span>}</span></button>)}
          {!queueItems.length&&<p className="review-empty">当前筛选下没有评论。</p>}
        </section>
        {reviewPageCount>1&&<nav className="review-queue-pagination" aria-label="评论分页"><button aria-label="上一页评论" disabled={commentPage===0} onClick={()=>setCommentPage(page=>Math.max(0,page-1))}><ChevronLeft size={14}/></button><span>{commentPage+1} / {reviewPageCount}</span><button aria-label="下一页评论" disabled={commentPage>=reviewPageCount-1} onClick={()=>setCommentPage(page=>Math.min(reviewPageCount-1,page+1))}><ChevronRight size={14}/></button></nav>}
        <div className="review-comment-compose"><MessageSquareText size={16}/><input aria-label="添加审阅评论" value={commentDraft} onChange={event=>setCommentDraft(event.target.value)} placeholder={selectedThread?'回复当前评论':'选择一条持久化评论后回复'}/><button aria-label="发送评论" disabled={!selectedThread||!commentDraft.trim()||commentBusy} onClick={()=>void sendComment()}><Send size={15}/></button></div>
        <div className="review-shot-actions"><button aria-label="要求修改" disabled={!selected||reviewBusy} onClick={()=>void requestShotChanges()}><X size={14}/>要求修改</button><button className="approve-shot" aria-label="通过当前镜头审核" disabled={!selected?.shot.active_panel_asset_id||selected?.shot.review_status==='approved'||reviewBusy} onClick={()=>void approveSelectedShot()}><Check size={14}/>{selected?.shot.review_status==='approved'?'当前镜头已通过':'通过当前镜头'}</button></div>
        {reviewActionStatus&&<p className="review-action-status" role="status">{reviewActionStatus}</p>}
        <section className="publish-gate"><header><h2>终审登记</h2><span>服务端门禁</span></header><label>目标记录<select value={platform} onChange={event=>setPlatform(event.target.value as typeof platform)}><option value="internal_master">内部母版</option><option value="short_video">短视频发布记录</option><option value="widescreen">横屏发布记录</option></select></label><label>下一候选<input value={`V${nextCandidateVersion} · 下一终审候选`} readOnly/></label>{selectedCandidate&&<p className="publish-candidate">当前终审：{selectedCandidate.version} · {selectedCandidate.status==='published'?'已登记':selectedCandidate.status==='approved'?'已批准':'待批准'}</p>}{platform!=='internal_master'&&<p><AlertCircle size={14}/>当前仅登记发布记录，不会上传到外部平台。</p>}{criticalCount > 0 && <p><AlertCircle size={14}/>{criticalCount} 个关键问题未解决，暂不可提交。</p>}{publishError&&<p className="publish-error" role="alert"><AlertCircle size={14}/>{publishError}</p>}{publishStatus&&<p className="publish-status" role="status">{publishStatus}</p>}<div className="publish-actions"><button className="generate-preview" disabled={criticalCount > 0||!readiness.ready||publishBusy} aria-label="生成终审预览" onClick={()=>void generateFinalPreview()}><Play size={16}/>{publishBusy?'正在处理':'生成终审预览'}</button><button className="approve-publish" disabled={!selectedCandidate||criticalCount > 0||!readiness.ready||publishBusy} aria-label="批准并登记" onClick={()=>void publishEpisode()}><Check size={16}/>{publishBusy?'正在处理':'批准并登记'}</button></div></section>
      </aside>
    </div>
  </main>;
}
