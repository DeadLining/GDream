'use client';
import {useEffect,useState} from 'react';
import {CirclePlus,Clapperboard,Clock3,Layers3,MoreVertical,Play,Search} from 'lucide-react';
import {getWorkspaceSummary} from '../lib/api';
import type {Project,ProjectDetail,WorkspaceSummary} from '../lib/types';
import {OperationsLayout} from './OperationsLayout';

export function WorkspaceHome({projects,selectedProject,onOpenProject,onCreateProject,onNavigate}:{projects:Project[];selectedProject:ProjectDetail|null;onOpenProject:(id:string)=>void;onCreateProject:()=>void;onNavigate?:(value:string)=>void}){
  const [summary,setSummary]=useState<WorkspaceSummary|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;getWorkspaceSummary().then(value=>active&&setSummary(value)).catch(cause=>active&&setError(cause instanceof Error?cause.message:'工作台统计加载失败'));return()=>{active=false;};},[]);
  const selectedId=selectedProject?.id??projects[0]?.id;
  const selectedSummary=summary?.projects.find(item=>item.project_id===selectedId)??null;
  return <OperationsLayout active="recent" onNavigate={onNavigate}><div className="operations-page workspace-home-page">
    <header className="operations-page-header"><div><h1>工作台</h1><p>跨作品查看制作进度、审核和下一步任务。</p></div><button className="command-button" onClick={onCreateProject}><CirclePlus size={16}/>新建作品</button></header>
    {error&&<p className="warning-box" role="alert">{error}</p>}
    <div className="operations-metrics"><div><Clapperboard size={18}/><span>进行中作品</span><strong>{summary?.active_project_count??projects.length}</strong></div><div><Clock3 size={18}/><span>今日待审核</span><strong>{summary?.pending_review_count??0}</strong></div><div><Layers3 size={18}/><span>生成任务</span><strong>{summary?.active_task_count??0}</strong></div><div><Search size={18}/><span>最近更新</span><strong>{summary?`${summary.updated_today_count} 个作品`:'加载中'}</strong></div></div>
    <div className="workspace-home-grid"><section className="operations-table-wrap"><table className="operations-table"><thead><tr><th>作品</th><th>规模</th><th>当前阶段</th><th>完成度</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{projects.map(item=>{const row=summary?.projects.find(value=>value.project_id===item.id);const completion=row?.completion_percent??0;return <tr key={item.id} className={item.id===selectedId?'selected':''}><td><button className="project-cell" onClick={()=>onOpenProject(item.id)}><span className="project-cover"><Clapperboard size={20}/></span><span><strong>{item.title}</strong><small>{item.logline}</small></span></button></td><td>{row?`${row.volume_count}卷 · ${row.episode_count}集 · ${row.scene_count}场景 · ${row.shot_count}镜头`:'统计加载中'}</td><td>{row?.current_stage??'项目初始化'}</td><td><span className="table-progress"><i style={{width:`${completion}%`}}/>{completion}%</span></td><td><span className="status-chip status-running">{row?.open_task_count?'制作中':'待安排'}</span></td><td><button className="icon-button" aria-label={`${item.title}更多操作`}><MoreVertical size={15}/></button></td></tr>;})}</tbody></table></section>
      <aside className="operations-inspector"><h2>{selectedProject?.title??'选择作品'}</h2><div className="project-hero"><Clapperboard size={30}/></div><p>{selectedProject?.logline??'从作品列表选择一个项目。'}</p><dl><div><dt>当前单集</dt><dd>{selectedProject?.episodes[0]?.title??'尚未创建'}</dd></div><div><dt>制作流程</dt><dd>剧本 → 分镜 → 画面 → 视频 → 审核</dd></div></dl><div className="operations-next"><h3>接下来 {selectedSummary?.latest_task_titles.length??0} 个任务</h3>{selectedSummary?.latest_task_titles.length?selectedSummary.latest_task_titles.map(title=><p key={title}>{title}</p>):<p>当前没有待办任务</p>}</div><button className="command-button" disabled={!selectedProject} onClick={()=>selectedProject&&onOpenProject(selectedProject.id)}><Play size={16}/>进入单集制作</button></aside>
    </div>
  </div></OperationsLayout>;
}
