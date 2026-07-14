'use client';

import {useState} from 'react';
import {AlertTriangle, ArrowRight, BookOpenText, Boxes, Clapperboard, Clock3, Library, Pencil, Plus, Users, X} from 'lucide-react';
import type {EpisodeDetail, ProductionReadiness, ProjectDetail, Storyline, Volume} from '../lib/types';

const statusLabel = (status: string) => ({planned: '已规划', draft: '草稿', completed: '已完成'}[status] ?? status);

export function ProductOverview({project, episode, readiness, volumes, storylines, onOpenEpisode, onOpenScript, onOpenAssets, onCreateVolume, onUpdateVolume}: {
  project: ProjectDetail;
  episode: EpisodeDetail | null;
  readiness: ProductionReadiness | null;
  volumes: Volume[];
  storylines: Storyline[];
  onOpenEpisode: (episodeId: string) => void;
  onOpenScript: () => void;
  onOpenAssets: () => void;
  onCreateVolume?: (data:{title:string;summary:string;position:number}) => Promise<void> | void;
  onUpdateVolume?: (id:string,data:{title:string;summary:string;position:number}) => Promise<void> | void;
}) {
  const [volumeForm,setVolumeForm]=useState(false);
  const [editingVolumeId,setEditingVolumeId]=useState<string|null>(null);
  const [volumeTitle,setVolumeTitle]=useState('');
  const [volumeSummary,setVolumeSummary]=useState('');
  const [volumePosition,setVolumePosition]=useState('1');
  const [volumeBusy,setVolumeBusy]=useState(false);
  const [volumeError,setVolumeError]=useState('');
  const totalScenes = episode?.scenes.length ?? 0;
  const totalShots = readiness?.totals.shots ?? episode?.scenes.reduce((total, scene) => total + scene.shots.length, 0) ?? 0;
  const assignedEpisodes = volumes.flatMap(volume => volume.episodes);
  const assignedEpisodeIds = new Set(assignedEpisodes.map(item => item.id));
  const orderedEpisodes = [...assignedEpisodes, ...project.episodes.filter(item => !assignedEpisodeIds.has(item.id))];
  const primaryEpisodeId = episode?.id ?? orderedEpisodes[0]?.id ?? null;
  const currentProgress = readiness && readiness.totals.shots
    ? Math.round((readiness.ready_counts.panels + readiness.ready_counts.approved) / (readiness.totals.shots * 2) * 100)
    : 0;
  const blockerCount = readiness ? readiness.blockers.missing_panels.length + readiness.blockers.unapproved_shots.length + readiness.blockers.missing_speech.length : 0;
  const closeVolumeForm=()=>{setVolumeForm(false);setEditingVolumeId(null);setVolumeError('');};
  const openCreateVolume=()=>{setEditingVolumeId(null);setVolumeTitle('');setVolumeSummary('');setVolumePosition(String(Math.max(0,...volumes.map(item=>item.position))+1));setVolumeError('');setVolumeForm(true);};
  const openEditVolume=(volume:Volume)=>{setEditingVolumeId(volume.id);setVolumeTitle(volume.title);setVolumeSummary(volume.summary);setVolumePosition(String(volume.position));setVolumeError('');setVolumeForm(true);};
  const saveVolume=async()=>{const title=volumeTitle.trim();const position=Number.parseInt(volumePosition,10);if(!title||!Number.isInteger(position)||position<1||volumeBusy)return;setVolumeBusy(true);setVolumeError('');try{const data={title,summary:volumeSummary.trim(),position};if(editingVolumeId){if(!onUpdateVolume)return;await onUpdateVolume(editingVolumeId,data);}else{if(!onCreateVolume)return;await onCreateVolume(data);}setVolumeTitle('');setVolumeSummary('');closeVolumeForm();}catch(cause){setVolumeError(cause instanceof Error?cause.message:(editingVolumeId?'更新卷失败':'创建卷失败'));}finally{setVolumeBusy(false);}};

  return <main className="product-overview">
    <header className="product-overview-header">
      <div className="project-cover"><Clapperboard size={24}/></div>
      <div className="product-overview-title"><span>当前作品</span><h1>{project.title}</h1><p>{project.logline}</p></div>
      <div className="project-summary-metrics"><span><BookOpenText size={14}/><strong>{volumes.length}</strong> 卷</span><span><Clapperboard size={14}/><strong>{project.episodes.length}</strong> 集</span><span><Boxes size={14}/><strong>{totalScenes}</strong> 场</span><span><Users size={14}/><strong>{project.characters.length}</strong> 角色</span></div>
      <button className="primary-action" type="button" disabled={!primaryEpisodeId} onClick={() => primaryEpisodeId && onOpenEpisode(primaryEpisodeId)}>进入制作<ArrowRight size={15}/></button>
    </header>

    <section className="project-stage-rail" aria-label="作品制作阶段">
      {[['剧本锁定', 100], ['资产准备', project.characters.length ? 70 : 0], ['分镜', readiness?.totals.shots ? Math.round(readiness.ready_counts.panels / readiness.totals.shots * 100) : 0], ['生成', currentProgress], ['审核', readiness?.totals.shots ? Math.round(readiness.ready_counts.approved / readiness.totals.shots * 100) : 0]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}%</strong><progress max="100" value={Number(value)}/></div>)}
    </section>

    <div className="product-overview-grid">
      <section className="episode-operations" aria-labelledby="episode-operations-heading">
        <header><div><span className="eyebrow">{volumes[0] ? `第 ${String(volumes[0].position).padStart(2,'0')} 卷` : '未分卷'}</span><h2 id="episode-operations-heading">{volumes[0]?.title ?? '待整理剧集'}</h2></div><div className="episode-operations-heading-actions"><span>{project.episodes.length} 集 · 稳定排序</span>{volumes[0]&&onUpdateVolume&&<button type="button" aria-label={`编辑卷 ${volumes[0].title}`} onClick={()=>openEditVolume(volumes[0])}><Pencil size={14}/></button>}{onCreateVolume&&<button type="button" onClick={openCreateVolume}><Plus size={14}/>新建卷</button>}</div></header>
        {volumeForm&&<form className="narrative-inline-form volume-create-form" onSubmit={event=>{event.preventDefault();void saveVolume();}}><header><strong>{editingVolumeId?'编辑卷 / 篇章':'新建卷 / 篇章'}</strong><button type="button" aria-label="关闭卷表单" onClick={closeVolumeForm}><X size={14}/></button></header><label>卷标题<input aria-label="卷标题" value={volumeTitle} onChange={event=>setVolumeTitle(event.target.value)} autoFocus/></label><label>卷简介<textarea aria-label="卷简介" value={volumeSummary} onChange={event=>setVolumeSummary(event.target.value)}/></label>{editingVolumeId&&<label>卷排序<input aria-label="卷排序" type="number" min="1" value={volumePosition} onChange={event=>setVolumePosition(event.target.value)}/></label>}{volumeError&&<p role="alert">{volumeError}</p>}<button className="primary-action" type="submit" disabled={!volumeTitle.trim()||!Number.isInteger(Number(volumePosition))||Number(volumePosition)<1||volumeBusy}>{volumeBusy?'正在保存':'保存卷'}</button></form>}
        <div className="episode-table" role="table" aria-label="剧集制作状态">
          <div role="row" className="episode-table-head"><span>集数</span><span>剧集</span><span>阶段</span><span>进度</span><span>风险</span><span/></div>
          {orderedEpisodes.map((item, index) => {
            const active = item.id === episode?.id;
            const progress = active ? currentProgress : item.status === 'completed' ? 100 : item.status === 'planned' ? 18 : 0;
            return <div role="row" className={active ? 'active' : ''} key={item.id}>
              <span>第 {String(index + 1).padStart(2, '0')} 集</span><span><strong>{item.title}</strong><small>{item.premise}</small></span><span>{statusLabel(item.status)}</span><span><progress max="100" value={progress}/><small>{progress}%</small></span><span>{active && blockerCount ? <><AlertTriangle size={13}/>{blockerCount} 项</> : '正常'}</span><button type="button" aria-label={`进入第 ${String(index + 1).padStart(2, '0')} 集制作`} onClick={() => onOpenEpisode(item.id)}><ArrowRight size={15}/></button>
            </div>;
          })}
        </div>
      </section>

      <aside className="project-side-summary">
        <section><header><h2>故事线</h2><span>跨集追踪</span></header>{storylines.length ? storylines.slice(0,3).map(line => <button key={line.id}><i style={{backgroundColor:line.color}}/><span><strong>{line.title}</strong><small>{line.events.length} 个事件 · {line.description || '持续追踪'}</small></span></button>) : <p className="project-side-empty">尚未创建故事线</p>}</section>
        <section><header><h2>快捷入口</h2></header><button onClick={onOpenScript}><BookOpenText size={16}/><span><strong>剧本与故事线</strong><small>继续编辑作品结构</small></span></button><button onClick={onOpenAssets}><Library size={16}/><span><strong>作品资产库</strong><small>角色、场景与变体</small></span></button></section>
        <section className="project-deadline"><Clock3 size={16}/><div><span>当前集目标</span><strong>{episode?.target_duration_seconds ?? 0} 秒</strong></div><div><span>制作阻塞</span><strong>{blockerCount}</strong></div></section>
      </aside>
    </div>
  </main>;
}
