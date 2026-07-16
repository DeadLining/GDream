'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Box,CameraIcon,History,LoaderCircle,Plus,Redo2,RefreshCw,Sparkles,Undo2} from 'lucide-react';
import {ApiError,applyDirectorSuggestionToShot,createDirectorObject,createDirectorStage,createDirectorSuggestion,deleteDirectorObject,getDirectorAssets,getDirectorStage,listDirectorRevisions,restoreDirectorRevision,syncDirectorAssets,updateDirectorCamera,updateDirectorObject,uploadDirectorPreview} from '../../lib/api';
import {applyDirectorAssetModels,applyDirectorObjectOverrides,mergeDirectorObjectOverride,removeDirectorObjectOverride,setDirectorObjectOverrideTransform} from '../../lib/director-overrides';
import {captureDirectorPreview} from '../../lib/director-preview';
import type {DirectorApplyField,DirectorAsset,DirectorRevision,DirectorStage,DirectorSuggestion,Scene,Shot,Transform} from '../../lib/types';
import {DirectorCanvas,type DirectorCameraPose} from './DirectorCanvas';
import {DirectorInspector} from './DirectorInspector';
import {DirectorObjectTree} from './DirectorObjectTree';
import {DirectorRevisionDialog} from './DirectorRevisionDialog';
import {DirectorShotStrip} from './DirectorShotStrip';
import {DirectorSuggestionDialog} from './DirectorSuggestionDialog';

type TransformHistoryEntry={objectId:string;shotId:string;before:Transform|null;after:Transform};
const sameTransform=(left:Transform|null,right:Transform|null)=>JSON.stringify(left)===JSON.stringify(right);

export function DirectorWorkspace({scene,selectedShotId,mobile,onSelectShot,onShotUpdated,onBackToProduction}:{scene:Scene;selectedShotId:string;mobile:boolean;onSelectShot:(id:string)=>void;onShotUpdated?:(shot:Shot)=>void;onBackToProduction?:()=>void}){
  const [stage,setStage]=useState<DirectorStage|null>(null);
  const [assets,setAssets]=useState<DirectorAsset[]>([]);
  const [selectedObjectId,setSelectedObjectId]=useState<string|null>(null);
  const [snapEnabled,setSnapEnabled]=useState(false);
  const [undoHistory,setUndoHistory]=useState<TransformHistoryEntry[]>([]);
  const [redoHistory,setRedoHistory]=useState<TransformHistoryEntry[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [suggestion,setSuggestion]=useState<DirectorSuggestion|null>(null);
  const [suggesting,setSuggesting]=useState(false);
  const [applying,setApplying]=useState(false);
  const [capturing,setCapturing]=useState(false);
  const [revisions,setRevisions]=useState<DirectorRevision[]>([]);
  const [revisionOpen,setRevisionOpen]=useState(false);
  const [revisionLoading,setRevisionLoading]=useState(false);
  const [restoringRevisionId,setRestoringRevisionId]=useState<string|null>(null);
  const [conflictVersion,setConflictVersion]=useState<number|null>(null);
  const [conflictOpen,setConflictOpen]=useState(false);
  const [loadAttempt,setLoadAttempt]=useState(0);
  const viewportRef=useRef<HTMLElement>(null);

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
    setSelectedObjectId(null);setUndoHistory([]);setRedoHistory([]);
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
  const showNotice=(message:string)=>{setError('');setNotice(message);};
  const addObject=async()=>{if(!stage)return;try{const created=await createDirectorObject(stage.id,stage.version,{kind:'primitive',source_type:'placeholder',label:'新道具'});setStage({...stage,version:stage.version+1,objects:[...stage.objects,created]});setSelectedObjectId(created.id);showNotice('已添加占位物，可直接调整本镜头位置');}catch(cause){handleDirectorError(cause,'添加失败');}};
  const addAsset=async(key:string)=>{if(!stage||syncing)return;const existing=stage.objects.map(item=>String(item.metadata.catalog_key??'')).filter(Boolean);setSyncing(true);setError('');try{const next=await syncDirectorAssets(stage.id,stage.version,Array.from(new Set([...existing,key])));setStage(next);setSelectedObjectId(next.objects.find(item=>item.metadata.catalog_key===key)?.id??null);showNotice('资产已加入当前场景');}catch(cause){handleDirectorError(cause,'添加资产失败');}finally{setSyncing(false);}};
  const syncAssets=async()=>{if(!stage||syncing||!assets.length)return;setSyncing(true);setError('');try{setStage(await syncDirectorAssets(stage.id,stage.version,assets.map(item=>item.key)));showNotice('场景资产已同步');}catch(cause){handleDirectorError(cause,'同步资产失败');}finally{setSyncing(false);}};
  const persistTransform=async(entry:TransformHistoryEntry,transform:Transform|null)=>{
    if(!stage)return false;
    const targetCamera=stage.shot_cameras.find(item=>item.shot_id===entry.shotId);
    if(!targetCamera)return false;
    const beforeStage=stage;
    const object_overrides=setDirectorObjectOverrideTransform(targetCamera.object_overrides,entry.objectId,transform);
    setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===targetCamera.id?{...item,object_overrides}:item)});
    try{
      const saved=await updateDirectorCamera(stage.id,targetCamera.shot_id,targetCamera.version,{object_overrides});
      setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?saved:item)}:current);
      return true;
    }catch(cause){setStage(beforeStage);handleDirectorError(cause,'保存本镜头实体位置失败');return false;}
  };
  const transformObject=async(id:string,transform:Transform)=>{
    if(!stage||!camera||historyBusy)return;
    const entry:TransformHistoryEntry={objectId:id,shotId:camera.shot_id,before:camera.object_overrides[id]?.transform??null,after:transform};
    if(sameTransform(entry.before,entry.after))return;
    setHistoryBusy(true);
    try{if(await persistTransform(entry,entry.after)){setUndoHistory(current=>[...current,entry].slice(-50));setRedoHistory([]);showNotice('本镜头实体位置已保存');}}finally{setHistoryBusy(false);}
  };
  const undoTransform=async()=>{const entry=undoHistory.at(-1);if(!entry||historyBusy)return;setHistoryBusy(true);try{if(await persistTransform(entry,entry.before)){setUndoHistory(current=>current.slice(0,-1));setRedoHistory(current=>[...current,entry].slice(-50));showNotice('已撤销本镜头位置调整');}}finally{setHistoryBusy(false);}};
  const redoTransform=async()=>{const entry=redoHistory.at(-1);if(!entry||historyBusy)return;setHistoryBusy(true);try{if(await persistTransform(entry,entry.after)){setRedoHistory(current=>current.slice(0,-1));setUndoHistory(current=>[...current,entry].slice(-50));showNotice('已重做本镜头位置调整');}}finally{setHistoryBusy(false);}};
  const groundObject=()=>{if(!object)return;void transformObject(object.id,{...object.transform,position:[object.transform.position[0],0,object.transform.position[2]]});};
  const centerObject=()=>{if(!object)return;void transformObject(object.id,{...object.transform,position:[0,object.transform.position[1],0]});};
  const changeShotVisibility=async(visible:boolean)=>{if(!stage||!camera||!object)return;try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,object.id,{visible});const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?saved:item)}:current);showNotice(visible?'实体已在本镜头显示':'实体已在本镜头隐藏');}catch(cause){handleDirectorError(cause,'保存镜头显示状态失败');}};
  const updateSceneObject=async(patch:Parameters<typeof updateDirectorObject>[2],failure:string)=>{if(!stage||!sceneObject)return;const before=stage;try{const saved=await updateDirectorObject(sceneObject.id,stage.version,patch);setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===sceneObject.id?saved:item)}:current);showNotice('场景对象已更新');}catch(cause){setStage(before);handleDirectorError(cause,failure);}};
  const resetShotOverride=async()=>{if(!stage||!camera||!object)return;try{const object_overrides=removeDirectorObjectOverride(camera.object_overrides,object.id);const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?saved:item)}:current);showNotice('已恢复场景默认位置');}catch(cause){handleDirectorError(cause,'重置镜头位置失败');}};
  const deleteObject=async()=>{if(!stage||!object||!window.confirm(`删除场景对象“${object.label}”？`))return;try{await deleteDirectorObject(object.id,stage.version);setStage(current=>current?{...current,version:current.version+1,objects:current.objects.filter(item=>item.id!==object.id),shot_cameras:current.shot_cameras.map(item=>({...item,object_overrides:removeDirectorObjectOverride(item.object_overrides,object.id)}))}:current);setSelectedObjectId(null);showNotice('场景对象已删除');}catch(cause){handleDirectorError(cause,'删除对象失败');}};
  const changeFocal=(value:number)=>{if(!stage||!camera||!Number.isFinite(value))return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,focal_length_mm:value}:item)});};
  const changeCameraPose=(pose:DirectorCameraPose)=>{if(!stage||!camera)return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,...pose}:item)});};
  const saveCamera=async()=>{if(!stage||!camera)return;try{const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{position:camera.position,target:camera.target,rotation:camera.rotation,focal_length_mm:camera.focal_length_mm});setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===saved.id?saved:item)});showNotice('当前镜头视角已保存');}catch(cause){handleDirectorError(cause,'保存镜头视角失败');}};
  const openRevisionHistory=async()=>{if(!stage)return;setRevisionOpen(true);setRevisionLoading(true);try{setRevisions(await listDirectorRevisions(stage.id));}catch(cause){handleDirectorError(cause,'加载修订历史失败');}finally{setRevisionLoading(false);}};
  const restoreRevision=async(revision:DirectorRevision)=>{if(!stage||restoringRevisionId)return;const version=revision.stage_snapshot.version??'未知';if(!window.confirm(`恢复导演台版本 ${version}？当前状态会先保存为新修订。`))return;setRestoringRevisionId(revision.id);try{const restored=await restoreDirectorRevision(stage.id,revision.id,stage.version);setStage(restored);setSelectedObjectId(null);setUndoHistory([]);setRedoHistory([]);setRevisionOpen(false);showNotice('导演台版本已恢复');}catch(cause){handleDirectorError(cause,'恢复修订失败');}finally{setRestoringRevisionId(null);}};
  const reloadLatestStage=async()=>{setBusy(true);try{const latest=await getDirectorStage(scene.id);const catalog=await getDirectorAssets(latest.id,selectedShotId);setStage(latest);setAssets(catalog);setSelectedObjectId(null);setUndoHistory([]);setRedoHistory([]);setConflictOpen(false);setConflictVersion(null);}catch(cause){setError(cause instanceof Error?cause.message:'重新加载导演台失败');}finally{setBusy(false);}};
  const requestSuggestion=async()=>{if(!stage||!shot||suggesting)return;setSuggesting(true);setError('');try{setSuggestion(await createDirectorSuggestion(stage.id,shot.id,'shot_composition'));}catch(cause){setError(cause instanceof Error?cause.message:'AI 建议生成失败');}finally{setSuggesting(false);}};
  const applySuggestion=async(fields:DirectorApplyField[])=>{if(!stage||!shot||!suggestion||applying)return;setApplying(true);try{const updated=await applyDirectorSuggestionToShot(stage.id,shot.id,suggestion.id,fields);onShotUpdated?.(updated);setSuggestion(null);showNotice('AI 构图建议已应用');}catch(cause){setError(cause instanceof Error?cause.message:'应用建议失败');}finally{setApplying(false);}};
  const capturePreview=async()=>{if(!stage||!camera||capturing)return;const canvas=viewportRef.current?.querySelector('canvas');if(!canvas){setError('3D 画布尚未就绪');return;}setCapturing(true);try{const asset=await uploadDirectorPreview(camera.id,await captureDirectorPreview(canvas));setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,preview_asset_id:asset.id}:item)});showNotice('当前镜头预览已保存');}catch(cause){setError(cause instanceof Error?cause.message:'预览保存失败');}finally{setCapturing(false);}};
  const selectShot=(id:string)=>{const next=scene.shots.find(item=>item.id===id);setSelectedObjectId(null);setUndoHistory([]);setRedoHistory([]);setNotice(next?`已切换到镜头 ${String(next.position).padStart(2,'0')}`:'');onSelectShot(id);};

  if(busy)return <main className="director-loading"><LoaderCircle className="planning-spinner"/><span>正在加载 3D 导演台</span></main>;
  if(!stage||!camera)return <main className="director-loading"><strong>导演台不可用</strong><span>{error||'当前场景没有镜头'}</span>{error&&<button className="command-button" aria-label="重新连接导演台" onClick={()=>setLoadAttempt(value=>value+1)}><RefreshCw size={15}/>重新连接</button>}</main>;
  return <main className="director-workspace">
    <header className="director-toolbar">
      <div>{onBackToProduction&&<button className="command-button director-back-action" aria-label="返回生产画布" onClick={onBackToProduction}><ArrowLeft size={15}/>返回</button>}<Box size={18}/><h1>3D 导演台</h1><span>{scene.location}</span></div>
      <div className="director-current-shot" aria-live="polite"><strong>镜头 {String(shot?.position??0).padStart(2,'0')}</strong><span>{shot?.shot_type.replaceAll('_',' ')??'当前镜头'}</span></div>
      <div className="director-toolbar-actions"><button className="command-button director-history-action" aria-label="撤销对象变换" title="撤销对象变换" disabled={historyBusy||!undoHistory.length} onClick={()=>void undoTransform()}><Undo2 size={15}/></button><button className="command-button director-history-action" aria-label="重做对象变换" title="重做对象变换" disabled={historyBusy||!redoHistory.length} onClick={()=>void redoTransform()}><Redo2 size={15}/></button><button className="command-button director-history-action" aria-label="修订历史" title="修订历史" onClick={()=>void openRevisionHistory()}><History size={15}/></button><button className="command-button" aria-label="保存相机预览" disabled={capturing} onClick={()=>void capturePreview()}><CameraIcon size={15}/>{capturing?'保存中':'保存预览'}</button><button className="command-button" aria-label="AI构图建议" disabled={suggesting} onClick={()=>void requestSuggestion()}><Sparkles size={15}/>{suggesting?'生成中':'AI构图建议'}</button><button className="command-button" aria-label="同步场景资产" disabled={syncing||!assets.length} onClick={()=>void syncAssets()}><RefreshCw size={15}/>{syncing?'同步中':'同步资产'}</button><button className="command-button" aria-label="添加占位物" onClick={()=>void addObject()}><Plus size={15}/>添加占位物</button></div>
    </header>
    {error&&<p className="director-error" role="alert">{error}</p>}
    {notice&&<p className="director-notice" role="status">{notice}</p>}
    {conflictOpen&&<div className="director-conflict" role="alertdialog" aria-label="导演台版本冲突"><div><strong>导演台已在其他位置更新</strong><span>{conflictVersion===null?'请重新加载最新舞台后再继续。':`服务器最新版本为版本 ${conflictVersion}，请重新加载后再继续。`}</span></div><button type="button" className="command-button" onClick={()=>void reloadLatestStage()}>重新加载最新舞台</button></div>}
    <div className="director-layout">
      <DirectorObjectTree objects={objects} assets={assets} selectedId={selectedObjectId} syncing={syncing} onSelect={setSelectedObjectId} onAdd={()=>void addObject()} onSync={()=>void syncAssets()} onAddAsset={key=>void addAsset(key)}/>
      <section ref={viewportRef} className="director-viewport"><DirectorCanvas objects={effectiveObjects} camera={camera} environment={stage.environment} selectedObjectId={selectedObjectId} mode="camera" transformMode="translate" snapEnabled={snapEnabled} editable={!mobile} onSelectObject={setSelectedObjectId} onTransform={(id,transform)=>void transformObject(id,transform)} onCameraChange={changeCameraPose}/></section>
      <DirectorInspector object={object} camera={camera} snapEnabled={snapEnabled} hasShotOverride={Boolean(object&&camera.object_overrides[object.id])} onSnapEnabledChange={setSnapEnabled} onGroundObject={groundObject} onCenterObject={centerObject} onObjectTransformChange={transform=>object&&void transformObject(object.id,transform)} onCameraChange={changeFocal} onSaveCamera={()=>void saveCamera()} onShotVisibilityChange={visible=>void changeShotVisibility(visible)} onRenameObject={label=>void updateSceneObject({label},'重命名对象失败')} onResetShotOverride={()=>void resetShotOverride()} onDeleteObject={()=>void deleteObject()}/>
    </div>
    <DirectorShotStrip shots={scene.shots} selectedId={camera.shot_id} onSelect={selectShot}/>
    <DirectorSuggestionDialog suggestion={suggestion} shot={shot} busy={applying} onCancel={()=>setSuggestion(null)} onApply={fields=>void applySuggestion(fields)}/>
    {revisionOpen&&<DirectorRevisionDialog revisions={revisions} loading={revisionLoading} restoringId={restoringRevisionId} onClose={()=>setRevisionOpen(false)} onRestore={revision=>void restoreRevision(revision)}/>}
  </main>;
}
