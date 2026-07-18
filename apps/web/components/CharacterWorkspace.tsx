'use client';

import {Check,ImagePlus,LoaderCircle,Pencil,RefreshCw,Sparkles,Trash2} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {
  activateCharacterReference,
  bindLibraryAssetToScene,
  createCharacter,
  createLibraryAsset,
  createAssetVariant,
  createAssetVariantState,
  createAssetVariantUsage,
  deleteLibraryAsset,
  deleteCharacterReference,
  deleteAssetVariant,
  deleteAssetVariantState,
  generateCharacterReferenceSet,
  generateLibraryAssetImage,
  getAssetVariantImpact,
  getAssetVariantStateImpact,
  getCharacterImpact,
  getShotGenerationReadiness,
  getEpisodeProductionGraph,
  createProductionRun,
  listCharacterReferences,
  listAssetRequirements,
  listLibraryAssets,
  listAssetVariants,
  mediaUrl,
  retryModelRuntimeJob,
  syncAssetRequirements,
  updateAssetVariant,
  updateAssetVariantState,
  updateCharacterReference,
  updateCharacter,
  updateLibraryAsset,
  uploadCharacterReference,
  uploadLibraryAssetMedia,
} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {
  Character,
  CharacterReference,
  CharacterReferenceSetMetadata,
  CharacterReferenceType,
  AssetVariant,
  AssetImpact,
  LibraryAsset,
  LibraryAssetCreate,
  LibraryAssetPatch,
  Job,
  EpisodeSummary,
  ProjectSearchResult,
  ShotGenerationReadiness,
} from '../lib/types';
import {
  AssetCatalogView,
  AssetVariantEditorView,
  CharacterMasterView,
  type CharacterAssetCatalogData,
  type CharacterDraft,
  type AssetWorkspaceView,
} from './assets/AssetLibraryViews';
import {AssetLineageCanvas} from './canvas/AssetLineageCanvas';
import {normalizeAssetImpact} from '../lib/asset-impact';
import type {AssetRequirement,GenerationAssetRequest} from '../lib/shot-generation-readiness';

const types:Array<[CharacterReferenceType,string]>=[
  ['primary','主参考'],['front','正面'],['three_quarter','四分之三'],
  ['side','侧面'],['back','背面'],['expression','表情'],['outfit','服装'],
];
const labels=Object.fromEntries(types) as Record<CharacterReferenceType,string>;
const setMetadata=(job:Job|null)=>job?.result_metadata as Partial<CharacterReferenceSetMetadata>|undefined;
const defaultAssetRequest:GenerationAssetRequest={target:'character',shotId:'',requirementIds:[]};
const requirementsForRequest=(items:AssetRequirement[],request:GenerationAssetRequest)=>items.filter(item=>{
  if(item.kind!==request.target)return false;
  if(request.requirementIds.length&&request.requirementIds.includes(item.id))return true;
  const shotIds=Array.isArray(item.source_context.shot_ids)?item.source_context.shot_ids:[];
  return Boolean(request.shotId&&shotIds.includes(request.shotId));
});

export function CharacterWorkspace({projectId,characters,episodes=[],requestedAssetRequest=defaultAssetRequest,searchTarget,onCharactersChanged,onMetricsChanged,onReturnToShot}:{projectId?:string;characters:Character[];episodes?:EpisodeSummary[];requestedAssetRequest?:GenerationAssetRequest;searchTarget?:ProjectSearchResult|null;onCharactersChanged?:()=>Promise<void>|void;onMetricsChanged?:()=>Promise<void>|void;onReturnToShot?:(shotId:string)=>void}){
  const [workspaceCharacters,setWorkspaceCharacters]=useState(characters);
  const [selected,setSelected]=useState(characters[0]?.id??'');
  const [view,setView]=useState<AssetWorkspaceView>('catalog');
  const [filter,setFilter]=useState<CharacterReferenceType>('primary');
  const [assetData,setAssetData]=useState<Record<string,CharacterAssetCatalogData>>({});
  const [libraryAssets,setLibraryAssets]=useState<LibraryAsset[]>([]);
  const [libraryError,setLibraryError]=useState('');
  const [assetRequirements,setAssetRequirements]=useState<AssetRequirement[]>([]);
  const [assetRequirementError,setAssetRequirementError]=useState('');
  const [generationReadiness,setGenerationReadiness]=useState<ShotGenerationReadiness|null>(null);
  const [error,setError]=useState('');
  const [generating,setGenerating]=useState(false);
  const [currentJob,setCurrentJob]=useState<Job|null>(null);
  const [editingReferenceId,setEditingReferenceId]=useState('');
  const [editingReferenceLabel,setEditingReferenceLabel]=useState('');
  const completedCount=useRef(0);
  const loadRequests=useRef<Record<string,number>>({});
  const libraryLoadRequest=useRef(0);
  useEffect(()=>setWorkspaceCharacters(characters),[characters]);
  useEffect(()=>setView('catalog'),[requestedAssetRequest]);
  const resolvedProjectId=projectId??workspaceCharacters[0]?.project_id??'';
  const character=workspaceCharacters.find(item=>item.id===selected)??workspaceCharacters[0];
  const references=character?assetData[character.id]?.references??[]:[];
  const variants=character?assetData[character.id]?.variants??[]:[];
  const characterIds=workspaceCharacters.map(item=>item.id).join('|');
  const requestedRequirementIds=requestedAssetRequest.requirementIds.join('|');
  const searchCategory=searchTarget?.kind==='library_asset'&&searchTarget.library_asset_kind?searchTarget.library_asset_kind:requestedAssetRequest.target;

  const load=async(id:string)=>{
    const request=(loadRequests.current[id]??0)+1;
    loadRequests.current[id]=request;
    try{
      const [nextReferences,nextVariants]=await Promise.all([listCharacterReferences(id),listAssetVariants(id)]);
      if(request!==loadRequests.current[id])return;
      setAssetData(current=>({...current,[id]:{references:nextReferences,variants:nextVariants}}));
      setError('');
    }catch(cause){
      if(request!==loadRequests.current[id])return;
      setError(cause instanceof Error?cause.message:'加载失败');
    }
  };
  const analyzeImpact=async({characterId,variantId,stateId}:{characterId:string;variantId:string|null;stateId:string|null})=>normalizeAssetImpact(await(stateId?getAssetVariantStateImpact(stateId):variantId?getAssetVariantImpact(variantId):getCharacterImpact(characterId)));
  const regenerateImpact=async(impact:AssetImpact)=>{
    let started=0;
    const errors:string[]=[];
    for(const episode of impact.episodes){
      const shotIds=episode.scenes.flatMap(scene=>scene.shots.map(shot=>shot.id));
      if(!shotIds.length)continue;
      try{
        await createProductionRun(episode.episode_id,{stages:['panels'],shot_ids:shotIds,concurrency:2,regenerate_panels:true,regenerate_speech:false,regenerate_videos:false});
        started+=1;
      }catch(cause){errors.push(`${episode.episode_title}：${cause instanceof Error?cause.message:'启动失败'}`);}
    }
    if(errors.length)throw new Error(`已启动 ${started} 集，${errors.length} 集失败：${errors.join('；')}`);
  };
  useEffect(()=>{for(const item of workspaceCharacters)void load(item.id);},[characterIds]);
  useEffect(()=>{
    if(!searchTarget)return;
    if(searchTarget.kind==='library_asset'){setView('catalog');return;}
    if(searchTarget.character_id&&workspaceCharacters.some(item=>item.id===searchTarget.character_id))setSelected(searchTarget.character_id);
    if(searchTarget.kind==='character')setView('master');
    else if(searchTarget.kind==='asset_variant'||searchTarget.kind==='asset_state')setView('variant');
  },[searchTarget,characterIds]);

  const reloadLibraryAssets=async()=>{
    if(!resolvedProjectId){setLibraryAssets([]);return;}
    const request=++libraryLoadRequest.current;
    try{
      const nextAssets=await listLibraryAssets(resolvedProjectId);
      if(request!==libraryLoadRequest.current)return;
      setLibraryAssets(nextAssets);
      setLibraryError('');
    }catch(cause){
      if(request!==libraryLoadRequest.current)return;
      setLibraryError(cause instanceof Error?cause.message:'加载作品资产失败');
    }
  };
  useEffect(()=>{void reloadLibraryAssets();},[resolvedProjectId]);

  useEffect(()=>{
    let active=true;
    if(!resolvedProjectId){setAssetRequirements([]);setAssetRequirementError('');return;}
    const request=requestedAssetRequest.shotId?listAssetRequirements(resolvedProjectId,requestedAssetRequest.target):listAssetRequirements(resolvedProjectId);
    void request.then(items=>{if(active){const next=requestedAssetRequest.shotId?requirementsForRequest(items,requestedAssetRequest):items;setAssetRequirements(next);setAssetRequirementError('');}}).catch(cause=>{if(active){setAssetRequirements([]);setAssetRequirementError(cause instanceof Error?cause.message:'无法读取作品资产需求');}});
    return()=>{active=false;};
  },[resolvedProjectId,requestedAssetRequest.target,requestedAssetRequest.shotId,requestedRequirementIds]);
  useEffect(()=>{if(requestedAssetRequest.target==='character'){const characterId=assetRequirements.find(item=>item.binding_id)?.binding_id;if(characterId&&workspaceCharacters.some(item=>item.id===characterId))setSelected(characterId);}},[requestedAssetRequest.target,assetRequirements,characterIds]);
  useEffect(()=>{let active=true;if(!requestedAssetRequest.shotId){setGenerationReadiness(null);return;}void getShotGenerationReadiness(requestedAssetRequest.shotId).then(value=>{if(active)setGenerationReadiness(value);}).catch(()=>{if(active)setGenerationReadiness(null);});return()=>{active=false;};},[requestedAssetRequest.shotId]);

  const refreshAssetRequirements=async()=>{
    if(!resolvedProjectId)return;
    const items=await syncAssetRequirements(resolvedProjectId);
    if(requestedAssetRequest.shotId){
      const readiness=await getShotGenerationReadiness(requestedAssetRequest.shotId);
      setAssetRequirements(requirementsForRequest(items,requestedAssetRequest));
      setGenerationReadiness(readiness);
    }else{
      setAssetRequirements(items);
      setGenerationReadiness(null);
    }
    setAssetRequirementError('');
  };

  const addLibraryAsset=async(data:LibraryAssetCreate)=>{
    if(!resolvedProjectId)throw new Error('缺少项目 ID，无法创建资产');
    const created=await createLibraryAsset(resolvedProjectId,data);
    await reloadLibraryAssets();
    await onMetricsChanged?.();
    return created;
  };
  const editLibraryAsset=async(id:string,data:LibraryAssetPatch)=>{await updateLibraryAsset(id,data);await reloadLibraryAssets();};
  const removeLibraryAsset=async(id:string)=>{await deleteLibraryAsset(id);await reloadLibraryAssets();await onMetricsChanged?.();};
  const uploadLibraryMedia=async(id:string,file:File)=>{await uploadLibraryAssetMedia(id,file,file.name);await reloadLibraryAssets();await refreshAssetRequirements();await onMetricsChanged?.();};
  const generateLibraryImage=async(id:string)=>{const started=await generateLibraryAssetImage(id);const finished=await pollJob(started.job_id);if(finished.status==='failed')throw new Error(finished.error||'场景参考图生成失败');await reloadLibraryAssets();await refreshAssetRequirements();await onMetricsChanged?.();};
  const bindLibraryAsset=async(assetId:string,requirementId:string)=>{
    const requirement=assetRequirements.find(item=>item.id===requirementId);
    if(!requirement)throw new Error('镜头资产需求已变化，请重新进入');
    const sceneIds=(Array.isArray(requirement.source_context.scene_ids)?requirement.source_context.scene_ids:[]).filter((item):item is string=>typeof item==='string');
    if(!sceneIds.length)throw new Error('缺少需求对应的场景');
    for(const sceneId of sceneIds)await bindLibraryAssetToScene(sceneId,assetId);
    await reloadLibraryAssets();await refreshAssetRequirements();await onMetricsChanged?.();
  };
  const addCharacter=async(data:CharacterDraft)=>{if(!resolvedProjectId)throw new Error('缺少项目 ID，无法创建角色');const created=await createCharacter(resolvedProjectId,data);setWorkspaceCharacters(current=>[...current,created]);setAssetData(current=>({...current,[created.id]:{references:[],variants:[]}}));setSelected(created.id);await onCharactersChanged?.();};
  const editCharacter=async(id:string,data:CharacterDraft)=>{const updated=await updateCharacter(id,data);setWorkspaceCharacters(current=>current.map(item=>item.id===id?{...item,...updated,id}:item));await onCharactersChanged?.();};
  const catalog=<AssetCatalogView characters={workspaceCharacters} character={character??null} references={references} variants={variants} characterAssets={assetData} libraryAssets={libraryAssets} libraryError={libraryError} requestedCategory={searchCategory} initialLibraryAssetId={searchTarget?.kind==='library_asset'?searchTarget.library_asset_id??'':''} requirements={assetRequirements} requirementScope={requestedAssetRequest.shotId?'shot':'project'} requirementError={assetRequirementError} generationReadiness={generationReadiness} onBindLibraryAsset={bindLibraryAsset} onReturnToShot={requestedAssetRequest.shotId&&onReturnToShot?()=>onReturnToShot(requestedAssetRequest.shotId):undefined} onSelect={setSelected} onOpen={setView} onCreateCharacter={addCharacter} onUpdateCharacter={editCharacter} onCreateLibraryAsset={addLibraryAsset} onUpdateLibraryAsset={editLibraryAsset} onDeleteLibraryAsset={removeLibraryAsset} onUploadLibraryAssetMedia={uploadLibraryMedia} onGenerateLibraryAssetImage={generateLibraryImage}/>;

  if(!character)return catalog;

  const upload=async(file:File|null)=>{
    if(!file)return;
    try{await uploadCharacterReference(character.id,filter,file);await load(character.id);}
    catch(cause){setError(cause instanceof Error?cause.message:'上传失败');}
  };
  const follow=async(jobId:string)=>{
    const finished=await pollJob(jobId,{
      onUpdate:(job)=>{
        setCurrentJob(job);
        const completed=setMetadata(job)?.completed_types?.length??0;
        if(completed>completedCount.current){
          completedCount.current=completed;
          void load(character.id);
        }
      },
    });
    setCurrentJob(finished);
    if(finished.status==='failed'){
      const metadata=setMetadata(finished);
      const failedLabel=metadata?.failed_type?labels[metadata.failed_type]:'图片';
      throw new Error(`${failedLabel}生成失败：${finished.error||String(metadata?.error_code??'未知错误')}`);
    }
    await load(character.id);await refreshAssetRequirements();
  };
  const generate=async()=>{
    if(generating)return;
    setGenerating(true);setError('');setCurrentJob(null);completedCount.current=0;
    try{const started=await generateCharacterReferenceSet(character.id);await follow(started.job_id);}
    catch(cause){setError(cause instanceof Error?cause.message:'整套生成失败');}
    finally{setGenerating(false);}
  };
  const retry=async()=>{
    if(generating||!currentJob)return;
    setGenerating(true);setError('');
    try{const started=await retryModelRuntimeJob(currentJob.id);await follow(started.job_id);}
    catch(cause){setError(cause instanceof Error?cause.message:'续跑失败');}
    finally{setGenerating(false);}
  };
  const approve=async(reference:CharacterReference)=>{await updateCharacterReference(reference.id,{review_status:'approved'});await load(character.id);};
  const activate=async(reference:CharacterReference)=>{await activateCharacterReference(character.id,reference.id);await load(character.id);await refreshAssetRequirements();await onMetricsChanged?.();};
  const renameReference=async(reference:CharacterReference)=>{const label=editingReferenceLabel.trim();if(!label)return;try{await updateCharacterReference(reference.id,{label});setEditingReferenceId('');setEditingReferenceLabel('');await load(character.id);}catch(cause){setError(cause instanceof Error?cause.message:'重命名参考图失败');}};
  const removeReference=async(reference:CharacterReference)=>{const label=reference.label||labels[reference.reference_type];if(reference.is_active||!window.confirm(`删除参考图「${label}」？`))return;try{await deleteCharacterReference(reference.id);await load(character.id);}catch(cause){setError(cause instanceof Error?cause.message:'删除参考图失败');}};
  const addVariant=async(data:Parameters<typeof createAssetVariant>[1])=>{await createAssetVariant(character.id,data);await load(character.id);};
  const addEpisodeVariant=async(data:Parameters<typeof createAssetVariant>[1])=>{
    const master=variants.find(item=>item.kind==='master')??await createAssetVariant(character.id,{
      kind:'master',label:'作品主设定',episode_id:null,parent_variant_id:null,inherited_fields:[],overrides:{},
    });
    try{await createAssetVariant(character.id,{...data,kind:'episode',parent_variant_id:master.id});}
    catch(cause){await load(character.id);throw cause;}
    await load(character.id);
  };
  const addState=async(variantId:string,data:Parameters<typeof createAssetVariantState>[1])=>{await createAssetVariantState(variantId,data);await load(character.id);};
  const addUsage=async(variantId:string,data:Parameters<typeof createAssetVariantUsage>[1])=>{await createAssetVariantUsage(variantId,data);await load(character.id);};
  const loadEpisodeShots=async(episodeId:string)=>{const graph=await getEpisodeProductionGraph(episodeId);return graph.shots.map(shot=>({id:shot.id,label:`镜头 ${String(shot.position).padStart(2,'0')} · ${shot.composition}`}));};
  const editVariant=async(id:string,data:Parameters<typeof updateAssetVariant>[1])=>{await updateAssetVariant(id,data);await load(character.id);};
  const removeVariant=async(id:string)=>{await deleteAssetVariant(id);await load(character.id);};
  const editState=async(id:string,data:Parameters<typeof updateAssetVariantState>[1])=>{await updateAssetVariantState(id,data);await load(character.id);};
  const removeState=async(id:string)=>{await deleteAssetVariantState(id);await load(character.id);};
  const visible=references.filter(item=>item.reference_type===filter);
  const metadata=setMetadata(currentJob);
  const progressText=generating&&metadata?.current_type
    ?`正在生成 ${Math.min((metadata.current_index??0)+1,metadata.total??7)}/${metadata.total??7}：${labels[metadata.current_type]}`
    :generating?'正在准备整套参考图…':'';
  const canRetry=currentJob?.status==='failed'&&metadata?.retryable===true;

  const referenceManager=<section className="reference-manager">
    <div className="reference-filters">{types.map(([value,label])=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{label}</button>)}</div>
    <div className="reference-actions">
      <label><ImagePlus size={16}/>上传<input aria-label="上传角色参考图" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>void upload(event.target.files?.[0]??null)}/></label>
      <button onClick={generate} disabled={generating}>{generating?<LoaderCircle aria-hidden="true" className="reference-spinner" size={16}/>:<Sparkles aria-hidden="true" size={16}/>}<span>一键生成整套</span></button>
      {progressText&&<span role="status" className="reference-generation-progress">{progressText}</span>}
    </div>
    {error&&<div className="form-error reference-set-error" role="alert"><span>{error}</span>{canRetry&&<button onClick={retry} disabled={generating}><RefreshCw size={14}/>继续未完成项</button>}</div>}
    <div className="reference-grid">{visible.map(reference=>{const label=reference.label||labels[reference.reference_type];const editing=editingReferenceId===reference.id;return <article key={reference.id} className={reference.is_active?'active':''}><img src={mediaUrl(reference.asset.media_url)} alt={`${character.name}${label}`}/><div>{editing?<><input aria-label="参考图名称" value={editingReferenceLabel} onChange={event=>setEditingReferenceLabel(event.target.value)}/><button aria-label="保存参考图名称" onClick={()=>void renameReference(reference)}><Check size={14}/></button></>:<span>{label}</span>}<small>{reference.review_status==='approved'?'已批准':'待审核'}{reference.is_active?' · 使用中':''}</small></div><div className="reference-commands">{reference.review_status!=='approved'&&<button onClick={()=>approve(reference)}><Check size={14}/>批准</button>}{reference.review_status==='approved'&&!reference.is_active&&<button onClick={()=>activate(reference)}>设为使用</button>}<button aria-label={`重命名${label}`} onClick={()=>{setEditingReferenceId(reference.id);setEditingReferenceLabel(label);}}><Pencil size={14}/></button><button aria-label={`删除${label}`} title={reference.is_active?'使用中的参考图不能删除':'删除参考图'} disabled={reference.is_active} onClick={()=>void removeReference(reference)}><Trash2 size={14}/></button></div></article>;})}</div>
  </section>;
  if(view!=='catalog')return <CharacterMasterView
    characters={workspaceCharacters}
    character={character}
    references={references}
    variants={variants}
    referenceManager={referenceManager}
    variantWorkspace={<AssetVariantEditorView embedded character={character} references={references} variants={variants} episodes={episodes} initialVariantId={searchTarget?.variant_id??undefined} initialStateId={searchTarget?.state_id??undefined} onOpen={setView} onCreateVariant={addEpisodeVariant} onCreateState={addState}/>}
    lineageWorkspace={<AssetLineageCanvas character={character} references={references} variants={variants} episodes={episodes} onCreateVariant={addVariant} onUpdateVariant={editVariant} onDeleteVariant={removeVariant} onCreateState={addState} onUpdateState={editState} onDeleteState={removeState} onLoadEpisodeShots={loadEpisodeShots} onCreateUsage={addUsage} onAnalyzeImpact={analyzeImpact} onRegenerateImpact={regenerateImpact}/>}
    modelManager={null}
    initialTab={view==='variant'?'variant':view==='lineage'?'lineage':'master'}
    onSelect={setSelected}
    onOpen={setView}
  />;

  return catalog;
}
