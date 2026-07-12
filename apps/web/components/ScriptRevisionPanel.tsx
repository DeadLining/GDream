import {X} from 'lucide-react';
import type {ScriptRevision} from '../lib/types';

export function ScriptRevisionPanel({items,onRestore,onClose}:{items:ScriptRevision[];onRestore:(id:string)=>void;onClose:()=>void}){return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true" aria-label="版本历史"><header><h2>版本历史</h2><button aria-label="关闭版本历史" onClick={onClose}><X size={18}/></button></header><div className="script-revision-list">{items.map(item=><article key={item.id}><div><strong>版本 {item.revision_number}</strong><small>{item.status==='finalized'?'已定稿':'编辑中'} · {item.content.length} 字</small></div><button aria-label={`恢复版本 ${item.revision_number}`} onClick={()=>onRestore(item.id)}>恢复</button></article>)}</div></section></div>;}
