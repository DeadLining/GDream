import type {ReactNode} from 'react';
import {Archive, Clock3, FolderKanban, PackageCheck, Trash2} from 'lucide-react';

export function OperationsLayout({active,children,onNavigate}:{active:'recent'|'projects'|'archive'|'trash'|'export';children:ReactNode;onNavigate?:(value:string)=>void}){
  const items=[['recent','最近访问',Clock3],['projects','我的作品',FolderKanban],['archive','已归档',Archive],['trash','回收站',Trash2],['export','导出交付',PackageCheck]] as const;
  return <main className="operations-layout">
    <aside className="operations-sidebar" aria-label="工作台导航">
      {items.map(([value,label,Icon])=><button key={value} aria-label={label} className={active===value?'active':''} aria-current={active===value?'page':undefined} onClick={()=>onNavigate?.(value)}><Icon aria-hidden="true" size={16}/><span>{label}</span></button>)}
    </aside>
    <section className="operations-content">{children}</section>
  </main>;
}
