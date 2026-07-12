import {describe, expect, it} from 'vitest';
import {createDirectorState, directorReducer} from '../lib/director-state';
import type {DirectorStage, Transform} from '../lib/types';

const transform = (x = 0): Transform => ({position:[x,0,0],rotation:[0,0,0],scale:[1,1,1]});
const stage: DirectorStage = {
  id:'stage-1', scene_id:'scene-1', version:1, environment:{background_color:'#6f858f'},
  objects:[{id:'object-1',stage_id:'stage-1',kind:'primitive',source_type:'placeholder',source_id:null,label:'方块',position:1,transform:transform(),appearance:{},metadata:{},visible:true}],
  shot_cameras:[{id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:0.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null}],
};

describe('director editor state', () => {
  it('updates object transforms immutably and marks the stage dirty', () => {
    const initial=createDirectorState(stage,'shot-1');const nextTransform=transform(2);
    const next=directorReducer(initial,{type:'object.transform',id:'object-1',transform:nextTransform});
    expect(next.objects['object-1'].transform).toEqual(nextTransform);
    expect(next.dirty.stage).toBe(true);
    expect(initial.objects['object-1'].transform).toEqual(transform());
    expect(next.objects['object-1']).not.toBe(initial.objects['object-1']);
  });

  it('keeps at most fifty undo entries and restores the prior edit', () => {
    let state=createDirectorState(stage,'shot-1');
    for(let index=1;index<=55;index++)state=directorReducer(state,{type:'object.transform',id:'object-1',transform:transform(index)});
    expect(state.past).toHaveLength(50);
    state=directorReducer(state,{type:'undo'});
    expect(state.objects['object-1'].transform.position[0]).toBe(54);
  });

  it('invalidates redo after a new edit', () => {
    let state=createDirectorState(stage,'shot-1');
    state=directorReducer(state,{type:'object.transform',id:'object-1',transform:transform(1)});
    state=directorReducer(state,{type:'undo'});
    expect(state.future).toHaveLength(1);
    state=directorReducer(state,{type:'camera.patch',shotId:'shot-1',patch:{focal_length_mm:85}});
    expect(state.future).toHaveLength(0);
    expect(state.dirty.cameras['shot-1']).toBe(true);
  });

  it('preserves local edits when a version conflict is reported', () => {
    let state=createDirectorState(stage,'shot-1');
    state=directorReducer(state,{type:'object.transform',id:'object-1',transform:transform(3)});
    state=directorReducer(state,{type:'conflict',scope:'stage',latestVersion:4});
    expect(state.conflict).toEqual({scope:'stage',latestVersion:4});
    expect(state.objects['object-1'].transform.position[0]).toBe(3);
  });
});
