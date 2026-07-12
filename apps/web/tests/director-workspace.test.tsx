import React from 'react';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DirectorWorkspace} from '../components/director/DirectorWorkspace';
import type {DirectorStage,Scene} from '../lib/types';

const mocks=vi.hoisted(()=>({getDirectorStage:vi.fn(),createDirectorStage:vi.fn(),createDirectorObject:vi.fn(),updateDirectorCamera:vi.fn(),updateDirectorObject:vi.fn()}));
vi.mock('../lib/api',()=>mocks);
vi.mock('../components/director/DirectorCanvas',()=>({DirectorCanvas:({editable}:{editable:boolean})=><div data-testid="director-canvas" data-editable={String(editable)}/> }));

const scene:Scene={id:'scene-1',position:1,location:'天台',time_of_day:'night',summary:'对峙',continuity_state:{},estimated_duration_seconds:10,shots:[{id:'shot-1',position:1,shot_type:'medium',duration_seconds:5,composition:'对峙',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',active_panel_asset_id:null,review_status:'draft',render_status:'pending',dialogue:[]}]};
const stage:DirectorStage={id:'stage-1',scene_id:'scene-1',version:1,environment:{},objects:[],shot_cameras:[{id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null}]};

describe('DirectorWorkspace',()=>{
  afterEach(()=>{cleanup();vi.clearAllMocks();});
  it('loads the scene stage and persists a new placeholder object',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);mocks.createDirectorObject.mockResolvedValue({...stage.objects[0],id:'object-1',stage_id:'stage-1',kind:'primitive',source_type:'placeholder',source_id:null,label:'新道具',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{},metadata:{},visible:true});
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile={false} onSelectShot={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'3D 导演台'})).toBeVisible();
    await userEvent.click(screen.getAllByRole('button',{name:'添加占位物'})[0]);
    await waitFor(()=>expect(mocks.createDirectorObject).toHaveBeenCalledWith('stage-1',1,expect.objectContaining({label:'新道具'})));
  });
  it('keeps transform drag disabled on mobile',async()=>{
    mocks.getDirectorStage.mockResolvedValue(stage);
    render(<DirectorWorkspace scene={scene} selectedShotId="shot-1" mobile onSelectShot={vi.fn()}/>);
    expect(await screen.findByTestId('director-canvas')).toHaveAttribute('data-editable','false');
  });
});
