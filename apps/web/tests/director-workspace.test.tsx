import React from 'react';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DirectorWorkspace} from '../components/director/DirectorWorkspace';
import type {DirectorStage,Scene} from '../lib/types';

const mocks=vi.hoisted(()=>({ApiError:class ApiError extends Error{constructor(message:string,public status=500,public detail=''){super(message);}},getDirectorStage:vi.fn(),createDirectorStage:vi.fn(),getDirectorAssets:vi.fn(),getShotGenerationReadiness:vi.fn(),inheritDirectorBlocking:vi.fn(),syncDirectorAssets:vi.fn(),createDirectorObject:vi.fn(),deleteDirectorObject:vi.fn(),updateDirectorCamera:vi.fn(),updateDirectorObject:vi.fn(),listDirectorRevisions:vi.fn(),restoreDirectorRevision:vi.fn(),createDirectorSuggestion:vi.fn(),applyDirectorSuggestionToShot:vi.fn(),uploadDirectorPreview:vi.fn()}));
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
    mocks.getShotGenerationReadiness.mockResolvedValue({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:false,asset_ready:true,blocking_ready:true,camera_ready:false,blockers:['director_preview_missing'],requirement_ids:[]});
    mocks.createDirectorObject.mockResolvedValue({...directorObject,id:'object-new',label:'新道具'});
    mocks.updateDirectorCamera.mockImplementation(async(_stageId:string,shotId:string,version:number,patch:Record<string,unknown>)=>({...camera,shot_id:shotId,...patch,version:version+1}));
    mocks.updateDirectorObject.mockImplementation(async(_id:string,_version:number,patch:Record<string,unknown>)=>({...directorObject,...patch}));
    mocks.deleteDirectorObject.mockResolvedValue(undefined);
    mocks.uploadDirectorPreview.mockResolvedValue({id:'preview-1'});
    mocks.inheritDirectorBlocking.mockResolvedValue({...camera,version:2,initialized_from_shot_id:'shot-0'});
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

  it('inherits the previous shot blocking into the selected later shot',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2',version:3};
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    mocks.inheritDirectorBlocking.mockResolvedValue({...camera2,version:4,initialized_from_shot_id:'shot-1',object_overrides:{'object-1':{transform:movedTransform}}});
    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId="shot-2" mobile={false} onSelectShot={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'继承上一镜头站位'}));

    await waitFor(()=>expect(mocks.inheritDirectorBlocking).toHaveBeenCalledWith('stage-1','shot-2',3));
    expect(screen.getByText('已继承镜头 01 的站位')).toBeVisible();
  });

  it('edits only a character horizontal facing angle',async()=>{
    const character={...directorObject,kind:'character' as const,label:'林夏'};
    mocks.getDirectorStage.mockResolvedValue({...stage,objects:[character]});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'林夏'}));

    const facing=screen.getByLabelText('水平朝向');
    await userEvent.clear(facing);await userEvent.type(facing,'90');await userEvent.tab();

    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,{object_overrides:{'object-1':{transform:{...character.transform,rotation:[0,Math.PI/2,0]}}}}));
  });

  it('shows asset, blocking, and preview readiness for the selected shot',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    expect(await screen.findByText('资产已就绪')).toBeVisible();
    expect(screen.getByText('站位已就绪')).toBeVisible();
    expect(screen.getByText('预览未保存')).toBeVisible();
  });

  it('shows asset, blocking, and preview readiness on every shot in the strip',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2'};
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    mocks.getShotGenerationReadiness.mockImplementation(async(shotId:string)=>shotId==='shot-1'
      ? {shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]}
      : {shot_id:'shot-2',project_id:'project-1',script_revision_id:'revision-1',ready:false,asset_ready:true,blocking_ready:true,camera_ready:false,blockers:['director_preview_missing'],requirement_ids:[]});

    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    expect(await screen.findByLabelText('镜头 01 预览已保存')).toBeVisible();
    expect(await screen.findByLabelText('镜头 02 资产已就绪')).toBeVisible();
    expect(screen.getByLabelText('镜头 02 站位已就绪')).toBeVisible();
    expect(screen.getByLabelText('镜头 02 预览未保存')).toBeVisible();
  });

  it('uses scene progress to jump to the next incomplete shot',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2'};
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    mocks.getShotGenerationReadiness.mockImplementation(async(shotId:string)=>shotId==='shot-1'
      ? {shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]}
      : {shot_id:'shot-2',project_id:'project-1',script_revision_id:'revision-1',ready:false,asset_ready:true,blocking_ready:true,camera_ready:false,blockers:['director_preview_missing'],requirement_ids:[]});

    const onSelectShot=vi.fn();
    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId="shot-1" mobile={false} onSelectShot={onSelectShot}/>);

    const progress=await screen.findByRole('button',{name:'前往下一个未完成镜头'});
    expect(progress).toHaveTextContent('1 / 2 镜头完成');
    await userEvent.click(progress);
    expect(onSelectShot).toHaveBeenCalledWith('shot-2');
  });

  it('returns to the production canvas and disables drag editing on mobile',async()=>{
    const onBack=vi.fn();
    const view=render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile onSelectShot={vi.fn()} onBackToProduction={onBack}/>);
    expect(await screen.findByTestId('director-canvas')).toHaveAttribute('data-editable','false');
    await userEvent.click(screen.getByRole('button',{name:'返回生产画布'}));
    expect(onBack).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('autosaves a dirty camera before switching shots',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2'};
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    function Harness(){const [shotId,setShotId]=React.useState('shot-1');return <DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId={shotId} mobile={false} onSelectShot={setShotId}/>;}
    render(<Harness/>);
    await userEvent.click(await screen.findByRole('button',{name:'移动相机'}));
    expect(screen.getByText('相机未保存')).toBeVisible();
    expect(screen.getByLabelText('镜头 01 预览待更新')).toBeVisible();

    await userEvent.click(screen.getByRole('button',{name:'镜头 02：close up'}));

    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,expect.objectContaining(movedCamera)));
    await waitFor(()=>expect(screen.getByTestId('director-canvas')).toHaveAttribute('data-camera-id','camera-2'));
    expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob));
  });

  it('blocks shot switching when dirty-camera autosave fails',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2'};
    const onSelectShot=vi.fn();
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    mocks.updateDirectorCamera.mockRejectedValueOnce(new Error('保存失败'));
    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId="shot-1" mobile={false} onSelectShot={onSelectShot}/>);
    await userEvent.click(await screen.findByRole('button',{name:'移动相机'}));

    await userEvent.click(screen.getByRole('button',{name:'镜头 02：close up'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(onSelectShot).not.toHaveBeenCalled();
    expect(screen.getByText('相机未保存')).toBeVisible();
  });

  it('autosaves a dirty camera before returning to production',async()=>{
    const onBack=vi.fn();
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onBackToProduction={onBack}/>);
    await userEvent.click(await screen.findByRole('button',{name:'移动相机'}));

    await userEvent.click(screen.getByRole('button',{name:'返回生产画布'}));

    await waitFor(()=>expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob)));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('warns before browser unload while the camera is dirty',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'移动相机'}));
    const event=new Event('beforeunload',{cancelable:true});

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
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
    await waitFor(()=>expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob)));
    expect(screen.getByText('当前镜头视角和预览已保存')).toBeVisible();
  });

  it('saves the current camera preview and advances to the next shot',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2',version:1,preview_asset_id:null};
    const onSelectShot=vi.fn();
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2]});
    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId="shot-1" mobile={false} onSelectShot={onSelectShot}/>);

    await userEvent.click(await screen.findByRole('button',{name:'保存并进入下一镜头'}));

    await waitFor(()=>expect(mocks.updateDirectorCamera).toHaveBeenCalledWith('stage-1','shot-1',1,expect.objectContaining({focal_length_mm:50})));
    await waitFor(()=>expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob)));
    expect(onSelectShot).toHaveBeenCalledWith('shot-2');
    expect(screen.getByText('镜头 01 已保存，进入镜头 02')).toBeVisible();
  });

  it('skips completed shots and advances to the next incomplete shot',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const shot3={...scene.shots[0],id:'shot-3',position:3,shot_type:'wide'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2',preview_asset_id:'preview-2'};
    const camera3={...camera,id:'camera-3',shot_id:'shot-3',preview_asset_id:null};
    const onSelectShot=vi.fn();
    let shot1Calls=0;
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[camera,camera2,camera3]});
    mocks.getShotGenerationReadiness.mockImplementation(async(shotId:string)=>{
      if(shotId==='shot-1'){
        shot1Calls+=1;
        return {shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:shot1Calls>1,asset_ready:true,blocking_ready:true,camera_ready:shot1Calls>1,blockers:shot1Calls>1?[]:['director_preview_missing'],requirement_ids:[]};
      }
      const ready=shotId==='shot-2';
      return {shot_id:shotId,project_id:'project-1',script_revision_id:'revision-1',ready,asset_ready:true,blocking_ready:true,camera_ready:ready,blockers:ready?[]:['director_preview_missing'],requirement_ids:[]};
    });
    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2,shot3]}} selectedShotId="shot-1" mobile={false} onSelectShot={onSelectShot}/>);

    await waitFor(()=>expect(screen.getByRole('button',{name:'前往下一个未完成镜头'})).toHaveTextContent('1 / 3 镜头完成'));
    await userEvent.click(screen.getByRole('button',{name:'保存并进入下一未完成镜头'}));

    await waitFor(()=>expect(onSelectShot).toHaveBeenCalledWith('shot-3'));
    expect(screen.getByText('镜头 01 已保存，进入镜头 03')).toBeVisible();
  });

  it('saves the final incomplete shot and returns to generation in one action',async()=>{
    const onReturnToGeneration=vi.fn();
    mocks.getShotGenerationReadiness
      .mockResolvedValueOnce({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:false,asset_ready:true,blocking_ready:true,camera_ready:false,blockers:['director_preview_missing'],requirement_ids:[]})
      .mockResolvedValueOnce({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onReturnToGeneration={onReturnToGeneration}/>);

    await userEvent.click(await screen.findByRole('button',{name:'保存并返回生成'}));

    await waitFor(()=>expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob)));
    expect(onReturnToGeneration).toHaveBeenCalledTimes(1);
  });

  it('saves a camera preview and shows completion feedback',async()=>{
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'保存相机预览'}));
    await waitFor(()=>expect(mocks.uploadDirectorPreview).toHaveBeenCalledWith('camera-1',expect.any(Blob)));
    expect(screen.getByText('当前镜头预览已保存')).toBeVisible();
  });

  it('returns the current shot to generation after its saved preview becomes ready',async()=>{
    const onReturnToGeneration=vi.fn();
    mocks.getShotGenerationReadiness
      .mockResolvedValueOnce({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:false,asset_ready:true,blocking_ready:true,camera_ready:false,blockers:['director_preview_missing'],requirement_ids:[]})
      .mockResolvedValueOnce({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onReturnToGeneration={onReturnToGeneration}/>);

    expect(screen.queryByRole('button',{name:'返回当前镜头生成'})).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button',{name:'保存相机预览'}));
    await userEvent.click(await screen.findByRole('button',{name:'返回当前镜头生成'}));

    expect(onReturnToGeneration).toHaveBeenCalledTimes(1);
  });

  it('offers whole-scene completion only after every shot is ready',async()=>{
    const shot2={...scene.shots[0],id:'shot-2',position:2,shot_type:'close_up'};
    const camera2={...camera,id:'camera-2',shot_id:'shot-2',preview_asset_id:'preview-2'};
    const onReturnToGeneration=vi.fn();
    const onCompleteScene=vi.fn();
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[{...camera,preview_asset_id:'preview-1'},camera2]});
    mocks.getShotGenerationReadiness.mockImplementation(async(shotId:string)=>({shot_id:shotId,project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]}));
    render(<DirectorWorkspace scene={{...scene,shots:[scene.shots[0],shot2]}} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onReturnToGeneration={onReturnToGeneration} onCompleteScene={onCompleteScene}/>);

    expect(await screen.findByRole('button',{name:'返回当前镜头生成'})).toBeVisible();
    await userEvent.click(await screen.findByRole('button',{name:'完成整场导演'}));

    expect(onCompleteScene).toHaveBeenCalledTimes(1);
    expect(onReturnToGeneration).not.toHaveBeenCalled();
  });

  it('hides whole-scene completion while the current camera is dirty',async()=>{
    const onCompleteScene=vi.fn();
    mocks.getDirectorStage.mockResolvedValue({...stage,shot_cameras:[{...camera,preview_asset_id:'preview-1'}]});
    mocks.getShotGenerationReadiness.mockResolvedValue({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()} onCompleteScene={onCompleteScene}/>);
    expect(await screen.findByRole('button',{name:'完成整场导演'})).toBeVisible();

    await userEvent.click(screen.getByRole('button',{name:'移动相机'}));

    expect(screen.queryByRole('button',{name:'完成整场导演'})).not.toBeInTheDocument();
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

  it('automatically synchronizes available production assets and supports manual refresh',async()=>{
    const asset={key:'character:char-1:ref-1',kind:'character' as const,source_type:'model' as const,source_id:'representation-1',asset_id:'asset-1',label:'林夏',media_url:'/media/linxia.glb',media_type:'model/gltf-binary',metadata:{role:'侦探'}};
    const syncedObject={...directorObject,id:'object-2',kind:'character' as const,source_type:'model' as const,source_id:'representation-1',label:'林夏',metadata:{catalog_key:asset.key}};
    mocks.getDirectorAssets.mockResolvedValue([asset]);
    mocks.syncDirectorAssets.mockResolvedValue({...stage,version:2,objects:[directorObject,syncedObject]});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledWith('stage-1',1,[asset.key]));
    expect(screen.getByText('场景资产已自动同步')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'同步场景资产'}));
    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledTimes(2));
    expect(screen.getByText('场景资产已同步')).toBeVisible();
  });

  it('automatically synchronizes available production assets when the stage opens',async()=>{
    const asset={key:'library_asset:scene-asset-1',kind:'background' as const,source_type:'library_asset' as const,source_id:'scene-asset-1',asset_id:'asset-1',label:'天台夜景',media_url:'/media/rooftop.png',media_type:'image/png',metadata:{}};
    const syncedObject={...directorObject,id:'object-2',kind:'background' as const,source_type:'library_asset' as const,source_id:'scene-asset-1',label:'天台夜景',metadata:{catalog_key:asset.key}};
    mocks.getDirectorAssets.mockResolvedValue([asset]);
    mocks.syncDirectorAssets.mockResolvedValue({...stage,version:2,objects:[directorObject,syncedObject]});

    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledWith('stage-1',1,[asset.key]));
    expect(screen.getByText('场景资产已自动同步')).toBeVisible();
  });

  it('finishes automatic synchronization when the asset catalog refreshes during the request',async()=>{
    const asset={key:'library_asset:scene-asset-1',kind:'background' as const,source_type:'library_asset' as const,source_id:'scene-asset-1',asset_id:'asset-1',label:'天台夜景',media_url:'/media/rooftop.png',media_type:'image/png',metadata:{}};
    const syncedObject={...directorObject,id:'object-2',kind:'background' as const,source_type:'library_asset' as const,source_id:'scene-asset-1',label:'天台夜景',metadata:{catalog_key:asset.key}};
    let finishSync:(value:DirectorStage)=>void=()=>{};
    mocks.getDirectorAssets.mockImplementation(async()=>[asset]);
    mocks.syncDirectorAssets.mockImplementation(()=>new Promise(resolve=>{finishSync=resolve;}));

    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);

    await waitFor(()=>expect(mocks.syncDirectorAssets).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(mocks.getDirectorAssets).toHaveBeenCalledTimes(2));
    finishSync({...stage,version:2,objects:[directorObject,syncedObject]});
    expect(await screen.findByText('场景资产已自动同步')).toBeVisible();
    expect(screen.getByRole('button',{name:'同步场景资产'})).toBeEnabled();
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
