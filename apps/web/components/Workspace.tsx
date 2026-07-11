'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {createEpisode, createProject, getEpisode, getProductionReadiness, getProject, listProjects, startPlanning} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {EpisodeCreate, EpisodeDetail, Job, ProductionReadiness, Project, ProjectCreate, ProjectDetail, Shot} from '../lib/types';
import {AppToolbar} from './AppToolbar';
import {CreateEpisodeDialog} from './CreateEpisodeDialog';
import {CreateProjectDialog} from './CreateProjectDialog';
import {EpisodeOverview} from './EpisodeOverview';
import {Inspector} from './Inspector';
import {ProductionPanel} from './ProductionPanel';
import {ProviderSettings} from './ProviderSettings';
import {ProjectNavigator} from './ProjectNavigator';
import {ReviewPanel} from './ReviewPanel';
import {Storyboard} from './Storyboard';
import {WorkspaceTabs, type WorkArea} from './WorkspaceTabs';
import {ScriptImportWorkspace} from './ScriptImportWorkspace';
import {CharacterWorkspace} from './CharacterWorkspace';

export function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [readiness, setReadiness] = useState<ProductionReadiness | null>(null);
  const [readinessError, setReadinessError] = useState('');
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [workArea, setWorkArea] = useState<WorkArea>('overview');
  const [mobile, setMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [planStarting, setPlanStarting] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [episodeDialog, setEpisodeDialog] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);
  const navigationRequest = useRef(0);

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 899px)');
    if (!query) return;
    const update = () => {
      setMobile(query.matches);
      setWorkArea(current => query.matches
        ? current === 'review' ? 'overview' : current
        : current === 'inspector' ? 'overview' : current);
    };
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const loadEpisodeForRequest = async (id: string, request: number, preserveSelection = false) => {
    const loaded = await getEpisode(id);
    let loadedReadiness: ProductionReadiness | null = null;
    let readinessFailure = '';
    try {
      loadedReadiness = await getProductionReadiness(id);
    } catch {
      readinessFailure = '渲染准备状态暂时无法获取。';
    }
    if (navigationRequest.current !== request) return;
    setEpisode(loaded);
    setReadiness(current => loadedReadiness ?? (current?.episode_id === id ? current : null));
    setReadinessError(readinessFailure);
    const loadedShots = loaded.scenes.flatMap(scene => scene.shots);
    setSelectedShotId(current => preserveSelection && loadedShots.some(shot => shot.id === current) ? current : loadedShots[0]?.id ?? null);
    localStorage.setItem('ai-comic-episode', id);
  };
  const loadEpisode = (id: string, preserveSelection = false) => {
    const request = ++navigationRequest.current;
    return loadEpisodeForRequest(id, request, preserveSelection);
  };

  const loadProjectForRequest = async (id: string, request: number) => {
    const loaded = await getProject(id);
    if (navigationRequest.current !== request) return;
    setProject(loaded);
    localStorage.setItem('ai-comic-project', id);
    const preferred = localStorage.getItem('ai-comic-episode');
    const selected = loaded.episodes.find(item => item.id === preferred) ?? loaded.episodes[0];
    if (selected) await loadEpisodeForRequest(selected.id, request);
    else {
      if (navigationRequest.current !== request) return;
      setEpisode(null);
      setReadiness(null);
      setReadinessError('');
      setSelectedShotId(null);
    }
  };
  const loadProject = (id: string) => {
    const request = ++navigationRequest.current;
    return loadProjectForRequest(id, request);
  };

  const reloadProjects = async (preferredId?: string) => {
    const request = ++navigationRequest.current;
    const loaded = await listProjects();
    if (navigationRequest.current !== request) return;
    setProjects(loaded);
    const stored = preferredId ?? localStorage.getItem('ai-comic-project');
    const selected = loaded.find(item => item.id === stored) ?? loaded[0];
    if (selected) await loadProjectForRequest(selected.id, request);
    else {
      if (navigationRequest.current !== request) return;
      setProject(null);
      setEpisode(null);
      setReadiness(null);
      setReadinessError('');
      setWorkArea(current => current === 'settings' ? current : 'overview');
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
    if (mobile) setWorkArea('inspector');
  };
  const selectShot = (shot: Shot) => selectShotById(shot.id);
  const changeWorkArea = (next: WorkArea) => {
    if (next === workArea) return true;
    if (workArea === 'settings' && settingsDirty && !window.confirm('模型渠道有未保存更改，确定离开吗？')) return false;
    setWorkArea(next);
    return true;
  };
  const canLeaveSettings = () => workArea !== 'settings' || !settingsDirty || window.confirm('模型渠道有未保存更改，确定离开吗？');
  const navigateProject = (id: string) => {if (canLeaveSettings()) void loadProject(id);};
  const navigateEpisode = (id: string) => {if (canLeaveSettings()) void loadEpisode(id);};
  const openReview = () => {
    if (!mobile) {
      changeWorkArea('review');
      return;
    }
    const blockers = readiness?.blockers;
    const blockedShot = blockers && shots.find(shot => blockers.unapproved_shots.includes(shot.id) || blockers.missing_panels.includes(shot.id));
    if (blockedShot) selectShotById(blockedShot.id);
    else setWorkArea('overview');
  };
  const refreshEpisode = async () => {
    if (episode) await loadEpisodeForRequest(episode.id, navigationRequest.current, true);
  };
  const updateShotInEpisode = async (updated: Shot) => {
    setEpisode(current => current ? {...current, scenes: current.scenes.map(scene => ({...scene, shots: scene.shots.map(item => item.id === updated.id ? updated : item)}))} : current);
    await refreshEpisode();
  };
  const planEpisode = async () => {
    if (!episode || planStarting || (job && ['queued', 'running'].includes(job.status))) return;
    setPlanStarting(true);
    try {
      const started = await startPlanning(episode.id);
      setJob(started);
      setPlanStarting(false);
      const finished = await pollJob(started.id);
      setJob(finished);
      if (finished.status === 'succeeded') await loadEpisode(episode.id);
    } finally {
      setPlanStarting(false);
    }
  };

  const toolbar = <AppToolbar projectLabel={project?.title ?? null} episodeLabel={episode?.title ?? null} episodeId={episode?.id} onRefresh={() => reloadProjects(project?.id)} onProduction={() => changeWorkArea('production')} renderReady={Boolean(readiness?.ready && !readinessError)} healthRefreshKey={healthRefreshKey}/>;
  if (loading) return <div className="app-shell">{toolbar}<main className="center-state"><h1>正在加载工作台</h1></main></div>;

  const episodeIndex = project && episode ? project.episodes.findIndex(item => item.id === episode.id) : -1;
  const episodeNumber = episodeIndex >= 0 ? episodeIndex + 1 : undefined;
  let center;
  if (workArea === 'settings') center = <ProviderSettings onDirtyChange={setSettingsDirty} onSaved={() => setHealthRefreshKey(value => value + 1)}/>;
  else if (workArea === 'import' && project) center = <ScriptImportWorkspace projectId={project.id} onConfirmed={()=>reloadProjects(project.id)}/>;
  else if (workArea === 'characters' && project) center = <CharacterWorkspace characters={project.characters}/>;
  else if (!projects.length) center = <main className="center-state"><h1>新建第一个项目</h1><p>建立故事设定后即可创建剧集和分镜。</p>{error && <p className="form-error">{error}</p>}<button className="command-button" onClick={() => setProjectDialog(true)}>创建项目</button></main>;
  else if (!episode) center = <Storyboard episode={null} selectedId={selectedShotId} onSelect={selectShot} onPlan={planEpisode} job={job} planStarting={planStarting}/>;
  else if (workArea === 'overview' && readiness) center = <EpisodeOverview episode={episode} episodeNumber={episodeNumber} readiness={readiness} onSelectShot={selectShotById} onOpenProduction={() => changeWorkArea('production')} onOpenReview={openReview}/>;
  else if (workArea === 'overview') center = <main className="episode-overview center-state"><h1>剧集总览暂不可用</h1><p>无法加载当前剧集的渲染准备状态。</p></main>;
  else if (workArea === 'production') center = <ProductionPanel episodeId={episode.id} onReadiness={() => void refreshEpisode()} onSelectTarget={selectShotById}/>;
  else if (workArea === 'review' && readiness) center = <ReviewPanel episode={episode} readiness={readiness} onSelectShot={selectShotById}/>;
  else center = <Storyboard episode={episode} selectedId={selectedShotId} onSelect={selectShot} onPlan={planEpisode} job={job} planStarting={planStarting}/>;
  const visibleWorkAreas: WorkArea[] = !projects.length
    ? ['overview', 'settings']
    : mobile
    ? ['overview', 'import', 'characters', 'storyboard', 'production', 'inspector', 'settings']
    : ['overview', 'import', 'characters', 'storyboard', 'production', 'review', 'settings'];

  return <div className="app-shell">
    {toolbar}
    {readinessError && <p className="readiness-error" role="alert">{readinessError}</p>}
    {projects.length > 0 && <div className="mobile-project-bar"><select aria-label="选择项目" value={project?.id ?? ''} onChange={event => navigateProject(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select aria-label="选择剧集" value={episode?.id ?? ''} onChange={event => navigateEpisode(event.target.value)}>{project?.episodes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>}
    <WorkspaceTabs value={workArea} onChange={changeWorkArea} mobile={mobile} areas={visibleWorkAreas} fullWidth={!projects.length}/>
    {visibleWorkAreas.filter(area => area !== workArea).map(area => <section key={area} id={`workspace-panel-${area}`} role="tabpanel" aria-labelledby={`workspace-tab-${area}`} hidden/>)}
    <div className={`workspace-grid mobile-${workArea} ${projects.length ? '' : 'workspace-grid-empty'}`}>
      {projects.length > 0 && <ProjectNavigator
        projects={projects}
        project={project}
        episodeId={episode?.id ?? null}
        onProject={navigateProject}
        onEpisode={navigateEpisode}
        onNewProject={() => setProjectDialog(true)}
        onNewEpisode={() => setEpisodeDialog(true)}
        onScriptImport={() => changeWorkArea('import')}
        onCharacters={() => changeWorkArea('characters')}
        onProviderSettings={() => changeWorkArea('settings')}
      />}
      <section
        className="workspace-center"
        id={workArea === 'inspector' ? undefined : `workspace-panel-${workArea}`}
        role={workArea === 'inspector' ? undefined : 'tabpanel'}
        aria-labelledby={workArea === 'inspector' ? undefined : `workspace-tab-${workArea}`}
      >{center}</section>
      {projects.length > 0 && <section
        className="workspace-inspector"
        id={workArea === 'inspector' ? 'workspace-panel-inspector' : undefined}
        role={workArea === 'inspector' ? 'tabpanel' : undefined}
        aria-labelledby={workArea === 'inspector' ? 'workspace-tab-inspector' : undefined}
      >{selectedShot ? <Inspector shot={selectedShot} characters={project?.characters ?? []} onShotUpdated={updateShotInEpisode}/> : <aside className="inspector empty-inspector"><p>选择镜头后编辑制作参数。</p></aside>}</section>}
    </div>
    <CreateProjectDialog open={projectDialog} onClose={() => setProjectDialog(false)} onCreate={async (data: ProjectCreate) => {const created = await createProject(data); setProjectDialog(false); await reloadProjects(created.id);}}/>
    <CreateEpisodeDialog open={episodeDialog} onClose={() => setEpisodeDialog(false)} onCreate={async (data: EpisodeCreate) => {if (!project) return; const created = await createEpisode(project.id, data); setEpisodeDialog(false); await loadProject(project.id); await loadEpisode(created.id);}}/>
  </div>;
}
