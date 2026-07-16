'use client';

import {Box,Check,ImagePlus,LoaderCircle,Pencil,RefreshCw,Sparkles,Trash2} from 'lucide-react';
import {Fragment,useEffect,useRef,useState} from 'react';
import {
  activateCharacterReference,
  approveModel3DJob,
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
  generateModel3D,
  getAssetVariantImpact,
  getAssetVariantStateImpact,
  getCharacterImpact,
  getLatestModel3DJob,
  getEpisodeProductionGraph,
  createProductionRun,
  listCharacterReferences,
  listCharacter3DRepresentations,
  listLibraryAssets,
  listAssetVariants,
  mediaUrl,
  retryModelRuntimeJob,
  updateAssetVariant,
  updateAssetVariantState,
  updateCharacterReference,
  updateCharacter,
  updateLibraryAsset,
  uploadCharacterReference,
  uploadCharacter3DRepresentation,
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
import {CharacterModelPreview} from './assets/CharacterModelPreview';

const types:Array<[CharacterReferenceType,string]>=[
  ['primary','主参考'],['front','正面'],['three_quarter','四分之三'],
  ['side','侧面'],['back','背面'],['expression','表情'],['outfit','服装'],
];
const labels=Object.fromEntries(types) as Record<CharacterReferenceType,string>;
const setMetadata=(job:Job|null)=>job?.result_metadata as Partial<CharacterReferenceSetMetadata>|undefined;
const modelMetadata=(metadata:Record<string,unknown>|undefined)=>{
  const skinCount=typeof metadata?.skin_count==='number'?metadata.skin_count:null;
  const jointCount=typeof metadata?.joint_count==='number'?metadata.joint_count:null;
  const clips=Array.isArray(metadata?.animation_clips)?metadata.animation_clips:[];
  const animationClips=clips.flatMap(item=>{
    if(!item||typeof item!=='object')return[];
    const clip=item as Record<string,unknown>;
    if(typeof clip.name!=='string')return[];
    return[{name:clip.name,duration:typeof clip.duration_seconds==='number'&&Number.isFinite(clip.duration_seconds)?clip.duration_seconds:null}];
  });
  const morphTargets=Array.from(new Set((Array.isArray(metadata?.morph_targets)?metadata.morph_targets:[]).filter((name):name is string=>typeof name==='string'&&Boolean(name.trim())).map(name=>name.trim())));
  return{skinCount,jointCount,animationClips,morphTargets};
};

export function CharacterWorkspace({projectId,characters,episodes=[],onCharactersChanged,onMetricsChanged}:{projectId?:string;characters:Character[];episodes?:EpisodeSummary[];onCharactersChanged?:()=>Promise<void>|void;onMetricsChanged?:()=>Promise<void>|void}){
  const [workspaceCharacters,setWorkspaceCharacters]=useState(characters);
  const [selected,setSelected]=useState(characters[0]?.id??'');
  const [view,setView]=useState<AssetWorkspaceView>('catalog');
  const [filter,setFilter]=useState<CharacterReferenceType>('primary');
  const [assetData,setAssetData]=useState<Record<string,CharacterAssetCatalogData>>({});
  const [libraryAssets,setLibraryAssets]=useState<LibraryAsset[]>([]);
  const [libraryError,setLibraryError]=useState('');
  const [error,setError]=useState('');
  const [generating,setGenerating]=useState(false);
  const [currentJob,setCurrentJob]=useState<Job|null>(null);
  const [model3dJob,setModel3dJob]=useState<Job|null>(null);
  const [model3dBusy,setModel3dBusy]=useState(false);
  const [model3dError,setModel3dError]=useState('');
  const [modelScope,setModelScope]=useState('master');
  const [modelImpact,setModelImpact]=useState<AssetImpact|null>(null);
  const [modelImpactLoading,setModelImpactLoading]=useState(false);
  const [modelImpactMessage,setModelImpactMessage]=useState('');
  const [editingReferenceId,setEditingReferenceId]=useState('');
  const [editingReferenceLabel,setEditingReferenceLabel]=useState('');
  const completedCount=useRef(0);
  const loadRequests=useRef<Record<string,number>>({});
  const libraryLoadRequest=useRef(0);
  useEffect(()=>setWorkspaceCharacters(characters),[characters]);
  const resolvedProjectId=projectId??workspaceCharacters[0]?.project_id??'';
  const character=workspaceCharacters.find(item=>item.id===selected)??workspaceCharacters[0];
  const references=character?assetData[character.id]?.references??[]:[];
  const variants=character?assetData[character.id]?.variants??[]:[];
  const representations=character?assetData[character.id]?.representations??[]:[];
  const selectedScope=(()=>{if(modelScope.startsWith('state:')){const stateId=modelScope.slice(6);const variant=variants.find(item=>item.states.some(state=>state.id===stateId));return{variantId:variant?.id??null,stateId};}if(modelScope.startsWith('variant:'))return{variantId:modelScope.slice(8),stateId:null};return{variantId:null,stateId:null};})();
  const characterIds=workspaceCharacters.map(item=>item.id).join('|');

  const load=async(id:string)=>{
    const request=(loadRequests.current[id]??0)+1;
    loadRequests.current[id]=request;
    try{
      const [nextReferences,nextVariants,nextRepresentations]=await Promise.all([listCharacterReferences(id),listAssetVariants(id),listCharacter3DRepresentations(id)]);
      if(request!==loadRequests.current[id])return;
      setAssetData(current=>({...current,[id]:{references:nextReferences,variants:nextVariants,representations:nextRepresentations}}));
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
  useEffect(()=>setModelScope('master'),[character?.id]);
  useEffect(()=>{
    let current=true;
    if(!character){setModel3dJob(null);return;}
    void getLatestModel3DJob('character',character.id,selectedScope.variantId,selectedScope.stateId).then(job=>{if(current)setModel3dJob(job);}).catch(()=>{if(current)setModel3dJob(null);});
    return()=>{current=false;};
  },[character?.id,modelScope,selectedScope.variantId,selectedScope.stateId]);

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

  const addLibraryAsset=async(data:LibraryAssetCreate)=>{
    if(!resolvedProjectId)throw new Error('缺少项目 ID，无法创建资产');
    await createLibraryAsset(resolvedProjectId,data);
    await reloadLibraryAssets();
    await onMetricsChanged?.();
  };
  const editLibraryAsset=async(id:string,data:LibraryAssetPatch)=>{await updateLibraryAsset(id,data);await reloadLibraryAssets();};
  const removeLibraryAsset=async(id:string)=>{await deleteLibraryAsset(id);await reloadLibraryAssets();await onMetricsChanged?.();};
  const uploadLibraryMedia=async(id:string,file:File)=>{await uploadLibraryAssetMedia(id,file,file.name);await reloadLibraryAssets();await onMetricsChanged?.();};
  const generateLibraryImage=async(id:string)=>{const started=await generateLibraryAssetImage(id);const finished=await pollJob(started.job_id);if(finished.status==='failed')throw new Error(finished.error||'场景参考图生成失败');await reloadLibraryAssets();await onMetricsChanged?.();};
  const generateLibraryModel=async(id:string,referenceAssetId:string)=>{
    const started=await generateModel3D('library_asset',id,referenceAssetId);
    const finished=await pollJob(started.job_id);
    if(finished.status==='failed')throw new Error(finished.error||'3D 生成失败');
    return finished;
  };
  const approveLibraryModel=async(jobId:string)=>{await approveModel3DJob(jobId);await reloadLibraryAssets();await onMetricsChanged?.();};
  const loadLibraryModelJob=(id:string)=>getLatestModel3DJob('library_asset',id);
  const addCharacter=async(data:CharacterDraft)=>{if(!resolvedProjectId)throw new Error('缺少项目 ID，无法创建角色');const created=await createCharacter(resolvedProjectId,data);setWorkspaceCharacters(current=>[...current,created]);setAssetData(current=>({...current,[created.id]:{references:[],variants:[]}}));setSelected(created.id);await onCharactersChanged?.();};
  const editCharacter=async(id:string,data:CharacterDraft)=>{const updated=await updateCharacter(id,data);setWorkspaceCharacters(current=>current.map(item=>item.id===id?{...item,...updated,id}:item));await onCharactersChanged?.();};
  const catalog=<AssetCatalogView characters={workspaceCharacters} character={character??null} references={references} variants={variants} characterAssets={assetData} libraryAssets={libraryAssets} libraryError={libraryError} onSelect={setSelected} onOpen={setView} onCreateCharacter={addCharacter} onUpdateCharacter={editCharacter} onCreateLibraryAsset={addLibraryAsset} onUpdateLibraryAsset={editLibraryAsset} onDeleteLibraryAsset={removeLibraryAsset} onUploadLibraryAssetMedia={uploadLibraryMedia} onGenerateLibraryAssetImage={generateLibraryImage} onGenerateLibraryAssetModel={generateLibraryModel} onApproveLibraryAssetModel={approveLibraryModel} onLoadLibraryAssetModelJob={loadLibraryModelJob}/>;

  if(!character)return catalog;

  const upload=async(file:File|null)=>{
    if(!file)return;
    try{await uploadCharacterReference(character.id,filter,file);await load(character.id);}
    catch(cause){setError(cause instanceof Error?cause.message:'上传失败');}
  };
  const uploadModel=async(file:File|null)=>{if(!file)return;try{if(selectedScope.variantId||selectedScope.stateId)await uploadCharacter3DRepresentation(character.id,file,'',selectedScope.variantId,selectedScope.stateId);else await uploadCharacter3DRepresentation(character.id,file);await load(character.id);}catch(cause){setError(cause instanceof Error?cause.message:'3D 模型上传失败');}};
  const approvedReferenceFor=(...referenceTypes:CharacterReferenceType[])=>references.find(item=>referenceTypes.includes(item.reference_type)&&item.review_status==='approved'&&item.is_active)??references.find(item=>referenceTypes.includes(item.reference_type)&&item.review_status==='approved')??null;
  const modelReferences=[
    approvedReferenceFor('primary','front'),
    approvedReferenceFor('three_quarter'),
    approvedReferenceFor('side'),
    approvedReferenceFor('back'),
  ].filter((item):item is CharacterReference=>item!==null);
  const modelReference=modelReferences[0]??null;
  const modelReferenceIds=modelReferences.map(item=>item.asset.id);
  const generateCharacterModel=async()=>{
    if(model3dBusy)return;
    if(!modelReference){setModel3dError('请先批准至少一张角色参考图');return;}
    setModel3dBusy(true);setModel3dError('');
    try{
      const started=await generateModel3D(
        'character',
        character.id,
        modelReference.asset.id,
        selectedScope.variantId,
        selectedScope.stateId,
        modelReferenceIds,
      );
      const finished=await pollJob(started.job_id,{onUpdate:setModel3dJob});
      setModel3dJob(finished);
      if(finished.status==='failed')throw new Error(finished.error||'3D 生成失败');
      await load(character.id);
    }catch(cause){setModel3dError(cause instanceof Error?cause.message:'3D 生成失败');}
    finally{setModel3dBusy(false);}
  };
  const confirmApproveCharacterModel=async(regenerate:boolean)=>{
    if(!model3dJob||model3dBusy)return;
    setModel3dBusy(true);setModel3dError('');
    try{await approveModel3DJob(model3dJob.id);await load(character.id);setModel3dJob(current=>current?{...current,result_metadata:{...current.result_metadata,review_status:'approved',is_active:true}}:current);await onMetricsChanged?.();}
    catch(cause){setModel3dError(cause instanceof Error?cause.message:'批准 3D 候选失败');setModel3dBusy(false);return;}
    if(!regenerate||!modelImpact){setModelImpact(null);setModel3dBusy(false);return;}
    try{await regenerateImpact(modelImpact);setModelImpactMessage(`3D 候选已批准，已启动 ${modelImpact.episodes.length} 集的画面重生成`);}
    catch(cause){setModelImpactMessage(`3D 候选已批准；${cause instanceof Error?cause.message:'启动画面重生成失败'}`);}
    finally{setModel3dBusy(false);}
  };
  const requestApproveCharacterModel=async()=>{
    if(model3dBusy)return;
    setModelImpactLoading(true);setModel3dError('');setModelImpactMessage('');
    try{setModelImpact(await analyzeImpact({characterId:character.id,variantId:selectedScope.variantId,stateId:selectedScope.stateId}));}
    catch(cause){setModel3dError(cause instanceof Error?cause.message:'分析 3D 变更影响失败');}
    finally{setModelImpactLoading(false);}
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
    await load(character.id);
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
  const activate=async(reference:CharacterReference)=>{await activateCharacterReference(character.id,reference.id);await load(character.id);await onMetricsChanged?.();};
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
  const scopedRepresentations=representations.filter(item=>item.variant_id===selectedScope.variantId&&item.state_id===selectedScope.stateId);
  const candidateId=String(model3dJob?.result_metadata?.representation_id??'');
  const candidateRepresentation=scopedRepresentations.find(item=>item.id===candidateId)??scopedRepresentations.find(item=>!item.is_active&&item.review_status!=='approved')??null;
  const activeRepresentation=scopedRepresentations.find(item=>item.is_active)??null;
  const visibleRepresentation=candidateRepresentation??activeRepresentation;
  const visibleModelMetadata=modelMetadata(visibleRepresentation?.metadata);
  const candidatePending=Boolean(candidateRepresentation&&model3dJob?.status==='succeeded'&&model3dJob.result_metadata?.is_active!==true);
  const modelManager=<><section className="character-model-section"><header><div><strong>3D 导演代理</strong><small>角色必须使用 GLB；AI 候选批准后才进入导演台</small><small>{modelReferenceIds.length?`将使用 ${modelReferenceIds.length} 张已批准视图`:'需要已批准的主参考或结构视图'}</small></div><div className="character-model-actions"><select aria-label="3D 模型作用域" value={modelScope} onChange={event=>setModelScope(event.target.value)}><option value="master">作品主设定</option>{variants.filter(item=>item.kind==='episode').map(variant=><Fragment key={variant.id}><option value={`variant:${variant.id}`}>{variant.label}</option>{variant.states.map(state=><option key={state.id} value={`state:${state.id}`}>{variant.label} / {state.label}</option>)}</Fragment>)}</select><button type="button" onClick={()=>void generateCharacterModel()} disabled={model3dBusy||!modelReference}>{model3dBusy?<LoaderCircle className="reference-spinner" size={15}/>:<Sparkles size={15}/>}根据参考图生成 3D</button><label>上传 GLB<input aria-label="上传角色 3D 模型" type="file" accept=".glb,model/gltf-binary" onChange={event=>void uploadModel(event.target.files?.[0]??null)}/></label></div></header>{visibleRepresentation?<><CharacterModelPreview url={visibleRepresentation.model_url}/><div className="character-model-meta"><strong>{visibleRepresentation.label}</strong><span>{visibleRepresentation.triangle_count.toLocaleString()} 三角面</span><span>{visibleRepresentation.has_skeleton?'含骨骼':'静态代理'}</span>{candidatePending&&<button type="button" className="primary-action" onClick={()=>void requestApproveCharacterModel()} disabled={model3dBusy||modelImpactLoading}><Check size={14}/>{modelImpactLoading?'正在分析':'批准使用 3D 候选'}</button>}</div></>:<div className="character-model-empty"><Box size={24}/><span>{model3dBusy?'正在生成 3D 候选':'当前作用域尚未准备 GLB'}</span></div>}{model3dError&&<p className="form-error" role="alert">{model3dError}</p>}</section>{modelImpact&&<div className="dialog-backdrop"><section className="form-dialog impact-dialog" role="dialog" aria-label="确认 3D 变更影响"><header><div><h2>确认 3D 变更影响</h2><small>批准后会影响 {modelImpact.shots.length} 个已绑定镜头</small></div><button type="button" aria-label="关闭 3D 影响" onClick={()=>setModelImpact(null)}>×</button></header><div className="impact-report">{modelImpact.episodes.length?modelImpact.episodes.map(episode=><section key={episode.episode_id}><h3>{episode.episode_title}</h3>{episode.scenes.map(scene=><div className="impact-scene" key={scene.scene_id}><strong>{scene.scene_label}</strong>{scene.shots.map(shot=><p key={shot.id}>镜头 {String(shot.position).padStart(2,'0')} · {shot.composition}</p>)}</div>)}</section>):<p>当前 3D 作用域没有已绑定镜头。</p>}</div>{modelImpactMessage&&<p role="status" className="impact-message">{modelImpactMessage}</p>}<footer><button type="button" onClick={()=>setModelImpact(null)}>{modelImpactMessage?'关闭':'取消'}</button>{!modelImpactMessage&&<><button type="button" onClick={()=>void confirmApproveCharacterModel(false)} disabled={model3dBusy}>{model3dBusy?'正在批准':'仅批准'}</button>{modelImpact.shots.length>0&&<button type="button" className="primary-action" onClick={()=>void confirmApproveCharacterModel(true)} disabled={model3dBusy}>{model3dBusy?'正在处理':'批准并重生成'}</button>}</>}</footer></section></div>}</>;
  const modelMetadataSummary=visibleRepresentation?<div className="character-model-meta"><span>{visibleModelMetadata.skinCount!==null&&visibleModelMetadata.jointCount!==null?`${visibleModelMetadata.skinCount} 套骨骼 · ${visibleModelMetadata.jointCount} 个关节`:''}</span>{visibleModelMetadata.animationClips.map(clip=><span key={clip.name}>动画片段：{clip.name}{clip.duration!==null?`（${clip.duration} 秒）`:''}</span>)}{visibleModelMetadata.morphTargets.length>0&&<span>表情目标：{visibleModelMetadata.morphTargets.join('、')}</span>}</div>:null;

  if(view!=='catalog')return <CharacterMasterView
    characters={workspaceCharacters}
    character={character}
    references={references}
    variants={variants}
    referenceManager={referenceManager}
    variantWorkspace={<AssetVariantEditorView embedded character={character} references={references} variants={variants} episodes={episodes} onOpen={setView} onCreateVariant={addEpisodeVariant} onCreateState={addState}/>}
    lineageWorkspace={<AssetLineageCanvas character={character} references={references} variants={variants} episodes={episodes} onCreateVariant={addVariant} onUpdateVariant={editVariant} onDeleteVariant={removeVariant} onCreateState={addState} onUpdateState={editState} onDeleteState={removeState} onLoadEpisodeShots={loadEpisodeShots} onCreateUsage={addUsage} onAnalyzeImpact={analyzeImpact} onRegenerateImpact={regenerateImpact}/>}
    modelManager={<>{modelManager}{modelMetadataSummary}</>}
    initialTab={view==='variant'?'variant':view==='lineage'?'lineage':'master'}
    onSelect={setSelected}
    onOpen={setView}
  />;

  return catalog;
}
