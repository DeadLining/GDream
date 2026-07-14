'use client';

import {History,Pencil,Save,Trash2} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {ScriptDocument,ScriptSaveState} from '../lib/types';

const saveLabel:Record<ScriptSaveState,string>={idle:'',saving:'正在保存',saved:'已保存',failed:'保存失败',conflict:'版本冲突'};

export function ScriptEditor({document,onSave,onFinalize,onRename,onDelete,onHistory,onDirtyChange}:{document:ScriptDocument;onSave:(content:string,checksum:string)=>Promise<void>;onFinalize:()=>Promise<void>;onRename:(title:string)=>Promise<void>;onDelete:()=>Promise<void>;onHistory:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const [buffer,setBuffer]=useState(document.current_revision.content);
  const [saveState,setSaveState]=useState<ScriptSaveState>('idle');
  const [renaming,setRenaming]=useState(false);
  const [title,setTitle]=useState(document.title);
  const dirty=buffer!==document.current_revision.content;
  const busy=saveState==='saving';
  useEffect(()=>{setBuffer(document.current_revision.content);setTitle(document.title);setSaveState('idle');setRenaming(false);},[document.id,document.title,document.current_revision.id,document.current_revision.content]);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  const saveDraft=async()=>{if(!dirty||busy)return;setSaveState('saving');try{await onSave(buffer,document.current_revision.checksum);setSaveState('saved');}catch(cause){setSaveState(cause instanceof Error&&cause.message.includes('revision_conflict')?'conflict':'failed');}};
  const createVersion=async()=>{if(busy)return;setSaveState('saving');try{if(dirty)await onSave(buffer,document.current_revision.checksum);await onFinalize();setSaveState('saved');}catch(cause){setSaveState(cause instanceof Error&&cause.message.includes('revision_conflict')?'conflict':'failed');}};
  const submitTitle=async()=>{const value=title.trim();if(!value){setTitle(document.title);setRenaming(false);return;}try{await onRename(value);setRenaming(false);}catch{setSaveState('failed');}};
  return <section className="script-editor">
    <header className="script-editor-header"><div>{renaming?<input aria-label="剧本标题" value={title} autoFocus onChange={event=>setTitle(event.target.value)} onBlur={()=>void submitTitle()} onKeyDown={event=>{if(event.key==='Enter')void submitTitle();if(event.key==='Escape'){setTitle(document.title);setRenaming(false);}}}/>:<><h1>{document.title}</h1><p>{document.source_type==='ai'?'AI 生成':document.source_type==='upload'?'文件上传':'手动编辑'} · 当前 V{document.current_revision.revision_number}</p></>}</div><div className="script-editor-commands" role="group" aria-label="剧本命令"><button type="button" className="icon-command" aria-label="保存草稿" title="保存草稿" disabled={!dirty||busy} onClick={()=>void saveDraft()}><Save size={15}/></button><button type="button" className="command-button" aria-label="创建版本" disabled={busy||(document.current_revision.status==='finalized'&&!dirty)} onClick={()=>void createVersion()}>创建版本</button><button type="button" className="icon-command" aria-label="版本历史" title="版本历史" onClick={onHistory}><History size={15}/></button><button type="button" className="icon-command" aria-label="重命名" title="重命名" onClick={()=>setRenaming(true)}><Pencil size={15}/></button><button type="button" className="icon-command destructive" aria-label="删除剧本" title="删除剧本" onClick={()=>void onDelete()}><Trash2 size={15}/></button></div></header>
    <div className="script-save-status" aria-live="polite">{saveLabel[saveState]}</div>
    <label className="script-body-field"><span>剧本正文</span><textarea aria-label="剧本正文" value={buffer} onChange={event=>{setBuffer(event.target.value);setSaveState('idle');}}/></label>
  </section>;
}
