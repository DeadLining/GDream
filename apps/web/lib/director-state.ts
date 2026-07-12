import type {DirectorObject,DirectorStage,ShotCamera,Transform} from './types';

type DirtyState={stage:boolean;cameras:Record<string,boolean>};
type Snapshot={objects:Record<string,DirectorObject>;cameras:Record<string,ShotCamera>;dirty:DirtyState};
export type DirectorConflict={scope:'stage'|'camera';latestVersion:number};
export type DirectorState=Snapshot&{
  stageId:string;stageVersion:number;selectedObjectId:string|null;selectedShotId:string;
  past:Snapshot[];future:Snapshot[];conflict:DirectorConflict|null;
};
export type DirectorAction=
  |{type:'select.object';id:string|null}
  |{type:'select.shot';id:string}
  |{type:'object.transform';id:string;transform:Transform}
  |{type:'camera.patch';shotId:string;patch:Partial<ShotCamera>}
  |{type:'saved';scope:'stage'|'camera';shotId?:string;version:number}
  |{type:'conflict';scope:'stage'|'camera';latestVersion:number}
  |{type:'undo'}|{type:'redo'};

const cloneDirty=(dirty:DirtyState):DirtyState=>({stage:dirty.stage,cameras:{...dirty.cameras}});
const snapshot=(state:Snapshot):Snapshot=>({objects:state.objects,cameras:state.cameras,dirty:cloneDirty(state.dirty)});
const remember=(state:DirectorState,next:Snapshot):DirectorState=>({...state,...next,past:[...state.past,snapshot(state)].slice(-50),future:[],conflict:null});

export function createDirectorState(stage:DirectorStage,selectedShotId:string):DirectorState{
  return {stageId:stage.id,stageVersion:stage.version,objects:Object.fromEntries(stage.objects.map(item=>[item.id,item])),cameras:Object.fromEntries(stage.shot_cameras.map(item=>[item.shot_id,item])),selectedObjectId:null,selectedShotId,dirty:{stage:false,cameras:{}},past:[],future:[],conflict:null};
}

export function directorReducer(state:DirectorState,action:DirectorAction):DirectorState{
  switch(action.type){
    case 'select.object':return {...state,selectedObjectId:action.id};
    case 'select.shot':return {...state,selectedShotId:action.id};
    case 'object.transform':{
      const current=state.objects[action.id];if(!current)return state;
      return remember(state,{objects:{...state.objects,[action.id]:{...current,transform:action.transform}},cameras:state.cameras,dirty:{...cloneDirty(state.dirty),stage:true}});
    }
    case 'camera.patch':{
      const current=state.cameras[action.shotId];if(!current)return state;
      return remember(state,{objects:state.objects,cameras:{...state.cameras,[action.shotId]:{...current,...action.patch}},dirty:{stage:state.dirty.stage,cameras:{...state.dirty.cameras,[action.shotId]:true}}});
    }
    case 'undo':{
      const previous=state.past.at(-1);if(!previous)return state;
      return {...state,...previous,past:state.past.slice(0,-1),future:[snapshot(state),...state.future],conflict:null};
    }
    case 'redo':{
      const next=state.future[0];if(!next)return state;
      return {...state,...next,past:[...state.past,snapshot(state)].slice(-50),future:state.future.slice(1),conflict:null};
    }
    case 'saved':return action.scope==='stage'?{...state,stageVersion:action.version,dirty:{...state.dirty,stage:false},conflict:null}:{...state,cameras:action.shotId&&state.cameras[action.shotId]?{...state.cameras,[action.shotId]:{...state.cameras[action.shotId],version:action.version}}:state.cameras,dirty:{...state.dirty,cameras:{...state.dirty.cameras,...(action.shotId?{[action.shotId]:false}:{})}},conflict:null};
    case 'conflict':return {...state,conflict:{scope:action.scope,latestVersion:action.latestVersion}};
  }
}

export const selectCurrentObject=(state:DirectorState)=>state.selectedObjectId?state.objects[state.selectedObjectId]??null:null;
export const selectCurrentCamera=(state:DirectorState)=>state.cameras[state.selectedShotId]??null;
