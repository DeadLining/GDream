'use client';

import type {DirectorRevision} from '../../lib/types';

const reasonLabel=(reason:string)=>({manual_save:'手动保存',shot_apply:'应用导演建议'}[reason]??reason);
const versionOf=(revision:DirectorRevision)=>typeof revision.stage_snapshot.version==='number'?revision.stage_snapshot.version:'—';

export function DirectorRevisionDialog({revisions,loading,restoringId,onClose,onRestore}:{revisions:DirectorRevision[];loading:boolean;restoringId:string|null;onClose:()=>void;onRestore:(revision:DirectorRevision)=>void}){
  return <div className="director-dialog-backdrop"><section className="director-revision-dialog" role="dialog" aria-label="导演台修订历史" aria-modal="true">
    <header><div><strong>导演台修订历史</strong><span>恢复会创建一个新版本，不覆盖历史记录</span></div><button type="button" className="icon-button" aria-label="关闭修订历史" onClick={onClose}>×</button></header>
    <div className="director-revision-list">{loading?<p>正在加载修订历史</p>:revisions.length?[...revisions].reverse().map(revision=>{
      const version=versionOf(revision);
      return <article key={revision.id}><div><strong>版本 {version}</strong><span>{reasonLabel(revision.reason)} · {new Date(revision.created_at).toLocaleString('zh-CN')}</span></div><button type="button" className="command-button" aria-label={`恢复版本 ${version}`} disabled={Boolean(restoringId)} onClick={()=>onRestore(revision)}>{restoringId===revision.id?'恢复中':'恢复'}</button></article>;
    }):<p>还没有可恢复的修订</p>}</div>
    <footer><button type="button" className="command-button" onClick={onClose}>关闭</button></footer>
  </section></div>;
}
