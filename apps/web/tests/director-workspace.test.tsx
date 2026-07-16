import React from 'react';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DirectorWorkspace} from '../components/director/DirectorWorkspace';
import type {DirectorStage,Scene} from '../lib/types';

const mocks=vi.hoisted(()=>({ApiError:class ApiError extends Error{constructor(message:string,public status=500,public detail=''){super(message);}},getDirectorStage:vi.fn(),createDirectorStage:vi.fn(),getDirectorAssets:vi.fn(),syncDirectorAssets:vi.fn(),createDirectorObject:vi.fn(),deleteDirectorObject:vi.fn(),updateDirectorCamera:vi.fn(),updateDirectorObject:vi.fn(),listDirectorRevisions:vi.fn(),restoreDirectorRevision:vi.fn(),createDirectorSuggestion:vi.fn(),applyDirectorSuggestionToShot:vi.fn(),uploadDirectorPreview:vi.fn()}));
vi.mock('../lib/api',()=>mocks);
vi.mock('../lib/director-preview',()=>({captureDirectorPreview:vi.fn(async()=>new Blob(['preview'],{type:'image/png'}))}));

const movedTransform={position:[2,0,0],rotation:[0,0,0],scale:[1,1,1]} as const;
const movedCamera={position:[2,2.4,6] as [number,number,number],target:[0,.9,0] as [number,number,number],rotation:[-.1,.25,0] as [number,number,number]};
vi.mock('../components/director/DirectorCanvas',()=>({DirectorCanvas:({editable,mode,transformMode,snapEnabled,objects,camera,onSelectObject,onTransform,onCameraChange}:{editable:boolean;mode:string;transformMode:string;snapEnabled:boolean;objects:Array<{id:string;visible:boolean;appearance:Record<string,unknown>}>;camera:{id:string};onSelectObject:(id:string|null)=>void;onTransform:(id:string,transform:typeof movedTransform)=>void;onCameraChange?:(camera:typeof movedCamera)=>void})=><div data-testid="director-canvas" data-camera-id={camera.id} data-editable={String(editable)} data-mode={mode} data-transform-mode={transformMode} data-snap-enabled={String(snapEnabled)} data-visible={String(objects[0]?.visible)} data-model-url={String(objects[0]?.appearance.model_url??'')}><canvas/><button onClick={()=>objects[0]&&onSelectObject(objects[0].id)}>选择画布对象</button><button onClick={()=>onSelectObject(null)}>清空画布选择</button><button onClick={()=>objects[0]&&onTransform(objects[0].id,movedTransform)}>移动对象</button><button onClick={()=>onCameraChange?.(movedCamera)}>移动相机</button></div>}));

const scene:Scene={id:'scene-1',position:1,location:'天台',time_of_day:'night',summary:'对峙',continuity_state:{},estimated_duration_seconds:10,shots:[{id:'shot-1',position:1,shot_type:'medium',duration_seconds:5,composition:'对峙',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',active_panel_asset_id:null,review_status:'draft',render_status:'pending',dialogue:[]}]};
const directorObject={id:'object-1',stage_id:'stage-1',kind:'primitive' as const,source_type:'placeholder' as const,source_id:null,label:'方块',position:1,transform:{position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]},appearance:{},metadata:{},visible:true};
const camera={id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5] as [number,number,number],target:[0,1.2,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],focal_length_mm:50,near:.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null};
const stage:DirectorStage={id:'stage-1',scene_id:'scene-1',version:1,environment:{},objects:[directorObject],shot_cameras:[camera]};

describe('DirectorWorkspace',()=>{
  beforeEach(()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);
    mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.createDirectorObject.mockResolvedValue({...directorObject,id:'object-new',label:'新道具'});
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,shotId:string,version:number,patch:Record<string,unknown>)=>({...camera,shot_id:shotId,...patch,version:version+1}));
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:Record<string,unknown>)=>({...directorObject,...patch}));
    mocks.deleteDirectorObject.mockResolvedValue(undefined);
    mocks.uploadDirectorPreview.mockResolvedValue({id:'preview-1'});
  });
  afterEach(()=>{cleanup();vi.resetAllMocks();});

  it('reconnects after a transient local API failure',async()=>{
    mocks.getDirectorStage.mockRejectedValueOnce(new Error('本地 API 暂时不可用，请稍后重试')).mockResolvedValueOnce(stage);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    expect(await screen.findByText('本地 API 暂时不可用，请稍后重试')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'重新连接导演台'}));
    expect(await screen.findByRole('heading',{name:'3D 导演台'})).toBeVisible();
    expect(mocks.getDirectorStage).toHaveBeenCalledTimes(2);
  });

  it('adds a visible placeholder and reports the result',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click((await screen.findAllByRole('button',{name:'添加占位物'}))[0]);
    await waitFor(()=>expect(mocks.createDirectorObject).toHaveBeenCalledWith('stage-1',1,expect.objectContaining({label:'新道具'})));
    expect(screen.getByText(/已添加占位物/)).toBeVisible();
  });

  it('edits only the selected shot camera and entity positions',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up',composition:'反应'};
    const twoShotScene={...scene,shots:[scene.shots[0],shot2]};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2',position:[2,1.8,4] as [number,number,number]};
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    function Harness(){const [shotId,setShotId]=React.useState('shot-1');return <DirectorWorkspace scene={twoShotScene} selectedShotId={shotId} mobile={false} onSelectShot={setShotId}/>;}
    render(<Harness/>);
    expect(await screen.findByTestId('director-canvas')).toHaveAttribute('data-camera-id','camera-1');
    const secondShot=screen.getByRole('button',{name:'镜头 02：close up'});
    await userEvent.click(secondShot);
    await waitFor(()=>expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-camera-id','camera-2'));
    expect(secondShot).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('已切换到镜头 02')).toBeVisible();
    expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-mode','camera');
    await userEvent.click(screen.getByRole('button',{name:'方块'}));
    expect(screen.getByLabelText('位置 X')).toBeVisible();
    for(const label of ['旋转 X','缩放 X','角色姿态','表情预设','角色身高'])expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    for(const name of ['旋转对象','缩放对象','保存角色轮廓图','保存骨架姿态图','保存深度图','保存对象遮罩图'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();
  });

  it('returns to the production canvas and disables drag editing on mobile',async()=>{
    const onBack=vi.fn();
    const view=render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile onSelectShot={vi.fn()} onBackToProduction={onBack}/>);
    expect(await screen.findByTestId('director-canvas')).toHaveAttribute('data-editable','false');
    await userEvent.click(screen.getByRole('button',{name:'返回生产画布'}));
    expect(onBack).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('stores entity positions and visibility on the selected shot',async()=>{
    const saved={...camera,version:2,object_overrides:{'object-1':{transform:movedTransform}}};
    mocks.updateDirectorCamera.mockResolvedValueOnce(saved).mockResolvedValueOnce({...saved,version:3,object_overrides:{'object-1':{transform:movedTransform,visible:false}}});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    await userEvent.click(screen.getAllByRole('button',{name:'移动对象'})[0]);
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{transform:movedTransform}}}));
    await userEvent.click(screen.getByLabelText('本镜头显示'));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{transform:movedTransform,visible:false}}}));
    expect(mocks.updateDirectorObject).not.toHaveBeenCalled();
  });

  it('selects objects from the canvas and supports position snapping',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'选择画布对象'}));
    const snap=screen.getByRole('button',{name:'网格吸附'});
    await userEvent.click(snap);
    expect(snap).toHaveAttribute('aria-pressed','true');
    expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-snap-enabled','true');
    await userEvent.click(screen.getByRole('button',{name:'清空画布选择'}));
    expect(screen.queryByRole('toolbar',{name:'实体位置工具'})).not.toBeInTheDocument();
  });

  it('grounds, centers, undoes, and redoes shot-relative positions',async()=>{
    const elevated={...directorObject,transform:{...directorObject.transform,position:[1,2,3] as [number,number,number]}};
    const current={...stage,objects:[elevated]};
    mocks.getDirectorStage.mockResolvedValue(current);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...camera,...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'对象落地'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{transform:{...elevated.transform,position:[1,0,3]}}}}));
    await userEvent.click(screen.getByRole('button',{name:'画面中心'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{transform:{...elevated.transform,position:[0,0,0]}}}}));
    await userEvent.click(screen.getByRole('button',{name:'撤销对象变换'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',3,{object_overrides:{'object-1':{transform:{...elevated.transform,position:[1,0,3]}}}}));
    await userEvent.click(screen.getByRole('button',{name:'重做对象变换'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',4,{object_overrides:{'object-1':{transform:{...elevated.transform,position:[0,0,0]}}}}));
  });

  it('commits precise position inputs without changing rotation or scale',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    const positionX=screen.getByLabelText('位置 X');
    await userEvent.clear(positionX);await userEvent.type(positionX,'2.5');await userEvent.tab();
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{transform:{...directorObject.transform,position:[2.5,0,0]}}}}));
  });

  it('saves the navigated camera and shows completion feedback',async()=>{
    mocks.updateDirectorCamera.mockResolvedValue({...camera,...movedCamera,version:2,focal_length_mm:65});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'移动相机'}));
    await userEvent.clear(screen.getByLabelText('焦距'));await userEvent.type(screen.getByLabelText('焦距'),'65');
    await userEvent.click(screen.getByRole('button',{name:'保存相机'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{...movedCamera,focal_length_mm:65}));
    expect(screen.getByText('当前镜头视角已保存')).toBeVisible();
  });

  it('saves a camera preview and shows completion feedback',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'保存相机预览'}));
    await waitFor(()=>expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob)));
    expect(screen.getByText('当前镜头预览已保存')).toBeVisible();
  });

  it('resets shot position overrides and deletes a confirmed scene object',async()=>{
    const overridden={...stage,shot_cameras:[{...camera,object_overrides:{'object-1':{visible:false}}}]};
    mocks.getDirectorStage.mockResolvedValue(overridden);
    mocks.updateDirectorCamera.mockResolvedValue({...camera,version:2,object_overrides:{}});
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'重置本镜头位置'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{}}));
    await userEvent.click(screen.getByRole('button',{name:'删除场景对象'}));
    await waitFor(()=>expect(mocks.deleteDirectorObject).toHaveBeenCalledWith('object-1',1));
  });

  it('reviews an AI suggestion and applies only selected shot fields',async()=>{
    const updated={...scene.shots[0],composition:'低机位对峙'};const onShotUpdated=vi.fn();
    mocks.createDirectorSuggestion.mockResolvedValue({id:'suggestion-1',stage_id:'stage-1',shot_id:'shot-1',kind:'shot_composition',status:'ready',request_context:{},suggested_patch:{composition:'低机位对峙',camera_motion:'push_in',image_prompt:'cinematic rain'},error_category:'',error:'',created_at:'',applied_at:null});
    mocks.applyDirectorSuggestionToShot.mockResolvedValue(updated);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onShotUpdated={onShotUpdated}/>);
    await userEvent.click(await screen.findByRole('button',{name:'AI构图建议'}));
    expect(await screen.findByRole('dialog',{name:'AI 导演建议'})).toBeVisible();
    await userEvent.click(screen.getByLabelText('运镜'));
    await userEvent.click(screen.getByRole('button',{name:'应用选中字段'}));
    await waitFor(()=>expect(mocks.applyDirectorSuggestionToShot).toHaveBeenCalledWith('stage-1','shot-1','suggestion-1',['composition']));
    expect(onShotUpdated).toHaveBeenCalledWith(updated);
  });

  it('synchronizes available production assets and adds one selected asset',async()=>{
    const asset={key:'character:char-1:ref-1',kind:'character' as const,source_type:'model' as const,source_id:'representation-1',asset_id:'asset-1',label:'林夏',media_url:'/media/linxia.glb',media_type:'model/gltf-binary',metadata:{role:'侦探'}};
    const syncedObject={...directorObject,id:'object-2',kind:'character' as const,source_type:'model' as const,source_id:'representation-1',label:'林夏',metadata:{catalog_key:asset.key}};
    mocks.getDirectorAssets.mockResolvedValue([asset]);
    mocks.syncDirectorAssets.mockResolvedValue({...stage,version:2,objects:[directorObject,syncedObject]});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'添加林夏到场景'}));
    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledWith('stage-1',1,[asset.key]));
    expect(screen.getByText('资产已加入当前场景')).toBeVisible();
  });

  it('renames the selected scene object',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    const name=screen.getByRole('textbox',{name:'对象名称'});
    await userEvent.clear(name);await userEvent.type(name,'线索箱');
    await userEvent.click(screen.getByRole('button',{name:'保存对象名称'}));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{label:'线索箱'}));
  });

  it('lists revisions and restores a selected snapshot',async()=>{
    const current={...stage,version:2};const restored={...stage,version:3};
    const revision={id:'revision-1',stage_id:'stage-1',shot_camera_id:null,stage_snapshot:{version:1,objects:[]},camera_snapshot:{},reason:'manual_save',created_at:'2026-07-16T08:00:00Z'};
    mocks.getDirectorStage.mockResolvedValue(current);mocks.listDirectorRevisions.mockResolvedValue([revision]);mocks.restoreDirectorRevision.mockResolvedValue(restored);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'修订历史'}));
    expect(await screen.findByRole('dialog',{name:'导演台修订历史'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'恢复版本 1'}));
    await waitFor(()=>expect(mocks.restoreDirectorRevision).toHaveBeenCalledWith('stage-1','revision-1',2));
    expect(screen.getByText('导演台版本已恢复')).toBeVisible();
  });

  it('shows a recoverable version conflict and reloads the latest stage',async()=>{
    const latest={...stage,version:4};
    mocks.getDirectorStage.mockResolvedValueOnce(stage).mockResolvedValueOnce(latest);
    mocks.updateDirectorCamera.mockRejectedValueOnce(new mocks.ApiError('conflict',409,JSON.stringify({latest_version:4})));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'保存相机'}));
    const conflict=await screen.findByRole('alertdialog',{name:'导演台版本冲突'});
    expect(conflict).toHaveTextContent('版本 4');
    await userEvent.click(screen.getByRole('button',{name:'重新加载最新舞台'}));
    await waitFor(()=>expect(mocks.getDirectorStage).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alertdialog',{name:'导演台版本冲突'})).not.toBeInTheDocument();
  });
});
