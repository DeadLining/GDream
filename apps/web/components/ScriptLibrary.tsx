'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {BookOpen,FilePenLine,FileUp,GitBranch,Sparkles,Square} from 'lucide-react';
import {createScript,createStoryline,createStorylineEvent,deleteScript,deleteScriptRevision,deleteStorylineEvent,finalizeScript,getScript,listScriptRevisions,listScripts,listStorylines,listVolumes,patchScript,restoreScriptRevision,streamDocumentScript,updateStoryline,updateStorylineEvent,uploadScript} from '../lib/api';
import type {ScriptDocument,ScriptRevision,Storyline,Volume} from '../lib/types';
import {ScriptEditor} from './ScriptEditor';
import {ScriptList} from './ScriptList';
import {ScriptRevisionPanel} from './ScriptRevisionPanel';
import {StorylineCanvas} from './canvas/StorylineCanvas';
import {ChapterTimeline} from './ChapterTimeline';

export function ScriptLibrary({projectId,onConfirmed,initialView='document',initialStorylineId}:{projectId:string;onConfirmed:()=>Promise<void>|void;initialView?:'document'|'storyline'|'chapters';initialStorylineId?:string}){
  const [document,setDocument]=useState<ScriptDocument|null>(null);
  const [revisionItems,setRevisionItems]=useState<ScriptRevision[]>([]);
  const [selectedRevisionId,setSelectedRevisionId]=useState<string|null>(null);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [view,setView]=useState<'document'|'storyline'|'chapters'>(initialView);
  const [volumes,setVolumes]=useState<Volume[]>([]);
  const [storylines,setStorylines]=useState<Storyline[]>([]);
  const [dirty,setDirty]=useState(false);
  const [aiOpen,setAiOpen]=useState(false);
  const [aiBrief,setAiBrief]=useState('');
  const [aiPreview,setAiPreview]=useState('');
  const [generating,setGenerating]=useState(false);
  const generation=useRef(0);
  const controller=useRef<AbortController|null>(null);

  const loadDocument=useCallback(async(id:string)=>{
    const [detail,revisions]=await Promise.all([getScript(id),listScriptRevisions(id)]);
    const normalizedRevisions=revisions.some(item=>item.id===detail.current_revision_id)
      ?revisions.map(item=>item.id===detail.current_revision_id?detail.current_revision:item)
      :[detail.current_revision,...revisions];
    setDocument(detail);
    setRevisionItems(normalizedRevisions);
    setSelectedRevisionId(current=>normalizedRevisions.some(item=>item.id===current)?current:detail.current_revision_id);
    return detail;
  },[]);
  const refresh=useCallback(async()=>{const scripts=await listScripts(projectId);if(scripts[0])await loadDocument(scripts[0].id);else{setDocument(null);setRevisionItems([]);setSelectedRevisionId(null);}},[projectId,loadDocument]);
  useEffect(()=>{const request=++generation.current;setLoading(true);setError('');setDocument(null);setRevisionItems([]);setSelectedRevisionId(null);void Promise.all([listScripts(projectId),listVolumes(projectId),listStorylines(projectId)]).then(async([scripts,nextVolumes,nextStorylines])=>{if(request!==generation.current)return;setVolumes(nextVolumes);setStorylines(nextStorylines);if(scripts[0])await loadDocument(scripts[0].id);}).catch(cause=>{if(request===generation.current)setError(cause instanceof Error?cause.message:'加载剧本失败');}).finally(()=>{if(request===generation.current)setLoading(false);});return()=>{generation.current+=1;controller.current?.abort();};},[projectId,loadDocument]);

  const save=useCallback(async(content:string,checksum:string)=>{if(!document)return;const wasLocked=document.current_revision.status==='finalized';const updated=await patchScript(document.id,{content,expected_checksum:checksum});await loadDocument(updated.id);setSelectedRevisionId(updated.current_revision_id);if(wasLocked)await onConfirmed();},[document,loadDocument,onConfirmed]);
  const finalize=async()=>{if(!document)return;const updated=await finalizeScript(document.id);await loadDocument(updated.id);setSelectedRevisionId(updated.current_revision_id);await onConfirmed();};
  const rename=async(title:string)=>{if(!document)return;const updated=await patchScript(document.id,{title});setDocument(updated);};
  const remove=async()=>{if(!document||!window.confirm(`永久删除剧本“${document.title}”？`))return;try{await deleteScript(document.id);setDocument(null);setRevisionItems([]);setSelectedRevisionId(null);setHistoryOpen(false);await onConfirmed();}catch(cause){setError(cause instanceof Error?cause.message:'删除失败');}};
  const upload=async(file:File)=>{setError('');try{const title=file.name.replace(/\.[^.]+$/,'')||'项目剧本';const updated=await uploadScript(projectId,title,file);await loadDocument(updated.id);setSelectedRevisionId(updated.current_revision_id);setView('document');await onConfirmed();}catch(cause){setError(cause instanceof Error?cause.message:'上传失败');}};
  const restore=async(revision:ScriptRevision)=>{if(!document||!window.confirm(`恢复 V${revision.revision_number} 并创建新的当前版本？`))return;try{const updated=await restoreScriptRevision(document.id,revision.id);await loadDocument(updated.id);setSelectedRevisionId(updated.current_revision_id);setHistoryOpen(false);await onConfirmed();}catch(cause){setError(cause instanceof Error?cause.message:'恢复失败');}};
  const removeRevision=async(revision:ScriptRevision)=>{if(!document||revision.id===document.current_revision_id)return;if(!window.confirm(`永久删除版本 V${revision.revision_number}？`))return;try{await deleteScriptRevision(document.id,revision.id);const revisions=await listScriptRevisions(document.id);setRevisionItems(revisions);setSelectedRevisionId(current=>current===revision.id?document.current_revision_id:current);setHistoryOpen(false);}catch(cause){const message=cause instanceof Error?cause.message:'删除版本失败';setError(message.includes('revision_has_imports')?'该版本已经生成剧集，需保留作为来源记录。':message);}};
  const runAi=async()=>{if(generating)return;setGenerating(true);setError('');setAiPreview('');const abort=new AbortController();controller.current=abort;try{let target=document;if(!target)target=await createScript(projectId,{title:'项目剧本',source_type:'ai',content:''});else target=await finalizeScript(target.id);setDocument(target);setSelectedRevisionId(target.current_revision_id);await streamDocumentScript(target.id,{brief:aiBrief.trim(),expected_revision_id:target.current_revision.id},{onChunk:event=>setAiPreview(value=>value+event.text),onDone:()=>{},onError:message=>setError(message)},abort.signal);const updated=await loadDocument(target.id);setSelectedRevisionId(updated.current_revision_id);setAiOpen(false);setAiBrief('');setView('document');await onConfirmed();}catch(cause){if(!(cause instanceof DOMException&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'AI 生成失败');}finally{controller.current=null;setGenerating(false);}};
  const stopAi=()=>{controller.current?.abort();controller.current=null;setGenerating(false);};
  const switchView=(next:typeof view)=>{if(next===view)return;if(dirty&&!window.confirm('当前草稿尚未保存，确定离开吗？'))return;setView(next);};
  const openHistory=async()=>{if(!document)return;try{setRevisionItems(await listScriptRevisions(document.id));setHistoryOpen(true);}catch(cause){setError(cause instanceof Error?cause.message:'版本加载失败');}};
  const addStoryline=async(data:Parameters<typeof createStoryline>[1])=>{const created=await createStoryline(projectId,data);setStorylines(current=>[...current,created]);await onConfirmed();};
  const addStorylineEvent=async(storylineId:string,data:Parameters<typeof createStorylineEvent>[1])=>{const created=await createStorylineEvent(storylineId,data);setStorylines(current=>current.map(line=>line.id===storylineId?{...line,events:[...line.events,created]}:line));await onConfirmed();};
  const editStoryline=async(id:string,data:Parameters<typeof updateStoryline>[1])=>{const updated=await updateStoryline(id,data);setStorylines(current=>current.map(line=>line.id===id?{...updated,events:line.events}:line));await onConfirmed();};
  const editStorylineEvent=async(id:string,data:Parameters<typeof updateStorylineEvent>[1])=>{const updated=await updateStorylineEvent(id,data);setStorylines(current=>current.map(line=>({...line,events:line.events.map(event=>event.id===id?updated:event)})));await onConfirmed();};
  const removeStorylineEvent=async(id:string)=>{await deleteStorylineEvent(id);setStorylines(current=>current.map(line=>({...line,events:line.events.filter(event=>event.id!==id)})));await onConfirmed();};

  if(loading)return <main className="center-state"><h1>正在加载剧本</h1></main>;
  const header=<header className="script-workspace-header"><div><h1>{view==='document'?'剧本与版本':view==='storyline'?'故事线画布':'章节事件图谱'}</h1><p>{view==='document'?'每个项目只有一个剧本，上传、AI 生成和编辑都会沉淀为版本。':view==='storyline'?'跨集追踪伏笔、角色成长和冲突，不改变卷与剧集顺序。':'按章节切分长篇内容并提取事件摘要。'}</p></div><div className="script-view-switch"><button className={view==='document'?'active':''} onClick={()=>switchView('document')}><FilePenLine size={15}/>文档编辑</button><button className={view==='storyline'?'active':''} onClick={()=>switchView('storyline')}><GitBranch size={15}/>故事线画布</button><button className={view==='chapters'?'active':''} onClick={()=>switchView('chapters')} disabled={!document}><BookOpen size={15}/>章节图谱</button></div></header>;
  const aiPanel=aiOpen?<section className="narrative-inline-form"><header><strong>AI 根据条件生成{document?'新版本':'剧本'}</strong></header><label>创作条件<textarea aria-label="AI 创作条件" value={aiBrief} onChange={event=>setAiBrief(event.target.value)} placeholder="例如：三集悬疑故事，每集约 90 秒，角色关系逐步反转"/></label>{aiPreview&&<pre>{aiPreview}</pre>}<div>{generating?<button type="button" onClick={stopAi}><Square size={14}/>停止生成</button>:<button type="button" className="primary-action" aria-label="开始生成" onClick={()=>void runAi()}><Sparkles size={15}/>开始生成</button>}</div></section>:null;
  const uploadControl=(label:string)=><label className="command-button"><FileUp size={16}/><span>{label}</span><input className="sr-only" aria-label={label} type="file" accept=".txt,.docx,.pdf" onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></label>;
  const storylineCanvas=(title:string)=><StorylineCanvas scriptTitle={title} volumes={volumes} storylines={storylines} initialStorylineId={initialStorylineId} onCreateStoryline={addStoryline} onUpdateStoryline={editStoryline} onCreateEvent={addStorylineEvent} onUpdateEvent={editStorylineEvent} onDeleteEvent={removeStorylineEvent}/>;
  if(!document)return <main className="script-workspace">{header}<section className="center-state script-empty-state"><h1>创建项目剧本</h1><p>选择上传文件，或让 AI 根据创作条件生成第一版剧本。</p><div>{uploadControl('上传剧本')}<button className="command-button" type="button" aria-label="AI 根据条件生成" onClick={()=>setAiOpen(true)}><Sparkles size={16}/>AI 根据条件生成</button></div>{aiPanel}{error&&<p className="form-error" role="alert">{error}</p>}</section></main>;
  const selectedRevision=revisionItems.find(item=>item.id===selectedRevisionId)??document.current_revision;
  return <main className="script-workspace">{header}{view==='document'?<section className="script-library"><ScriptList items={revisionItems} currentRevisionId={document.current_revision_id} selectedRevisionId={selectedRevision.id} onSelect={revision=>setSelectedRevisionId(revision.id)} onDelete={revision=>void removeRevision(revision)} onUpload={file=>void upload(file)}/><div className="script-library-main"><div className="script-version-actions"><button type="button" className="script-ai-version-button" aria-label="AI 生成新版本" onClick={()=>setAiOpen(value=>!value)}><Sparkles size={15}/>AI 生成新版本</button></div>{aiPanel}<ScriptEditor document={document} revision={selectedRevision} onSave={save} onFinalize={finalize} onRename={rename} onDelete={remove} onHistory={()=>void openHistory()} onRestoreRevision={revision=>void restore(revision)} onDeleteRevision={revision=>void removeRevision(revision)} onDirtyChange={setDirty}/>{error&&<p className="form-error script-library-error" role="alert">{error}</p>}</div></section>:view==='storyline'?storylineCanvas(document.title):<section className="script-library"><ScriptList items={revisionItems} currentRevisionId={document.current_revision_id} selectedRevisionId={selectedRevision.id} onSelect={revision=>setSelectedRevisionId(revision.id)} onDelete={revision=>void removeRevision(revision)} onUpload={file=>void upload(file)}/><div className="script-library-main"><ChapterTimeline scriptDocumentId={document.id}/></div></section>}{historyOpen&&<ScriptRevisionPanel items={revisionItems} onRestore={id=>{const revision=revisionItems.find(item=>item.id===id);if(revision)void restore(revision);}} onClose={()=>setHistoryOpen(false)}/>}</main>;
}
