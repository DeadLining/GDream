'use client';
import {useEffect,useMemo,useState} from 'react';
import {Box,Camera,Globe2,LoaderCircle,Plus} from 'lucide-react';
import {ApiError,createDirectorObject,createDirectorStage,getDirectorStage,updateDirectorCamera,updateDirectorObject} from '../../lib/api';
import type {DirectorObject,DirectorStage,Scene,Transform} from '../../lib/types';
import {DirectorCanvas,type DirectorCanvasMode} from './DirectorCanvas';
import {DirectorInspector} from './DirectorInspector';
import {DirectorObjectTree} from './DirectorObjectTree';
import {DirectorShotStrip} from './DirectorShotStrip';

export function DirectorWorkspace({scene,selectedShotId,mobile,onSelectShot}:{scene:Scene;selectedShotId:string;mobile:boolean;onSelectShot:(id:string)=>void}){
  const [stage,setStage]=useState<DirectorStage|null>(null);const [selectedObjectId,setSelectedObjectId]=useState<string|null>(null);const [mode,setMode]=useState<DirectorCanvasMode>('world');const [error,setError]=useState('');const [busy,setBusy]=useState(true);
  useEffect(()=>{let current=true;setBusy(true);setError('');getDirectorStage(scene.id).catch(cause=>cause instanceof ApiError&&cause.status===404?createDirectorStage(scene.id):Promise.reject(cause)).then(value=>{if(current)setStage(value);}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'无法加载导演台');}).finally(()=>{if(current)setBusy(false);});return()=>{current=false;};},[scene.id]);
  const camera=stage?.shot_cameras.find(item=>item.shot_id===selectedShotId)??stage?.shot_cameras[0]??null;const object=stage?.objects.find(item=>item.id===selectedObjectId)??null;
  const objects=useMemo(()=>stage?.objects??[],[stage]);
  const addObject=async()=>{if(!stage)return;try{const created=await createDirectorObject(stage.id,stage.version,{kind:'primitive',source_type:'placeholder',label:'新道具'});setStage({...stage,version:stage.version+1,objects:[...stage.objects,created]});setSelectedObjectId(created.id);}catch(cause){setError(cause instanceof Error?cause.message:'添加失败');}};
  const transformObject=async(id:string,transform:Transform)=>{if(!stage)return;const before=stage;setStage({...stage,objects:stage.objects.map(item=>item.id===id?{...item,transform}:item)});try{const saved=await updateDirectorObject(id,stage.version,{transform});setStage(current=>current?{...current,version:stage.version+1,objects:current.objects.map(item=>item.id===id?saved:item)}:current);}catch(cause){setStage(before);setError(cause instanceof Error?cause.message:'保存对象失败');}};
  const changeFocal=(value:number)=>{if(!stage||!camera)return;setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===camera.id?{...item,focal_length_mm:value}:item)});};
  const saveCamera=async()=>{if(!stage||!camera)return;try{const saved=await updateDirectorCamera(stage.id,camera.shot_id,camera.version,{focal_length_mm:camera.focal_length_mm});setStage({...stage,shot_cameras:stage.shot_cameras.map(item=>item.id===saved.id?saved:item)});}catch(cause){setError(cause instanceof Error?cause.message:'保存相机失败');}};
  if(busy)return <main className="director-loading"><LoaderCircle className="planning-spinner"/><span>正在加载 3D 导演台</span></main>;
  if(!stage||!camera)return <main className="director-loading"><strong>导演台不可用</strong><span>{error||'当前场景没有镜头'}</span></main>;
  return <main className="director-workspace"><header className="director-toolbar"><div><Box size={18}/><h1>3D 导演台</h1><span>{scene.location}</span></div><div className="director-mode" role="group" aria-label="导演模式"><button className={mode==='world'?'active':''} onClick={()=>setMode('world')}><Globe2 size={15}/>场景</button><button className={mode==='camera'?'active':''} onClick={()=>setMode('camera')}><Camera size={15}/>镜头</button></div><button className="command-button" aria-label="添加占位物" onClick={()=>void addObject()}><Plus size={15}/>添加占位物</button></header>{error&&<p className="director-error" role="alert">{error}</p>}<div className="director-layout"><DirectorObjectTree objects={objects} selectedId={selectedObjectId} onSelect={setSelectedObjectId} onAdd={()=>void addObject()}/><section className="director-viewport"><DirectorCanvas objects={objects} camera={camera} selectedObjectId={selectedObjectId} mode={mode} editable={!mobile} onTransform={(id,transform)=>void transformObject(id,transform)}/></section><DirectorInspector object={object} camera={camera} onCameraChange={changeFocal} onSaveCamera={()=>void saveCamera()}/></div><DirectorShotStrip shots={scene.shots} selectedId={camera.shot_id} onSelect={onSelectShot}/></main>;
}
