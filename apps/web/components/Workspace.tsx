'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {createEpisode,createProject,createVolume,deleteEpisode,deleteVolume,getEpisode,getProductionReadiness,getProject,getProjectOverviewMetrics,listProjects,listStorylines,listVolumes,moveEpisodeToVolume,previewEpisodeDeletion,startPlanning,updateProject,updateVolume} from '../lib/api';
import {pollJob} from '../lib/jobs';
import {globalSectionWorkAreas, resolveOperationsPage, type PlatformPage} from '../lib/navigation';
import type {EpisodeCreate,EpisodeDeletionPreview,EpisodeDetail,EpisodeSummary,Job,ProductionReadiness,ProductionTask,Project,ProjectCreate,ProjectDetail,ProjectOverviewMetrics,ProjectSearchResult,Shot,Storyline,Volume} from '../lib/types';
import {AppToolbar, type GlobalSection} from './AppToolbar';
import {CreateEpisodeDialog} from './CreateEpisodeDialog';
import {CreateProjectDialog} from './CreateProjectDialog';
import {EpisodeOverview} from './EpisodeOverview';
import {Inspector} from './Inspector';
import {ProductionPanel} from './ProductionPanel';
import {ModelCenter} from './ModelCenter';
import {ProjectNavigator} from './ProjectNavigator';
import {ReviewPanel} from './ReviewPanel';
import {Storyboard} from './Storyboard';
import {WorkspaceTabs, type WorkArea} from './WorkspaceTabs';
import {ScriptLibrary} from './ScriptLibrary';
import {CharacterWorkspace} from './CharacterWorkspace';
import {DeleteEpisodeDialog} from './DeleteEpisodeDialog';
import {DirectorWorkspace} from './director/DirectorWorkspace';
import {SceneWorkspace} from './SceneWorkspace';
import {VisualReviewWorkspace} from './VisualReviewWorkspace';
import {ProductionDialogueWorkspace} from './production-canvas/ProductionDialogueWorkspace';
import {ProductionMediaWorkspace,type ProductionMediaMode} from './production-canvas/ProductionMediaWorkspace';
import {ProductOverview} from './ProductOverview';
import {ProjectSettings} from './ProjectSettings';
import {WorkspaceHome} from './WorkspaceHome';
import {GlobalSearchOverlay} from './GlobalSearchOverlay';
import {TaskCenter} from './TaskCenter';
import {VersionHistory} from './VersionHistory';
import {RecycleBin} from './RecycleBin';
import {ExportDelivery} from './ExportDelivery';

export function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [volumes,setVolumes]=useState<Volume[]>([]);
  const [storylines,setStorylines]=useState<Storyline[]>([]);
  const [focusedStorylineId,setFocusedStorylineId]=useState<string|null>(null);
  const [overviewMetrics,setOverviewMetrics]=useState<ProjectOverviewMetrics|null>(null);
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [readiness, setReadiness] = useState<ProductionReadiness | null>(null);
  const [readinessByEpisode,setReadinessByEpisode]=useState<Record<string,ProductionReadiness>>({});
  const [readinessError, setReadinessError] = useState('');
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [productionReviewShotId,setProductionReviewShotId]=useState<string|null>(null);
  const [productionDirectorShotId,setProductionDirectorShotId]=useState<string|null>(null);
  const [productionDialogueShotId,setProductionDialogueShotId]=useState<string|null>(null);
  const [productionMedia,setProductionMedia]=useState<{shotId:string;mode:ProductionMediaMode}|null>(null);
  const [productionRefreshKey,setProductionRefreshKey]=useState(0);
  const [workArea, setWorkArea] = useState<WorkArea>('overview');
  const [platformPage, setPlatformPage] = useState<PlatformPage>('project');
  const [searchOpen,setSearchOpen]=useState(false);
  const [globalSection, setGlobalSection] = useState<GlobalSection>('episode');
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
  const deletionGeneration=useRef(0);
  const [deletingEpisode,setDeletingEpisode]=useState<EpisodeSummary|null>(null);
  const [deletionPreview,setDeletionPreview]=useState<EpisodeDeletionPreview|null>(null);
  const [deletionBusy,setDeletionBusy]=useState(false);
  const [deletionError,setDeletionError]=useState('');
  const [deletionWarnings,setDeletionWarnings]=useState<string[]>([]);

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 899px)');
    if (!query) return;
    const update = () => {
      setMobile(query.matches);
      setWorkArea(current => !query.matches && current === 'inspector' ? 'overview' : current);
    };
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const loadEpisodeForRequest = async (id: string, request: number, preserveSelection = false, readinessRequest?:Promise<ProductionReadiness>) => {
    const loaded = await getEpisode(id);
    let loadedReadiness: ProductionReadiness | null = null;
    let readinessFailure = '';
    try {
      loadedReadiness = await (readinessRequest??getProductionReadiness(id));
    } catch {
      readinessFailure = '渲染准备状态暂时无法获取。';
    }
    if (navigationRequest.current !== request) return;
    setEpisode(loaded);
    setReadiness(current => loadedReadiness ?? (current?.episode_id === id ? current : null));
    if(loadedReadiness)setReadinessByEpisode(current=>({...current,[id]:loadedReadiness}));
    setReadinessError(readinessFailure);
    if(!preserveSelection){setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia(null);}
    const loadedShots = loaded.scenes.flatMap(scene => scene.shots);
    setSelectedShotId(current => preserveSelection && loadedShots.some(shot => shot.id === current) ? current : loadedShots[0]?.id ?? null);
    localStorage.setItem('ai-comic-episode', id);
  };
  const loadEpisode = (id: string, preserveSelection = false) => {
    const request = ++navigationRequest.current;
    return loadEpisodeForRequest(id, request, preserveSelection);
  };

  const loadProjectForRequest = async (id: string, request: number) => {
    const [loaded,loadedVolumes,loadedStorylines,loadedOverviewMetrics] = await Promise.all([getProject(id),listVolumes(id),listStorylines(id),getProjectOverviewMetrics(id).catch(()=>null)]);
    if (navigationRequest.current !== request) return;
    const readinessRequests=loaded.episodes.map(item=>[item.id,getProductionReadiness(item.id)] as const);
    const projectReadinessRequest=Promise.allSettled(readinessRequests.map(([,pending])=>pending));
    setProject(loaded);
    setVolumes(loadedVolumes);
    setStorylines(loadedStorylines);
    setOverviewMetrics(loadedOverviewMetrics);
    setReadinessByEpisode({});
    localStorage.setItem('ai-comic-project', id);
    const preferred = localStorage.getItem('ai-comic-episode');
    const selected = loaded.episodes.find(item => item.id === preferred) ?? loaded.episodes[0];
    const selectedReadinessRequest=selected?readinessRequests.find(([episodeId])=>episodeId===selected.id)?.[1]:undefined;
    const episodeRequest=selected?loadEpisodeForRequest(selected.id,request,false,selectedReadinessRequest):Promise.resolve();
    const settledReadiness=await projectReadinessRequest;
    if(navigationRequest.current!==request)return;
    setReadinessByEpisode(Object.fromEntries(settledReadiness.flatMap((result,index)=>result.status==='fulfilled'?[[readinessRequests[index][0],result.value]]:[])));
    if (selected) await episodeRequest;
    else {
      if (navigationRequest.current !== request) return;
      setEpisode(null);
      setReadiness(null);
      setReadinessByEpisode({});
      setReadinessError('');
      setSelectedShotId(null);
    }
  };
  const loadProject = (id: string) => {
    const request = ++navigationRequest.current;
    return loadProjectForRequest(id, request);
  };

  const refreshOverviewSummary=async()=>{
    if(!project)return;
    const projectId=project.id;
    const request=navigationRequest.current;
    const [metrics,nextStorylines]=await Promise.all([getProjectOverviewMetrics(projectId),listStorylines(projectId)]);
    if(navigationRequest.current!==request||project.id!==projectId)return;
    setOverviewMetrics(metrics);
    setStorylines(nextStorylines);
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
      setVolumes([]);
      setStorylines([]);
      setOverviewMetrics(null);
      setEpisode(null);
      setReadiness(null);
      setReadinessByEpisode({});
      setReadinessError('');
      setWorkArea('overview');
    }
  };

  useEffect(() => {
    reloadProjects()
      .catch(cause => setError(cause instanceof Error ? cause.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const shots = useMemo(() => episode?.scenes.flatMap(scene => scene.shots) ?? [], [episode]);
  const selectedShot = shots.find(shot => shot.id === selectedShotId) ?? null;
  const selectedScene = episode?.scenes.find(scene => scene.shots.some(shot => shot.id === selectedShotId)) ?? episode?.scenes[0] ?? null;
  const selectShotById = (id: string) => {
    if (!shots.some(shot => shot.id === id || shot.dialogue.some(line => line.id === id))) return;
    const target = shots.find(shot => shot.id === id || shot.dialogue.some(line => line.id === id));
    if (!target) return;
    setSelectedShotId(target.id);
    if (mobile) setWorkArea('inspector');
  };
  const selectShot = (shot: Shot) => selectShotById(shot.id);
  const changeWorkArea = (next: WorkArea) => {
    if(next==='production'&&workArea==='production'&&(productionReviewShotId||productionDirectorShotId||productionDialogueShotId||productionMedia)){setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia(null);return true;}
    if(next!=='production'){setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia(null);}
    if (next === workArea) return true;
    setWorkArea(next);
    return true;
  };
  const canLeaveSettings = () => {
    if ((platformPage !== 'models' && platformPage !== 'settings') || !settingsDirty) return true;
    const confirmed = window.confirm(platformPage === 'models' ? '模型渠道有未保存更改，确定离开吗？' : '作品设置有未保存更改，确定离开吗？');
    if (confirmed) setSettingsDirty(false);
    return confirmed;
  };
  const toggleModelCenter = () => {
    if (platformPage === 'models') {
      if (!canLeaveSettings()) return;
      setPlatformPage('project');
      return;
    }
    setPlatformPage('models');
  };
  const toggleProjectSettings=()=>{if(platformPage==='settings'){if(canLeaveSettings())setPlatformPage('project');return;}if(canLeaveSettings())setPlatformPage('settings');};
  const navigateProject=(id:string)=>{if(canLeaveSettings()){deletionGeneration.current+=1;setDeletingEpisode(null);setDeletionPreview(null);setDeletionError('');setDeletionWarnings([]);void loadProject(id);}};
  const navigateEpisode = (id: string) => {if (canLeaveSettings()) void loadEpisode(id);};
  const openEpisodeDeletion=async(id:string)=>{const target=project?.episodes.find(item=>item.id===id);if(!target)return;const generation=++deletionGeneration.current;setDeletingEpisode(target);setDeletionPreview(null);setDeletionError('');setDeletionWarnings([]);try{const preview=await previewEpisodeDeletion(id);if(deletionGeneration.current===generation)setDeletionPreview(preview);}catch(cause){if(deletionGeneration.current===generation)setDeletionError(cause instanceof Error?cause.message:'无法读取删除影响');}};
  const closeEpisodeDeletion=()=>{if(deletionBusy)return;deletionGeneration.current+=1;setDeletingEpisode(null);setDeletionPreview(null);setDeletionError('');setDeletionWarnings([]);};
  const confirmEpisodeDeletion=async()=>{if(!deletingEpisode||deletionBusy||!project)return;const target=deletingEpisode;const navigationAtStart=navigationRequest.current;const generation=++deletionGeneration.current;const selectedId=episode?.id??null;const index=project.episodes.findIndex(item=>item.id===target.id);const adjacent=project.episodes[index+1]??project.episodes[index-1]??null;setDeletionBusy(true);setDeletionError('');try{const result=await deleteEpisode(target.id);if(deletionGeneration.current!==generation||navigationRequest.current!==navigationAtStart)return;const preferred=selectedId===target.id?adjacent?.id??null:selectedId;if(preferred)localStorage.setItem('ai-comic-episode',preferred);else localStorage.removeItem('ai-comic-episode');await loadProject(target.project_id);if(deletionGeneration.current!==generation)return;if(result.cleanup_warnings.length){setDeletionWarnings(result.cleanup_warnings);setDeletionPreview(null);}else{setDeletingEpisode(null);setDeletionPreview(null);}}catch(cause){if(deletionGeneration.current===generation)setDeletionError(cause instanceof Error?cause.message:'删除失败');}finally{if(deletionGeneration.current===generation)setDeletionBusy(false);}};
  const openReview = () => {
    const blockers = readiness?.blockers;
    const target=shots.find(shot=>shot.id===selectedShotId)??(blockers&&shots.find(shot=>blockers.unapproved_shots.includes(shot.id)||blockers.missing_panels.includes(shot.id)||blockers.stale_panels?.includes(shot.id)))??shots[0];
    if(target){setSelectedShotId(target.id);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia(null);setProductionReviewShotId(target.id);}
    setGlobalSection('episode');
    changeWorkArea('production');
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

  const navigateGlobal = (section: GlobalSection) => {
    if (!canLeaveSettings()) return;
    setPlatformPage('project');
    if(section==='script')setFocusedStorylineId(null);
    setGlobalSection(section);
    changeWorkArea(globalSectionWorkAreas[section]);
  };
  const openPlatformPage=(page:PlatformPage)=>{if(canLeaveSettings())setPlatformPage(page);};
  const openSearchResult=async(item:ProjectSearchResult)=>{
    if(!canLeaveSettings())return;
    setSearchOpen(false);
    if(['character','asset_variant','asset_state'].includes(item.kind)){setPlatformPage('project');setGlobalSection('assets');changeWorkArea('characters');return;}
    if(item.kind==='task'){setPlatformPage('tasks');return;}
    setPlatformPage('project');
    if(item.kind==='script'){setFocusedStorylineId(null);setGlobalSection('script');changeWorkArea('import');return;}
    if(item.episode_id&&item.episode_id!==episode?.id)await loadEpisode(item.episode_id);
    if(item.kind==='episode'){setGlobalSection('episode');changeWorkArea('overview');return;}
    if(item.kind==='scene'){setGlobalSection('episode');changeWorkArea('scene');return;}
    if(item.kind==='shot'){if(item.shot_id)setSelectedShotId(item.shot_id);setGlobalSection('episode');changeWorkArea('storyboard');return;}
    if(item.kind==='review'){if(item.shot_id)setSelectedShotId(item.shot_id);setGlobalSection('review');changeWorkArea('review');}
  };
  const openTaskTarget=async(task:ProductionTask)=>{
    if(!canLeaveSettings())return;
    setPlatformPage('project');
    if(task.episode_id&&task.episode_id!==episode?.id)await loadEpisode(task.episode_id);
    if(task.review_thread_id){if(task.shot_id)setSelectedShotId(task.shot_id);setGlobalSection('review');changeWorkArea('review');return;}
    if(task.shot_id){setSelectedShotId(task.shot_id);setGlobalSection('episode');changeWorkArea('storyboard');return;}
    if(task.scene_id){setGlobalSection('episode');changeWorkArea('scene');return;}
    if(task.episode_id){setGlobalSection('episode');changeWorkArea('overview');return;}
    setGlobalSection('overview');changeWorkArea('overview');
  };
  const toolbar = <AppToolbar projectLabel={project?.title ?? null} episodeLabel={episode?.title ?? null} episodeId={episode?.id} onRefresh={() => reloadProjects(project?.id)} onProduction={() => {if (canLeaveSettings()) {setPlatformPage('project'); setGlobalSection('episode'); changeWorkArea('production');}}} renderReady={Boolean(readiness?.ready && !readinessError)} healthRefreshKey={healthRefreshKey} onModelCenter={toggleModelCenter} modelCenterOpen={platformPage === 'models'} onProjectSettings={toggleProjectSettings} projectSettingsOpen={platformPage==='settings'} activeSection={globalSection} onNavigate={navigateGlobal} onWorkspaceHome={()=>openPlatformPage('home')} onSearch={()=>setSearchOpen(true)} onTasks={()=>openPlatformPage('tasks')} onVersions={()=>openPlatformPage('versions')}/>;
  const searchOverlay=searchOpen?<GlobalSearchOverlay project={project} episode={episode} onClose={()=>setSearchOpen(false)} onOpenResult={openSearchResult}/>:null;
  const navigateOperations=(page:string)=>{const next=resolveOperationsPage(page);if(next)openPlatformPage(next);};
  if (loading) return <div className="app-shell">{toolbar}<main className="center-state"><h1>正在加载工作台</h1></main></div>;
  if (platformPage === 'models') return <div className="app-shell">{toolbar}<ModelCenter onDirtyChange={setSettingsDirty} onSaved={() => setHealthRefreshKey(value => value + 1)}/>{searchOverlay}</div>;
  if(platformPage==='settings'&&project){const sceneCount=episode?.scenes.length??0;const shotCount=episode?.scenes.reduce((sum,scene)=>sum+scene.shots.length,0)??0;return <div className="app-shell">{toolbar}<ProjectSettings project={project} volumes={volumes} sceneCount={sceneCount} shotCount={shotCount} onDirtyChange={setSettingsDirty} onImported={async result=>{await reloadProjects(result.project_id);setPlatformPage('project');setGlobalSection('episode');setWorkArea('overview');}} onSave={async data=>{const updated=await updateProject(project.id,data);setProject(current=>current?{...current,...updated}:current);setProjects(current=>current.map(item=>item.id===updated.id?updated:item));}}/>{searchOverlay}</div>;}
  if(platformPage==='home')return <div className="app-shell">{toolbar}<WorkspaceHome projects={projects} selectedProject={project} onOpenProject={id=>{void loadProject(id);setPlatformPage('project');setGlobalSection('episode');setWorkArea('overview');}} onCreateProject={()=>setProjectDialog(true)} onNavigate={navigateOperations}/><CreateProjectDialog open={projectDialog} onClose={()=>setProjectDialog(false)} onCreate={async(data:ProjectCreate)=>{const created=await createProject(data);setProjectDialog(false);await reloadProjects(created.id);setPlatformPage('project');}}/>{searchOverlay}</div>;
  if(platformPage==='tasks')return <div className="app-shell">{toolbar}<TaskCenter project={project} episode={episode} onOpenTarget={openTaskTarget}/>{searchOverlay}</div>;
  if(platformPage==='versions')return <div className="app-shell">{toolbar}<VersionHistory episode={episode} onRestored={()=>episode?loadProject(episode.project_id):Promise.resolve()}/>{searchOverlay}</div>;
  if(platformPage==='trash')return <div className="app-shell">{toolbar}<RecycleBin project={project}/>{searchOverlay}</div>;
  if(platformPage==='export')return <div className="app-shell">{toolbar}<ExportDelivery project={project} episode={episode} onNavigate={navigateOperations}/>{searchOverlay}</div>;

  const episodeIndex = project && episode ? project.episodes.findIndex(item => item.id === episode.id) : -1;
  const episodeNumber = episodeIndex >= 0 ? episodeIndex + 1 : undefined;
  const productionDirectorScene=productionDirectorShotId?episode?.scenes.find(scene=>scene.shots.some(shot=>shot.id===productionDirectorShotId))??null:null;
  const productionDialogueShot=productionDialogueShotId?shots.find(shot=>shot.id===productionDialogueShotId)??null:null;
  const productionMediaShot=productionMedia?shots.find(shot=>shot.id===productionMedia.shotId)??null:null;
  let center;
  if (globalSection === 'overview' && project) center = <ProductOverview project={project} episode={episode} readiness={readiness} readinessByEpisode={readinessByEpisode} metrics={overviewMetrics} volumes={volumes} storylines={storylines} onOpenEpisode={id => {setGlobalSection('episode'); changeWorkArea('overview'); if (id !== episode?.id) void loadEpisode(id);}} onOpenScript={() => {setFocusedStorylineId(null);setGlobalSection('script'); changeWorkArea('import');}} onOpenStoryline={id=>{setFocusedStorylineId(id);setGlobalSection('script');changeWorkArea('import');}} onOpenAssets={() => {setGlobalSection('assets'); changeWorkArea('characters');}} onCreateVolume={async data=>{await createVolume(project.id,data);setVolumes(await listVolumes(project.id));}} onUpdateVolume={async(id,data)=>{await updateVolume(id,data);setVolumes(await listVolumes(project.id));}} onDeleteVolume={async id=>{await deleteVolume(id);await loadProject(project.id);}} onMoveEpisode={async(id,volumeId)=>{await moveEpisodeToVolume(id,volumeId);await loadProject(project.id);}}/>;
  else if (workArea === 'import' && project) center = <ScriptLibrary projectId={project.id} onConfirmed={refreshOverviewSummary} initialView={focusedStorylineId?'storyline':'document'} initialStorylineId={focusedStorylineId??undefined}/>;
  else if (workArea === 'characters' && project) center = <CharacterWorkspace projectId={project.id} characters={project.characters} episodes={project.episodes} onCharactersChanged={()=>loadProject(project.id)} onMetricsChanged={refreshOverviewSummary}/>;
  else if (!projects.length) center = <main className="center-state"><h1>新建第一个项目</h1><p>建立故事设定后即可创建剧集和分镜。</p>{error && <p className="form-error">{error}</p>}<button className="command-button" onClick={() => setProjectDialog(true)}>创建项目</button></main>;
  else if (!episode) center = <Storyboard episode={null} selectedId={selectedShotId} onSelect={selectShot} onPlan={planEpisode} job={job} planStarting={planStarting}/>;
  else if (workArea === 'overview' && readiness) center = <EpisodeOverview episode={episode} episodeNumber={episodeNumber} readiness={readiness} onSelectShot={id => {selectShotById(id); setGlobalSection('episode'); changeWorkArea('storyboard');}} onOpenProduction={() => {setGlobalSection('episode'); changeWorkArea('production');}} onOpenReview={openReview}/>;
  else if (workArea === 'overview') center = <main className="episode-overview center-state"><h1>剧集总览暂不可用</h1><p>无法加载当前剧集的渲染准备状态。</p></main>;
  else if (workArea === 'scene') center = <SceneWorkspace episode={episode} onEpisodeChanged={refreshEpisode} onOpenShot={id => {selectShotById(id); changeWorkArea('storyboard');}}/>;
  else if (workArea === 'production') center = <div className="production-flow-shell"><div className="production-flow-canvas" hidden={Boolean(productionReviewShotId||productionDirectorShotId||productionDialogueShotId||productionMedia)}><ProductionPanel episodeId={episode.id} refreshKey={productionRefreshKey} onReadiness={() => void refreshEpisode()} onSelectTarget={selectShotById} onSelectCanvasShot={setSelectedShotId} onOpenVisualReview={id=>{setSelectedShotId(id);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia(null);setProductionReviewShotId(id);}} onOpenDirector={id=>{setSelectedShotId(id);setProductionReviewShotId(null);setProductionDialogueShotId(null);setProductionMedia(null);setProductionDirectorShotId(id);}} onOpenDialogue={id=>{setSelectedShotId(id);setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionMedia(null);setProductionDialogueShotId(id);}} onOpenMedia={(id,mode)=>{setSelectedShotId(id);setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia({shotId:id,mode});}}/></div>{productionReviewShotId&&<div className="production-flow-review"><VisualReviewWorkspace episode={episode} selectedShotId={productionReviewShotId} onBackToProduction={()=>setProductionReviewShotId(null)} onCandidateAccepted={async()=>{await refreshEpisode();setProductionRefreshKey(value=>value+1);}}/></div>}{productionDirectorShotId&&productionDirectorScene&&<div className="production-flow-director"><DirectorWorkspace scene={productionDirectorScene} selectedShotId={productionDirectorShotId} mobile={mobile} onSelectShot={id=>{setSelectedShotId(id);setProductionDirectorShotId(id);}} onBackToProduction={()=>setProductionDirectorShotId(null)} onShotUpdated={async updated=>{await updateShotInEpisode(updated);setProductionRefreshKey(value=>value+1);}}/></div>}{productionDialogueShot&&<div className="production-flow-dialogue"><ProductionDialogueWorkspace shot={productionDialogueShot} characters={project?.characters??[]} onBackToProduction={()=>setProductionDialogueShotId(null)} onShotUpdated={async updated=>{await updateShotInEpisode(updated);setProductionRefreshKey(value=>value+1);}}/></div>}{productionMedia&&productionMediaShot&&<div className="production-flow-media"><ProductionMediaWorkspace mode={productionMedia.mode} shot={productionMediaShot} onBackToProduction={()=>setProductionMedia(null)} onShotUpdated={async updated=>{await updateShotInEpisode(updated);setProductionRefreshKey(value=>value+1);}}/></div>}</div>;
  else if (workArea === 'review' && readiness) center = <ReviewPanel episode={episode} readiness={readiness} onSelectShot={selectShotById} onEpisodeChanged={refreshEpisode}/>;
  else if (workArea === 'director' && selectedScene && selectedShotId) center = <DirectorWorkspace scene={selectedScene} selectedShotId={selectedShotId} mobile={mobile} onSelectShot={setSelectedShotId} onShotUpdated={updateShotInEpisode}/>;
  else if (workArea === 'director') center = <main className="center-state"><h1>3D 导演台</h1><p>请先生成并选择一个分镜。</p></main>;
  else center = <Storyboard episode={episode} selectedId={selectedShotId} onSelect={selectShot} onPlan={planEpisode} onOpenDirector={id => {selectShotById(id); changeWorkArea('director');}} job={job} planStarting={planStarting}/>;
  const showShotInspector = workArea === 'storyboard' || workArea === 'inspector';
  const stageWorkAreas: WorkArea[] = ['overview', 'scene', 'storyboard', 'production'];
  const visibleWorkAreas: WorkArea[] = globalSection === 'episode'
    ? mobile ? [...stageWorkAreas, 'inspector'] : stageWorkAreas
    : [workArea];
  const showStageTabs = Boolean(projects.length && episode && globalSection === 'episode');

  return <div className="app-shell">
    {toolbar}
    {readinessError && <p className="readiness-error" role="alert">{readinessError}</p>}
    {projects.length > 0 && <div className="mobile-project-bar"><select aria-label="选择项目" value={project?.id ?? ''} onChange={event => navigateProject(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select aria-label="选择剧集" value={episode?.id ?? ''} onChange={event => navigateEpisode(event.target.value)}>{project?.episodes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>}
    {showStageTabs && <WorkspaceTabs value={workArea} onChange={changeWorkArea} mobile={mobile} areas={visibleWorkAreas}/>}
    {showStageTabs && visibleWorkAreas.filter(area => area !== workArea).map(area => <section key={area} id={`workspace-panel-${area}`} role="tabpanel" aria-labelledby={`workspace-tab-${area}`} hidden/>)}
    <div className={`workspace-grid mobile-${workArea} ${projects.length ? '' : 'workspace-grid-empty'} ${showShotInspector ? '' : 'without-inspector'}`}>
      {projects.length > 0 && <ProjectNavigator
        projects={projects}
        project={project}
        episodeId={episode?.id ?? null}
        onProject={navigateProject}
        onEpisode={navigateEpisode}
        onDeleteEpisode={id=>void openEpisodeDeletion(id)}
        onNewProject={() => setProjectDialog(true)}
        onNewEpisode={() => setEpisodeDialog(true)}
        onScriptImport={() => {setGlobalSection('script'); changeWorkArea('import');}}
        onCharacters={() => {setGlobalSection('assets'); changeWorkArea('characters');}}
      />}
      <section
        className="workspace-center"
        id={showStageTabs && workArea !== 'inspector' ? `workspace-panel-${workArea}` : undefined}
        role={showStageTabs && workArea !== 'inspector' ? 'tabpanel' : undefined}
        aria-labelledby={showStageTabs && workArea !== 'inspector' ? `workspace-tab-${workArea}` : undefined}
      >{center}</section>
      {projects.length > 0 && showShotInspector && <section
        className="workspace-inspector"
        id={workArea === 'inspector' ? 'workspace-panel-inspector' : undefined}
        role={workArea === 'inspector' ? 'tabpanel' : undefined}
        aria-labelledby={workArea === 'inspector' ? 'workspace-tab-inspector' : undefined}
      >{selectedShot ? <Inspector shot={selectedShot} onShotUpdated={updateShotInEpisode} onOpenMedia={mode=>{setSelectedShotId(selectedShot.id);setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionDialogueShotId(null);setProductionMedia({shotId:selectedShot.id,mode});setGlobalSection('episode');changeWorkArea('production');}} onOpenDialogue={()=>{setSelectedShotId(selectedShot.id);setProductionReviewShotId(null);setProductionDirectorShotId(null);setProductionMedia(null);setProductionDialogueShotId(selectedShot.id);setGlobalSection('episode');changeWorkArea('production');}}/> : <aside className="inspector empty-inspector"><p>选择镜头后编辑制作参数。</p></aside>}</section>}
    </div>
    <CreateProjectDialog open={projectDialog} onClose={() => setProjectDialog(false)} onCreate={async (data: ProjectCreate) => {const created = await createProject(data); setProjectDialog(false); await reloadProjects(created.id);}}/>
    <CreateEpisodeDialog open={episodeDialog} onClose={() => setEpisodeDialog(false)} onCreate={async (data: EpisodeCreate) => {if (!project) return; const created = await createEpisode(project.id, data); setEpisodeDialog(false); await loadProject(project.id); await loadEpisode(created.id);}}/>
    <DeleteEpisodeDialog episode={deletingEpisode} preview={deletionPreview} busy={deletionBusy} error={deletionError} warnings={deletionWarnings} onCancel={closeEpisodeDeletion} onConfirm={()=>void confirmEpisodeDeletion()}/>
    {searchOverlay}
  </div>;
}
