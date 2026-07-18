'use client';

import {FileUp, Plus, RefreshCw, Save, Sparkles, Square, Trash2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {
  confirmScriptImport,
  createPastedScriptImport,
  parseScriptImport,
  retryScriptImport,
  streamScriptGeneration,
  updateScriptImportDraft,
  uploadScriptImport,
} from '../lib/api';
import type {ScriptImport, ScriptImportDraft, ScriptImportMode} from '../lib/types';

type StreamState = 'idle' | 'streaming' | 'complete' | 'stopped' | 'error';
const draftKey = (projectId:string) => `ai-comic-script-draft:${projectId}`;

function loadLocalDraft(projectId:string):{brief:string;draft:string}{
  try {
    const value=JSON.parse(localStorage.getItem(draftKey(projectId))??'{}') as {brief?:unknown;draft?:unknown};
    return {brief:typeof value.brief==='string'?value.brief:'',draft:typeof value.draft==='string'?value.draft:''};
  } catch {return {brief:'',draft:''};}
}

export function ScriptImportWorkspace({projectId,onConfirmed}:{projectId:string;onConfirmed:()=>Promise<void>|void}) {
  const initial=typeof window==='undefined'?{brief:'',draft:''}:loadLocalDraft(projectId);
  const [mode,setMode]=useState<ScriptImportMode>('generate');
  const [brief,setBrief]=useState(initial.brief);
  const [aiDraft,setAiDraft]=useState(initial.draft);
  const [sourceText,setSourceText]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [current,setCurrent]=useState<ScriptImport|null>(null);
  const [preview,setPreview]=useState<ScriptImportDraft|null>(null);
  const [busy,setBusy]=useState(false);
  const [streamState,setStreamState]=useState<StreamState>(initial.draft?'complete':'idle');
  const [error,setError]=useState('');
  const controller=useRef<AbortController|null>(null);
  const streamGeneration=useRef(0);

  const persist=(nextBrief:string,nextDraft:string)=>localStorage.setItem(draftKey(projectId),JSON.stringify({brief:nextBrief,draft:nextDraft}));

  useEffect(()=>{
    streamGeneration.current+=1;controller.current?.abort();controller.current=null;
    const saved=loadLocalDraft(projectId);setBrief(saved.brief);setAiDraft(saved.draft);setStreamState(saved.draft?'complete':'idle');
    setSourceText('');setFile(null);setCurrent(null);setPreview(null);setBusy(false);setError('');
    return()=>{streamGeneration.current+=1;controller.current?.abort();};
  },[projectId]);

  const changeBrief=(value:string)=>{setBrief(value);persist(value,aiDraft);};
  const changeDraft=(value:string)=>{setAiDraft(value);persist(brief,value);};

  const runStream=async(resume:boolean)=>{
    if(!resume&&aiDraft&&!window.confirm('重新生成会覆盖当前 AI 剧本草稿，确定继续吗？'))return;
    const existing=resume?aiDraft:'';if(!resume)changeDraft('');
    const generation=++streamGeneration.current;const abort=new AbortController();controller.current=abort;
    setStreamState('streaming');setError('');setCurrent(null);
    try{
      await streamScriptGeneration(projectId,{brief,existing_draft:existing},{
        onChunk:(chunk)=>{if(streamGeneration.current!==generation)return;setAiDraft(value=>{const next=value+chunk;persist(brief,next);return next;});},
        onDone:()=>{if(streamGeneration.current===generation)setStreamState('complete');},
        onError:(message)=>{if(streamGeneration.current===generation)setError(message);},
      },abort.signal);
      if(streamGeneration.current===generation)setStreamState('complete');
    }catch(cause){
      if(streamGeneration.current!==generation)return;
      if(cause instanceof DOMException&&cause.name==='AbortError')setStreamState('stopped');
      else {setStreamState('error');setError(cause instanceof Error?cause.message:'流式创作失败');}
    }finally{if(streamGeneration.current===generation)controller.current=null;}
  };

  const stopStream=()=>{controller.current?.abort();controller.current=null;setStreamState('stopped');};
  const parseSource=async(source:string,sourceMode:ScriptImportMode,fileValue:File|null=null)=>{setBusy(true);setError('');try{const created=fileValue?await uploadScriptImport(projectId,sourceMode,fileValue):await createPastedScriptImport(projectId,sourceMode,source);setCurrent(created);const parsed=await parseScriptImport(created.id);setCurrent(parsed);setPreview(parsed.structured_draft as ScriptImportDraft);}catch(cause){setError(cause instanceof Error?cause.message:'解析失败');}finally{setBusy(false);}};
  const retry=async()=>{if(!current)return;setBusy(true);setError('');try{const parsed=await retryScriptImport(current.id);setCurrent(parsed);setPreview(parsed.structured_draft as ScriptImportDraft);}catch(cause){setError(cause instanceof Error?cause.message:'重试失败');}finally{setBusy(false);}};
  const save=async()=>{if(!current||!preview)return;setBusy(true);setError('');try{const updated=await updateScriptImportDraft(current.id,preview);setCurrent(updated);}catch(cause){setError(cause instanceof Error?cause.message:'保存失败');}finally{setBusy(false);}};
  const confirm=async()=>{if(!current||!preview)return;setBusy(true);setError('');try{await updateScriptImportDraft(current.id,preview);await confirmScriptImport(current.id);localStorage.removeItem(draftKey(projectId));setAiDraft('');await onConfirmed();}catch(cause){setError(cause instanceof Error?cause.message:'确认失败');}finally{setBusy(false);}};

  const referencedCharacterIds=new Set(preview?.episodes.flatMap(episode=>episode.scenes.flatMap(scene=>scene.shots.flatMap(shot=>[...Object.keys(shot.character_state),...shot.dialogue.flatMap(line=>line.speaker_draft_id?[line.speaker_draft_id]:[])])))??[]);
  const propCount=preview?.episodes.reduce((total,episode)=>total+episode.scenes.reduce((sceneTotal,scene)=>sceneTotal+(scene.props?.length??0),0),0)??0;
  const updateSceneProps=(episodeId:string,sceneIndex:number,props:ScriptImportDraft['episodes'][number]['scenes'][number]['props'])=>setPreview(currentPreview=>currentPreview?{...currentPreview,episodes:currentPreview.episodes.map(episode=>episode.draft_id===episodeId?{...episode,scenes:episode.scenes.map((scene,index)=>index===sceneIndex?{...scene,props}:scene)}:episode)}:currentPreview);

  const hasDraft=Boolean(aiDraft)||streamState==='streaming';
  return <main className="script-import-workspace">
    <header><div><h1>剧本创作</h1><p>AI 生成或识别的草稿，确认后才会写入角色、剧集和分镜。</p></div>{preview&&<button className="command-button" disabled={busy} onClick={confirm}><Sparkles size={16}/>确认导入</button>}</header>
    {!preview?<section className="script-import-source">
      <div className="mode-segments script-mode-segments" role="group" aria-label="创作模式">{([['generate','AI生成'],['auto','自动识别']] as const).map(([value,label])=><button key={value} className={`script-mode-segment${mode===value?' active':''}`} onClick={()=>{if(streamState==='streaming')stopStream();setMode(value);setCurrent(null);setError('');}}>{value==='generate'&&<Sparkles aria-hidden="true" size={15}/>}<span>{label}</span></button>)}</div>
      {mode==='generate'?<>
        <label>{hasDraft?'AI 剧本草稿':'本次创作要求（可选）'}<textarea aria-label={hasDraft?'AI 剧本草稿':'本次创作要求（可选）'} value={hasDraft?aiDraft:brief} readOnly={streamState==='streaming'} onChange={event=>hasDraft?changeDraft(event.target.value):changeBrief(event.target.value)} placeholder={hasDraft?'AI 生成的剧本会实时显示在这里':'例如：围绕主角的新冲突，生成 3 集连续剧情'}/></label>
        <div className="script-generation-actions">{streamState==='streaming'?<button className="command-button" onClick={stopStream}><Square size={14}/>停止生成</button>:!hasDraft?<button className="command-button" onClick={()=>void runStream(false)}><Sparkles size={15}/>开始 AI 创作</button>:<><button className="command-button" disabled={busy||!aiDraft.trim()} onClick={()=>void parseSource(aiDraft,'auto')}>{busy?'正在解析':'解析并预览'}</button>{(streamState==='stopped'||streamState==='error')&&<button onClick={()=>void runStream(true)}>继续生成</button>}<button onClick={()=>void runStream(false)}><RefreshCw size={14}/>重新生成</button></>}</div>
      </>:<>
        <label>粘贴文本<textarea value={sourceText} onChange={event=>setSourceText(event.target.value)} placeholder="粘贴剧本、小说或故事文本"/></label><div className="source-divider"><span>或</span></div><label className="file-command"><FileUp size={17}/><span>{file?.name??'选择 TXT、DOCX 或 PDF'}</span><input aria-label="选择剧本文件" type="file" accept=".txt,.docx,.pdf" onChange={event=>setFile(event.target.files?.[0]??null)}/></label><button className="command-button" disabled={busy||(!file&&!sourceText.trim())} onClick={()=>void parseSource(sourceText,'auto',file)}>{busy?'正在解析':'解析并预览'}</button>
      </>}
      {error&&current&&<button className="retry-import-command" disabled={busy} onClick={retry}>{busy?'正在重试':'重试本次解析'}</button>}
    </section>:
    <section className="script-import-preview">
      <div className="preview-heading"><div><strong>{preview.characters.length}</strong><span>角色</span></div><div><strong>{propCount}</strong><span>道具</span></div><div><strong>{preview.episodes.filter(item=>item.enabled).length}</strong><span>启用分集</span></div><button disabled={busy} onClick={save}><Save size={15}/>保存修改</button></div>
      <div className="import-preview-columns">
        <section><h2>角色</h2>{preview.characters.map((character,index)=>{const referenced=referencedCharacterIds.has(character.draft_id);return <div className="import-character" key={character.draft_id}><label>角色 {index+1}<input value={character.name} onChange={event=>setPreview({...preview,characters:preview.characters.map(item=>item.draft_id===character.draft_id?{...item,name:event.target.value}:item)})}/><small>{character.role} · {character.appearance_bible}</small></label><button type="button" className="icon-button" aria-label={`删除角色 ${character.name}`} title={referenced?'角色仍被镜头或对白引用':'删除角色'} disabled={referenced} onClick={()=>setPreview({...preview,characters:preview.characters.filter(item=>item.draft_id!==character.draft_id)})}><Trash2 size={15}/></button></div>;})}</section>
        <section><h2>分集</h2>{preview.episodes.map((episode,episodeIndex)=><div className="import-episode" key={episode.draft_id}><label className="episode-enabled"><input type="checkbox" checked={episode.enabled} onChange={event=>setPreview({...preview,episodes:preview.episodes.map(item=>item.draft_id===episode.draft_id?{...item,enabled:event.target.checked}:item)})}/>导入第 {episodeIndex+1} 集</label><input aria-label={`第 ${episodeIndex+1} 集标题`} value={episode.title} onChange={event=>setPreview({...preview,episodes:preview.episodes.map(item=>item.draft_id===episode.draft_id?{...item,title:event.target.value}:item)})}/><small>{episode.scenes.length} 场 · {episode.target_duration_seconds} 秒</small><div className="import-scene-props"><h3>场景道具</h3>{episode.scenes.map((scene,sceneIndex)=>{const props=scene.props??[];return <section key={`${episode.draft_id}-${sceneIndex}`}><div className="import-scene-props-heading"><strong>第 {sceneIndex+1} 场 · {scene.location}</strong><button type="button" aria-label={`为第 ${episodeIndex+1} 集第 ${sceneIndex+1} 场添加道具`} onClick={()=>updateSceneProps(episode.draft_id,sceneIndex,[...props,{name:'',description:'',required:true}])}><Plus size={14}/>添加道具</button></div>{props.length===0?<p>暂无道具</p>:props.map((prop,propIndex)=><div className="import-prop-row" key={`${sceneIndex}-${propIndex}`}><label>名称<input aria-label={`第 ${episodeIndex+1} 集第 ${sceneIndex+1} 场道具 ${propIndex+1} 名称`} value={prop.name} onChange={event=>updateSceneProps(episode.draft_id,sceneIndex,props.map((item,index)=>index===propIndex?{...item,name:event.target.value}:item))}/></label><label>描述<textarea aria-label={`第 ${episodeIndex+1} 集第 ${sceneIndex+1} 场道具 ${propIndex+1} 描述`} value={prop.description} onChange={event=>updateSceneProps(episode.draft_id,sceneIndex,props.map((item,index)=>index===propIndex?{...item,description:event.target.value}:item))}/></label><label className="import-prop-required"><input type="checkbox" checked={prop.required} onChange={event=>updateSceneProps(episode.draft_id,sceneIndex,props.map((item,index)=>index===propIndex?{...item,required:event.target.checked}:item))}/>必需</label><button type="button" className="icon-button" aria-label={`删除第 ${episodeIndex+1} 集第 ${sceneIndex+1} 场道具 ${propIndex+1}`} title="删除道具" onClick={()=>updateSceneProps(episode.draft_id,sceneIndex,props.filter((_,index)=>index!==propIndex))}><Trash2 size={15}/></button></div>)}</section>;})}</div></div>)}</section>
      </div>
    </section>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </main>;
}
