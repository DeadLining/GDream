'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Box,Camera,CameraIcon,Globe2,History,LoaderCircle,Plus,Redo2,RefreshCw,Sparkles,Undo2} from 'lucide-react';
import {ApiError,applyDirectorSuggestionToShot,createDirectorObject,createDirectorStage,createDirectorSuggestion,deleteDirectorObject,getDirectorAssets,getDirectorStage,listDirectorRevisions,restoreDirectorRevision,syncDirectorAssets,updateDirectorCamera,updateDirectorObject,updateDirectorStage,uploadDirectorPreview} from '../../lib/api';
import {applyDirectorAssetModels,applyDirectorObjectOverrides,mergeDirectorObjectOverride,removeDirectorObjectOverride,setDirectorObjectOverrideTransform} from '../../lib/director-overrides';
import {captureDirectorPreview} from '../../lib/director-preview';
import type {DirectorEnvironmentSettings} from '../../lib/director-environment';
import type {DirectorAnimationClip,DirectorApplyField,DirectorAsset,DirectorFacialExpression,DirectorObjectOverride,DirectorPosePreset,DirectorProxyRig,DirectorRevision,DirectorStage,DirectorSuggestion,DirectorTransformMode,Scene,Shot,Transform} from '../../lib/types';
import {DirectorCanvas,type DirectorCameraPose,type DirectorCanvasMode} from './DirectorCanvas';
import {DirectorInspector} from './DirectorInspector';
import {DirectorObjectTree} from './DirectorObjectTree';
import {DirectorRevisionDialog} from './DirectorRevisionDialog';
import {DirectorShotStrip} from './DirectorShotStrip';
import {DirectorSuggestionDialog} from './DirectorSuggestionDialog';

type TransformHistoryEntry=
  |{scope:'world';objectId:string;before:Transform;after:Transform}
  |{scope:'camera';objectId:string;shotId:string;before:Transform|null;after:Transform};

const sameTransform=(left:Transform|null,right:Transform|null)=>JSON.stringify(left)===JSON.stringify(right);

export function DirectorWorkspace({scene,selectedShotId,mobile,onSelectShot,onShotUpdated,onBackToProduction}:{scene:Scene;selectedShotId:string;mobile:boolean;onSelectShot:(id:string)=>void;onShotUpdated?:(shot:Shot)=>void;onBackToProduction?:()=>void}){
  const [stage,setStage]=useState<DirectorStage|null>(null);
  const [assets,setAssets]=useState<DirectorAsset[]>([]);
  const [selectedObjectId,setSelectedObjectId]=useState<string|null>(null);
  const [mode,setMode]=useState<DirectorCanvasMode>('world');
  const [transformMode,setTransformMode]=useState<DirectorTransformMode>('translate');
  const [snapEnabled,setSnapEnabled]=useState(false);
  const [undoHistory,setUndoHistory]=useState<TransformHistoryEntry[]>([]);
  const [redoHistory,setRedoHistory]=useState<TransformHistoryEntry[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [suggestion,setSuggestion]=useState<DirectorSuggestion|null>(null);
  const [suggesting,setSuggesting]=useState(false);
  const [applying,setApplying]=useState(false);
  const [capturing,setCapturing]=useState(false);
  const [environmentSaving,setEnvironmentSaving]=useState(false);
  const [animationSaving,setAnimationSaving]=useState(false);
  const [revisions,setRevisions]=useState<DirectorRevision[]>([]);
  const [revisionOpen,setRevisionOpen]=useState(false);
  const [revisionLoading,setRevisionLoading]=useState(false);
  const [restoringRevisionId,setRestoringRevisionId]=useState<string|null>(null);
  const [conflictVersion,setConflictVersion]=useState<number|null>(null);
  const [conflictOpen,setConflictOpen]=useState(false);
  const [loadAttempt,setLoadAttempt]=useState(0);
  const viewportRef=useRef<HTMLElement>(null);
  const animationSavingRef=useRef(false);

  useEffect(()=>{
    let current=true;
    setBusy(true);setError('');
    getDirectorStage(scene.id)
      .catch(cause=>cause instanceof ApiError&&cause.status===404?createDirectorStage(scene.id):Promise.reject(cause))
      .then(async value=>{const catalog=await getDirectorAssets(value.id,selectedShotId);if(current){setStage(value);setAssets(catalog);setUndoHistory([]);setRedoHistory([]);}})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'无法加载导演台');})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[scene.id,loadAttempt]);

  useEffect(()=>{
    if(!stage)return;
    let current=true;
    getDirectorAssets(stage.id,selectedShotId)
      .then(catalog=>{if(current)setAssets(catalog);})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'无法加载镜头资产');});
    return()=>{current=false;};
  },[stage?.id,selectedShotId]);

  const camera=stage?.shot_cameras.find(item=>item.shot_id===selectedShotId)??stage?.shot_cameras[0]??null;
  const shot=scene.shots.find(item=>item.id===selectedShotId)??scene.shots[0];
  const objects=useMemo(()=>stage?.objects??[],[stage]);
  const scopedObjects=useMemo(()=>applyDirectorAssetModels(objects,assets),[assets,objects]);
  const effectiveObjects=useMemo(()=>camera?applyDirectorObjectOverrides(scopedObjects,camera.object_overrides):scopedObjects,[camera,scopedObjects]);
  const sceneObject=objects.find(item=>item.id===selectedObjectId)??null;
  const object=effectiveObjects.find(item=>item.id===selectedObjectId)??null;

  const handleDirectorError=(cause:unknown,fallback:string)=>{
    if(cause instanceof ApiError&&cause.status===409){
      let latest:number|null=null;
      try{const detail=JSON.parse(cause.detail) as {latest_version?:unknown};if(typeof detail.latest_version==='number')latest=detail.latest_version;}catch{}
      setConflictVersion(latest);setConflictOpen(true);setError('');return;
    }
    setError(cause instanceof Error?cause.message:fallback);
  };

  const addObject=async()=>{if(!stage)return;try{const created=await createDirectorObject(stage.id,stage.version,{kind:'primitive',source_type:'placeholder',label:'新道具'});setStage({...stage,version:stage.version+1,objects:[...stage.objects,created]});setSelectedObjectId(created.id);}catch(cause){handleDirectorError(cause,'添加失败');}};
  const addAsset=async(key:string)=>{if(!stage||syncing)return;const existing=stage.objects.map(item=>String(item.metadata.catalog_key??'')).filter(Boolean);setSyncing(true);setError('');try{const next=await syncDirectorAssets(stage.id,stage.version,Array.from(new Set([...existing,key])));setStage(next);setSelectedObjectId(next.objects.find(item=>item.metadata.catalog_key===key)?.id??null);}catch(cause){handleDirectorError(cause,'添加资产失败');}finally{setSyncing(false);}};
  const syncAssets=async()=>{if(!stage||syncing||!assets.length)return;setSyncing(true);setError('');try{setStage(await syncDirectorAssets(stage.id,stage.version,assets.map(item=>item.key)));}catch(cause){handleDirectorError(cause,'同步资产失败');}finally{setSyncing(false);}};
  const persistTransform=async(entry:TransformHistoryEntry,transform:Transform|null)=>{
    if(!stage)return false;
    const beforeStage=stage;
    if(entry.scope==='world'){
      if(!transform)return false;
      setStage({...stage,objects:stage.objects.map(item=>item.id===entry.objectId?{...item,transform}:item)});
      try{
        const saved=await updateDirectorObject(entry.objectId,stage.version,{transform});
        setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===entry.objectId?saved:item)}:current);
        return true;
      }catch(cause){setStage(beforeStage);handleDirectorError(cause,'保存对象失败');return false;}
    }
    const targetCamera=stage.shot_cameras.find(item=>item.shot_id===entry.shotId);
    if(!targetCamera)return false;
    const object_overrides=setDirectorObjectOverrideTransform(targetCamera.object_overrides,entry.objectId,transform);
    setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===targetCamera.id?{...item,object_overrides}:item)});
    try{
      const saved=await updateDirectorCamera(stage.id,targetCamera.shot_id,targetCamera.version,{object_overrides});
      setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);
      return true;
    }catch(cause){setStage(beforeStage);handleDirectorError(cause,'保存镜头对象失败');return false;}
  };
  const transformObject=async(id:string,transform:Transform)=>{
    if(!stage||!camera||historyBusy)return;
    const entry:TransformHistoryEntry=mode==='camera'
      ?{scope:'camera',objectId:id,shotId:camera.shot_id,before:camera.object_overrides[id]?.transform??null,after:transform}
      :{scope:'world',objectId:id,before:stage.objects.find(item=>item.id===id)?.transform??transform,after:transform};
    if(sameTransform(entry.before,entry.after))return;
    setHistoryBusy(true);
    try{if(await persistTransform(entry,entry.after)){setUndoHistory(current=>[...current,entry].slice(-50));setRedoHistory([]);}}finally{setHistoryBusy(false);}
  };
  const undoTransform=async()=>{const entry=undoHistory.at(-1);if(!entry||historyBusy)return;setHistoryBusy(true);try{if(await persistTransform(entry,entry.before)){setUndoHistory(current=>current.slice(0,-1));setRedoHistory(current=>[...current,entry].slice(-50));}}finally{setHistoryBusy(false);}};
  const redoTransform=async()=>{const entry=redoHistory.at(-1);if(!entry||historyBusy)return;setHistoryBusy(true);try{if(await persistTransform(entry,entry.after)){setRedoHistory(current=>current.slice(0,-1));setUndoHistory(current=>[...current,entry].slice(-50));}}finally{setHistoryBusy(false);}};
  const groundObject=()=>{if(!object)return;void transformObject(object.id,{...object.transform,position:[object.transform.position[0],0,object.transform.position[2]]});};
  const centerObject=()=>{if(!object)return;void transformObject(object.id,{...object.transform,position:[0,object.transform.position[1],0]});};
  const changeShotVisibility=async(visible:boolean)=>{if(!stage||!camera||!object)return;try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,object.id,{visible});const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){handleDirectorError(cause,'保存镜头显示状态失败');}};
  const updateSceneObject=async(patch:Parameters<typeof updateDirectorObject>[2],failure:string)=>{if(!stage||!sceneObject)return;const before=stage;try{const saved=await updateDirectorObject(sceneObject.id,stage.version,patch);setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===sceneObject.id?saved:item)}:current);}catch(cause){setStage(before);handleDirectorError(cause,failure);}};
  const renameObject=(label:string)=>void updateSceneObject({label},'重命名对象失败');
  const changeSceneVisibility=(visible:boolean)=>void updateSceneObject({visible},'保存场景显示状态失败');
  const duplicateObject=async()=>{if(!stage||!sceneObject)return;const {catalog_key:_,...metadata}=sceneObject.metadata;const transform={...sceneObject.transform,position:[sceneObject.transform.position[0]+.5,sceneObject.transform.position[1],sceneObject.transform.position[2]] as [number,number,number]};try{const created=await createDirectorObject(stage.id,stage.version,{kind:sceneObject.kind,source_type:sceneObject.source_type,source_id:sceneObject.source_id,label:`${sceneObject.label} 副本`,transform,appearance:sceneObject.appearance,metadata,visible:sceneObject.visible});setStage(current=>current?{...current,version:stage.version+1,objects:[...current.objects,created]}:current);setSelectedObjectId(created.id);}catch(cause){handleDirectorError(cause,'复制对象失败');}};
  const changePose=async(pose_preset:DirectorPosePreset)=>{if(!stage||!camera||!object)return;try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,object.id,{pose_preset});const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){handleDirectorError(cause,'保存角色姿态失败');}};
  const changeBodyProfile=async(key:'proxy_height'|'proxy_shoulder_width'|'proxy_body_width',value:number)=>{if(!stage||!object)return;const beforeStage=stage;const appearance={...object.appearance,[key]:value};setStage({...stage,objects:stage.objects.map(item=>item.id===object.id?{...item,appearance}:item)});try{const saved=await updateDirectorObject(object.id,stage.version,{appearance});setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===object.id?saved:item)}:current);}catch(cause){setStage(beforeStage);handleDirectorError(cause,'保存角色体型失败');}};
  const changeProxyRig=async(proxy_rig:DirectorProxyRig)=>{if(!stage||!object)return;const beforeStage=stage;const metadata={...object.metadata,requires_3d_model:false,proxy_rig,full_model_optional:true};setStage({...stage,objects:stage.objects.map(item=>item.id===object.id?{...item,metadata}:item)});try{const saved=await updateDirectorObject(object.id,stage.version,{metadata});setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===object.id?saved:item)}:current);}catch(cause){setStage(beforeStage);handleDirectorError(cause,'保存 3D 代理模板失败');}};
  const persistAnimationOverride=async(patch:DirectorObjectOverride,failure:string)=>{if(!stage||!camera||!object||animationSavingRef.current)return;animationSavingRef.current=true;setAnimationSaving(true);try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,object.id,patch);const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){handleDirectorError(cause,failure);}finally{animationSavingRef.current=false;setAnimationSaving(false);}};
  const changeAnimation=(animation_clip:DirectorAnimationClip)=>persistAnimationOverride({animation_clip,animation_playing:false,animation_time_seconds:0},'保存角色动画失败');
  const changeFacialExpression=(facial_expression:DirectorFacialExpression)=>persistAnimationOverride({facial_expression},'保存角色表情失败');
  const changeHeadDirection=(key:'head_yaw_degrees'|'head_pitch_degrees',value:number)=>persistAnimationOverride({[key]:value},'保存头部方向失败');
  const changeGazeTarget=(gaze_target:Transform['position']|null)=>persistAnimationOverride({gaze_target:gaze_target??undefined},'保存视线目标失败');
  const changeMorphTargetWeight=(name:string,weight:number)=>{const stored=object?.appearance.morph_target_weights&&typeof object.appearance.morph_target_weights==='object'?object.appearance.morph_target_weights as Record<string,unknown>:{};const morph_target_weights=Object.fromEntries(Object.entries(stored).flatMap(([key,value])=>typeof value==='number'&&Number.isFinite(value)?[[key,value]]:[]));morph_target_weights[name]=Math.min(1,Math.max(0,weight));return persistAnimationOverride({morph_target_weights},'保存模型表情失败');};
  const resetMorphTargets=()=>persistAnimationOverride({morph_target_weights:{}},'重置模型表情失败');
  const changeImportedAnimation=(animation_clip:string)=>persistAnimationOverride({animation_clip,animation_playing:false,animation_time_seconds:0},'保存导入动画失败');
  const changeAnimationPlaying=(animation_playing:boolean)=>{
    const importedClips=Array.isArray(object?.metadata.animation_clips)?object.metadata.animation_clips:[];
    const firstImportedClip=importedClips.find(item=>item&&typeof item==='object'&&typeof(item as Record<string,unknown>).name==='string') as Record<string,unknown>|undefined;
    const needsImportedDefault=animation_playing&&typeof object?.appearance.model_url==='string'&&typeof object.appearance.animation_clip!=='string'&&typeof firstImportedClip?.name==='string';
    const proxyClip=(typeof object?.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip;
    const storedTime=typeof object?.appearance.animation_time_seconds==='number'&&Number.isFinite(object.appearance.animation_time_seconds)?object.appearance.animation_time_seconds:0;
    const needsProxyDefault=animation_playing&&typeof object?.appearance.model_url!=='string'&&typeof object?.appearance.animation_clip!=='string';
    return persistAnimationOverride(needsImportedDefault?{animation_clip:firstImportedClip.name as string,animation_playing,animation_time_seconds:0}:needsProxyDefault?{animation_clip:proxyClip,animation_playing,animation_time_seconds:storedTime}:{animation_playing},'保存动画播放状态失败');
  };
  const changeAnimationTime=(animation_time_seconds:number)=>persistAnimationOverride(typeof object?.appearance.model_url==='string'?{animation_time_seconds}:{animation_clip:(typeof object?.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip,animation_playing:false,animation_time_seconds},'保存动画时间失败');
  const resetAnimation=()=>persistAnimationOverride(typeof object?.appearance.model_url==='string'?{animation_playing:false,animation_time_seconds:0}:{animation_clip:(typeof object?.appearance.animation_clip==='string'?object.appearance.animation_clip:'idle') as DirectorAnimationClip,animation_playing:false,animation_time_seconds:0},'重置动画失败');
  const resetShotOverride=async()=>{if(!stage||!camera||!object)return;try{const object_overrides=removeDirectorObjectOverride(camera.object_overrides,object.id);const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){handleDirectorError(cause,'重置镜头覆盖失败');}};
  const deleteObject=async()=>{if(!stage||!object||!window.confirm(`删除场景对象“${object.label}”？`))return;try{await deleteDirectorObject(object.id,stage.version);setStage(current=>current?{...current,version:current.version+1,objects:current.objects.filter(item=>item.id!==object.id),shot_cameras:current.shot_cameras.map(item=>({...item,object_overrides:removeDirectorObjectOverride(item.object_overrides,object.id)}))}:current);setSelectedObjectId(null);}catch(cause){handleDirectorError(cause,'删除对象失败');}};
  const changeFocal=(value:number)=>{if(!stage||!camera)return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,focal_length_mm:value}:item)});};
  const changeCameraPose=(pose:DirectorCameraPose)=>{if(!stage||!camera)return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,...pose}:item)});};
  const saveCamera=async()=>{if(!stage||!camera)return;try{const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{position:camera.position,target:camera.target,rotation:camera.rotation,focal_length_mm:camera.focal_length_mm});setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===saved.id?saved:item)});}catch(cause){handleDirectorError(cause,'保存相机失败');}};
  const saveEnvironment=async(settings:DirectorEnvironmentSettings)=>{if(!stage||environmentSaving)return;setEnvironmentSaving(true);setError('');try{setStage(await updateDirectorStage(stage.id,stage.version,{...stage.environment,...settings}));}catch(cause){handleDirectorError(cause,'保存环境设置失败');}finally{setEnvironmentSaving(false);}};
  const openRevisionHistory=async()=>{if(!stage)return;setRevisionOpen(true);setRevisionLoading(true);try{setRevisions(await listDirectorRevisions(stage.id));}catch(cause){handleDirectorError(cause,'加载修订历史失败');}finally{setRevisionLoading(false);}};
  const restoreRevision=async(revision:DirectorRevision)=>{if(!stage||restoringRevisionId)return;const version=revision.stage_snapshot.version??'未知';if(!window.confirm(`恢复导演台版本 ${version}？当前状态会先保存为新修订。`))return;setRestoringRevisionId(revision.id);try{const restored=await restoreDirectorRevision(stage.id,revision.id,stage.version);setStage(restored);setSelectedObjectId(null);setUndoHistory([]);setRedoHistory([]);setRevisionOpen(false);}catch(cause){handleDirectorError(cause,'恢复修订失败');}finally{setRestoringRevisionId(null);}};
  const reloadLatestStage=async()=>{setBusy(true);try{const latest=await getDirectorStage(scene.id);const catalog=await getDirectorAssets(latest.id,selectedShotId);setStage(latest);setAssets(catalog);setSelectedObjectId(null);setUndoHistory([]);setRedoHistory([]);setConflictOpen(false);setConflictVersion(null);}catch(cause){setError(cause instanceof Error?cause.message:'重新加载导演台失败');}finally{setBusy(false);}};
  const requestSuggestion=async()=>{if(!stage||!shot||suggesting)return;setSuggesting(true);setError('');try{setSuggestion(await createDirectorSuggestion(stage.id,shot.id,'shot_composition'));}catch(cause){setError(cause instanceof Error?cause.message:'AI 建议生成失败');}finally{setSuggesting(false);}};
  const applySuggestion=async(fields:DirectorApplyField[])=>{if(!stage||!shot||!suggestion||applying)return;setApplying(true);try{const updated=await applyDirectorSuggestionToShot(stage.id,shot.id,suggestion.id,fields);onShotUpdated?.(updated);setSuggestion(null);}catch(cause){setError(cause instanceof Error?cause.message:'应用建议失败');}finally{setApplying(false);}};
  const capturePreview=async()=>{if(!stage||!camera||capturing)return;const canvas=viewportRef.current?.querySelector('canvas');if(!canvas){setError('3D 画布尚未就绪');return;}setCapturing(true);try{const asset=await uploadDirectorPreview(camera.id,await captureDirectorPreview(canvas));setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,preview_asset_id:asset.id}:item)});}catch(cause){setError(cause instanceof Error?cause.message:'预览保存失败');}finally{setCapturing(false);}};

  if(busy)return <main className="director-loading"><LoaderCircle className="planning-spinner"/><span>正在加载 3D 导演台</span></main>;
  if(!stage||!camera)return <main className="director-loading"><strong>导演台不可用</strong><span>{error||'当前场景没有镜头'}</span>{error&&<button className="command-button" aria-label="重新连接导演台" onClick={()=>setLoadAttempt(value=>value+1)}><RefreshCw size={15}/>重新连接</button>}</main>;
  return <main className="director-workspace">
    <header className="director-toolbar">
      <div>{onBackToProduction&&<button className="command-button director-back-action" aria-label="返回生产画布" onClick={onBackToProduction}><ArrowLeft size={15}/>返回</button>}<Box size={18}/><h1>3D 导演台</h1><span>{scene.location}</span></div>
      <div className="director-mode" role="group" aria-label="导演模式"><button className={mode==='world'?'active':''} onClick={()=>setMode('world')}><Globe2 size={15}/>场景</button><button className={mode==='camera'?'active':''} onClick={()=>setMode('camera')}><Camera size={15}/>镜头</button></div>
      <div className="director-toolbar-actions"><button className="command-button director-history-action" aria-label="撤销对象变换" title="撤销对象变换" disabled={historyBusy||!undoHistory.length} onClick={()=>void undoTransform()}><Undo2 size={15}/></button><button className="command-button director-history-action" aria-label="重做对象变换" title="重做对象变换" disabled={historyBusy||!redoHistory.length} onClick={()=>void redoTransform()}><Redo2 size={15}/></button><button className="command-button director-history-action" aria-label="修订历史" title="修订历史" onClick={()=>void openRevisionHistory()}><History size={15}/></button><button className="command-button" aria-label="保存相机预览" disabled={capturing} onClick={()=>void capturePreview()}><CameraIcon size={15}/>{capturing?'保存中':'保存预览'}</button><button className="command-button" aria-label="AI构图建议" disabled={suggesting} onClick={()=>void requestSuggestion()}><Sparkles size={15}/>{suggesting?'生成中':'AI构图建议'}</button><button className="command-button" aria-label="同步场景资产" disabled={syncing||!assets.length} onClick={()=>void syncAssets()}><RefreshCw size={15}/>{syncing?'同步中':'同步资产'}</button><button className="command-button" aria-label="添加占位物" onClick={()=>void addObject()}><Plus size={15}/>添加占位物</button></div>
    </header>
    {error&&<p className="director-error" role="alert">{error}</p>}
    {conflictOpen&&<div className="director-conflict" role="alertdialog" aria-label="导演台版本冲突"><div><strong>导演台已在其他位置更新</strong><span>{conflictVersion===null?'请重新加载最新舞台后再继续。':`服务器最新版本为版本 ${conflictVersion}，请重新加载后再继续。`}</span></div><button type="button" className="command-button" onClick={()=>void reloadLatestStage()}>重新加载最新舞台</button></div>}
    <div className="director-layout">
      <DirectorObjectTree objects={objects} assets={assets} selectedId={selectedObjectId} syncing={syncing} onSelect={setSelectedObjectId} onAdd={()=>void addObject()} onSync={()=>void syncAssets()} onAddAsset={key=>void addAsset(key)}/>
      <section ref={viewportRef} className="director-viewport"><DirectorCanvas objects={effectiveObjects} camera={camera} environment={stage.environment} selectedObjectId={selectedObjectId} mode={mode} transformMode={transformMode} snapEnabled={snapEnabled} editable={!mobile} onSelectObject={setSelectedObjectId} onTransform={(id,transform)=>void transformObject(id,transform)} onCameraChange={changeCameraPose}/></section>
      <DirectorInspector object={object} animationSaving={animationSaving} environment={stage.environment} environmentSaving={environmentSaving} sceneVisible={sceneObject?.visible??false} camera={camera} cameraMode={mode==='camera'} transformMode={transformMode} snapEnabled={snapEnabled} hasShotOverride={Boolean(object&&camera.object_overrides[object.id])} onTransformModeChange={setTransformMode} onSnapEnabledChange={setSnapEnabled} onGroundObject={groundObject} onCenterObject={centerObject} onObjectTransformChange={transform=>object&&void transformObject(object.id,transform)} onCameraChange={changeFocal} onSaveCamera={()=>void saveCamera()} onPoseChange={pose=>void changePose(pose)} onHeadDirectionChange={(key,value)=>void changeHeadDirection(key,value)} onGazeTargetChange={target=>void changeGazeTarget(target)} onFacialExpressionChange={expression=>void changeFacialExpression(expression)} onMorphTargetWeightChange={(name,weight)=>void changeMorphTargetWeight(name,weight)} onMorphTargetReset={()=>void resetMorphTargets()} onBodyProfileChange={(key,value)=>void changeBodyProfile(key,value)} onProxyRigChange={rig=>void changeProxyRig(rig)} onAnimationChange={clip=>void changeAnimation(clip)} onImportedAnimationChange={clip=>void changeImportedAnimation(clip)} onAnimationPlayingChange={playing=>void changeAnimationPlaying(playing)} onAnimationTimeChange={time=>void changeAnimationTime(time)} onAnimationReset={()=>void resetAnimation()} onShotVisibilityChange={visible=>void changeShotVisibility(visible)} onSceneVisibilityChange={changeSceneVisibility} onRenameObject={renameObject} onDuplicateObject={()=>void duplicateObject()} onSaveEnvironment={settings=>void saveEnvironment(settings)} onResetShotOverride={()=>void resetShotOverride()} onDeleteObject={()=>void deleteObject()}/>
    </div>
    <DirectorShotStrip shots={scene.shots} selectedId={camera.shot_id} onSelect={onSelectShot}/>
    <DirectorSuggestionDialog suggestion={suggestion} shot={shot} busy={applying} onCancel={()=>setSuggestion(null)} onApply={fields=>void applySuggestion(fields)}/>
    {revisionOpen&&<DirectorRevisionDialog revisions={revisions} loading={revisionLoading} restoringId={restoringRevisionId} onClose={()=>setRevisionOpen(false)} onRestore={revision=>void restoreRevision(revision)}/>}
  </main>;
}
