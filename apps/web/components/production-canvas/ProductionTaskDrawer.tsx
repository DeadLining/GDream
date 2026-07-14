import {RefreshCw,X} from 'lucide-react';
import type {ProductionItem,ProductionRun} from '../../lib/types';
import {ProductionItemRow} from '../ProductionItemRow';

export function ProductionTaskDrawer({open,run,items,filter,onFilter,selected,onSelect,onRetry,onOpenItem,onClose}:{open:boolean;run:ProductionRun|null;items:ProductionItem[];filter:string;onFilter:(value:string)=>void;selected:string[];onSelect:(id:string,checked:boolean)=>void;onRetry:()=>void;onOpenItem:(id:string)=>void;onClose:()=>void}){
  if(!open||!run)return null;
  const visible=items.filter(item=>filter==='all'||(filter==='completed'?['succeeded','skipped'].includes(item.status):item.status===filter));
  const filters=[{value:'all',label:'全部'},{value:'running',label:'进行中'},{value:'failed',label:'失败'},{value:'completed',label:'已完成'}];
  return <aside className="production-task-drawer" aria-label="生产任务抽屉">
    <header><div><small>执行明细</small><h2>任务队列</h2></div><button aria-label="关闭任务队列" onClick={onClose}><X size={17}/></button></header>
    <div className="production-task-summary"><span>共 {run.total_items} 项</span><progress max={run.total_items||1} value={run.succeeded_items+run.failed_items+run.skipped_items}/><div><span>成功 {run.succeeded_items}</span><span>失败 {run.failed_items}</span><span>跳过 {run.skipped_items}</span></div></div>
    <nav className="production-filters" aria-label="生产队列筛选">{filters.map(({value,label})=><button key={value} className={filter===value?'active':''} aria-pressed={filter===value} onClick={()=>onFilter(value)}>{label}</button>)}</nav>
    <div className="production-items">{visible.map(item=><ProductionItemRow key={item.id} item={item} selected={selected.includes(item.id)} onSelect={checked=>onSelect(item.id,checked)} onOpen={()=>onOpenItem(item.target_id)}/>)}</div>
    {run.failed_items>0&&<footer><button onClick={onRetry} disabled={!selected.length}><RefreshCw size={15}/>重试选中失败项</button></footer>}
  </aside>;
}
