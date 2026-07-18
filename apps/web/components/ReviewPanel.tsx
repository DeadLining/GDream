'use client';

import {type MouseEvent, useEffect, useMemo, useRef, useState} from 'react';
import {AlertCircle, Check, ChevronLeft, ChevronRight, Download, ImageOff, Pause, Play, ShieldCheck, Volume2, VolumeX} from 'lucide-react';
import {approveReleaseCandidate,createReleaseCandidate,getAsset,getReleaseGate,getRenderReview,listReleaseCandidates,mediaUrl,publishReleaseCandidate,startRender} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {EpisodeDetail, ProductionReadiness,ReleaseCandidate,RenderReview} from '../lib/types';

export function ReviewPanel({episode, readiness, initialShotId, onSelectShot}: {episode: EpisodeDetail; readiness: ProductionReadiness; initialShotId?: string; onSelectShot: (id: string) => void}) {
  const missingPanels = new Set(readiness.blockers.missing_panels);
  const stalePanels = new Set(readiness.blockers.stale_panels??[]);
  const unapprovedShots = new Set(readiness.blockers.unapproved_shots);
  const allShots = useMemo(() => episode.scenes.flatMap(scene => scene.shots.map(shot => ({shot, scenePosition: scene.position, sceneLocation: scene.location}))), [episode]);
  const shots = allShots.filter(({shot}) => missingPanels.has(shot.id) || stalePanels.has(shot.id) || unapprovedShots.has(shot.id));
  const [selectedId, setSelectedId] = useState(allShots.some(item=>item.shot.id===initialShotId)?initialShotId??'':shots[0]?.shot.id ?? allShots[0]?.shot.id ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image');
  const [previewMode,setPreviewMode]=useState<'shot'|'final'>('shot');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [visibleTrack, setVisibleTrack] = useState<'all'|'video'|'dialogue'|'music'|'subtitle'>('all');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [platform,setPlatform]=useState<'internal_master'|'short_video'|'widescreen'>('internal_master');
  const [publishBusy,setPublishBusy]=useState(false);
  const [publishStatus,setPublishStatus]=useState('');
  const [publishError,setPublishError]=useState('');
  const [nextCandidateVersion,setNextCandidateVersion]=useState(1);
  const [releaseCandidates,setReleaseCandidates]=useState<ReleaseCandidate[]>([]);
  const [selectedCandidateId,setSelectedCandidateId]=useState('');
  const [renderReview,setRenderReview]=useState<RenderReview|null>(null);
  const pendingSeekRef=useRef<number|null>(null);
  const selected = allShots.find(item => item.shot.id === selectedId) ?? allShots[0] ?? null;
  const criticalCount = shots.length;
  const pendingCount=shots.length;
  const totalDuration = allShots.reduce((sum, item) => sum + item.shot.duration_seconds, 0);
  const selectedIndex = selected ? allShots.findIndex(item => item.shot.id === selected.shot.id) : -1;
  const selectedShotStart = selectedIndex < 1 ? 0 : allShots.slice(0, selectedIndex).reduce((sum, item) => sum + item.shot.duration_seconds, 0);
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
  useEffect(()=>{setSelectedId(current=>initialShotId&&allShots.some(item=>item.shot.id===initialShotId)?initialShotId:allShots.some(item=>item.shot.id===current)?current:shots[0]?.shot.id??allShots[0]?.shot.id??'');},[episode.id,initialShotId,allShots]);
  useEffect(()=>{let current=true;listReleaseCandidates(episode.id).then(items=>{if(!current)return;setReleaseCandidates(items);setSelectedCandidateId(value=>items.some(item=>item.id===value)?value:items[0]?.id??'');setNextCandidateVersion(Math.max(0,...items.map(item=>Number(item.version.match(/^V(\d+)$/)?.[1]??0)))+1);if(items.length)getRenderReview(episode.id).then(review=>{if(current)setRenderReview(review);}).catch(()=>{if(current)setRenderReview(null);});else setRenderReview(null);}).catch(()=>{if(current){setReleaseCandidates([]);setSelectedCandidateId('');setRenderReview(null);setNextCandidateVersion(1);}});return()=>{current=false;};},[episode.id]);

  const shotStartFor=(id:string)=>{const index=allShots.findIndex(item=>item.shot.id===id);return index<1?0:allShots.slice(0,index).reduce((sum,item)=>sum+item.shot.duration_seconds,0);};
  const shotAtEpisodeTime=(seconds:number)=>{let offset=0;for(const item of allShots){const end=offset+item.shot.duration_seconds;if(seconds<end||item===allShots.at(-1))return{item,offset,localTime:Math.min(item.shot.duration_seconds,Math.max(0,seconds-offset))};offset=end;}return null;};
  const selectShot = (id: string,localTime?:number) => {pendingSeekRef.current=localTime??null;setSelectedId(id);if(localTime!==undefined)setCurrentTime(localTime);onSelectShot(id);};
  const seekToEpisodeTime=(seconds:number)=>{const absolute=Math.min(totalDuration,Math.max(0,seconds));const target=shotAtEpisodeTime(absolute);if(!target)return;if(finalPreviewActive){if(target.item.shot.id!==selected?.shot.id)selectShot(target.item.shot.id);setCurrentTime(absolute);if(videoRef.current)videoRef.current.currentTime=absolute;return;}if(target.item.shot.id===selected?.shot.id){pendingSeekRef.current=null;setCurrentTime(target.localTime);if(videoRef.current)videoRef.current.currentTime=target.localTime;}else selectShot(target.item.shot.id,target.localTime);};
  const seekFromRuler=(event:MouseEvent<HTMLButtonElement>)=>{const bounds=event.currentTarget.getBoundingClientRect();if(bounds.width<=0)return;seekToEpisodeTime((event.clientX-bounds.left)/bounds.width*totalDuration);};
  const syncPendingSeek=(video:HTMLVideoElement)=>{const pending=pendingSeekRef.current;if(pending===null)return;video.currentTime=pending;setCurrentTime(pending);pendingSeekRef.current=null;};
  const moveShot=(offset:number)=>{if(!allShots.length)return;const current=Math.max(0,selectedIndex);const next=Math.min(allShots.length-1,Math.max(0,current+offset));selectShot(allShots[next].shot.id);};
  const togglePlayback=async()=>{if((finalPreviewActive||previewType==='video')&&videoRef.current){if(playing){videoRef.current.pause();setPlaying(false);}else{await videoRef.current.play();setPlaying(true);}}else{setPlaying(value=>!value);}};
  const toggleMuted=()=>{const next=!muted;setMuted(next);if(videoRef.current)videoRef.current.muted=next;};
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
            {selected && <><span className="review-timecode">{formatTime(episodeTime)} / {formatTime(totalDuration)}</span><span className="review-safe-frame"/></>}
          </div>
          <div className="review-transport"><button aria-label="上一镜头" disabled={finalPreviewActive||selectedIndex<=0} onClick={()=>moveShot(-1)}><ChevronLeft size={16}/></button><button className="play" aria-label={playing ? '暂停' : '播放'} onClick={()=>void togglePlayback()}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button><button aria-label="下一镜头" disabled={finalPreviewActive||selectedIndex<0||selectedIndex>=allShots.length-1} onClick={()=>moveShot(1)}><ChevronRight size={16}/></button><span>{formatTime(episodeTime)} / {formatTime(totalDuration)}</span><button className={`audio-toggle ${muted?'muted':'audible'}`} aria-label={muted?'取消静音':'静音'} aria-pressed={muted} title={muted?'当前已静音，点击恢复声音':'当前已开启声音，点击静音'} onClick={toggleMuted}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button><span className="review-quality">{finalPreviewActive?selectedCandidate?.version:previewType==='video'?'视频源':'画面预览'}</span></div>
        </section>

        <section className="review-timeline" aria-label="多轨时间线">
          <header><span>多轨时间线</span><div><button aria-label="显示全部轨道" className={visibleTrack==='all'?'active':''} onClick={()=>setVisibleTrack('all')}>全部</button><button aria-label="视频轨道" className={visibleTrack==='video'?'active':''} onClick={()=>setVisibleTrack('video')}>镜头</button><button aria-label="对白轨道" className={visibleTrack==='dialogue'?'active':''} onClick={()=>setVisibleTrack('dialogue')}>对白</button><button aria-label="音乐轨道" className={visibleTrack==='music'?'active':''} onClick={()=>setVisibleTrack('music')}>音乐</button><button aria-label="字幕轨道" className={visibleTrack==='subtitle'?'active':''} onClick={()=>setVisibleTrack('subtitle')}>字幕</button></div></header>
          <button type="button" className="timeline-ruler" aria-label="跳转时间线" onClick={seekFromRuler}>{timelineTicks.map((tick,index)=><span key={`${tick}-${index}`}>{tick}</span>)}</button>
          {(visibleTrack==='all'||visibleTrack==='video')&&<div className="timeline-track video-track"><label>视频</label><div>{allShots.map(({shot,scenePosition,sceneLocation},globalIndex) => <button key={shot.id} aria-label={`镜头 ${globalIndex+1}`} title={`场景 ${String(scenePosition).padStart(2,'0')} · ${sceneLocation} · 场景内镜头 ${String(shot.position).padStart(2,'0')}`} className={`${shot.id === selected?.shot.id ? 'active' : ''} ${missingPanels.has(shot.id)||stalePanels.has(shot.id) ? 'missing' : ''}`} style={{flexGrow: Math.max(1, shot.duration_seconds)}} onClick={() => seekToEpisodeTime(shotStartFor(shot.id))}><strong>镜头 {String(globalIndex+1).padStart(2,'0')}</strong><small>场景 {String(scenePosition).padStart(2,'0')}</small></button>)}</div></div>}
          {(visibleTrack==='all'||visibleTrack==='dialogue')&&<div className="timeline-track audio-track"><label>对白</label><div>{allShots.map(({shot}) => <div className="timeline-shot-segment" key={shot.id} style={{flexGrow:Math.max(1,shot.duration_seconds)}}>{shot.dialogue.map(line=>{const start=Math.min(shot.duration_seconds,Math.max(0,line.start_seconds));const duration=Math.min(Math.max(.1,line.duration_seconds),Math.max(.1,shot.duration_seconds-start));return <button key={line.id} className={`timeline-clip ${line.audio_asset_id?'ready':''}`} aria-label={`对白 ${line.text}`} title={`${formatTime(shotStartFor(shot.id)+start)} ${line.text}`} style={{left:`${start/Math.max(.1,shot.duration_seconds)*100}%`,width:`${duration/Math.max(.1,shot.duration_seconds)*100}%`}} onClick={()=>seekToEpisodeTime(shotStartFor(shot.id)+start)}>{line.text}</button>;})}</div>)}</div></div>}
          {(visibleTrack==='all'||visibleTrack==='music')&&<div className="timeline-track music-track"><label>音乐</label><div><span className="timeline-empty-track">本集未配置音乐轨</span></div></div>}
          {(visibleTrack==='all'||visibleTrack==='subtitle')&&<div className="timeline-track subtitle-track"><label>字幕</label><div>{allShots.map(({shot}) => <div className="timeline-shot-segment" key={shot.id} style={{flexGrow:Math.max(1,shot.duration_seconds)}}>{shot.dialogue.filter(line=>line.subtitle_text.trim()).map(line=>{const start=Math.min(shot.duration_seconds,Math.max(0,line.start_seconds));const duration=Math.min(Math.max(.1,line.duration_seconds),Math.max(.1,shot.duration_seconds-start));return <button key={line.id} className="timeline-clip" aria-label={`字幕 ${line.subtitle_text}`} title={`${formatTime(shotStartFor(shot.id)+start)} ${line.subtitle_text}`} style={{left:`${start/Math.max(.1,shot.duration_seconds)*100}%`,width:`${duration/Math.max(.1,shot.duration_seconds)*100}%`}} onClick={()=>seekToEpisodeTime(shotStartFor(shot.id)+start)}>{line.subtitle_text}</button>;})}</div>)}</div></div>}
          <span className="timeline-playhead-lane"><span className="timeline-playhead" aria-label="时间线播放头" style={{left:`${playheadPercent}%`}}/></span>
        </section>

        <section className="qc-summary" aria-label="质量检查">
          {qcRows.map(([label,status,pass]) => <div key={label} className={pass?'pass':'warning'}><ShieldCheck size={15}/><span>{label}</span><strong>{status}</strong></div>)}
        </section>
      </section>

      <aside className="review-publish-sidebar">
        <section className="publish-gate"><header><h2>终审登记</h2><span>服务端门禁</span></header><label>目标记录<select value={platform} onChange={event=>setPlatform(event.target.value as typeof platform)}><option value="internal_master">内部母版</option><option value="short_video">短视频发布记录</option><option value="widescreen">横屏发布记录</option></select></label><label>下一候选<input value={`V${nextCandidateVersion} · 下一终审候选`} readOnly/></label>{selectedCandidate&&<p className="publish-candidate">当前终审：{selectedCandidate.version} · {selectedCandidate.status==='published'?'已登记':selectedCandidate.status==='approved'?'已批准':'待批准'}</p>}{platform!=='internal_master'&&<p><AlertCircle size={14}/>当前仅登记发布记录，不会上传到外部平台。</p>}{criticalCount > 0 && <p><AlertCircle size={14}/>{criticalCount} 个关键问题未解决，暂不可提交。</p>}{publishError&&<p className="publish-error" role="alert"><AlertCircle size={14}/>{publishError}</p>}{publishStatus&&<p className="publish-status" role="status">{publishStatus}</p>}<div className="publish-actions"><button className="generate-preview" disabled={criticalCount > 0||!readiness.ready||publishBusy} aria-label="生成终审预览" onClick={()=>void generateFinalPreview()}><Play size={16}/>{publishBusy?'正在处理':'生成终审预览'}</button><button className="approve-publish" disabled={!selectedCandidate||criticalCount > 0||!readiness.ready||publishBusy} aria-label="批准并登记" onClick={()=>void publishEpisode()}><Check size={16}/>{publishBusy?'正在处理':'批准并登记'}</button></div></section>
      </aside>
    </div>
  </main>;
}
