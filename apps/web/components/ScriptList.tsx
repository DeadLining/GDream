import {FileText, Trash2, Upload} from 'lucide-react';
import type {ScriptRevision} from '../lib/types';

const creationMethodLabels: Record<string,string>={
  upload:'上传',
  ai:'AI 生成',
  manual:'手动编辑',
  edit:'手动编辑',
  paste:'粘贴导入',
  restore:'版本恢复',
};

const formatDate=(value:string)=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));

export function ScriptList({items,currentRevisionId,selectedRevisionId,onSelect,onDelete,onUpload}:{items:ScriptRevision[];currentRevisionId:string|null;selectedRevisionId:string|null;onSelect:(revision:ScriptRevision)=>void;onDelete:(revision:ScriptRevision)=>void;onUpload:(file:File)=>void}){
  return <aside className="script-library-list" aria-label="剧本版本">
    <header>
      <div><h2>版本</h2><span>{items.length}</span></div>
      <label className="icon-command" title="上传新版本"><Upload size={16}/><input aria-label="上传新版本" type="file" accept=".txt,.docx,.pdf" onChange={event=>{const file=event.target.files?.[0];if(file)onUpload(file);event.target.value='';}}/></label>
    </header>
    <div className="script-list-items">
      {items.map(item=>{
        const current=item.id===currentRevisionId;
        const selected=item.id===selectedRevisionId;
        return <div key={item.id} className={`script-list-item${selected?' selected':''}${current?' current':''}`}>
          <button type="button" className="script-version-select" aria-label={`查看版本 ${item.revision_number}`} aria-pressed={selected} onClick={()=>onSelect(item)}>
            <span className="script-version-icon"><FileText size={15}/></span>
            <span className="script-version-copy">
              <span className="script-version-title"><strong>V{item.revision_number}</strong>{current&&<em>当前</em>}</span>
              <small>{item.status==='finalized'?'已定稿':'工作草稿'} · {creationMethodLabels[item.creation_method]??item.creation_method}</small>
              <small>{item.content.length.toLocaleString()} 字 · {formatDate(item.created_at)}</small>
            </span>
          </button>
          <button type="button" className="script-version-delete" aria-label={`从版本列表删除版本 ${item.revision_number}`} title={current?'当前版本不能删除':`删除 V${item.revision_number}`} disabled={current} onClick={()=>onDelete(item)}><Trash2 size={14}/></button>
        </div>;
      })}
    </div>
  </aside>;
}
