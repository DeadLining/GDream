'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Box,Camera,CameraIcon,Globe2,LoaderCircle,Plus,RefreshCw,Sparkles} from 'lucide-react';
import {ApiError,applyDirectorSuggestionToShot,createDirectorObject,createDirectorStage,createDirectorSuggestion,deleteDirectorObject,getDirectorAssets,getDirectorStage,syncDirectorAssets,updateDirectorCamera,updateDirectorObject,uploadDirectorPreview} from '../../lib/api';
import {applyDirectorObjectOverrides,mergeDirectorObjectOverride,removeDirectorObjectOverride} from '../../lib/director-overrides';
import {captureDirectorPreview} from '../../lib/director-preview';
import type {DirectorApplyField,DirectorAsset,DirectorPosePreset,DirectorStage,DirectorSuggestion,DirectorTransformMode,Scene,Shot,Transform} from '../../lib/types';
import {DirectorCanvas,type DirectorCameraPose,type DirectorCanvasMode} from './DirectorCanvas';
import {DirectorInspector} from './DirectorInspector';
import {DirectorObjectTree} from './DirectorObjectTree';
import {DirectorShotStrip} from './DirectorShotStrip';
import {DirectorSuggestionDialog} from './DirectorSuggestionDialog';

export function DirectorWorkspace({scene,selectedShotId,mobile,onSelectShot,onShotUpdated,onBackToProduction}:{scene:Scene;selectedShotId:string;mobile:boolean;onSelectShot:(id:string)=>void;onShotUpdated?:(shot:Shot)=>void;onBackToProduction?:()=>void}){
  const [stage,setStage]=useState<DirectorStage|null>(null);
  const [assets,setAssets]=useState<DirectorAsset[]>([]);
  const [selectedObjectId,setSelectedObjectId]=useState<string|null>(null);
  const [mode,setMode]=useState<DirectorCanvasMode>('world');
  const [transformMode,setTransformMode]=useState<DirectorTransformMode>('translate');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [suggestion,setSuggestion]=useState<DirectorSuggestion|null>(null);
  const [suggesting,setSuggesting]=useState(false);
  const [applying,setApplying]=useState(false);
  const [capturing,setCapturing]=useState(false);
  const viewportRef=useRef<HTMLElement>(null);

  useEffect(()=>{
    let current=true;
    setBusy(true);setError('');
    getDirectorStage(scene.id)
      .catch(cause=>cause instanceof ApiError&&cause.status===404?createDirectorStage(scene.id):Promise.reject(cause))
      .then(async value=>{const catalog=await getDirectorAssets(value.id);if(current){setStage(value);setAssets(catalog);}})
      .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'无法加载导演台');})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[scene.id]);

  const camera=stage?.shot_cameras.find(item=>item.shot_id===selectedShotId)??stage?.shot_cameras[0]??null;
  const shot=scene.shots.find(item=>item.id===selectedShotId)??scene.shots[0];
  const objects=useMemo(()=>stage?.objects??[],[stage]);
  const effectiveObjects=useMemo(()=>camera?applyDirectorObjectOverrides(objects,camera.object_overrides):objects,[camera,objects]);
  const object=effectiveObjects.find(item=>item.id===selectedObjectId)??null;

  const addObject=async()=>{if(!stage)return;try{const created=await createDirectorObject(stage.id,stage.version,{kind:'primitive',source_type:'placeholder',label:'新道具'});setStage({...stage,version:stage.version+1,objects:[...stage.objects,created]});setSelectedObjectId(created.id);}catch(cause){setError(cause instanceof Error?cause.message:'添加失败');}};
  const syncAssets=async()=>{if(!stage||syncing||!assets.length)return;setSyncing(true);setError('');try{setStage(await syncDirectorAssets(stage.id,stage.version,assets.map(item=>item.key)));}catch(cause){setError(cause instanceof Error?cause.message:'同步资产失败');}finally{setSyncing(false);}};
  const transformObject=async(id:string,transform:Transform)=>{if(!stage||!camera)return;if(mode==='camera'){try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,id,{transform});const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){setError(cause instanceof Error?cause.message:'保存镜头对象失败');}return;}const before=stage;setStage({...stage,objects:stage.objects.map(item=>item.id===id?{...item,transform}:item)});try{const saved=await updateDirectorObject(id,stage.version,{transform});setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===id?saved:item)}:current);}catch(cause){setStage(before);setError(cause instanceof Error?cause.message:'保存对象失败');}};
  const groundObject=()=>{if(!object)return;void transformObject(object.id,{...object.transform,position:[object.transform.position[0],0,object.transform.position[2]]});};
  const centerObject=()=>{if(!object)return;void transformObject(object.id,{...object.transform,position:[0,object.transform.position[1],0]});};
  const changeShotVisibility=async(visible:boolean)=>{if(!stage||!camera||!object)return;try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,object.id,{visible});const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){setError(cause instanceof Error?cause.message:'保存镜头显示状态失败');}};
  const changePose=async(pose_preset:DirectorPosePreset)=>{if(!stage||!camera||!object)return;try{const object_overrides=mergeDirectorObjectOverride(camera.object_overrides,object.id,{pose_preset});const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){setError(cause instanceof Error?cause.message:'保存角色姿态失败');}};
  const resetShotOverride=async()=>{if(!stage||!camera||!object)return;try{const object_overrides=removeDirectorObjectOverride(camera.object_overrides,object.id);const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{object_overrides});setStage(current=>current?{...current,shot_cameras:current.shot_cameras.map(item=>item.id===saved.id?{...saved,object_overrides}:item)}:current);}catch(cause){setError(cause instanceof Error?cause.message:'重置镜头覆盖失败');}};
  const deleteObject=async()=>{if(!stage||!object||!window.confirm(`删除场景对象“${object.label}”？`))return;try{await deleteDirectorObject(object.id,stage.version);setStage(current=>current?{...current,version:current.version+1,objects:current.objects.filter(item=>item.id!==object.id),shot_cameras:current.shot_cameras.map(item=>({...item,object_overrides:removeDirectorObjectOverride(item.object_overrides,object.id)}))}:current);setSelectedObjectId(null);}catch(cause){setError(cause instanceof Error?cause.message:'删除对象失败');}};
  const changeFocal=(value:number)=>{if(!stage||!camera)return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,focal_length_mm:value}:item)});};
  const changeCameraPose=(pose:DirectorCameraPose)=>{if(!stage||!camera)return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,...pose}:item)});};
  const saveCamera=async()=>{if(!stage||!camera)return;try{const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{position:camera.position,target:camera.target,rotation:camera.rotation,focal_length_mm:camera.focal_length_mm});setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===saved.id?saved:item)});}catch(cause){setError(cause instanceof Error?cause.message:'保存相机失败');}};
  const requestSuggestion=async()=>{if(!stage||!shot||suggesting)return;setSuggesting(true);setError('');try{setSuggestion(await createDirectorSuggestion(stage.id,shot.id,'shot_composition'));}catch(cause){setError(cause instanceof Error?cause.message:'AI 建议生成失败');}finally{setSuggesting(false);}};
  const applySuggestion=async(fields:DirectorApplyField[])=>{if(!stage||!shot||!suggestion||applying)return;setApplying(true);try{const updated=await applyDirectorSuggestionToShot(stage.id,shot.id,suggestion.id,fields);onShotUpdated?.(updated);setSuggestion(null);}catch(cause){setError(cause instanceof Error?cause.message:'应用建议失败');}finally{setApplying(false);}};
  const capturePreview=async()=>{if(!stage||!camera||capturing)return;const canvas=viewportRef.current?.querySelector('canvas');if(!canvas){setError('3D 画布尚未就绪');return;}setCapturing(true);try{const asset=await uploadDirectorPreview(camera.id,await captureDirectorPreview(canvas));setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,preview_asset_id:asset.id}:item)});}catch(cause){setError(cause instanceof Error?cause.message:'预览保存失败');}finally{setCapturing(false);}};

  if(busy)return <main className="director-loading"><LoaderCircle className="planning-spinner"/><span>正在加载 3D 导演台</span></main>;
  if(!stage||!camera)return <main className="director-loading"><strong>导演台不可用</strong><span>{error||'当前场景没有镜头'}</span></main>;
  return <main className="director-workspace">
    <header className="director-toolbar">
      <div>{onBackToProduction&&<button className="command-button director-back-action" aria-label="返回生产画布" onClick={onBackToProduction}><ArrowLeft size={15}/>返回</button>}<Box size={18}/><h1>3D 导演台</h1><span>{scene.location}</span></div>
      <div className="director-mode" role="group" aria-label="导演模式"><button className={mode==='world'?'active':''} onClick={()=>setMode('world')}><Globe2 size={15}/>场景</button><button className={mode==='camera'?'active':''} onClick={()=>setMode('camera')}><Camera size={15}/>镜头</button></div>
      <div className="director-toolbar-actions"><button className="command-button" aria-label="保存相机预览" disabled={capturing} onClick={()=>void capturePreview()}><CameraIcon size={15}/>{capturing?'保存中':'保存预览'}</button><button className="command-button" aria-label="AI构图建议" disabled={suggesting} onClick={()=>void requestSuggestion()}><Sparkles size={15}/>{suggesting?'生成中':'AI构图建议'}</button><button className="command-button" aria-label="同步场景资产" disabled={syncing||!assets.length} onClick={()=>void syncAssets()}><RefreshCw size={15}/>{syncing?'同步中':'同步资产'}</button><button className="command-button" aria-label="添加占位物" onClick={()=>void addObject()}><Plus size={15}/>添加占位物</button></div>
    </header>
    {error&&<p className="director-error" role="alert">{error}</p>}
    <div className="director-layout">
      <DirectorObjectTree objects={objects} assets={assets} selectedId={selectedObjectId} syncing={syncing} onSelect={setSelectedObjectId} onAdd={()=>void addObject()} onSync={()=>void syncAssets()}/>
      <section ref={viewportRef} className="director-viewport"><DirectorCanvas objects={effectiveObjects} camera={camera} selectedObjectId={selectedObjectId} mode={mode} transformMode={transformMode} editable={!mobile} onTransform={(id,transform)=>void transformObject(id,transform)} onCameraChange={changeCameraPose}/></section>
      <DirectorInspector object={object} camera={camera} cameraMode={mode==='camera'} transformMode={transformMode} hasShotOverride={Boolean(object&&camera.object_overrides[object.id])} onTransformModeChange={setTransformMode} onGroundObject={groundObject} onCenterObject={centerObject} onCameraChange={changeFocal} onSaveCamera={()=>void saveCamera()} onPoseChange={pose=>void changePose(pose)} onShotVisibilityChange={visible=>void changeShotVisibility(visible)} onResetShotOverride={()=>void resetShotOverride()} onDeleteObject={()=>void deleteObject()}/>
    </div>
    <DirectorShotStrip shots={scene.shots} selectedId={camera.shot_id} onSelect={onSelectShot}/>
    <DirectorSuggestionDialog suggestion={suggestion} shot={shot} busy={applying} onCancel={()=>setSuggestion(null)} onApply={fields=>void applySuggestion(fields)}/>
  </main>;
}
