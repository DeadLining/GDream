'use client';
import {useEffect,useState} from 'react';
import {AlertTriangle,GitBranch,RotateCcw,Trash2} from 'lucide-react';
import {listTrashItems,permanentlyDeleteTrashItem,restoreTrashItem} from '../lib/api';
import type {ProjectDetail,TrashItem} from '../lib/types';
import {OperationsLayout} from './OperationsLayout';

const typeLabel:Record<TrashItem['resource_type'],string>={asset_variant:'角色资产变体',asset_variant_state:'状态'};

export function RecycleBin({project}:{project:ProjectDetail|null}){
  const [items,setItems]=useState<TrashItem[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!project?.id){setItems([]);setLoading(false);return;}
    let active=true;setLoading(true);setError('');
    listTrashItems(project.id).then(next=>{if(active){setItems(next);setSelectedId(next[0]?.id??'');}}).catch(cause=>active&&setError(cause instanceof Error?cause.message:'回收站加载失败')).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[project?.id]);
  const selected=items.find(item=>item.id===selectedId)??items[0]??null;
  const removeItem=(id:string)=>{setItems(current=>{const next=current.filter(item=>item.id!==id);setSelectedId(next[0]?.id??'');return next;});};
  const restore=async(item:TrashItem)=>{setBusyId(item.id);setError('');try{await restoreTrashItem(item.id);removeItem(item.id);}catch(cause){setError(cause instanceof Error?cause.message:'恢复失败');}finally{setBusyId('');}};
  const purge=async(item:TrashItem)=>{if(!item.can_permanently_delete)return;setBusyId(item.id);setError('');try{await permanentlyDeleteTrashItem(item.id);removeItem(item.id);}catch(cause){setError(cause instanceof Error?cause.message:'永久删除失败');}finally{setBusyId('');}};
  const remainingDays=(item:TrashItem)=>Math.max(0,Math.ceil((new Date(item.expires_at).getTime()-Date.now())/86400000));
  return <OperationsLayout active="trash"><div className="operations-page recycle-page"><header className="operations-page-header"><div><h1>回收站</h1><p>删除内容保留 30 天，恢复时保持原继承与引用关系。</p></div></header>{error&&<p className="warning-box" role="alert">{error}</p>}<div className="recycle-layout"><section><div className="operations-filterbar"><select aria-label="内容类型"><option>内容类型：全部</option></select><select aria-label="所属项目"><option>所属项目：{project?.title??'全部'}</option></select></div>{loading?<p>正在加载回收站…</p>:items.length===0?<p>回收站为空。</p>:<table className="operations-table"><thead><tr><th>物品</th><th>类型</th><th>原始位置</th><th>依赖影响</th><th>删除者</th><th>过期时间</th><th>操作</th></tr></thead><tbody>{items.map(item=><tr key={item.id} className={item.id===selected?.id?'selected':''} aria-label={`${item.name} ${typeLabel[item.resource_type]} ${item.reference_count?`仍被 ${item.reference_count} 镜头引用`:'无引用'}`} onClick={()=>setSelectedId(item.id)}><td><strong>{item.name}</strong></td><td>{typeLabel[item.resource_type]}</td><td>{item.original_location.join(' → ')}</td><td className={item.reference_count?'warning-text':'success-text'}>{item.reference_count?<><AlertTriangle size={13}/> 仍被 {item.reference_count} 镜头引用</>:'无引用'}</td><td>{item.deleted_by}</td><td>剩余 {remainingDays(item)} 天</td><td><button aria-label={`恢复${item.name}`} disabled={busyId===item.id} onClick={event=>{event.stopPropagation();void restore(item);}}>恢复</button><button aria-label={`永久删除${item.name}`} disabled={!item.can_permanently_delete||busyId===item.id} onClick={event=>{event.stopPropagation();void purge(item);}}>删除</button></td></tr>)}</tbody></table>}</section><aside className="operations-inspector">{selected?<><h2>{selected.name}</h2><div className="asset-preview-placeholder">{typeLabel[selected.resource_type]}</div><h3><GitBranch size={14}/>删除前的血缘关系</h3><p>{selected.lineage.join(' → ')}</p><h3>下游镜头引用（{selected.reference_count}）</h3><p className={selected.reference_count?'warning-box':'success-text'}>{selected.reference_count?'恢复后将重新连接原有镜头引用。引用未解除前不可永久删除。':'当前没有下游引用，可以永久删除。'}</p><button className="command-button" disabled={busyId===selected.id} onClick={()=>void restore(selected)}><RotateCcw size={16}/>{busyId===selected.id?'处理中…':'恢复并重连引用'}</button><button className="danger-outline" disabled={!selected.can_permanently_delete||busyId===selected.id} onClick={()=>void purge(selected)}><Trash2 size={16}/>永久删除</button></>:<p>选择回收项后查看影响范围。</p>}</aside></div></div></OperationsLayout>;
}
