'use client';

import {ArrowLeft,Box,Check,CheckCircle2,ChevronRight,Circle,GitBranch,ImageIcon,MessageSquareText,MousePointer2,Pencil,Plus,Search,Send,Sparkles,Trash2} from 'lucide-react';
import {useEffect,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {mediaUrl,suggestAssetVariant,type AssetVariantSuggestion} from '../../lib/api';
import type {AssetVariant,AssetVariantState,Character,CharacterBodyPlan,Character3DRepresentation,CharacterReference,CharacterReferenceType,EpisodeSummary,Job,LibraryAsset,LibraryAssetCreate,LibraryAssetKind,LibraryAssetPatch,ShotGenerationReadiness} from '../../lib/types';
import type {AssetRequirement} from '../../lib/shot-generation-readiness';

const referenceLabels:Record<CharacterReferenceType,string>={primary:'主参考',front:'正面',three_quarter:'四分之三',side:'侧面',back:'背面',expression:'表情',outfit:'服装'};
const stateLabels:Record<AssetVariantState['kind'],string>={expression:'表情',outfit:'服装',injury:'伤势',age:'年龄',custom:'自定义'};
const statusLabel=(status:string)=>status==='approved'?'已通过':status==='needs_changes'?'需修改':'待审核';
const firstReference=(references:CharacterReference[],type?:CharacterReferenceType)=>references.find(item=>(!type||item.reference_type===type)&&item.is_active)??references.find(item=>!type||item.reference_type===type);
const imageFor=(references:CharacterReference[],type?:CharacterReferenceType)=>{const reference=firstReference(references,type);return reference?mediaUrl(reference.asset.media_url):null;};

export type AssetWorkspaceView='catalog'|'master'|'variant'|'lineage';
export type AssetCatalogCategory='character'|LibraryAssetKind;
export type CharacterAssetCatalogData={references:CharacterReference[];variants:AssetVariant[];representations?:Character3DRepresentation[]};
export type CharacterDraft=Pick<Character,'name'|'role'|'appearance_bible'|'personality'|'continuity_rules'|'negative_constraints'|'voice_speaker'|'voice_instruction'>&{body_plan:CharacterBodyPlan};
type CharacterDetailTab='master'|'references'|'variant'|'lineage';

const libraryCategory:Record<LibraryAssetKind,{label:string;description:string}>={
  scene:{label:'场景',description:'管理地点、时间、氛围和连续性设定。'},
  prop:{label:'道具',description:'管理关键物件、手持物和剧情线索。'},
  costume:{label:'服装',description:'管理作品级服装方案和造型说明。'},
  sound:{label:'声音',description:'管理环境音、效果音和声音设计说明。'},
};

const emptyCharacterDraft:CharacterDraft={name:'',role:'',body_plan:'humanoid',appearance_bible:'',personality:'',continuity_rules:'',negative_constraints:'',voice_speaker:'',voice_instruction:''};
const bodyPlanLabels:Record<CharacterBodyPlan,string>={humanoid:'人形',quadruped:'四足',bird:'鸟类',other:'其他形态'};
const characterFields:Array<{key:keyof CharacterDraft;label:string;multiline?:boolean;required?:boolean}>=[
  {key:'name',label:'角色名称',required:true},{key:'role',label:'角色定位',required:true},
  {key:'appearance_bible',label:'外观设定',multiline:true,required:true},{key:'personality',label:'性格设定',multiline:true,required:true},
  {key:'continuity_rules',label:'连续性规则',multiline:true,required:true},{key:'negative_constraints',label:'禁止漂移',multiline:true},
  {key:'voice_speaker',label:'声音角色',required:true},{key:'voice_instruction',label:'配音说明',multiline:true},
];

export function AssetCatalogView({characters,character,references,variants,characterAssets={},libraryAssets=[],libraryError='',requestedCategory='character',initialLibraryAssetId='',requirements=[],requirementScope='shot',requirementError='',generationReadiness=null,onBindLibraryAsset,onReturnToShot,onOpenDirector,onSelect,onOpen,onCreateCharacter,onUpdateCharacter,onCreateLibraryAsset,onUpdateLibraryAsset,onDeleteLibraryAsset,onUploadLibraryAssetMedia,onGenerateLibraryAssetImage,onGenerateLibraryAssetModel,onApproveLibraryAssetModel,onLoadLibraryAssetModelJob}:{characters:Character[];character:Character|null;references:CharacterReference[];variants:AssetVariant[];characterAssets?:Record<string,CharacterAssetCatalogData>;libraryAssets?:LibraryAsset[];libraryError?:string;requestedCategory?:AssetCatalogCategory;initialLibraryAssetId?:string;requirements?:AssetRequirement[];requirementScope?:'shot'|'project';requirementError?:string;generationReadiness?:ShotGenerationReadiness|null;onBindLibraryAsset?:(assetId:string,requirementId:string)=>Promise<void>|void;onReturnToShot?:()=>void;onOpenDirector?:()=>void;onSelect:(id:string)=>void;onOpen:(view:AssetWorkspaceView)=>void;onCreateCharacter?:(data:CharacterDraft)=>Promise<void>|void;onUpdateCharacter?:(id:string,data:CharacterDraft)=>Promise<void>|void;onCreateLibraryAsset?:(data:LibraryAssetCreate)=>Promise<LibraryAsset|void>|LibraryAsset|void;onUpdateLibraryAsset?:(id:string,data:LibraryAssetPatch)=>Promise<void>|void;onDeleteLibraryAsset?:(id:string)=>Promise<void>|void;onUploadLibraryAssetMedia?:(id:string,file:File)=>Promise<void>|void;onGenerateLibraryAssetImage?:(id:string)=>Promise<void>|void;onGenerateLibraryAssetModel?:(id:string,referenceAssetId:string)=>Promise<Job>;onApproveLibraryAssetModel?:(jobId:string)=>Promise<void>;onLoadLibraryAssetModelJob?:(id:string)=>Promise<Job|null>}){
  const [filter,setFilter]=useState<'all'|'variants'|'pending'>('all');
  const [category,setCategory]=useState<AssetCatalogCategory>(requestedCategory);
  const [query,setQuery]=useState('');
  const [selectedLibraryId,setSelectedLibraryId]=useState(initialLibraryAssetId);
  const [selectedRequirementId,setSelectedRequirementId]=useState('');
  const [formMode,setFormMode]=useState<'create'|'edit'|null>(null);
  const [assetName,setAssetName]=useState('');
  const [assetDescription,setAssetDescription]=useState('');
  const [assetTags,setAssetTags]=useState('');
  const [assetBusy,setAssetBusy]=useState(false);
  const [assetError,setAssetError]=useState('');
  const [characterFormMode,setCharacterFormMode]=useState<'create'|'edit'|null>(null);
  const [characterDraft,setCharacterDraft]=useState<CharacterDraft>(emptyCharacterDraft);
  const [characterBusy,setCharacterBusy]=useState(false);
  const [characterError,setCharacterError]=useState('');
  const [modelJob,setModelJob]=useState<Job|null>(null);
  const [modelBusy,setModelBusy]=useState(false);
  const [modelError,setModelError]=useState('');
  const catalogDataFor=(id:string)=>characterAssets[id]??(id===character?.id?{references,variants}:{references:[],variants:[]});
  const episodeVariants=variants.filter(item=>item.kind==='episode');
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const filtered=characters.filter(item=>{
    const data=catalogDataFor(item.id);
    const hasVariant=data.variants.some(variant=>variant.kind==='episode');
    const hasPending=data.references.some(reference=>reference.review_status!=='approved')||data.variants.some(variant=>variant.review_status!=='approved');
    return (filter==='all'||filter==='variants'&&hasVariant||filter==='pending'&&hasPending)&&(!normalizedQuery||`${item.name} ${item.role}`.toLocaleLowerCase().includes(normalizedQuery));
  });
  const categoryAssets=category==='character'?[]:libraryAssets.filter(item=>item.kind===category);
  const visibleLibraryAssets=categoryAssets.filter(item=>!normalizedQuery||`${item.name} ${item.description} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(normalizedQuery));
  const categoryRequirements=category==='character'?requirements.filter(item=>item.kind==='character'):requirements.filter(item=>item.kind===category);
  const selectedRequirement=categoryRequirements.find(item=>item.id===selectedRequirementId)??categoryRequirements[0]??null;
  const selectedLibrary=visibleLibraryAssets.find(item=>item.id===selectedLibraryId)??visibleLibraryAssets.find(item=>item.id===selectedRequirement?.binding_id)??visibleLibraryAssets[0]??null;
  useEffect(()=>{
    let current=true;
    setModelError('');
    if(!selectedLibrary||!onLoadLibraryAssetModelJob){setModelJob(null);return;}
    void onLoadLibraryAssetModelJob(selectedLibrary.id).then(job=>{if(current)setModelJob(job);}).catch(()=>{if(current)setModelJob(null);});
    return()=>{current=false;};
  },[selectedLibrary?.id]);
  const categories:(['character',string]|[LibraryAssetKind,string])[]=[['character','角色实体'],...Object.entries(libraryCategory).map(([kind,item])=>[kind as LibraryAssetKind,item.label] as [LibraryAssetKind,string])];
  const selectCategory=(next:'character'|LibraryAssetKind)=>{setCategory(next);setQuery('');setFormMode(null);setAssetError('');if(next!=='character')setSelectedLibraryId(libraryAssets.find(item=>item.kind===next)?.id??'');};
  useEffect(()=>{setCategory(requestedCategory);setQuery('');setFormMode(null);setAssetError('');setSelectedLibraryId(initialLibraryAssetId);},[requestedCategory,initialLibraryAssetId]);
  useEffect(()=>{setSelectedRequirementId(current=>categoryRequirements.some(item=>item.id===current)?current:categoryRequirements[0]?.id??'');},[category,requirements]);
  const openCreate=()=>{setFormMode('create');setAssetName('');setAssetDescription('');setAssetTags('');setAssetError('');};
  const openRequirementCreate=()=>{if(!selectedRequirement)return;setFormMode('create');setAssetName(selectedRequirement.name);setAssetDescription(selectedRequirement.description);setAssetTags('');setAssetError('');};
  const openEdit=()=>{if(!selectedLibrary)return;setFormMode('edit');setAssetName(selectedLibrary.name);setAssetDescription(selectedLibrary.description);setAssetTags(selectedLibrary.tags.join(', '));setAssetError('');};
  const saveLibraryAsset=async(event:FormEvent)=>{event.preventDefault();if(category==='character'||!assetName.trim()||assetBusy)return;const data={kind:category,name:assetName.trim(),description:assetDescription.trim(),tags:assetTags.split(/[,，]/).map(item=>item.trim()).filter(Boolean),metadata:formMode==='edit'?selectedLibrary?.metadata??{}:{}};setAssetBusy(true);setAssetError('');try{if(formMode==='edit'&&selectedLibrary&&onUpdateLibraryAsset)await onUpdateLibraryAsset(selectedLibrary.id,data);else if(formMode==='create'&&onCreateLibraryAsset){const created=await onCreateLibraryAsset(data);if(created){setSelectedLibraryId(created.id);if(selectedRequirement&&onBindLibraryAsset)await onBindLibraryAsset(created.id,selectedRequirement.id);}}setFormMode(null);}catch(cause){setAssetError(cause instanceof Error?cause.message:'保存资产失败');}finally{setAssetBusy(false);}};
  const bindSelectedLibrary=async()=>{if(!selectedLibrary||!selectedRequirement||!onBindLibraryAsset||assetBusy)return;setAssetBusy(true);setAssetError('');try{await onBindLibraryAsset(selectedLibrary.id,selectedRequirement.id);}catch(cause){setAssetError(cause instanceof Error?cause.message:'绑定资产失败');}finally{setAssetBusy(false);}};
  const removeLibraryAsset=async()=>{if(!selectedLibrary||!onDeleteLibraryAsset||assetBusy||!window.confirm(`删除资产「${selectedLibrary.name}」？`))return;setAssetBusy(true);setAssetError('');try{await onDeleteLibraryAsset(selectedLibrary.id);setSelectedLibraryId('');}catch(cause){setAssetError(cause instanceof Error?cause.message:'删除资产失败');}finally{setAssetBusy(false);}};
  const uploadLibraryMedia=async(file:File|null)=>{if(!file||!selectedLibrary||!onUploadLibraryAssetMedia||assetBusy)return;setAssetBusy(true);setAssetError('');try{await onUploadLibraryAssetMedia(selectedLibrary.id,file);}catch(cause){setAssetError(cause instanceof Error?cause.message:'上传资产媒体失败');}finally{setAssetBusy(false);}};
  const generateLibraryImage=async()=>{if(!selectedLibrary||!onGenerateLibraryAssetImage||assetBusy)return;setAssetBusy(true);setAssetError('');try{await onGenerateLibraryAssetImage(selectedLibrary.id);}catch(cause){setAssetError(cause instanceof Error?cause.message:'场景参考图生成失败');}finally{setAssetBusy(false);}};
  const generateLibraryModel=async()=>{if(!selectedLibrary?.media_asset_id||!onGenerateLibraryAssetModel||modelBusy)return;setModelBusy(true);setModelError('');try{setModelJob(await onGenerateLibraryAssetModel(selectedLibrary.id,selectedLibrary.media_asset_id));}catch(cause){setModelError(cause instanceof Error?cause.message:'3D 生成失败');}finally{setModelBusy(false);}};
  const approveLibraryModel=async()=>{if(!modelJob||!onApproveLibraryAssetModel||modelBusy)return;setModelBusy(true);setModelError('');try{await onApproveLibraryAssetModel(modelJob.id);setModelJob(current=>current?{...current,result_metadata:{...current.result_metadata,review_status:'approved',is_active:true}}:current);}catch(cause){setModelError(cause instanceof Error?cause.message:'批准 3D 候选失败');}finally{setModelBusy(false);}};
  const openCharacterCreate=()=>{setCharacterFormMode('create');setCharacterDraft(emptyCharacterDraft);setCharacterError('');};
  const openCharacterEdit=()=>{if(!character)return;setCharacterFormMode('edit');setCharacterDraft({name:character.name,role:character.role,body_plan:character.body_plan??'humanoid',appearance_bible:character.appearance_bible,personality:character.personality,continuity_rules:character.continuity_rules,negative_constraints:character.negative_constraints,voice_speaker:character.voice_speaker,voice_instruction:character.voice_instruction});setCharacterError('');};
  const saveCharacter=async(event:FormEvent)=>{event.preventDefault();if(characterBusy||characterFields.some(field=>field.required&&!characterDraft[field.key].trim()))return;setCharacterBusy(true);setCharacterError('');try{if(characterFormMode==='edit'&&character&&onUpdateCharacter)await onUpdateCharacter(character.id,characterDraft);else if(characterFormMode==='create'&&onCreateCharacter)await onCreateCharacter(characterDraft);setCharacterFormMode(null);}catch(cause){setCharacterError(cause instanceof Error?cause.message:'保存角色失败');}finally{setCharacterBusy(false);}};
  const requirementContext=categoryRequirements.length>0?<section className="asset-requirement-context" role="status"><strong>{requirementScope==='project'?'项目待补资产':'当前镜头需要'}：{selectedRequirement?.name}</strong><div>{categoryRequirements.map(item=><button type="button" key={item.id} className={item.id===selectedRequirement?.id?'active':''} onClick={()=>{setSelectedRequirementId(item.id);setSelectedLibraryId(item.binding_id??'');}}>{item.name}<small>{item.status==='ready'?'已满足':item.status==='pending'?'待绑定或补媒体':'未创建'}</small></button>)}</div>{selectedRequirement?.description&&<p>{selectedRequirement.description}</p>}{generationReadiness&&<p className="asset-requirement-next">{generationReadiness.ready?'镜头生成条件已完成':generationReadiness.asset_ready?'资产已就绪，下一步完成导演站位与机位':'仍需补齐当前镜头资产'}</p>}<div className="asset-requirement-actions">{generationReadiness?.asset_ready&&(!generationReadiness.blocking_ready||!generationReadiness.camera_ready)&&onOpenDirector&&<button type="button" className="primary-action" onClick={onOpenDirector}>打开 3D 导演台</button>}{onReturnToShot&&<button type="button" onClick={onReturnToShot}>{generationReadiness?.ready?'返回原镜头继续生成':'返回原镜头'}</button>}</div></section>:null;

  const sidebar=<aside className="asset-catalog-sidebar"><h2>工作区</h2>{categories.map(([kind,label])=>{const count=kind==='character'?characters.length:libraryAssets.filter(item=>item.kind===kind).length;return <button type="button" key={kind} aria-label={`${label} ${count}`} className={category===kind?'active':''} onClick={()=>selectCategory(kind)}><span>{label}</span><b>{count}</b></button>;})}</aside>;

  if(category!=='character'){
    const details=libraryCategory[category];
    return <main className="character-workspace asset-library-page asset-catalog-page"><div className="asset-catalog-layout">
      {sidebar}
      <section className="asset-catalog-content library-asset-content"><header><div><h1>{details.label}资产</h1><p>{details.description}</p></div><div className="asset-catalog-header-actions"><label className="asset-search"><Search size={15}/><span className="sr-only">搜索资产</span><input type="search" aria-label="搜索资产" placeholder="搜索名称、描述或标签" value={query} onChange={event=>setQuery(event.target.value)}/></label>{selectedRequirement?<button type="button" onClick={openRequirementCreate}><Plus size={15}/>按需求新建{details.label}</button>:<button type="button" onClick={openCreate}><Plus size={15}/>新建{details.label}</button>}</div></header>
        {requirementContext}
        {requirementError&&<p className="form-error" role="alert">{requirementError}</p>}
        {formMode&&<form aria-label={`${formMode==='edit'?'编辑':'新建'}${details.label}资产`} className="library-asset-form" onSubmit={saveLibraryAsset}><label>资产名称<input aria-label="资产名称" value={assetName} onChange={event=>setAssetName(event.target.value)} autoFocus/></label><label>资产描述<textarea aria-label="资产描述" value={assetDescription} onChange={event=>setAssetDescription(event.target.value)}/></label><label>资产标签<input aria-label="资产标签" value={assetTags} onChange={event=>setAssetTags(event.target.value)} placeholder="使用逗号分隔"/></label>{assetError&&<p role="alert">{assetError}</p>}<div><button type="button" onClick={()=>setFormMode(null)}>取消</button><button className="primary-action" type="submit" disabled={!assetName.trim()||assetBusy}>{assetBusy?'正在保存':'保存资产'}</button></div></form>}
        {!formMode&&(assetError||libraryError)&&<p className="form-error" role="alert">{assetError||libraryError}</p>}
        <div className="asset-card-grid">{visibleLibraryAssets.map(item=><button type="button" className={`asset-catalog-card library-asset-card ${item.id===selectedLibrary?.id?'selected':''}`} key={item.id} aria-label={`${item.name} ${details.label}`} onClick={()=>setSelectedLibraryId(item.id)}><span className="asset-card-media">{item.media_url&&item.media_type?.startsWith('image/')?<img src={mediaUrl(item.media_url)} alt={`${item.name}缩略图`}/>:<span className="asset-card-placeholder">{item.name.slice(0,1)}</span>}<i>{details.label}</i></span><span className="asset-card-body"><strong>{item.name}</strong><small>{item.description||'尚未填写描述'}</small><span className="library-asset-tags">{item.tags.length?item.tags.join(' · '):'无标签'}</span></span></button>)}</div>
        {!visibleLibraryAssets.length&&!formMode&&<p className="asset-catalog-empty">{query?'没有匹配的资产。':`尚未创建${details.label}资产。`}</p>}
      </section>
      <aside className="asset-catalog-inspector library-asset-inspector">{selectedLibrary?<><header><div><h2>{selectedLibrary.name}</h2><span>{details.label}资产</span></div><strong>{selectedLibrary.media_asset_id?'媒体已就绪':'仅设定'}</strong></header>{selectedRequirement&&selectedRequirement.status!=='ready'&&onBindLibraryAsset&&<button type="button" className="primary-action library-asset-bind" disabled={assetBusy} onClick={()=>void bindSelectedLibrary()}><Check size={14}/>绑定到当前场景</button>}{selectedLibrary.media_url&&(selectedLibrary.media_type?.startsWith('image/')?<img className="library-asset-media" src={mediaUrl(selectedLibrary.media_url)} alt={`${selectedLibrary.name}媒体`}/>:selectedLibrary.media_type?.startsWith('audio/')?<audio className="library-asset-audio" src={mediaUrl(selectedLibrary.media_url)} controls/>:selectedLibrary.media_type==='model/gltf-binary'?<div className="library-asset-model"><Box size={24}/><span>GLB 3D 模型已就绪</span></div>:null)}{category==='scene'&&<button type="button" className="library-image-generate" onClick={()=>void generateLibraryImage()} disabled={assetBusy}>{assetBusy?<Circle size={15}/>:<Sparkles size={15}/>}AI 生成场景参考图</button>}{modelJob?.status==='succeeded'&&modelJob.result_metadata?.is_active!==true&&<div className="library-asset-model library-asset-model-candidate"><Box size={24}/><span>AI 3D 候选已生成</span><button type="button" className="primary-action" onClick={()=>void approveLibraryModel()} disabled={modelBusy}><Check size={14}/>批准使用 3D 候选</button></div>}{(category==='prop'||category==='scene')&&selectedLibrary.media_type?.startsWith('image/')&&<button type="button" className="library-model-generate" onClick={()=>void generateLibraryModel()} disabled={modelBusy}>{modelBusy?<Circle size={15}/>:<Sparkles size={15}/>}根据参考图生成 3D</button>}<label className="library-asset-upload">上传{details.label}媒体<input aria-label={`上传${details.label}媒体`} type="file" accept={category==='sound'?'audio/wav,audio/mpeg':category==='prop'||category==='scene'?'.glb,model/gltf-binary,image/png,image/jpeg,image/webp':'image/png,image/jpeg,image/webp'} disabled={assetBusy} onChange={event=>void uploadLibraryMedia(event.target.files?.[0]??null)}/></label>{modelError&&<p className="form-error" role="alert">{modelError}</p>}<dl><div><dt>资产类型</dt><dd>{details.label}</dd></div><div><dt>标签</dt><dd>{selectedLibrary.tags.join('、')||'无'}</dd></div><div><dt>更新时间</dt><dd>{selectedLibrary.updated_at||'刚刚'}</dd></div></dl><section><h3>设定说明</h3><p>{selectedLibrary.description||'尚未填写描述。'}</p></section><footer><button type="button" onClick={openEdit}><Pencil size={15}/>编辑资产</button><button type="button" onClick={()=>void removeLibraryAsset()} disabled={assetBusy}><Trash2 size={15}/>删除资产</button></footer></>:<p className="asset-catalog-empty">选择一个资产查看详情。</p>}</aside>
    </div></main>;
  }

  return <main className="character-workspace asset-library-page asset-catalog-page">
    <div className="asset-catalog-layout">
      {sidebar}

      <section className="asset-catalog-content">
        <header>
          <div><h1>作品资产库</h1><p>管理作品级主设定、集级变体与审核状态。</p></div>
          <div className="asset-catalog-header-actions"><label className="asset-search"><Search size={15}/><span className="sr-only">搜索资产</span><input type="search" aria-label="搜索资产" placeholder="搜索资产名称" value={query} onChange={event=>setQuery(event.target.value)}/></label><button type="button" onClick={openCharacterCreate}><Plus size={15}/>新建角色</button></div>
        </header>
        {requirementContext}
        {characterFormMode&&<form aria-label={characterFormMode==='edit'?'编辑角色':'新建角色'} className="library-asset-form character-asset-form" onSubmit={saveCharacter}><label>实体形态<select aria-label="实体形态" value={characterDraft.body_plan} onChange={event=>setCharacterDraft(current=>({...current,body_plan:event.target.value as CharacterBodyPlan}))}>{Object.entries(bodyPlanLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{characterFields.map(field=><label key={field.key}>{field.label}{field.multiline?<textarea aria-label={field.label} value={characterDraft[field.key]} onChange={event=>setCharacterDraft(current=>({...current,[field.key]:event.target.value}))}/>:<input aria-label={field.label} value={characterDraft[field.key]} onChange={event=>setCharacterDraft(current=>({...current,[field.key]:event.target.value}))}/>}</label>)}{characterError&&<p role="alert">{characterError}</p>}<div><button type="button" onClick={()=>setCharacterFormMode(null)}>取消</button><button className="primary-action" type="submit" disabled={characterBusy||characterFields.some(field=>field.required&&!characterDraft[field.key].trim())}>{characterBusy?'正在保存':'保存角色'}</button></div></form>}
        <div className="asset-catalog-filters">
          <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>主设定</button>
          <button className={filter==='variants'?'active':''} onClick={()=>setFilter('variants')}>有变体</button>
          <button className={filter==='pending'?'active':''} onClick={()=>setFilter('pending')}>待审核</button>
        </div>
        <div className="asset-card-grid">
          {filtered.map(item=>{
            const current=item.id===character?.id;
            const data=catalogDataFor(item.id);
            const itemEpisodeVariants=data.variants.filter(variant=>variant.kind==='episode');
            const itemPending=data.references.filter(reference=>reference.review_status!=='approved').length+data.variants.filter(variant=>variant.review_status!=='approved').length;
            const loaded=Boolean(characterAssets[item.id])||current;
            const image=imageFor(data.references);
            return <button type="button" className={`asset-catalog-card ${current?'selected':''}`} key={item.id} onClick={()=>{onSelect(item.id);onOpen('master');}} aria-label={`${item.name} ${item.role}`}>
              <span className="asset-card-media">{image?<img src={image} alt=""/>:<span className="asset-card-placeholder">{item.name.slice(0,1)}</span>}<i>{itemPending?'待审核':'主设定'}</i></span>
              <span className="asset-card-body"><strong>{item.name}</strong><small>{item.role}</small><span><em>{loaded?statusLabel(data.variants.find(variant=>variant.kind==='master')?.review_status??'draft'):'加载中'}</em></span><span className="asset-card-stats">集级变体 {itemEpisodeVariants.length}</span></span>
            </button>;
          })}
        </div>
      </section>

      {character?<aside className="asset-catalog-inspector">
        <header><div><h2>{character.name}</h2><span>{character.role}</span></div><strong>{statusLabel(variants.find(item=>item.kind==='master')?.review_status??'draft')}</strong></header>
        <dl><div><dt>资产类型</dt><dd>角色实体</dd></div><div><dt>实体形态</dt><dd>{bodyPlanLabels[character.body_plan??'humanoid']}</dd></div><div><dt>主设定</dt><dd>MASTER v{variants.find(item=>item.kind==='master')?.version??1}</dd></div><div><dt>集级变体</dt><dd>{episodeVariants.length}</dd></div><div><dt>状态数量</dt><dd>{episodeVariants.reduce((total,item)=>total+item.states.length,0)}</dd></div></dl>
        <div className="asset-inspector-tabs"><button className="active">主设定</button><button onClick={()=>onOpen('variant')}>集级变体</button><button onClick={()=>onOpen('lineage')}>引用</button></div>
        <section className="asset-lineage-preview"><h3>继承谱系</h3><div><span className="lineage-preview-root">{character.name}<small>主设定</small></span><ChevronRight size={16}/><span className="lineage-preview-branches">{episodeVariants.slice(0,2).map(item=><button key={item.id} onClick={()=>onOpen('variant')}>{item.label}</button>)}</span></div></section>
        <footer><button onClick={openCharacterEdit}><Pencil size={15}/>编辑角色</button><button onClick={()=>onOpen('lineage')}><GitBranch size={15}/>打开谱系</button><button className="primary-action" onClick={()=>onOpen('variant')}><Plus size={15}/>创建变体</button></footer>
      </aside>:<aside className="asset-catalog-inspector"><p className="asset-catalog-empty">尚未创建角色，可以先管理其他作品资产。</p></aside>}
    </div>
  </main>;
}

export function CharacterMasterView({characters,character,references,variants,referenceManager,variantWorkspace,lineageWorkspace,modelManager,initialTab='master',onSelect,onOpen}:{characters:Character[];character:Character;references:CharacterReference[];variants:AssetVariant[];referenceManager:ReactNode;variantWorkspace:ReactNode;lineageWorkspace:ReactNode;modelManager:ReactNode;initialTab?:Exclude<CharacterDetailTab,'references'>;onSelect:(id:string)=>void;onOpen:(view:AssetWorkspaceView)=>void}){
  const [tab,setTab]=useState<CharacterDetailTab>(initialTab);
  const master=variants.find(item=>item.kind==='master');
  const episodeVariants=variants.filter(item=>item.kind==='episode');
  const approved=references.filter(item=>item.review_status==='approved').length;
  const score=references.length?Math.round(approved/references.length*100):0;
  const slots:Array<[string,CharacterReferenceType|undefined]>=[['1. 正面视图','front'],['2. 侧面视图','side'],['3. 背面视图','back'],['4. 表情设定','expression'],['5. 全身视图','primary'],['6. 服装细节','outfit']];
  const embedded=tab==='variant'||tab==='lineage';
  useEffect(()=>setTab(initialTab),[initialTab]);

  return <main className={`character-workspace asset-library-page master-setting-page ${embedded?'master-setting-page-embedded':''}`}>
    <aside className="master-character-list"><h2>角色列表</h2>{characters.map(item=><button key={item.id} className={item.id===character.id?'active':''} onClick={()=>onSelect(item.id)}><span>{item.name}</span><small>{item.id===character.id?'已锁定':item.role}</small></button>)}</aside>
    <section className="master-setting-content">
      <header><button className="asset-back" aria-label="返回资产库" onClick={()=>onOpen('catalog')}><ArrowLeft size={15}/></button><h1>角色主设定</h1><span className="master-lock"><CheckCircle2 size={14}/>已锁定</span></header>
      <nav className="master-tabs" aria-label="角色资产详情">
        <button className={tab==='master'?'active':''} onClick={()=>setTab('master')}>主设定</button>
        <button className={tab==='references'?'active':''} onClick={()=>setTab('references')}>参考集</button>
        <button className={tab==='variant'?'active':''} onClick={()=>setTab('variant')}>变体</button>
        <button className={tab==='lineage'?'active':''} onClick={()=>setTab('lineage')}>使用记录</button>
      </nav>
      {tab==='references'?referenceManager:tab==='variant'?<div className="master-embedded-workspace">{variantWorkspace}</div>:tab==='lineage'?<div className="master-embedded-workspace">{lineageWorkspace}</div>:<>
        <div className="master-visual-assets"><div className="master-image-grid">{slots.map(([label,type])=>{const image=imageFor(references,type);return <article key={label}><span>{label}</span>{image?<img src={image} alt={`${character.name}${label}`}/>:<div><ImageIcon size={20}/><small>尚无图片</small></div>}</article>;})}</div>{modelManager}</div>
        <section className="identity-bible"><h2>设定档案 (Identity Bible)</h2><div><article><span>身份与外观</span><p>{character.appearance_bible||'尚未填写角色外观设定。'}</p></article><article><span>性格</span><p>{character.personality||'尚未填写角色性格。'}</p></article><article><span>连续性规则</span><p>{character.continuity_rules||'尚未填写连续性规则。'}</p></article><article><span>禁止漂移</span><p>{character.negative_constraints||'尚未填写禁止项。'}</p></article></div></section>
      </>}
    </section>
    {!embedded&&<aside className="master-setting-inspector"><h2>设定信息</h2><dl><div><dt>版本</dt><dd>MASTER v{master?.version??1}</dd></div><div><dt>状态</dt><dd>{statusLabel(master?.review_status??'draft')}</dd></div><div><dt>一致性</dt><dd>{score} / 100</dd></div><div><dt>参考图</dt><dd>{references.length} 张</dd></div></dl><section><h3>来源参考图 ({references.length})</h3><div className="master-source-strip">{references.slice(0,6).map(item=><img key={item.id} src={mediaUrl(item.asset.media_url)} alt=""/>)}</div></section><section><h3>血统（继承关系）</h3><div className="master-lineage-summary"><strong>MASTER v{master?.version??1}</strong>{episodeVariants.map(item=><button key={item.id} onClick={()=>setTab('variant')}>{item.label}</button>)}</div></section><button className="primary-action" onClick={()=>setTab('variant')}>创建集级变体</button><button onClick={()=>setTab('lineage')}>查看继承关系</button></aside>}
  </main>;
}

type VariantDraft={kind:'master'|'episode';label:string;episode_id:string|null;parent_variant_id:string|null;inherited_fields:string[];overrides:Record<string,unknown>};
type StateDraft={kind:AssetVariantState['kind'];label:string;overrides:Record<string,unknown>};

export function AssetVariantEditorView({character,references,variants,episodes,initialVariantId,initialStateId,onOpen,onCreateVariant,onCreateState,embedded=false}:{character:Character;references:CharacterReference[];variants:AssetVariant[];episodes:EpisodeSummary[];initialVariantId?:string;initialStateId?:string;onOpen:(view:AssetWorkspaceView)=>void;onCreateVariant:(data:VariantDraft)=>Promise<void>|void;onCreateState:(variantId:string,data:StateDraft)=>Promise<void>|void;embedded?:boolean}){
  const master=variants.find(item=>item.kind==='master')??variants[0];
  const episodeVariants=variants.filter(item=>item.kind==='episode');
  const [selectedId,setSelectedId]=useState(variants.some(item=>item.id===initialVariantId)?initialVariantId??'':episodeVariants[0]?.id??master?.id??'');
  const [stateId,setStateId]=useState<string>(initialStateId??'');
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [messages,setMessages]=useState<Array<{role:'user'|'assistant';content:string}>>([{role:'assistant',content:'描述角色在本集发生的视觉变化。我会判断它属于集级变体，还是表情、服装、伤势等临时状态。'}]);
  const [draft,setDraft]=useState<AssetVariantSuggestion|null>(null);
  const [targetEpisodeId,setTargetEpisodeId]=useState(episodeVariants[0]?.episode_id??episodes[0]?.id??'');
  const [draftEpisodeId,setDraftEpisodeId]=useState<string|null>(null);
  const [annotations,setAnnotations]=useState<Array<{cx:number;cy:number;label:string}>>([]);
  const selected=variants.find(item=>item.id===selectedId)??episodeVariants[0]??master;
  const selectedState=selected?.states.find(item=>item.id===stateId)??selected?.states[0];
  const image=imageFor(references);
  const stateImage=(state:AssetVariantState)=>imageFor(references,state.kind==='expression'?'expression':state.kind==='outfit'?'outfit':undefined)??image;
  const canvasImage=selectedState?stateImage(selectedState):image;
  const fields=useMemo(()=>Array.from(new Set(['年龄','发型','服装','伤势','表情',...Object.keys(selected?.overrides??{}),...Object.keys(selectedState?.overrides??{}),...Object.keys(draft?.overrides??{})])),[selected,selectedState,draft]);
  useEffect(()=>{if(selected&&!selected.states.some(item=>item.id===stateId))setStateId(selected.states[0]?.id??'');},[selected,stateId]);
  useEffect(()=>{const target=initialVariantId?variants.find(item=>item.id===initialVariantId):undefined;if(target){setSelectedId(target.id);setStateId(initialStateId&&target.states.some(item=>item.id===initialStateId)?initialStateId:target.states[0]?.id??'');}},[initialVariantId,initialStateId,variants]);
  useEffect(()=>{if(!selectedId&&episodeVariants[0])setSelectedId(episodeVariants[0].id);},[episodeVariants,selectedId]);
  useEffect(()=>{if(selected?.kind==='episode'&&selected.episode_id)setTargetEpisodeId(selected.episode_id);},[selected]);

  const addAnnotation=(event:React.MouseEvent<HTMLDivElement>)=>{if(!canvasImage)return;const rect=event.currentTarget.getBoundingClientRect();if(!rect.width||!rect.height)return;const clamp=(value:number)=>Math.min(.92,Math.max(.08,value));setAnnotations(current=>[...current,{cx:Number(clamp((event.clientX-rect.left)/rect.width).toFixed(4)),cy:Number(clamp((event.clientY-rect.top)/rect.height).toFixed(4)),label:`圈点 ${String(current.length+1).padStart(2,'0')}`}]);};
  const send=async()=>{const content=message.trim();if(!content||busy)return;const nextMessages=[...messages,{role:'user' as const,content}];setMessages(nextMessages);setMessage('');setBusy(true);setError('');try{const episode=episodes.find(item=>item.id===targetEpisodeId)??null;const suggestion=await suggestAssetVariant({character_id:character.id,episode_id:episode?.id??null,message:content,character:{name:character.name,role:character.role,appearance_bible:character.appearance_bible,personality:character.personality,continuity_rules:character.continuity_rules,negative_constraints:character.negative_constraints},episode:episode?{id:episode.id,title:episode.title,premise:episode.premise}:null,conversation:nextMessages,annotations:annotations.map(item=>({kind:'circle',geometry:{cx:item.cx,cy:item.cy,rx:.08,ry:.08},label:item.label}))});setDraftEpisodeId(episode?.id??null);setDraft(suggestion);setMessages(current=>[...current,{role:'assistant',content:suggestion.assistant_message}]);}catch(cause){setError(cause instanceof Error?cause.message:'AI 变体分析失败');}finally{setBusy(false);}};
  const confirmDraft=async()=>{if(!draft||saving)return;setSaving(true);setError('');try{if(draft.kind==='episode'){if(!draftEpisodeId)throw new Error('请先选择变体所属的目标剧集。');await onCreateVariant({kind:'episode',label:draft.label,episode_id:draftEpisodeId,parent_variant_id:master?.id??null,inherited_fields:draft.inherited_fields,overrides:draft.overrides});}else if(selected?.kind==='episode'&&draft.state_kind){await onCreateState(selected.id,{kind:draft.state_kind,label:draft.label,overrides:draft.overrides});}else{throw new Error('AI 判断这是临时状态，请先在左侧选择一个集级变体，或继续对话创建本集基础造型。');}setMessages(current=>[...current,{role:'assistant',content:`“${draft.label}”已确认入库。`}]);setDraft(null);setDraftEpisodeId(null);setAnnotations([]);}catch(cause){setError(cause instanceof Error?cause.message:'保存变体失败');}finally{setSaving(false);}};

  const content=<div className="variant-editor-layout">
      <aside className="variant-tree"><h2>继承树</h2>{master&&<button className={selected?.id===master.id?'active':''} onClick={()=>{setSelectedId(master.id);setStateId('');}}><span>{character.name}</span><small>MASTER v{master.version}</small></button>}{episodeVariants.map(variant=><div key={variant.id}><button className={selected?.id===variant.id?'active':''} onClick={()=>{setSelectedId(variant.id);setStateId(variant.states[0]?.id??'');}}><span>{variant.label}</span><small>{statusLabel(variant.review_status)}</small></button>{variant.states.map(state=><button className={`variant-tree-state ${stateId===state.id?'active':''}`} key={state.id} onClick={()=>{setSelectedId(variant.id);setStateId(state.id);}}><span>{state.label}</span><small>{stateLabels[state.kind]}</small></button>)}</div>)}</aside>
      <section className="variant-editor-main">
        <div className="ai-variant-canvas-shell"><header><div><button aria-label="选择工具"><MousePointer2 size={16}/></button><button className="active" aria-label="圈选工具"><Circle size={16}/></button></div><span>圈点角色图片后，在右侧描述需要改变的部分</span></header><div className="ai-variant-canvas" aria-label="变体创作画布" onClick={addAnnotation}>{canvasImage?<img src={canvasImage} alt={`${character.name}角色主设定`}/>:<div><ImageIcon size={24}/><span>尚无角色参考图</span></div>}{annotations.map((item,index)=><button type="button" key={`${item.cx}-${item.cy}-${index}`} aria-label={item.label} style={{left:`${item.cx*100}%`,top:`${item.cy*100}%`}}>{String(index+1).padStart(2,'0')}</button>)}</div><footer><div><span>当前基线</span><strong>{selected?.kind==='episode'?selected.label:`MASTER v${master?.version??1}`}</strong></div>{references.slice(0,5).map(reference=><span key={reference.id}><img src={mediaUrl(reference.asset.media_url)} alt=""/></span>)}</footer></div>
        <section className="variant-diff"><h2>属性差异（与继承源对比）</h2><table><thead><tr><th>属性</th><th>MASTER</th><th>{selected?.label??'集级变体'}</th><th>{draft?.label??selectedState?.label??'AI 草案'}</th></tr></thead><tbody>{fields.map(field=>{const comparison=draft?.overrides??selectedState?.overrides??{};return <tr key={field}><td>{field}</td><td>继承</td><td className={field in (selected?.overrides??{})?'changed':''}>{String(selected?.overrides?.[field]??'继承')}</td><td className={field in comparison?'changed':''}>{String(comparison[field]??'继承')}</td></tr>;})}</tbody></table></section>
      </section>
      <aside className="variant-impact ai-variant-conversation"><header><div><span>资产创作助手</span><h2>{character.name}</h2></div><MessageSquareText size={18}/></header><div className="review-context"><select aria-label="目标剧集" value={targetEpisodeId} disabled={!episodes.length||busy||Boolean(draft)} onChange={event=>setTargetEpisodeId(event.target.value)}>{episodes.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><span>{selected?.kind==='episode'?'集级变体':'MASTER'}</span><span>{annotations.length} 个圈点</span></div><div className="conversation-thread">{messages.map((item,index)=>item.role==='assistant'?<div className="conversation-ai" key={index}><Sparkles size={16}/><p>{item.content}</p></div>:<div className="conversation-user" key={index}>{item.content}</div>)}</div><div className="ai-variant-compose"><input aria-label="描述角色变化" value={message} onChange={event=>setMessage(event.target.value)} placeholder="例如：第一集换成唐代书生服装，保持脸型" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void send();}}}/><button aria-label="发送变体创作消息" disabled={!message.trim()||busy||!targetEpisodeId} onClick={()=>void send()}>{busy?<Sparkles size={15}/>:<Send size={15}/>}</button></div>{draft&&<section className="ai-variant-draft"><header><div><span>{draft.kind==='episode'?'集级变体':'临时状态'}</span><h3>{draft.label}</h3></div><strong>{draft.kind==='state'&&draft.state_kind?stateLabels[draft.state_kind]:'本集'}</strong></header><p>{draft.summary}</p><dl><div><dt>继承</dt><dd>{draft.inherited_fields.join('、')||'身份基线'}</dd></div><div><dt>覆盖</dt><dd>{Object.keys(draft.overrides).join('、')||'无'}</dd></div></dl><button className="primary-action" aria-label="确认入库" disabled={saving} onClick={()=>void confirmDraft()}><Check size={15}/>{saving?'正在保存':'确认入库'}</button><button onClick={()=>{setDraft(null);setDraftEpisodeId(null);}}>继续对话修改</button></section>}{error&&<p className="form-error" role="alert">{error}</p>}</aside>
    </div>;
  if(embedded)return <section className="asset-variant-embedded">{content}</section>;
  return <main className="character-workspace asset-library-page asset-variant-page"><header className="variant-page-header"><button aria-label="返回角色主设定" onClick={()=>onOpen('master')}><ArrowLeft size={16}/></button><h1>AI 角色变体创作</h1><button onClick={()=>onOpen('lineage')}><GitBranch size={15}/>查看资产谱系</button></header>{content}</main>;
}
