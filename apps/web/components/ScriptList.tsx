import {FileText, Plus} from 'lucide-react';
import type {ScriptDocumentSummary} from '../lib/types';

export function ScriptList({items,selectedId,onSelect,onCreate}:{items:ScriptDocumentSummary[];selectedId:string|null;onSelect:(id:string)=>void;onCreate:()=>void}){
  return <aside className="script-library-list" aria-label="剧本列表">
    <header><h2>剧本</h2><button className="icon-command" aria-label="新建剧本" title="新建剧本" onClick={onCreate}><Plus size={16}/></button></header>
    <div className="script-list-items">{items.map(item=><button key={item.id} className={`script-list-item${item.id===selectedId?' active':''}`} onClick={()=>onSelect(item.id)}><FileText size={15}/><span><strong>{item.title}</strong><small>{item.revision_count} 个版本 · {item.status==='ready'?'已就绪':'草稿'}</small></span></button>)}</div>
  </aside>;
}
