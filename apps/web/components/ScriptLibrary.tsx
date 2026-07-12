'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {createScript,deleteScript,getScript,listScriptRevisions,listScripts,patchScript,restoreScriptRevision,uploadScript} from '../lib/api';
import type {ScriptDocument,ScriptDocumentSummary,ScriptRevision} from '../lib/types';
import {ScriptEditor} from './ScriptEditor';
import {ScriptList} from './ScriptList';
import {ScriptRevisionPanel} from './ScriptRevisionPanel';

export function ScriptLibrary({projectId,onConfirmed:_onConfirmed}:{projectId:string;onConfirmed:()=>Promise<void>|void}){
  const [items,setItems]=useState<ScriptDocumentSummary[]>([]);const [selectedId,setSelectedId]=useState<string|null>(null);const [document,setDocument]=useState<ScriptDocument|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const generation=useRef(0);
  const [revisions,setRevisions]=useState<ScriptRevision[]|null>(null);
  const refreshList=useCallback(async(preferred?:string)=>{const request=++generation.current;const loaded=await listScripts(projectId);if(request!==generation.current)return;setItems(loaded);const id=preferred??(loaded.some(item=>item.id===selectedId)?selectedId:loaded[0]?.id??null);setSelectedId(id);if(id){const detail=await getScript(id);if(request===generation.current)setDocument(detail);}else setDocument(null);},[projectId,selectedId]);
  useEffect(()=>{setLoading(true);setError('');setSelectedId(null);setDocument(null);void refreshList().catch(cause=>setError(cause instanceof Error?cause.message:'加载剧本失败')).finally(()=>setLoading(false));return()=>{generation.current+=1;};},[projectId]);
  const select=async(id:string)=>{const request=++generation.current;setSelectedId(id);setError('');try{const detail=await getScript(id);if(request===generation.current)setDocument(detail);}catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:'加载剧本失败');}};
  const create=async()=>{setError('');try{const created=await createScript(projectId,{title:'未命名剧本',source_type:'paste',content:''});setItems(current=>[created,...current]);setSelectedId(created.id);setDocument(created);}catch(cause){setError(cause instanceof Error?cause.message:'创建失败');}};
  const save=useCallback(async(content:string,checksum:string)=>{if(!document)return;const updated=await patchScript(document.id,{content,expected_checksum:checksum});setDocument(updated);setItems(current=>current.map(item=>item.id===updated.id?updated:item));},[document?.id]);
  const rename=async(title:string)=>{if(!document)return;const updated=await patchScript(document.id,{title});setDocument(updated);setItems(current=>current.map(item=>item.id===updated.id?updated:item));};
  const remove=async()=>{if(!document||!window.confirm(`永久删除剧本“${document.title}”？`))return;try{await deleteScript(document.id);setDocument(null);setSelectedId(null);await refreshList();}catch(cause){setError(cause instanceof Error?cause.message:'删除失败');}};
  const upload=async(file:File)=>{try{const title=file.name.replace(/\.[^.]+$/,'')||'上传剧本';const created=await uploadScript(projectId,title,file);setItems(current=>[created,...current]);setSelectedId(created.id);setDocument(created);}catch(cause){setError(cause instanceof Error?cause.message:'上传失败');}};
  const openHistory=async()=>{if(document)setRevisions(await listScriptRevisions(document.id));};
  const restore=async(id:string)=>{if(!document||!window.confirm('恢复此版本并创建新的当前版本？'))return;const updated=await restoreScriptRevision(document.id,id);setDocument(updated);setItems(current=>current.map(item=>item.id===updated.id?updated:item));setRevisions(null);};
  if(loading)return <main className="center-state"><h1>正在加载剧本</h1></main>;
  if(!items.length&&!document)return <main className="center-state"><h1>创建第一份剧本</h1><p>AI 生成、粘贴或上传的内容都会保存在项目中。</p><button className="command-button" onClick={()=>void create()}>新建剧本</button>{error&&<p className="form-error">{error}</p>}</main>;
  return <main className="script-library"><ScriptList items={items} selectedId={selectedId} onSelect={id=>void select(id)} onCreate={()=>void create()} onUpload={file=>void upload(file)}/><div className="script-library-main">{document?<ScriptEditor document={document} onSave={save} onRename={rename} onDelete={remove} onHistory={()=>void openHistory()}/>:<div className="center-state">选择一份剧本</div>}{error&&<p className="form-error" role="alert">{error}</p>}</div>{revisions&&<ScriptRevisionPanel items={revisions} onRestore={id=>void restore(id)} onClose={()=>setRevisions(null)}/>}</main>;
}
