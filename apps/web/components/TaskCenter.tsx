'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {CheckCircle2,Link2,MessageCircle,Plus,Search} from 'lucide-react';
import {createProductionTask,listProductionTasks,updateProductionTask} from '../lib/api';
import type {EpisodeDetail,ProductionTask,ProjectDetail} from '../lib/types';

const priorityLabel={low:'低',medium:'中',high:'高',critical:'紧急'} as const;
const statusLabel={todo:'待处理',in_progress:'进行中',review:'待审核',completed:'已完成',cancelled:'已取消'} as const;

export function TaskCenter({project,episode}:{project:ProjectDetail|null;episode:EpisodeDetail|null}){
  const [tasks,setTasks]=useState<ProductionTask[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [creating,setCreating]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [query,setQuery]=useState('');

  useEffect(()=>{
    if(!project?.id){setTasks([]);setLoading(false);return;}
    let active=true;
    setLoading(true);setError('');
    listProductionTasks(project.id).then(items=>{
      if(!active)return;
      setTasks(items);setSelectedId(current=>items.some(item=>item.id===current)?current:(items[0]?.id??''));
    }).catch(cause=>active&&setError(cause instanceof Error?cause.message:'任务加载失败')).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[project?.id]);

  const selected=tasks.find(task=>task.id===selectedId)??tasks[0]??null;
  const filteredTasks=tasks.filter(task=>{const term=query.trim().toLocaleLowerCase();return !term||task.title.toLocaleLowerCase().includes(term)||task.description.toLocaleLowerCase().includes(term)||task.assignee.toLocaleLowerCase().includes(term);});
  const completeSelected=async()=>{
    if(!selected||selected.status==='completed')return;
    setSaving(true);setError('');
    try{const updated=await updateProductionTask(selected.id,{status:'completed'});setTasks(items=>items.map(item=>item.id===updated.id?updated:item));}
    catch(cause){setError(cause instanceof Error?cause.message:'任务更新失败');}
    finally{setSaving(false);}
  };
  const createTask=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!project||creating)return;
    const form=new FormData(event.currentTarget);setCreating(true);setError('');
    try{const created=await createProductionTask(project.id,{title:String(form.get('title')).trim(),description:String(form.get('description')).trim(),priority:String(form.get('priority')) as ProductionTask['priority'],assignee:String(form.get('assignee')).trim(),due_at:null,episode_id:episode?.id??null,scene_id:null,shot_id:null,review_thread_id:null,checklist:[]});setTasks(items=>[created,...items]);setSelectedId(created.id);setCreateOpen(false);}catch(cause){setError(cause instanceof Error?cause.message:'任务创建失败');}finally{setCreating(false);}
  };
  const scope=(task:ProductionTask)=>[episode?.title??'当前单集',task.scene_id?'场景':'',task.shot_id?'镜头':''].filter(Boolean).join(' → ');
  return <main className="operations-page task-center-page"><header className="operations-page-header"><div><h1>任务中心</h1><p>把制作任务与作品层级、资产状态和审阅意见放在同一处。</p></div><div className="header-actions"><div className="segmented"><button className="active">列表</button><button>看板</button><button>时间线</button></div><button className="command-button" onClick={()=>setCreateOpen(true)}><Plus size={16}/>新建任务</button></div></header><div className="task-layout"><section><div className="operations-filterbar"><label><Search size={15}/><input aria-label="搜索任务" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索任务标题、编号"/></label><select aria-label="执行人"><option>执行人：全部</option></select><select aria-label="项目"><option>项目：{project?.title??'全部'}</option></select></div><p className="hierarchy-note">作品 → 卷/篇章 → 集 → 场景 → 镜头</p>{error&&<p className="warning-box" role="alert">{error}</p>}{loading?<p>正在加载任务…</p>:tasks.length===0?<p>当前作品暂无任务。</p>:filteredTasks.length===0?<p>没有匹配的任务。</p>:<table className="operations-table"><thead><tr><th>优先级</th><th>任务</th><th>范围</th><th>执行人</th><th>状态</th><th>到期时间</th></tr></thead><tbody>{filteredTasks.map(task=><tr key={task.id} className={task.id===selected?.id?'selected':''} onClick={()=>setSelectedId(task.id)}><td><span className={`priority priority-${task.priority==='critical'?'high':task.priority}`}>{priorityLabel[task.priority]}</span></td><td><strong>{task.title}</strong></td><td>{scope(task)}</td><td>{task.assignee||'未分配'}</td><td><span className={`status-chip ${task.status==='completed'?'status-approved':'status-running'}`}>{statusLabel[task.status]}</span></td><td>{task.due_at?new Date(task.due_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未设置'}</td></tr>)}</tbody></table>}</section><aside className="operations-inspector">{selected?<><h2>{selected.title}</h2><dl><div><dt>状态</dt><dd>{statusLabel[selected.status]}</dd></div><div><dt>优先级</dt><dd>{priorityLabel[selected.priority]}</dd></div><div><dt>范围</dt><dd>{project?.title??'当前作品'} → {scope(selected)}</dd></div></dl><h3>清单（{selected.checklist.filter(item=>item.done).length}/{selected.checklist.length}）</h3>{selected.checklist.map(item=><label key={item.label}><input type="checkbox" checked={item.done} readOnly/>{item.label}</label>)}<h3><Link2 size={14}/>关联资产</h3><div className="linked-flow"><span>{selected.scene_id?'关联场景':'当前单集'}</span><b>→</b><span>{selected.shot_id?'关联镜头':'全部镜头'}</span><b>→</b><span>制作任务</span></div><h3><MessageCircle size={14}/>关联视觉审阅</h3><div className="review-annotation-mini"><i/>{selected.review_thread_id?'已关联视觉审阅意见':'暂无关联审阅意见'}</div><button className="command-button" aria-label="标记完成" disabled={saving||selected.status==='completed'} onClick={completeSelected}><CheckCircle2 size={16}/>{saving?'保存中…':'标记完成'}</button></>:<p>选择任务后查看详情。</p>}</aside></div>{createOpen&&<div className="dialog-backdrop"><form className="form-dialog" role="dialog" aria-label="新建任务" onSubmit={createTask}><header><h2>新建任务</h2><button type="button" aria-label="关闭" onClick={()=>setCreateOpen(false)}>×</button></header><label>任务标题<input aria-label="任务标题" name="title" required/></label><label>任务说明<textarea aria-label="任务说明" name="description" rows={3}/></label><label>执行人<input aria-label="执行人" name="assignee" required/></label><label>优先级<select aria-label="优先级" name="priority" defaultValue="medium"><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">紧急</option></select></label><footer><button type="button" onClick={()=>setCreateOpen(false)}>取消</button><button className="primary-action" aria-label="创建任务" disabled={creating}>{creating?'创建中…':'创建任务'}</button></footer></form></div>}</main>;
}
