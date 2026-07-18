'use client';
import {useEffect,useState} from 'react';
import {CirclePlus,Clapperboard,Clock3,Layers3,Play,Search,Trash2} from 'lucide-react';
import {getWorkspaceSummary,previewProjectDeletion} from '../lib/api';
import {orderRecentlyAccessedProjects} from '../lib/recent-projects';
import type {Project,ProjectDeletionPreview,ProjectDeletionResult,ProjectDetail,WorkspaceSummary} from '../lib/types';
import {DeleteProjectDialog} from './DeleteProjectDialog';
import {OperationsLayout} from './OperationsLayout';

export function WorkspaceHome({projects,selectedProject,onOpenProject,onCreateProject,onDeleteProject,onNavigate}:{projects:Project[];selectedProject:ProjectDetail|null;onOpenProject:(id:string)=>void;onCreateProject:()=>void;onDeleteProject?:(id:string)=>Promise<ProjectDeletionResult>;onNavigate?:(value:string)=>void}){
  const [summary,setSummary]=useState<WorkspaceSummary|null>(null);
  const [error,setError]=useState('');
  const [view,setView]=useState<'recent'|'projects'>('recent');
  const [deletingProject,setDeletingProject]=useState<Project|null>(null);
  const [deletionPreview,setDeletionPreview]=useState<ProjectDeletionPreview|null>(null);
  const [deletionBusy,setDeletionBusy]=useState(false);
  const [deletionError,setDeletionError]=useState('');
  const [deletionWarnings,setDeletionWarnings]=useState<string[]>([]);
  useEffect(()=>{let active=true;getWorkspaceSummary().then(value=>active&&setSummary(value)).catch(cause=>active&&setError(cause instanceof Error?cause.message:'工作台统计加载失败'));return()=>{active=false;};},[]);
  const visibleProjects=view==='recent'?orderRecentlyAccessedProjects(projects):projects;
  const selectedId=visibleProjects.some(item=>item.id===selectedProject?.id)?selectedProject?.id:visibleProjects[0]?.id;
  const selectedDetail=selectedProject?.id===selectedId?selectedProject:null;
  const selectedSummary=summary?.projects.find(item=>item.project_id===selectedId)??null;
  const navigate=(destination:string)=>{if(destination==='recent'||destination==='projects'){setView(destination);return;}onNavigate?.(destination);};
  const openDeletion=async()=>{if(!selectedDetail||!onDeleteProject)return;setDeletingProject(selectedDetail);setDeletionPreview(null);setDeletionError('');setDeletionWarnings([]);try{setDeletionPreview(await previewProjectDeletion(selectedDetail.id));}catch(cause){setDeletionError(cause instanceof Error?cause.message:'无法读取删除影响');}};
  const closeDeletion=()=>{if(deletionBusy)return;setDeletingProject(null);setDeletionPreview(null);setDeletionError('');setDeletionWarnings([]);};
  const confirmDeletion=async()=>{if(!deletingProject||!onDeleteProject||deletionBusy)return;setDeletionBusy(true);setDeletionError('');try{const result=await onDeleteProject(deletingProject.id);if(result.cleanup_warnings.length){setDeletionWarnings(result.cleanup_warnings);setDeletionPreview(null);}else{setDeletingProject(null);setDeletionPreview(null);setDeletionWarnings([]);}}catch(cause){setDeletionError(cause instanceof Error?cause.message:'删除失败');}finally{setDeletionBusy(false);}};
  return <OperationsLayout active={view} onNavigate={navigate}><div className="operations-page workspace-home-page">
    <header className="operations-page-header"><div><h1>{view==='recent'?'工作台':'我的作品'}</h1><p>{view==='recent'?'查看最近访问的作品、审核和下一步任务。':'查看并进入全部个人作品。'}</p></div><button className="command-button" onClick={onCreateProject}><CirclePlus size={16}/>新建作品</button></header>
    {error&&<p className="warning-box" role="alert">{error}</p>}
    <div className="operations-metrics"><div><Clapperboard size={18}/><span>作品总数</span><strong>{summary?.active_project_count??projects.length}</strong></div><div><Clock3 size={18}/><span>未通过镜头</span><strong>{summary?.pending_review_count??0}</strong></div><div><Layers3 size={18}/><span>未完成任务</span><strong>{summary?.active_task_count??0}</strong></div><div><Search size={18}/><span>今日更新</span><strong>{summary?`${summary.updated_today_count} 个作品`:'加载中'}</strong></div></div>
    <div className="workspace-home-grid"><section className="operations-table-wrap"><table className="operations-table"><thead><tr><th>作品</th><th>规模</th><th>当前阶段</th><th>完成度</th><th>任务</th></tr></thead><tbody>{visibleProjects.map(item=>{const row=summary?.projects.find(value=>value.project_id===item.id);const completion=row?.completion_percent??0;return <tr key={item.id} className={item.id===selectedId?'selected':''}><td><button className="project-cell" onClick={()=>onOpenProject(item.id)}><span className="project-cover"><Clapperboard size={20}/></span><span><strong>{item.title}</strong><small>{item.logline}</small></span></button></td><td>{row?`${row.volume_count}卷 · ${row.episode_count}集 · ${row.scene_count}场景 · ${row.shot_count}镜头`:'统计加载中'}</td><td>{row?.current_stage??'项目初始化'}</td><td><span className="table-progress"><i style={{width:`${completion}%`}}/>{completion}%</span></td><td><span className={`status-chip ${row?.open_task_count?'status-running':''}`}>{row?row.open_task_count?`${row.open_task_count} 个未完成`:'暂无任务':'加载中'}</span></td></tr>;})}</tbody></table></section>
      <aside className="operations-inspector"><h2>{selectedDetail?.title??'选择作品'}</h2><div className="project-hero"><Clapperboard size={30}/></div><p>{selectedDetail?.logline??'从作品列表选择一个项目。'}</p><dl><div><dt>当前单集</dt><dd>{selectedDetail?.episodes[0]?.title??'尚未创建'}</dd></div><div><dt>制作流程</dt><dd>剧本 → 分镜 → 画面 → 视频 → 审核</dd></div></dl><div className="operations-next"><h3>接下来 {selectedSummary?.latest_task_titles.length??0} 个任务</h3>{selectedSummary?.latest_task_titles.length?selectedSummary.latest_task_titles.map(title=><p key={title}>{title}</p>):<p>当前没有待办任务</p>}</div><button className="command-button" disabled={!selectedDetail} onClick={()=>selectedDetail&&onOpenProject(selectedDetail.id)}><Play size={16}/>进入单集制作</button>{onDeleteProject&&<button className="danger-action" aria-label="删除作品" disabled={!selectedDetail} onClick={()=>void openDeletion()}><Trash2 size={16}/>删除作品</button>}</aside>
    </div>
    <DeleteProjectDialog project={deletingProject} preview={deletionPreview} busy={deletionBusy} error={deletionError} warnings={deletionWarnings} onCancel={closeDeletion} onConfirm={()=>void confirmDeletion()}/>
  </div></OperationsLayout>;
}
