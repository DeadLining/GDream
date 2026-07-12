'use client';

import {Pencil,Trash2} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {ScriptDocument,ScriptSaveState} from '../lib/types';

const saveLabel:Record<ScriptSaveState,string>={idle:'',saving:'正在保存',saved:'已保存',failed:'保存失败',conflict:'版本冲突'};

export function ScriptEditor({document,onSave,onRename,onDelete}:{document:ScriptDocument;onSave:(content:string,checksum:string)=>Promise<void>;onRename:(title:string)=>Promise<void>;onDelete:()=>Promise<void>}){
  const [buffer,setBuffer]=useState(document.current_revision.content);
  const [saveState,setSaveState]=useState<ScriptSaveState>('idle');
  const [renaming,setRenaming]=useState(false);
  const [title,setTitle]=useState(document.title);
  useEffect(()=>{setBuffer(document.current_revision.content);setTitle(document.title);setSaveState('idle');setRenaming(false);},[document.id,document.current_revision.id]);
  useEffect(()=>{if(buffer===document.current_revision.content)return;setSaveState('saving');const timer=window.setTimeout(()=>{void onSave(buffer,document.current_revision.checksum).then(()=>setSaveState('saved')).catch(()=>setSaveState('failed'));},600);return()=>window.clearTimeout(timer);},[buffer,document.current_revision.checksum,document.current_revision.content,onSave]);
  const submitTitle=async()=>{const value=title.trim();if(!value){setTitle(document.title);setRenaming(false);return;}await onRename(value);setRenaming(false);};
  return <section className="script-editor">
    <header className="script-editor-header"><div>{renaming?<input aria-label="剧本标题" value={title} autoFocus onChange={event=>setTitle(event.target.value)} onBlur={()=>void submitTitle()} onKeyDown={event=>{if(event.key==='Enter')void submitTitle();if(event.key==='Escape'){setTitle(document.title);setRenaming(false);}}}/>:<><h1>{document.title}</h1><p>{document.source_type==='ai'?'AI 生成':document.source_type==='upload'?'文件上传':'粘贴文本'} · {document.revision_count} 个版本</p></>}</div><div className="script-editor-commands" role="group" aria-label="剧本命令"><button className="icon-command" aria-label="重命名" title="重命名" onClick={()=>setRenaming(true)}><Pencil size={15}/></button><button className="icon-command destructive" aria-label="删除剧本" title="删除剧本" onClick={()=>void onDelete()}><Trash2 size={15}/></button></div></header>
    <div className="script-save-status" aria-live="polite">{saveLabel[saveState]}</div>
    <label className="script-body-field"><span>剧本正文</span><textarea aria-label="剧本正文" value={buffer} onChange={event=>setBuffer(event.target.value)}/></label>
  </section>;
}
