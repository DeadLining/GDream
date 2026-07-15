import React from 'react';
import {cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DirectorWorkspace} from '../components/director/DirectorWorkspace';
import type {DirectorStage,Scene} from '../lib/types';

const mocks=vi.hoisted(()=>({getDirectorStage:vi.fn(),createDirectorStage:vi.fn(),getDirectorAssets:vi.fn(),syncDirectorAssets:vi.fn(),createDirectorObject:vi.fn(),deleteDirectorObject:vi.fn(),updateDirectorCamera:vi.fn(),updateDirectorObject:vi.fn(),createDirectorSuggestion:vi.fn(),applyDirectorSuggestionToShot:vi.fn()}));
vi.mock('../lib/api',()=>mocks);
const overrideTransform={position:[2,0,0],rotation:[0,.5,0],scale:[1,1,1]} as const;
vi.mock('../components/director/DirectorCanvas',()=>({DirectorCanvas:({editable,mode,objects,onTransform}:{editable:boolean;mode:string;objects:Array<{id:string;visible:boolean}>;onTransform:(id:string,transform:typeof overrideTransform)=>void})=><button data-testid="director-canvas" data-editable={String(editable)} data-mode={mode} data-visible={String(objects[0]?.visible)} onClick={()=>objects[0]&&onTransform(objects[0].id,overrideTransform)}>移动对象</button> }));

const scene:Scene={id:'scene-1',position:1,location:'天台',time_of_day:'night',summary:'对峙',continuity_state:{},estimated_duration_seconds:10,shots:[{id:'shot-1',position:1,shot_type:'medium',duration_seconds:5,composition:'对峙',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',active_panel_asset_id:null,review_status:'draft',render_status:'pending',dialogue:[]}]};
const directorObject={id:'object-1',stage_id:'stage-1',kind:'primitive' as const,source_type:'placeholder' as const,source_id:null,label:'方块',position:1,transform:{position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]},appearance:{},metadata:{},visible:true};
const stage:DirectorStage={id:'stage-1',scene_id:'scene-1',version:1,environment:{},objects:[directorObject],shot_cameras:[{id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null}]};

describe('DirectorWorkspace',()=>{
  afterEach(()=>{cleanup();vi.clearAllMocks();});
  it('loads the scene stage and persists a new placeholder object',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.getDirectorAssets.mockResolvedValue([]);mocks.createDirectorObject.mockResolvedValue({...stage.objects[0],id:'object-1',stage_id:'stage-1',kind:'primitive',source_type:'placeholder',source_id:null,label:'新道具',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{},metadata:{},visible:true});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'3D 导演台'})).toBeVisible();
    await userEvent.click(screen.getAllByRole('button',{name:'添加占位物'})[0]);
    await waitFor(()=>expect(mocks.createDirectorObject).toHaveBeenCalledWith('stage-1',1,expect.objectContaining({label:'新道具'})));
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
});
