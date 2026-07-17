'use client';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {CheckCircle2,Link2,MessageCircle,Plus,Search} from 'lucide-react';
import {createProductionTask,listProductionTasks,updateProductionTask} from '../lib/api';
import type {EpisodeDetail,ProductionTask,ProductionTaskPatch,ProjectDetail} from '../lib/types';

const priorityLabel={low:'低',medium:'中',high:'高',critical:'紧急'} as const;
const statusLabel={todo:'待处理',in_progress:'进行中',review:'待审核',completed:'已完成',cancelled:'已取消'} as const;
const statuses=Object.keys(statusLabel) as ProductionTask['status'][];
type TaskView='list'|'board'|'timeline';
type TaskScope='project'|'episode'|'scene'|'shot';

export function TaskCenter({project,episode,onOpenTarget}:{project:ProjectDetail|null;episode:EpisodeDetail|null;onOpenTarget?:(task:ProductionTask)=>void}){
  const [tasks,setTasks]=useState<ProductionTask[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [creating,setCreating]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [view,setView]=useState<TaskView>('list');
  const [assigneeFilter,setAssigneeFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [createScope,setCreateScope]=useState<TaskScope>(episode?'episode':'project');
  const [createSceneId,setCreateSceneId]=useState(episode?.scenes[0]?.id??'');
  const [createShotId,setCreateShotId]=useState(episode?.scenes[0]?.shots[0]?.id??'');

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
  const assignees=useMemo(()=>Array.from(new Set(tasks.map(task=>task.assignee).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'zh-CN')),[tasks]);
  const filteredTasks=useMemo(()=>tasks.filter(task=>{
    const term=query.trim().toLocaleLowerCase();
    const matchesTerm=!term||[task.id,task.title,task.description,task.assignee].some(value=>value.toLocaleLowerCase().includes(term));
    return matchesTerm&&(!assigneeFilter||task.assignee===assigneeFilter)&&(!statusFilter||task.status===statusFilter);
  }),[tasks,query,assigneeFilter,statusFilter]);

  const updateSelected=async(patch:ProductionTaskPatch)=>{
    if(!selected||saving)return;
    setSaving(true);setError('');
    try{const updated=await updateProductionTask(selected.id,patch);setTasks(items=>items.map(item=>item.id===updated.id?updated:item));}
    catch(cause){setError(cause instanceof Error?cause.message:'任务更新失败');}
    finally{setSaving(false);}
  };
  const createTask=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!project||creating)return;
    const form=new FormData(event.currentTarget);
    const dueAt=String(form.get('due_at')??'');
    const checklist=String(form.get('checklist')??'').split('\n').map(label=>label.trim()).filter(Boolean).map(label=>({label,done:false}));
    const sceneId=['scene','shot'].includes(createScope)?createSceneId:null;
    const shotId=createScope==='shot'?createShotId:null;
    setCreating(true);setError('');
    try{
      const created=await createProductionTask(project.id,{title:String(form.get('title')).trim(),description:String(form.get('description')).trim(),priority:String(form.get('priority')) as ProductionTask['priority'],assignee:String(form.get('assignee')).trim(),due_at:dueAt?new Date(dueAt).toISOString():null,episode_id:createScope==='project'?null:episode?.id??null,scene_id:sceneId||null,shot_id:shotId||null,review_thread_id:null,checklist});
      setTasks(items=>[created,...items]);setSelectedId(created.id);setCreateOpen(false);
    }catch(cause){setError(cause instanceof Error?cause.message:'任务创建失败');}
    finally{setCreating(false);}
  };
  const sceneForCreate=episode?.scenes.find(scene=>scene.id===createSceneId)??episode?.scenes[0]??null;
  const taskScope=(task:ProductionTask)=>{
    if(!task.episode_id)return '当前作品';
    const episodeTitle=project?.episodes.find(item=>item.id===task.episode_id)?.title??(task.episode_id===episode?.id?episode.title:'其他剧集');
    const scene=task.scene_id&&task.episode_id===episode?.id?episode.scenes.find(item=>item.id===task.scene_id):null;
    const shot=task.shot_id&&scene?scene.shots.find(item=>item.id===task.shot_id):null;
    return [episodeTitle,task.scene_id?(scene?.location??'场景'):'',task.shot_id?(shot?`镜头 ${String(shot.position).padStart(2,'0')}`:'镜头'):''].filter(Boolean).join(' → ');
  };
  const openTargetLabel=selected?.review_thread_id?'打开关联审阅':selected?.shot_id?'打开关联镜头':selected?.scene_id?'打开关联场景':selected?.episode_id?'打开关联剧集':'';
  const taskButton=(task:ProductionTask)=><button key={task.id} className={task.id===selected?.id?'selected':''} onClick={()=>setSelectedId(task.id)}><strong>{task.title}</strong><small>{taskScope(task)} · {task.assignee||'未分配'}</small></button>;

  let content=null;
  if(loading)content=<p>正在加载任务…</p>;
  else if(tasks.length===0)content=<p>当前作品暂无任务。</p>;
  else if(filteredTasks.length===0)content=<p>没有匹配的任务。</p>;
  else if(view==='list')content=<table className="operations-table"><thead><tr><th>优先级</th><th>任务</th><th>范围</th><th>执行人</th><th>状态</th><th>到期时间</th></tr></thead><tbody>{filteredTasks.map(task=><tr key={task.id} className={task.id===selected?.id?'selected':''} onClick={()=>setSelectedId(task.id)}><td><span className={`priority priority-${task.priority==='critical'?'high':task.priority}`}>{priorityLabel[task.priority]}</span></td><td><strong>{task.title}</strong></td><td>{taskScope(task)}</td><td>{task.assignee||'未分配'}</td><td><span className={`status-chip ${task.status==='completed'?'status-approved':'status-running'}`}>{statusLabel[task.status]}</span></td><td>{task.due_at?new Date(task.due_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未设置'}</td></tr>)}</tbody></table>;
  else if(view==='board')content=<div className="task-board">{statuses.map(status=><section key={status}><h2>{statusLabel[status]}</h2><span>{filteredTasks.filter(task=>task.status===status).length}</span>{filteredTasks.filter(task=>task.status===status).map(taskButton)}</section>)}</div>;
  else content=<div className="task-timeline">{[...filteredTasks].sort((a,b)=>(a.due_at??'9999').localeCompare(b.due_at??'9999')).map(task=><article key={task.id} className={task.id===selected?.id?'selected':''}><time>{task.due_at?new Date(task.due_at).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):'未设置'}</time>{taskButton(task)}</article>)}</div>;

  return <main className="operations-page task-center-page"><header className="operations-page-header"><div><h1>任务中心</h1><p>把制作任务与作品层级、资产状态和审阅意见放在同一处。</p></div><div className="header-actions"><div className="segmented" aria-label="任务视图">{([['list','列表'],['board','看板'],['timeline','时间线']] as Array<[TaskView,string]>).map(([value,label])=><button key={value} className={view===value?'active':''} aria-pressed={view===value} onClick={()=>setView(value)}>{label}</button>)}</div><button className="command-button" onClick={()=>setCreateOpen(true)}><Plus size={16}/>新建任务</button></div></header><div className="task-layout"><section><div className="operations-filterbar"><label><Search size={15}/><input aria-label="搜索任务" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索任务标题、编号"/></label><select aria-label="执行人" value={assigneeFilter} onChange={event=>setAssigneeFilter(event.target.value)}><option value="">执行人：全部</option>{assignees.map(assignee=><option key={assignee} value={assignee}>{assignee}</option>)}</select><select aria-label="任务状态筛选" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">状态：全部</option>{statuses.map(status=><option key={status} value={status}>{statusLabel[status]}</option>)}</select></div><p className="hierarchy-note">作品 → 卷/篇章 → 集 → 场景 → 镜头</p>{error&&<p className="warning-box" role="alert">{error}</p>}{content}</section><aside className="operations-inspector">{selected?<><h2>{selected.title}</h2>{selected.description&&<p>{selected.description}</p>}<dl><div><dt>状态</dt><dd><select aria-label="任务状态" value={selected.status} disabled={saving} onChange={event=>void updateSelected({status:event.target.value as ProductionTask['status']})}>{statuses.map(status=><option key={status} value={status}>{statusLabel[status]}</option>)}</select></dd></div><div><dt>优先级</dt><dd>{priorityLabel[selected.priority]}</dd></div><div><dt>范围</dt><dd>{project?.title??'当前作品'} → {taskScope(selected)}</dd></div></dl><h3>清单（{selected.checklist.filter(item=>item.done).length}/{selected.checklist.length}）</h3>{selected.checklist.length?selected.checklist.map((item,index)=><label key={`${item.label}-${index}`}><input type="checkbox" checked={item.done} disabled={saving} onChange={()=>void updateSelected({checklist:selected.checklist.map((entry,entryIndex)=>entryIndex===index?{...entry,done:!entry.done}:entry)})}/>{item.label}</label>):<p>没有清单项。</p>}<h3><Link2 size={14}/>关联范围</h3><div className="linked-flow"><span>{selected.scene_id?'关联场景':selected.episode_id?'当前单集':'当前作品'}</span><b>→</b><span>{selected.shot_id?'关联镜头':'全部镜头'}</span><b>→</b><span>制作任务</span></div>{openTargetLabel&&onOpenTarget&&<button className="command-button" onClick={()=>onOpenTarget(selected)}>{openTargetLabel}</button>}<h3><MessageCircle size={14}/>关联视觉审阅</h3><div className="review-annotation-mini"><i/>{selected.review_thread_id?'已关联视觉审阅意见':'暂无关联审阅意见'}</div><button className="command-button" aria-label="标记完成" disabled={saving||selected.status==='completed'} onClick={()=>void updateSelected({status:'completed'})}><CheckCircle2 size={16}/>{saving?'保存中…':'标记完成'}</button></>:<p>选择任务后查看详情。</p>}</aside></div>{createOpen&&<div className="dialog-backdrop"><form className="form-dialog" role="dialog" aria-label="新建任务" onSubmit={createTask}><header><h2>新建任务</h2><button type="button" aria-label="关闭" onClick={()=>setCreateOpen(false)}>×</button></header><label>任务标题<input aria-label="任务标题" name="title" required/></label><label>任务说明<textarea aria-label="任务说明" name="description" rows={3}/></label><label>执行人<input aria-label="执行人" name="assignee" required/></label><label>优先级<select aria-label="优先级" name="priority" defaultValue="medium"><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">紧急</option></select></label><label>任务范围<select aria-label="任务范围" value={createScope} onChange={event=>setCreateScope(event.target.value as TaskScope)}><option value="project">当前作品</option>{episode&&<option value="episode">当前剧集</option>}{episode?.scenes.length&&<option value="scene">场景</option>}{episode?.scenes.some(scene=>scene.shots.length)&&<option value="shot">镜头</option>}</select></label>{['scene','shot'].includes(createScope)&&<label>场景<select aria-label="关联场景" value={createSceneId} onChange={event=>{setCreateSceneId(event.target.value);setCreateShotId(episode?.scenes.find(scene=>scene.id===event.target.value)?.shots[0]?.id??'');}}>{episode?.scenes.map(scene=><option key={scene.id} value={scene.id}>{scene.location}</option>)}</select></label>}{createScope==='shot'&&<label>镜头<select aria-label="关联镜头" value={createShotId} onChange={event=>setCreateShotId(event.target.value)}>{sceneForCreate?.shots.map(shot=><option key={shot.id} value={shot.id}>镜头 {String(shot.position).padStart(2,'0')}</option>)}</select></label>}<label>到期时间<input aria-label="到期时间" name="due_at" type="datetime-local"/></label><label>初始清单<textarea aria-label="初始清单" name="checklist" rows={3} placeholder="每行一个检查项"/></label><footer><button type="button" onClick={()=>setCreateOpen(false)}>取消</button><button className="primary-action" aria-label="创建任务" disabled={creating}>{creating?'创建中…':'创建任务'}</button></footer></form></div>}</main>;
}
