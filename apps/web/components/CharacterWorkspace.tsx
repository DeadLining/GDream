'use client';

import {Check,ImagePlus,LoaderCircle,RefreshCw,Sparkles} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {
  activateCharacterReference,
  createLibraryAsset,
  createAssetVariant,
  createAssetVariantState,
  createAssetVariantUsage,
  deleteLibraryAsset,
  deleteAssetVariant,
  deleteAssetVariantState,
  generateCharacterReferenceSet,
  getEpisodeProductionGraph,
  listCharacterReferences,
  listLibraryAssets,
  listAssetVariants,
  mediaUrl,
  retryModelRuntimeJob,
  updateAssetVariant,
  updateAssetVariantState,
  updateCharacterReference,
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
  type AssetWorkspaceView,
} from './assets/AssetLibraryViews';
import {AssetLineageCanvas} from './canvas/AssetLineageCanvas';

const types:Array<[CharacterReferenceType,string]>=[
  ['primary','主参考'],['front','正面'],['three_quarter','四分之三'],
  ['side','侧面'],['back','背面'],['expression','表情'],['outfit','服装'],
];
const labels=Object.fromEntries(types) as Record<CharacterReferenceType,string>;
const setMetadata=(job:Job|null)=>job?.result_metadata as Partial<CharacterReferenceSetMetadata>|undefined;

export function CharacterWorkspace({projectId,characters,episodes=[]}:{projectId?:string;characters:Character[];episodes?:EpisodeSummary[]}){
  const [selected,setSelected]=useState(characters[0]?.id??'');
  const [view,setView]=useState<AssetWorkspaceView>('catalog');
  const [filter,setFilter]=useState<CharacterReferenceType>('primary');
  const [assetData,setAssetData]=useState<Record<string,CharacterAssetCatalogData>>({});
  const [libraryAssets,setLibraryAssets]=useState<LibraryAsset[]>([]);
  const [libraryError,setLibraryError]=useState('');
  const [error,setError]=useState('');
  const [generating,setGenerating]=useState(false);
  const [currentJob,setCurrentJob]=useState<Job|null>(null);
  const completedCount=useRef(0);
  const loadRequests=useRef<Record<string,number>>({});
  const libraryLoadRequest=useRef(0);
  const resolvedProjectId=projectId??characters[0]?.project_id??'';
  const character=characters.find(item=>item.id===selected)??characters[0];
  const references=character?assetData[character.id]?.references??[]:[];
  const variants=character?assetData[character.id]?.variants??[]:[];
  const characterIds=characters.map(item=>item.id).join('|');

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
  useEffect(()=>{for(const item of characters)void load(item.id);},[characterIds]);

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
  };
  const editLibraryAsset=async(id:string,data:LibraryAssetPatch)=>{await updateLibraryAsset(id,data);await reloadLibraryAssets();};
  const removeLibraryAsset=async(id:string)=>{await deleteLibraryAsset(id);await reloadLibraryAssets();};
  const uploadLibraryMedia=async(id:string,file:File)=>{await uploadLibraryAssetMedia(id,file,file.name);await reloadLibraryAssets();};
  const catalog=<AssetCatalogView characters={characters} character={character??null} references={references} variants={variants} characterAssets={assetData} libraryAssets={libraryAssets} libraryError={libraryError} onSelect={setSelected} onOpen={setView} onCreateLibraryAsset={addLibraryAsset} onUpdateLibraryAsset={editLibraryAsset} onDeleteLibraryAsset={removeLibraryAsset} onUploadLibraryAssetMedia={uploadLibraryMedia}/>;

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
  const activate=async(reference:CharacterReference)=>{await activateCharacterReference(character.id,reference.id);await load(character.id);};
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
    <div className="reference-grid">{visible.map(reference=><article key={reference.id} className={reference.is_active?'active':''}><img src={mediaUrl(reference.asset.media_url)} alt={`${character.name}${reference.label||'参考图'}`}/><div><span>{reference.label||labels[reference.reference_type]}</span><small>{reference.review_status==='approved'?'已批准':'待审核'}{reference.is_active?' · 使用中':''}</small></div><div className="reference-commands">{reference.review_status!=='approved'&&<button onClick={()=>approve(reference)}><Check size={14}/>批准</button>}{reference.review_status==='approved'&&!reference.is_active&&<button onClick={()=>activate(reference)}>设为使用</button>}</div></article>)}</div>
  </section>;

  if(view!=='catalog')return <CharacterMasterView
    characters={characters}
    character={character}
    references={references}
    variants={variants}
    referenceManager={referenceManager}
    variantWorkspace={<AssetVariantEditorView embedded character={character} references={references} variants={variants} episodes={episodes} onOpen={setView} onCreateVariant={addEpisodeVariant} onCreateState={addState}/>}
    lineageWorkspace={<AssetLineageCanvas character={character} references={references} variants={variants} episodes={episodes} onCreateVariant={addVariant} onUpdateVariant={editVariant} onDeleteVariant={removeVariant} onCreateState={addState} onUpdateState={editState} onDeleteState={removeState} onLoadEpisodeShots={loadEpisodeShots} onCreateUsage={addUsage}/>}
    initialTab={view==='variant'?'variant':view==='lineage'?'lineage':'master'}
    onSelect={setSelected}
    onOpen={setView}
  />;

  return catalog;
}
