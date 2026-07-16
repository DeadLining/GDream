'use client';

import {Eye,History,Pencil,RotateCcw,Save,Trash2} from 'lucide-react';
import {useEffect,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {ScriptDocument,ScriptRevision,ScriptSaveState} from '../lib/types';

const saveLabel:Record<ScriptSaveState,string>={idle:'',saving:'正在保存',saved:'已保存',failed:'保存失败',conflict:'版本冲突'};
const sourceLabel=(method:string)=>({ai:'AI 生成',upload:'文件上传',paste:'粘贴导入',edit:'手动编辑',restore:'版本恢复'}[method]??method);

export function ScriptEditor({document,revision,onSave,onFinalize,onRename,onDelete,onHistory,onRestoreRevision,onDeleteRevision,onDirtyChange}:{document:ScriptDocument;revision:ScriptRevision;onSave:(content:string,checksum:string)=>Promise<void>;onFinalize:()=>Promise<void>;onRename:(title:string)=>Promise<void>;onDelete:()=>Promise<void>;onHistory:()=>void;onRestoreRevision:(revision:ScriptRevision)=>void;onDeleteRevision:(revision:ScriptRevision)=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const isCurrent=revision.id===document.current_revision_id;
  const [buffer,setBuffer]=useState(revision.content);
  const [saveState,setSaveState]=useState<ScriptSaveState>('idle');
  const [renaming,setRenaming]=useState(false);
  const [title,setTitle]=useState(document.title);
  const [mode,setMode]=useState<'preview'|'edit'>(isCurrent&&revision.status==='working'?'edit':'preview');
  const dirty=isCurrent&&buffer!==document.current_revision.content;
  const busy=saveState==='saving';
  useEffect(()=>{setBuffer(revision.content);setTitle(document.title);setSaveState('idle');setRenaming(false);setMode(revision.id===document.current_revision_id&&revision.status==='working'?'edit':'preview');},[document.id,document.title,document.current_revision_id,revision.id,revision.content,revision.status]);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  const saveDraft=async()=>{if(!dirty||busy)return;setSaveState('saving');try{await onSave(buffer,document.current_revision.checksum);setSaveState('saved');}catch(cause){setSaveState(cause instanceof Error&&cause.message.includes('revision_conflict')?'conflict':'failed');}};
  const createVersion=async()=>{if(busy)return;setSaveState('saving');try{if(dirty)await onSave(buffer,document.current_revision.checksum);await onFinalize();setSaveState('saved');setMode('preview');}catch(cause){setSaveState(cause instanceof Error&&cause.message.includes('revision_conflict')?'conflict':'failed');}};
  const submitTitle=async()=>{const value=title.trim();if(!value){setTitle(document.title);setRenaming(false);return;}try{await onRename(value);setRenaming(false);}catch{setSaveState('failed');}};

  return <section className="script-editor">
    <header className="script-editor-header">
      <div className="script-editor-heading">{renaming&&isCurrent?<input aria-label="剧本标题" value={title} autoFocus onChange={event=>setTitle(event.target.value)} onBlur={()=>void submitTitle()} onKeyDown={event=>{if(event.key==='Enter')void submitTitle();if(event.key==='Escape'){setTitle(document.title);setRenaming(false);}}}/>:<><div className="script-editor-title-row"><h1>{document.title}</h1>{!isCurrent&&<span>历史版本</span>}</div><p>{sourceLabel(revision.creation_method)} · V{revision.revision_number} · {revision.status==='finalized'?'已定稿':'工作草稿'}</p></>}</div>
      <div className="script-editor-toolbar">
        {isCurrent?<>
          <div className="script-mode-switch" role="group" aria-label="正文显示模式">
            <button type="button" aria-label="阅读正文" aria-pressed={mode==='preview'} onClick={()=>setMode('preview')}><Eye size={14}/>阅读</button>
            <button type="button" aria-label="编辑正文" aria-pressed={mode==='edit'} onClick={()=>setMode('edit')}><Pencil size={14}/>编辑</button>
          </div>
          <div className="script-editor-commands" role="group" aria-label="剧本命令">
            <button type="button" className="icon-command" aria-label="保存草稿" title="保存草稿" disabled={!dirty||busy} onClick={()=>void saveDraft()}><Save size={15}/></button>
            <button type="button" className="script-create-version" aria-label="创建版本" disabled={busy||(document.current_revision.status==='finalized'&&!dirty)} onClick={()=>void createVersion()}>创建版本</button>
            <button type="button" className="icon-command" aria-label="版本历史" title="版本历史" onClick={onHistory}><History size={15}/></button>
            <button type="button" className="icon-command" aria-label="重命名" title="重命名" onClick={()=>setRenaming(true)}><Pencil size={15}/></button>
            <button type="button" className="icon-command destructive" aria-label="删除剧本" title="删除剧本" onClick={()=>void onDelete()}><Trash2 size={15}/></button>
          </div>
        </>:<div className="script-history-actions"><button type="button" aria-label={`恢复版本 ${revision.revision_number}`} onClick={()=>onRestoreRevision(revision)}><RotateCcw size={15}/>恢复为新版本</button><button type="button" className="destructive" aria-label={`删除版本 ${revision.revision_number}`} onClick={()=>onDeleteRevision(revision)}><Trash2 size={15}/>删除版本</button></div>}
      </div>
    </header>
    <div className="script-save-status" aria-live="polite">{saveLabel[saveState]}</div>
    {mode==='edit'&&isCurrent?<label className="script-body-field"><span>剧本正文</span><textarea aria-label="剧本正文" value={buffer} onChange={event=>{setBuffer(event.target.value);setSaveState('idle');}}/></label>:<div className="script-preview-scroll"><article className="script-markdown" aria-label="剧本正文预览"><ReactMarkdown remarkPlugins={[remarkGfm]}>{revision.content}</ReactMarkdown></article></div>}
  </section>;
}
