'use client';

import {useEffect, useMemo, useState} from 'react';
import {createEpisode, createProject, getEpisode, getProductionReadiness, getProject, listProjects, startPlanning} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {EpisodeCreate, EpisodeDetail, Job, ProductionReadiness, Project, ProjectCreate, ProjectDetail, Shot} from '../lib/types';
import {AppToolbar} from './AppToolbar';
import {CreateEpisodeDialog} from './CreateEpisodeDialog';
import {CreateProjectDialog} from './CreateProjectDialog';
import {EpisodeOverview} from './EpisodeOverview';
import {Inspector} from './Inspector';
import {ProductionPanel} from './ProductionPanel';
import {ProjectNavigator} from './ProjectNavigator';
import {Storyboard} from './Storyboard';
import {WorkspaceTabs, type WorkArea} from './WorkspaceTabs';

function unavailableReadiness(episode: EpisodeDetail): ProductionReadiness {
  const shots = episode.scenes.flatMap(scene => scene.shots);
  return {
    episode_id: episode.id,
    ready: false,
    totals: {shots: shots.length, dialogue: shots.flatMap(shot => shot.dialogue).length},
    ready_counts: {panels: 0, approved: 0, speech: 0},
    blockers: {missing_panels: [], unapproved_shots: [], missing_speech: []},
  };
}

export function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [readiness, setReadiness] = useState<ProductionReadiness | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [workArea, setWorkArea] = useState<WorkArea>('overview');
  const [mobile, setMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [episodeDialog, setEpisodeDialog] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 899px)');
    if (!query) return;
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const loadEpisode = async (id: string, preserveSelection = false) => {
    const loaded = await getEpisode(id);
    const loadedReadiness = await getProductionReadiness(id).catch(() => unavailableReadiness(loaded));
    setEpisode(loaded);
    setReadiness(loadedReadiness);
    const loadedShots = loaded.scenes.flatMap(scene => scene.shots);
    setSelectedShotId(current => preserveSelection && loadedShots.some(shot => shot.id === current) ? current : loadedShots[0]?.id ?? null);
    localStorage.setItem('ai-comic-episode', id);
  };

  const loadProject = async (id: string) => {
    const loaded = await getProject(id);
    setProject(loaded);
    localStorage.setItem('ai-comic-project', id);
    const preferred = localStorage.getItem('ai-comic-episode');
    const selected = loaded.episodes.find(item => item.id === preferred) ?? loaded.episodes[0];
    if (selected) await loadEpisode(selected.id);
    else {
      setEpisode(null);
      setReadiness(null);
      setSelectedShotId(null);
    }
  };

  const reloadProjects = async (preferredId?: string) => {
    const loaded = await listProjects();
    setProjects(loaded);
    const stored = preferredId ?? localStorage.getItem('ai-comic-project');
    const selected = loaded.find(item => item.id === stored) ?? loaded[0];
    if (selected) await loadProject(selected.id);
    else {
      setProject(null);
      setEpisode(null);
      setReadiness(null);
    }
  };

  useEffect(() => {
    reloadProjects()
      .catch(cause => setError(cause instanceof Error ? cause.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const shots = useMemo(() => episode?.scenes.flatMap(scene => scene.shots) ?? [], [episode]);
  const selectedShot = shots.find(shot => shot.id === selectedShotId) ?? null;
  const selectShotById = (id: string) => {
    if (!shots.some(shot => shot.id === id || shot.dialogue.some(line => line.id === id))) return;
    const target = shots.find(shot => shot.id === id || shot.dialogue.some(line => line.id === id));
    if (!target) return;
    setSelectedShotId(target.id);
    if (window.matchMedia?.('(max-width: 899px)').matches) setWorkArea('inspector');
  };
  const selectShot = (shot: Shot) => selectShotById(shot.id);
  const refreshEpisode = async () => {
    if (episode) await loadEpisode(episode.id, true);
  };
  const updateShotInEpisode = async (updated: Shot) => {
    setEpisode(current => current ? {...current, scenes: current.scenes.map(scene => ({...scene, shots: scene.shots.map(item => item.id === updated.id ? updated : item)}))} : current);
    await refreshEpisode();
  };
  const planEpisode = async () => {
    if (!episode || (job && ['queued', 'running'].includes(job.status))) return;
    const started = await startPlanning(episode.id);
    setJob(started);
    const finished = await pollJob(started.id);
    setJob(finished);
    if (finished.status === 'succeeded') await loadEpisode(episode.id);
  };

  const toolbar = <AppToolbar episodeId={episode?.id} onRefresh={() => reloadProjects(project?.id)} onProduction={() => setWorkArea('production')} renderReady={readiness?.ready ?? false}/>;
  if (loading) return <div className="app-shell">{toolbar}<main className="center-state"><h1>正在加载工作台</h1></main></div>;
  if (!projects.length) return <div className="app-shell">{toolbar}<main className="center-state"><h1>新建第一个项目</h1><p>建立故事设定后即可创建剧集和分镜。</p>{error && <p className="form-error">{error}</p>}<button className="command-button" onClick={() => setProjectDialog(true)}>创建项目</button></main><CreateProjectDialog open={projectDialog} onClose={() => setProjectDialog(false)} onCreate={async data => {const created = await createProject(data); setProjectDialog(false); await reloadProjects(created.id);}}/></div>;

  let center;
  if (!episode) center = <Storyboard episode={null} selectedId={selectedShotId} onSelect={selectShot} onPlan={planEpisode} job={job}/>;
  else if (workArea === 'overview' && readiness) center = <EpisodeOverview episode={episode} readiness={readiness} onSelectShot={selectShotById} onOpenProduction={() => setWorkArea('production')} onOpenReview={() => setWorkArea('review')}/>;
  else if (workArea === 'production') center = <ProductionPanel episodeId={episode.id} onReadiness={() => void refreshEpisode()} onSelectTarget={selectShotById}/>;
  else if (workArea === 'review') center = <main className="center-state review-placeholder" data-testid="review-placeholder"><h1>审核工作区</h1><p>审核队列将在后续任务中接入。</p></main>;
  else center = <Storyboard episode={episode} selectedId={selectedShotId} onSelect={selectShot} onPlan={planEpisode} job={job}/>;

  return <div className="app-shell">
    {toolbar}
    <div className="mobile-project-bar"><select aria-label="选择项目" value={project?.id ?? ''} onChange={event => loadProject(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select aria-label="选择剧集" value={episode?.id ?? ''} onChange={event => loadEpisode(event.target.value)}>{project?.episodes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
    <WorkspaceTabs value={workArea} onChange={setWorkArea} mobile={mobile}/>
    <div className={`workspace-grid mobile-${workArea}`}>
      <ProjectNavigator projects={projects} project={project} episodeId={episode?.id ?? null} onProject={loadProject} onEpisode={loadEpisode} onNewProject={() => setProjectDialog(true)} onNewEpisode={() => setEpisodeDialog(true)}/>
      {center}
      {selectedShot ? <Inspector shot={selectedShot} onShotUpdated={updateShotInEpisode}/> : <aside className="inspector empty-inspector"><p>选择镜头后编辑制作参数。</p></aside>}
    </div>
    <CreateProjectDialog open={projectDialog} onClose={() => setProjectDialog(false)} onCreate={async (data: ProjectCreate) => {const created = await createProject(data); setProjectDialog(false); await reloadProjects(created.id);}}/>
    <CreateEpisodeDialog open={episodeDialog} onClose={() => setEpisodeDialog(false)} onCreate={async (data: EpisodeCreate) => {if (!project) return; const created = await createEpisode(project.id, data); setEpisodeDialog(false); await loadProject(project.id); await loadEpisode(created.id);}}/>
  </div>;
}
