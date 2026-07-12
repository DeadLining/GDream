import {FileText, Plus, Upload} from 'lucide-react';
import type {ScriptDocumentSummary} from '../lib/types';

export function ScriptList({items,selectedId,onSelect,onCreate,onUpload}:{items:ScriptDocumentSummary[];selectedId:string|null;onSelect:(id:string)=>void;onCreate:()=>void;onUpload:(file:File)=>void}){
  return <aside className="script-library-list" aria-label="剧本列表">
    <header><h2>剧本</h2><div><label className="icon-command" title="上传剧本"><Upload size={16}/><input aria-label="上传剧本" type="file" accept=".txt,.docx,.pdf" onChange={event=>{const file=event.target.files?.[0];if(file)onUpload(file);event.target.value='';}}/></label><button className="icon-command" aria-label="新建剧本" title="新建剧本" onClick={onCreate}><Plus size={16}/></button></div></header>
    <div className="script-list-items">{items.map(item=><button key={item.id} className={`script-list-item${item.id===selectedId?' active':''}`} onClick={()=>onSelect(item.id)}><FileText size={15}/><span><strong>{item.title}</strong><small>{item.revision_count} 个版本 · {item.status==='ready'?'已就绪':'草稿'}</small></span></button>)}</div>
  </aside>;
}
