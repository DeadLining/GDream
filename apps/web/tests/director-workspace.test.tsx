import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DirectorWorkspace} from '../components/director/DirectorWorkspace';
import type {DirectorStage,Scene} from '../lib/types';

const mocks=vi.hoisted(()=>({ApiError:class ApiError extends Error{constructor(message:string,public status=500,public detail=''){super(message);}},getDirectorStage:vi.fn(),createDirectorStage:vi.fn(),getDirectorAssets:vi.fn(),syncDirectorAssets:vi.fn(),createDirectorObject:vi.fn(),deleteDirectorObject:vi.fn(),updateDirectorStage:vi.fn(),updateDirectorCamera:vi.fn(),updateDirectorObject:vi.fn(),listDirectorRevisions:vi.fn(),restoreDirectorRevision:vi.fn(),createDirectorSuggestion:vi.fn(),applyDirectorSuggestionToShot:vi.fn()}));
vi.mock('../lib/api',()=>mocks);
const overrideTransform={position:[2,0,0],rotation:[0,.5,0],scale:[1,1,1]} as const;
const movedCamera={position:[2,2.4,6] as [number,number,number],target:[0,.9,0] as [number,number,number],rotation:[-.1,.25,0] as [number,number,number]};
vi.mock('../components/director/DirectorCanvas',()=>({DirectorCanvas:({editable,mode,transformMode,snapEnabled,objects,onSelectObject,onTransform,onCameraChange}:{editable:boolean;mode:string;transformMode:string;snapEnabled:boolean;objects:Array<{id:string;visible:boolean;appearance:Record<string,unknown>}>;onSelectObject:(id:string|null)=>void;onTransform:(id:string,transform:typeof overrideTransform)=>void;onCameraChange?:(camera:typeof movedCamera)=>void})=><div data-testid="director-canvas" data-editable={String(editable)} data-mode={mode} data-transform-mode={transformMode} data-snap-enabled={String(snapEnabled)} data-visible={String(objects[0]?.visible)} data-model-url={String(objects[0]?.appearance.model_url??'')}><button onClick={()=>objects[0]&&onSelectObject(objects[0].id)}>选择画布对象</button><button onClick={()=>onSelectObject(null)}>清空画布选择</button><button onClick={()=>objects[0]&&onTransform(objects[0].id,overrideTransform)}>移动对象</button><button onClick={()=>onCameraChange?.(movedCamera)}>移动相机</button></div> }));

const scene:Scene={id:'scene-1',position:1,location:'天台',time_of_day:'night',summary:'对峙',continuity_state:{},estimated_duration_seconds:10,shots:[{id:'shot-1',position:1,shot_type:'medium',duration_seconds:5,composition:'对峙',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',active_panel_asset_id:null,review_status:'draft',render_status:'pending',dialogue:[]}]};
const directorObject={id:'object-1',stage_id:'stage-1',kind:'primitive' as const,source_type:'placeholder' as const,source_id:null,label:'方块',position:1,transform:{position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]},appearance:{},metadata:{},visible:true};
const stage:DirectorStage={id:'stage-1',scene_id:'scene-1',version:1,environment:{},objects:[directorObject],shot_cameras:[{id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null}]};

describe('DirectorWorkspace',()=>{
  afterEach(()=>{cleanup();vi.clearAllMocks();});
  it('reconnects after a transient local API failure',async()=>{
    mocks.getDirectorStage
      .mockRejectedValueOnce(new Error('本地 API 暂时不可用，请稍后重试'))
      .mockResolvedValueOnce(stage);
    mocks.getDirectorAssets.mockResolvedValue([]);

    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    expect(await screen.findByText('本地 API 暂时不可用，请稍后重试')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'重新连接导演台'}));

    expect(await screen.findByRole('heading',{name:'3D 导演台'})).toBeVisible();
    expect(mocks.getDirectorStage).toHaveBeenCalledTimes(2);
  });
  it('loads the scene stage and persists a new placeholder object',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.createDirectorObject.mockResolvedValue({...stage.objects[0],id:'object-1',stage_id:'stage-1',kind:'primitive',source_type:'placeholder',source_id:null,label:'新道具',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{},metadata:{},visible:true});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'3D 导演台'})).toBeVisible();
    await userEvent.click(screen.getAllByRole('button',{name:'添加占位物'})[0]);
    await waitFor(()=>expect(mocks.createDirectorObject).toHaveBeenCalledWith('stage-1',1,expect.objectContaining({label:'新道具'})));
  });
  it('adds one selected catalog asset without removing existing stage assets',async()=>{
    const existingCharacter={...directorObject,kind:'character' as const,source_type:'character_reference' as const,label:'林夏',metadata:{catalog_key:'character:c1'}};
    const addedProp={...directorObject,id:'object-2',kind:'prop' as const,source_type:'library_asset' as const,source_id:'dog-1',label:'机械犬',position:2,metadata:{catalog_key:'library_asset:dog-1',proxy_rig:'quadruped'}};
    const catalog=[
      {key:'character:c1',kind:'character' as const,source_type:'character_reference' as const,source_id:'c1',asset_id:null,label:'林夏',media_url:null,media_type:null,metadata:{proxy_rig:'standard_humanoid'}},
      {key:'library_asset:dog-1',kind:'prop' as const,source_type:'library_asset' as const,source_id:'dog-1',asset_id:null,label:'机械犬',media_url:null,media_type:null,metadata:{proxy_rig:'quadruped'}},
    ];
    const initialStage={...stage,objects:[existingCharacter]};
    const syncedStage={...stage,version:2,objects:[existingCharacter,addedProp]};
    mocks.getDirectorStage.mockResolvedValue(initialStage);mocks.getDirectorAssets.mockResolvedValue(catalog);mocks.syncDirectorAssets.mockResolvedValue(syncedStage);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'添加机械犬到场景'}));

    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledWith('stage-1',1,['character:c1','library_asset:dog-1']));
    expect(await screen.findByRole('button',{name:'机械犬'})).toBeVisible();
  });
  it('returns to the production canvas when embedded as a production subview',async()=>{
    const onBackToProduction=vi.fn();
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onBackToProduction={onBackToProduction}/>);

    await userEvent.click(await screen.findByRole('button',{name:'返回生产画布'}));

    expect(onBackToProduction).toHaveBeenCalledTimes(1);
  });
  it('keeps transform drag disabled on mobile',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile onSelectShot={vi.fn()}/>);
    expect(await screen.findByTestId('director-canvas')).toHaveAttribute('data-editable','false');
    expect(within(document.querySelector('.director-toolbar') as HTMLElement).getByRole('button',{name:'同步场景资产'})).toBeVisible();
  });
  it('stores transforms and visibility on the selected shot in camera mode',async()=>{
    const overriddenCamera={...stage.shot_cameras[0],version:2,object_overrides:{'object-1':{transform:overrideTransform,visible:false}}};
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.updateDirectorCamera.mockResolvedValue(overriddenCamera);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'移动对象'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{transform:overrideTransform}}}));
    await userEvent.click(screen.getByLabelText('本镜头显示'));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{transform:overrideTransform,visible:false}}}));
    expect(mocks.updateDirectorObject).not.toHaveBeenCalled();
  });
  it('switches the selected object to rotate controls',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'旋转对象'}));
    expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-transform-mode','rotate');
  });
  it('selects and clears objects directly from the canvas',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'选择画布对象'}));
    expect(screen.getByRole('toolbar',{name:'对象变换工具'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'清空画布选择'}));
    expect(screen.queryByRole('toolbar',{name:'对象变换工具'})).not.toBeInTheDocument();
  });
  it('enables transform snapping from the object toolbar',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'选择画布对象'}));
    const snap=screen.getByRole('button',{name:'网格吸附'});
    expect(snap).toHaveAttribute('aria-pressed','false');
    await userEvent.click(snap);
    expect(snap).toHaveAttribute('aria-pressed','true');
    expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-snap-enabled','true');
  });
  it('grounds the selected object as a shot override in camera mode',async()=>{
    const elevatedObject={...directorObject,transform:{...directorObject.transform,position:[1,2,3] as [number,number,number]}};
    const elevatedStage={...stage,objects:[elevatedObject]};
    const groundedTransform={...elevatedObject.transform,position:[1,0,3] as [number,number,number]};
    const savedCamera={...stage.shot_cameras[0],version:2,object_overrides:{'object-1':{transform:groundedTransform}}};
    mocks.getDirectorStage.mockResolvedValue(elevatedStage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.updateDirectorCamera.mockResolvedValue(savedCamera);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'对象落地'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{transform:groundedTransform}}}));
    expect(mocks.updateDirectorObject).not.toHaveBeenCalled();
  });
  it('centers the selected object in the main scene layout',async()=>{
    const offsetObject={...directorObject,transform:{position:[4,1,-3] as [number,number,number],rotation:[0,.5,0] as [number,number,number],scale:[1.2,1.2,1.2] as [number,number,number]}};
    const offsetStage={...stage,objects:[offsetObject]};
    const centeredTransform={...offsetObject.transform,position:[0,1,0] as [number,number,number]};
    mocks.getDirectorStage.mockResolvedValue(offsetStage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.updateDirectorObject.mockResolvedValue({...offsetObject,transform:centeredTransform});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'场景居中'}));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{transform:centeredTransform}));
    expect(mocks.updateDirectorCamera).not.toHaveBeenCalled();
  });
  it('persists undo and redo for main scene transforms',async()=>{
    const offsetObject={...directorObject,transform:{...directorObject.transform,position:[4,1,-3] as [number,number,number]}};
    const offsetStage={...stage,objects:[offsetObject]};
    const centeredTransform={...offsetObject.transform,position:[0,1,0] as [number,number,number]};
    mocks.getDirectorStage.mockResolvedValue(offsetStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:{transform:typeof centeredTransform})=>({...offsetObject,transform:patch.transform}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    expect(screen.getByRole('button',{name:'撤销对象变换'})).toBeDisabled();
    await userEvent.click(screen.getByRole('button',{name:'场景居中'}));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{transform:centeredTransform}));
    await userEvent.click(screen.getByRole('button',{name:'撤销对象变换'}));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenLastCalledWith('object-1',2,{transform:offsetObject.transform}));
    await userEvent.click(screen.getByRole('button',{name:'重做对象变换'}));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenLastCalledWith('object-1',3,{transform:centeredTransform}));
  });
  it('commits precise transform inputs on blur and converts rotation degrees',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:{transform:typeof directorObject.transform})=>({...directorObject,transform:patch.transform}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    const positionX=screen.getByRole('spinbutton',{name:'位置 X'});
    await userEvent.clear(positionX);await userEvent.type(positionX,'2.5');
    expect(mocks.updateDirectorObject).not.toHaveBeenCalled();
    await userEvent.tab();
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{transform:{...directorObject.transform,position:[2.5,0,0]}}));
    const rotationY=screen.getByRole('spinbutton',{name:'旋转 Y'});
    await userEvent.clear(rotationY);await userEvent.type(rotationY,'90');await userEvent.tab();
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenLastCalledWith('object-1',2,{transform:{position:[2.5,0,0],rotation:[0,Math.PI/2,0],scale:[1,1,1]}}));
    expect(screen.getByRole('button',{name:'撤销对象变换'})).toBeEnabled();
  });
  it('preserves untouched transform axes when committing a precise input',async()=>{
    const preciseObject={...directorObject,transform:{...directorObject.transform,rotation:[0,.123456,0] as [number,number,number]}};
    const preciseStage={...stage,objects:[preciseObject]};
    mocks.getDirectorStage.mockResolvedValue(preciseStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:{transform:typeof preciseObject.transform})=>({...preciseObject,transform:patch.transform}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    const positionX=screen.getByRole('spinbutton',{name:'位置 X'});
    await userEvent.clear(positionX);await userEvent.type(positionX,'2');await userEvent.tab();
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{transform:{...preciseObject.transform,position:[2,0,0]}}));
  });
  it('undoes a shot transform without removing the existing pose override',async()=>{
    const elevatedObject={...directorObject,kind:'character' as const,source_type:'model' as const,label:'林夏',transform:{...directorObject.transform,position:[1,2,3] as [number,number,number]},metadata:{has_skeleton:true}};
    const posedCamera={...stage.shot_cameras[0],object_overrides:{'object-1':{pose_preset:'action' as const}}};
    const cameraStage={...stage,objects:[elevatedObject],shot_cameras:[posedCamera]};
    mocks.getDirectorStage.mockResolvedValue(cameraStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...posedCamera,...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));
    await userEvent.click(screen.getByRole('button',{name:'对象落地'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{pose_preset:'action',transform:{...elevatedObject.transform,position:[1,0,3]}}}}));
    await userEvent.click(screen.getByRole('button',{name:'撤销对象变换'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{pose_preset:'action'}}}));
  });
  it('persists the navigated camera pose together with focal length',async()=>{
    const savedCamera={...stage.shot_cameras[0],...movedCamera,version:2,focal_length_mm:65};
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.updateDirectorCamera.mockResolvedValue(savedCamera);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'移动相机'}));
    await userEvent.clear(screen.getByLabelText('焦距'));
    await userEvent.type(screen.getByLabelText('焦距'),'65');
    await userEvent.click(screen.getByRole('button',{name:'保存相机'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{...movedCamera,focal_length_mm:65}));
  });
  it('stores a character pose preset on the selected shot',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'model' as const,label:'林夏',appearance:{model_url:'/media/linxia.glb'},metadata:{has_skeleton:true}};
    const characterStage={...stage,objects:[characterObject]};
    const posedCamera={...stage.shot_cameras[0],version:2,object_overrides:{'object-1':{pose_preset:'action'}}};
    mocks.getDirectorStage.mockResolvedValue(characterStage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.updateDirectorCamera.mockResolvedValue(posedCamera);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));
    await userEvent.selectOptions(screen.getByLabelText('角色姿态'),'action');
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{pose_preset:'action'}}}));
  });
  it('persists standard humanoid body proportions on the scene object',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'character_reference' as const,label:'林夏',appearance:{proxy_height:1,proxy_shoulder_width:1,proxy_body_width:1},metadata:{}};
    const characterStage={...stage,objects:[characterObject]};
    mocks.getDirectorStage.mockResolvedValue(characterStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:{appearance:Record<string,unknown>})=>({...characterObject,appearance:patch.appearance}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'林夏'}));
    expect(screen.getByLabelText('角色身高')).toBeVisible();
    expect(screen.getByLabelText('肩宽')).toBeVisible();
    expect(screen.getByLabelText('体型')).toBeVisible();
    await userEvent.clear(screen.getByLabelText('角色身高'));
    await userEvent.type(screen.getByLabelText('角色身高'),'1.1');
    await userEvent.tab();
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{appearance:{proxy_height:1.1,proxy_shoulder_width:1,proxy_body_width:1}}));
  });
  it('persists an explicit 3D proxy template without losing asset metadata',async()=>{
    const propObject={...directorObject,kind:'prop' as const,source_type:'library_asset' as const,label:'机械犬',metadata:{catalog_key:'library_asset:dog-1',requires_3d_model:true}};
    const propStage={...stage,objects:[propObject]};
    mocks.getDirectorStage.mockResolvedValue(propStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:{metadata:Record<string,unknown>})=>({...propObject,metadata:patch.metadata}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByText('机械犬'));
    expect(screen.getByLabelText('3D 代理模板')).toHaveValue('prop_box');
    await userEvent.selectOptions(screen.getByLabelText('3D 代理模板'),'quadruped');
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{metadata:{catalog_key:'library_asset:dog-1',requires_3d_model:false,proxy_rig:'quadruped',full_model_optional:true}}));
  });
  it('stores proxy pose and animation controls on only the selected shot',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'character_reference' as const,label:'林夏',appearance:{proxy_height:1},metadata:{proxy_rig:'standard_humanoid'}};
    const characterStage={...stage,objects:[characterObject]};
    mocks.getDirectorStage.mockResolvedValue(characterStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...stage.shot_cameras[0],...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));
    expect(screen.getByLabelText('角色姿态')).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText('角色姿态'),'dialogue');
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{pose_preset:'dialogue'}}}));
    await userEvent.selectOptions(screen.getByLabelText('动画片段'),'walk');
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{pose_preset:'dialogue',animation_clip:'walk',animation_playing:false,animation_time_seconds:0}}}));
    expect(screen.getByLabelText('代理动画时间')).toHaveAttribute('max','2');
    fireEvent.change(screen.getByLabelText('代理动画时间'),{target:{value:'1'}});
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',3,{object_overrides:{'object-1':{pose_preset:'dialogue',animation_clip:'walk',animation_playing:false,animation_time_seconds:1}}}));
    await userEvent.click(screen.getByRole('button',{name:'播放动画'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',4,{object_overrides:{'object-1':{pose_preset:'dialogue',animation_clip:'walk',animation_playing:true,animation_time_seconds:1}}}));
    await userEvent.click(screen.getByRole('button',{name:'重置代理动画'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',5,{object_overrides:{'object-1':{pose_preset:'dialogue',animation_clip:'walk',animation_playing:false,animation_time_seconds:0}}}));
    expect(mocks.updateDirectorObject).not.toHaveBeenCalled();
  });
  it('locks procedural animation controls while a shot override is saving',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'character_reference' as const,label:'林夏',appearance:{proxy_height:1},metadata:{proxy_rig:'standard_humanoid'}};
    const characterStage={...stage,objects:[characterObject]};
    let resolveSave:(camera:DirectorStage['shot_cameras'][number])=>void=()=>{};
    mocks.getDirectorStage.mockResolvedValue(characterStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockReturnValue(new Promise(resolve=>{resolveSave=resolve;}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));

    await userEvent.selectOptions(screen.getByLabelText('动画片段'),'walk');

    expect(screen.getByLabelText('动画片段')).toBeDisabled();
    expect(screen.getByLabelText('代理动画时间')).toBeDisabled();
    expect(screen.getByRole('button',{name:'播放动画'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'重置代理动画'})).toBeDisabled();
    resolveSave({...stage.shot_cameras[0],version:2,object_overrides:{'object-1':{animation_clip:'walk',animation_playing:false,animation_time_seconds:0}}});
    await waitFor(()=>expect(screen.getByLabelText('动画片段')).toBeEnabled());
  });
  it('stores a humanoid proxy facial expression on only the selected shot',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'character_reference' as const,label:'林夏',appearance:{},metadata:{proxy_rig:'standard_humanoid'}};
    mocks.getDirectorStage.mockResolvedValue({...stage,objects:[characterObject]});mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...stage.shot_cameras[0],...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));

    await userEvent.selectOptions(screen.getByLabelText('表情预设'),'happy');

    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{facial_expression:'happy'}}}));
  });
  it('stores and resets imported GLB morph target weights on the selected shot',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'model' as const,label:'林夏',appearance:{model_url:'/media/linxia.glb'},metadata:{has_skeleton:true,morph_targets:['Smile','Blink']}};
    mocks.getDirectorStage.mockResolvedValue({...stage,objects:[characterObject]});mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...stage.shot_cameras[0],...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));

    fireEvent.change(screen.getByLabelText('表情 Smile'),{target:{value:'.7'}});
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{morph_target_weights:{Smile:.7}}}}));
    await userEvent.click(screen.getByRole('button',{name:'重置模型表情'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{morph_target_weights:{}}}}));
  });
  it('controls an imported GLB animation clip and timeline on the selected shot',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'model' as const,label:'林夏',appearance:{model_url:'/media/linxia.glb'},metadata:{has_skeleton:true,animation_clips:[{name:'Walk',duration_seconds:2.5},{name:'Turn',duration_seconds:1.2}]}};
    const characterStage={...stage,objects:[characterObject]};
    mocks.getDirectorStage.mockResolvedValue(characterStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...stage.shot_cameras[0],...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));

    expect(screen.getByLabelText('导入动画片段')).toHaveValue('Walk');
    expect(screen.getByLabelText('动画时间')).toHaveAttribute('max','2.5');
    await userEvent.selectOptions(screen.getByLabelText('导入动画片段'),'Turn');
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{animation_clip:'Turn',animation_playing:false,animation_time_seconds:0}}}));
    fireEvent.change(screen.getByLabelText('动画时间'),{target:{value:'0.6'}});
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',2,{object_overrides:{'object-1':{animation_clip:'Turn',animation_playing:false,animation_time_seconds:.6}}}));
    await userEvent.click(screen.getByRole('button',{name:'播放导入动画'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',3,{object_overrides:{'object-1':{animation_clip:'Turn',animation_playing:true,animation_time_seconds:.6}}}));
    await userEvent.click(screen.getByRole('button',{name:'重置导入动画'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenLastCalledWith('stage-1','shot-1',4,{object_overrides:{'object-1':{animation_clip:'Turn',animation_playing:false,animation_time_seconds:0}}}));
  });
  it('starts the first imported clip when play is pressed before choosing one',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'model' as const,label:'林夏',appearance:{model_url:'/media/linxia.glb'},metadata:{has_skeleton:true,animation_clips:[{name:'Walk',duration_seconds:2.5}]}};
    mocks.getDirectorStage.mockResolvedValue({...stage,objects:[characterObject]});mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,_shotId:string,version:number,patch:{object_overrides:Record<string,unknown>})=>({...stage.shot_cameras[0],...patch,version:version+1}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'林夏'}));
    await userEvent.click(screen.getByRole('button',{name:'播放导入动画'}));

    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{animation_clip:'Walk',animation_playing:true,animation_time_seconds:0}}}));
  });
  it('resets shot overrides and confirms object deletion',async()=>{
    const overridden={...stage,shot_cameras:[{...stage.shot_cameras[0],object_overrides:{'object-1':{visible:false}}}]};
    mocks.getDirectorStage.mockResolvedValue(overridden);mocks.getDirectorAssets.mockResolvedValue([]);mocks.updateDirectorCamera.mockResolvedValue({...overridden.shot_cameras[0],version:2,object_overrides:{}});mocks.deleteDirectorObject.mockResolvedValue(undefined);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    await userEvent.click(screen.getByRole('button',{name:'镜头'}));
    await userEvent.click(screen.getByRole('button',{name:'重置本镜头覆盖'}));
    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{}}));
    await userEvent.click(screen.getByRole('button',{name:'删除场景对象'}));
    expect(window.confirm).toHaveBeenCalledWith('删除场景对象“方块”？');
    await waitFor(()=>expect(mocks.deleteDirectorObject).toHaveBeenCalledWith('object-1',1));
  });
  it('reviews an AI suggestion and applies only selected shot fields',async()=>{
    const updated={...scene.shots[0],composition:'低机位对峙',camera_motion:'push_in'};const onShotUpdated=vi.fn();
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.createDirectorSuggestion.mockResolvedValue({id:'suggestion-1',stage_id:'stage-1',shot_id:'shot-1',kind:'shot_composition',status:'ready',request_context:{},suggested_patch:{composition:'低机位对峙',camera_motion:'push_in',image_prompt:'cinematic rain'},error_category:'',error:'',created_at:'',applied_at:null});mocks.applyDirectorSuggestionToShot.mockResolvedValue(updated);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onShotUpdated={onShotUpdated}/>);
    await userEvent.click(await screen.findByRole('button',{name:'AI构图建议'}));
    expect(await screen.findByRole('dialog',{name:'AI 导演建议'})).toBeVisible();
    expect(screen.getByLabelText('构图')).toBeChecked();expect(screen.getByLabelText('运镜')).toBeChecked();expect(screen.getByLabelText('图像提示词')).not.toBeChecked();
    await userEvent.click(screen.getByLabelText('运镜'));
    await userEvent.click(screen.getByRole('button',{name:'应用选中字段'}));
    await waitFor(()=>expect(mocks.applyDirectorSuggestionToShot).toHaveBeenCalledWith('stage-1','shot-1','suggestion-1',['composition']));
    expect(onShotUpdated).toHaveBeenCalledWith(updated);
  });
  it('lists available production assets and synchronizes them into the stage',async()=>{
    const assets=[
      {key:'scene:scene-1',kind:'background',source_type:'scene_context',source_id:'scene-1',asset_id:null,label:'天台 · night',media_url:null,metadata:{summary:'对峙'}},
      {key:'character:char-1:ref-1',kind:'character',source_type:'model',source_id:'representation-1',asset_id:'asset-1',label:'林夏',media_url:'/media/linxia.glb',media_type:'model/gltf-binary',metadata:{role:'侦探'}},
    ] as const;
    const synced={...stage,version:2,environment:{location:'天台'},objects:[{id:'object-1',stage_id:'stage-1',kind:'character',source_type:'character_reference',source_id:'char-1',label:'林夏',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{image_url:'/media/linxia.png'},metadata:{catalog_key:'character:char-1:ref-1'},visible:true}]};
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue(assets);mocks.syncDirectorAssets.mockResolvedValue(synced);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    expect(await screen.findByText('林夏')).toBeVisible();
    expect(screen.getByText('天台 · night')).toBeVisible();
    expect(screen.getByText('3D 模型')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'同步场景资产'}));
    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledWith('stage-1',1,assets.map(item=>item.key)));
    expect(await screen.findByText('已同步 1 / 2')).toBeVisible();
  });
  it('adds one selected production asset without removing existing scene objects',async()=>{
    const asset={key:'character:char-1:ref-1',kind:'character',source_type:'model',source_id:'representation-1',asset_id:'asset-1',label:'林夏',media_url:'/media/linxia.glb',media_type:'model/gltf-binary',metadata:{role:'侦探'}} as const;
    const existing={...directorObject,metadata:{catalog_key:'scene:scene-1'}};
    const syncedObject={...directorObject,id:'object-2',kind:'character' as const,source_type:'model' as const,source_id:'representation-1',label:'林夏',metadata:{catalog_key:asset.key}};
    const currentStage={...stage,objects:[existing]};
    const synced={...stage,version:2,objects:[existing,syncedObject]};
    mocks.getDirectorStage.mockResolvedValue(currentStage);mocks.getDirectorAssets.mockResolvedValue([asset]);mocks.syncDirectorAssets.mockResolvedValue(synced);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'添加林夏到场景'}));

    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledWith('stage-1',1,['scene:scene-1',asset.key]));
    expect(await screen.findByDisplayValue('林夏')).toBeVisible();
  });
  it('renames an object and controls its scene-level visibility',async()=>{
    const shotHiddenStage={...stage,shot_cameras:[{...stage.shot_cameras[0],object_overrides:{'object-1':{visible:false}}}]};
    mocks.getDirectorStage.mockResolvedValue(shotHiddenStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:Record<string,unknown>)=>({...directorObject,...patch}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'方块'}));
    expect(screen.getByLabelText('场景显示')).toBeChecked();
    const name=screen.getByRole('textbox',{name:'对象名称'});
    await userEvent.clear(name);await userEvent.type(name,'线索箱');
    await userEvent.click(screen.getByRole('button',{name:'保存对象名称'}));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenCalledWith('object-1',1,{label:'线索箱'}));

    await userEvent.click(screen.getByLabelText('场景显示'));
    await waitFor(()=>expect(mocks.updateDirectorObject).toHaveBeenLastCalledWith('object-1',2,{visible:false}));
  });
  it('duplicates a scene object as an independent instance',async()=>{
    const catalogObject={...directorObject,source_type:'library_asset' as const,source_id:'asset-1',label:'机械犬',appearance:{color:'#777'},metadata:{catalog_key:'library_asset:asset-1',proxy_rig:'quadruped'}};
    const currentStage={...stage,objects:[catalogObject]};
    const duplicate={...catalogObject,id:'object-2',label:'机械犬 副本',position:2,transform:{...catalogObject.transform,position:[.5,0,0] as [number,number,number]},metadata:{proxy_rig:'quadruped'}};
    mocks.getDirectorStage.mockResolvedValue(currentStage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.createDirectorObject.mockResolvedValue(duplicate);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'机械犬'}));

    await userEvent.click(screen.getByRole('button',{name:'复制场景对象'}));

    await waitFor(()=>expect(mocks.createDirectorObject).toHaveBeenCalledWith('stage-1',1,{kind:'primitive',source_type:'library_asset',source_id:'asset-1',label:'机械犬 副本',transform:{...catalogObject.transform,position:[.5,0,0]},appearance:{color:'#777'},metadata:{proxy_rig:'quadruped'},visible:true}));
    expect(screen.getByRole('button',{name:'机械犬 副本'})).toBeVisible();
  });
  it('persists environment, ground, and lighting controls on the stage',async()=>{
    const environment={background_color:'#263238',ground:'grid',ground_color:'#40545c',ambient_light:.85,key_light_color:'#ffffff',key_light_intensity:1.4};
    const currentStage={...stage,environment};
    mocks.getDirectorStage.mockResolvedValue(currentStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorStage.mockImplementation(async(_id:string,_version:number,next:Record<string,unknown>)=>({...currentStage,version:2,environment:next}));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    fireEvent.change(await screen.findByLabelText('背景颜色'),{target:{value:'#112233'}});
    await userEvent.selectOptions(screen.getByLabelText('地面样式'),'solid');
    fireEvent.change(screen.getByLabelText('环境光强度'),{target:{value:'0.4'}});
    fireEvent.change(screen.getByLabelText('主光强度'),{target:{value:'1.1'}});
    await userEvent.click(screen.getByRole('button',{name:'保存环境设置'}));

    await waitFor(()=>expect(mocks.updateDirectorStage).toHaveBeenCalledWith('stage-1',1,{...environment,background_color:'#112233',ground:'solid',ambient_light:.4,key_light_intensity:1.1}));
  });
  it('lists director revisions and restores a selected stage snapshot',async()=>{
    const currentStage={...stage,version:2,environment:{background_color:'#263238'}};
    const restoredStage={...stage,version:3,environment:{background_color:'#112233'}};
    const revision={id:'revision-1',stage_id:'stage-1',shot_camera_id:null,stage_snapshot:{version:1,environment:restoredStage.environment,objects:[]},camera_snapshot:{},reason:'manual_save',created_at:'2026-07-16T08:00:00Z'};
    mocks.getDirectorStage.mockResolvedValue(currentStage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.listDirectorRevisions.mockResolvedValue([revision]);mocks.restoreDirectorRevision.mockResolvedValue(restoredStage);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'修订历史'}));
    expect(await screen.findByRole('dialog',{name:'导演台修订历史'})).toBeVisible();
    expect(screen.getByText('版本 1')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'恢复版本 1'}));

    await waitFor(()=>expect(mocks.restoreDirectorRevision).toHaveBeenCalledWith('stage-1','revision-1',2));
    expect(await screen.findByLabelText('背景颜色')).toHaveValue('#112233');
  });
  it('shows a recoverable conflict prompt and reloads the latest stage',async()=>{
    const latestStage={...stage,version:4,environment:{background_color:'#445566'}};
    mocks.getDirectorStage.mockResolvedValueOnce(stage).mockResolvedValue(latestStage);mocks.getDirectorAssets.mockResolvedValue([]);
    mocks.updateDirectorStage.mockRejectedValue(new mocks.ApiError('conflict',409,'{"code":"director_version_conflict","latest_version":4}'));
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'保存环境设置'}));
    const conflict=await screen.findByRole('alertdialog',{name:'导演台版本冲突'});
    expect(within(conflict).getByText(/版本 4/)).toBeVisible();
    await userEvent.click(within(conflict).getByRole('button',{name:'重新加载最新舞台'}));

    await waitFor(()=>expect(mocks.getDirectorStage).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('背景颜色')).toHaveValue('#445566');
    expect(screen.queryByRole('alertdialog',{name:'导演台版本冲突'})).not.toBeInTheDocument();
  });
  it('renders the effective variant model when the selected shot changes',async()=>{
    const characterObject={...directorObject,kind:'character' as const,source_type:'model' as const,source_id:'master-representation',label:'林夏',appearance:{model_url:'/media/master.glb'},metadata:{character_id:'char-1',representation_id:'master-representation'},transform:{...directorObject.transform,position:[3,0,1] as [number,number,number]}};
    const secondShot={...scene.shots[0],id:'shot-2',position:2,composition:'受伤特写'};
    const scopedScene={...scene,shots:[scene.shots[0],secondShot]};
    const scopedStage={...stage,objects:[characterObject],shot_cameras:[stage.shot_cameras[0],{...stage.shot_cameras[0],id:'camera-2',shot_id:'shot-2'}]};
    const episodeAsset={key:'character:char-1:representation:episode',kind:'character',source_type:'model',source_id:'episode-representation',asset_id:'episode-asset',label:'林夏',media_url:'/media/episode.glb',media_type:'model/gltf-binary',metadata:{character_id:'char-1',variant_id:'variant-1',state_id:null,representation_id:'episode-representation'}} as const;
    const stateAsset={...episodeAsset,key:'character:char-1:representation:injured',source_id:'injured-representation',asset_id:'injured-asset',media_url:'/media/injured.glb',metadata:{...episodeAsset.metadata,state_id:'state-1',representation_id:'injured-representation'}} as const;
    mocks.getDirectorStage.mockResolvedValue(scopedStage);
    mocks.getDirectorAssets.mockImplementation(async(_stageId:string,shotId?:string)=>shotId==='shot-2'?[stateAsset]:[episodeAsset]);
    const view=render(<DirectorWorkspace scene={scopedScene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    expect(await screen.findByTestId('director-canvas')).toHaveAttribute('data-model-url','/media/episode.glb');
    view.rerender(<DirectorWorkspace scene={scopedScene} selectedShotId="shot-2" mobile={false} onSelectShot={vi.fn()}/>);

    await waitFor(()=>expect(mocks.getDirectorAssets).toHaveBeenLastCalledWith('stage-1','shot-2'));
    expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-model-url','/media/injured.glb');
  });
});
