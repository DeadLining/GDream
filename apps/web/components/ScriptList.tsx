import {Upload} from 'lucide-react';
import type {ScriptRevision} from '../lib/types';

const creationMethodLabels: Record<string,string>={
  upload:'上传',
  ai:'AI 生成',
  manual:'手动编辑',
  paste:'粘贴导入',
  restore:'版本恢复',
};

export function ScriptList({items,currentRevisionId,onUpload}:{items:ScriptRevision[];currentRevisionId:string|null;onUpload:(file:File)=>void}){
  return <aside className="script-library-list" aria-label="剧本版本">
    <header><h2>版本</h2><div><label className="icon-command" title="上传新版本"><Upload size={16}/><input aria-label="上传新版本" type="file" accept=".txt,.docx,.pdf" onChange={event=>{const file=event.target.files?.[0];if(file)onUpload(file);event.target.value='';}}/></label></div></header>
    <div className="script-list-items">{items.map(item=><div key={item.id} className={`script-list-item${item.id===currentRevisionId?' active':''}`}><span><strong>V{item.revision_number}</strong><small>{item.status==='finalized'?'正式版本':'工作草稿'} · {creationMethodLabels[item.creation_method]??item.creation_method}</small></span></div>)}</div>
  </aside>;
}
