import React from 'react';
import {Group} from 'three';
import {cleanup,render,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DirectorCanvas} from '../components/director/DirectorCanvas';
import type {DirectorObject,ShotCamera} from '../lib/types';

const threeCamera={position:{set:vi.fn()},rotation:{set:vi.fn()},fov:50,updateProjectionMatrix:vi.fn()};
vi.mock('@react-three/fiber',()=>({Canvas:({children}:React.PropsWithChildren)=> <div data-testid="r3f-canvas">{children}</div>,useThree:(select:(state:{camera:typeof threeCamera})=>unknown)=>select({camera:threeCamera})}));
vi.mock('@react-three/drei',()=>({
  Clone:({object}:{object:{name:string}})=><div data-testid="director-model" data-name={object.name}/>,
  Image:({url}:{url:string})=><div data-testid="director-image" data-url={url}/>,
  OrbitControls:({enabled,onEnd}:{enabled:boolean;onEnd?:(event:unknown)=>void})=><button data-testid="orbit" data-enabled={String(enabled)} onClick={()=>onEnd?.({target:{object:{position:{x:2,y:3,z:4},rotation:{x:.1,y:.2,z:.3}},target:{x:0,y:1,z:0}}})}>移动镜头</button>,
  TransformControls:({children,mode}:React.PropsWithChildren<{mode:string}>)=><div data-testid="transform-controls" data-mode={mode}>{children}</div>,
  useGLTF:(url:string)=>{const scene=new Group();scene.name=url;return {scene};},
}));

const camera:ShotCamera={id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null};
const objects:DirectorObject[]=[
  {id:'character-1',stage_id:'stage-1',kind:'character',source_type:'character_reference',source_id:'char-1',label:'林夏',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{image_url:'/media/linxia.png',aspect_ratio:.75},metadata:{asset_id:'asset-1'},visible:true},
  {id:'prop-1',stage_id:'stage-1',kind:'prop',source_type:'model',source_id:'missing.glb',label:'箱子',position:2,transform:{position:[1,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{},metadata:{},visible:true},
  {id:'character-3d',stage_id:'stage-1',kind:'character',source_type:'model',source_id:'representation-1',label:'林夏 3D',position:3,transform:{position:[-1,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{model_url:'/media/linxia.glb',model_scale:1.2,model_offset_y:.1},metadata:{asset_id:'model-asset-1'},visible:true},
];

describe('DirectorCanvas',()=>{
  beforeEach(()=>vi.spyOn(console,'error').mockImplementation(()=>{}));
  afterEach(()=>{cleanup();vi.restoreAllMocks();});
  it('renders deterministic placeholders and selected transform controls',()=>{
    const view=render(<DirectorCanvas objects={objects} camera={camera} selectedObjectId="character-1" mode="world" onTransform={vi.fn()}/>);
    const ui=within(view.container);
    expect(ui.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(view.container.querySelector('[name="director-object-character-1"]')).toBeInTheDocument();
    expect(view.container.querySelector('[name="director-object-prop-1"]')).toBeInTheDocument();
    expect(ui.getByTestId('director-image')).toHaveAttribute('data-url','/media/linxia.png');
    expect(ui.getByTestId('director-model')).toHaveAttribute('data-name','/media/linxia.glb');
    expect(ui.getByTestId('transform-controls')).toBeInTheDocument();
    expect(ui.getByTestId('orbit')).toHaveAttribute('data-enabled','true');
  });

  it('reports the persisted camera pose after camera-mode navigation',()=>{
    const onCameraChange=vi.fn();
    const view=render(<DirectorCanvas objects={objects} camera={camera} selectedObjectId={null} mode="camera" onTransform={vi.fn()} onCameraChange={onCameraChange}/>);
    const orbit=within(view.container).getByTestId('orbit');
    expect(orbit).toHaveAttribute('data-enabled','true');
    orbit.click();
    expect(onCameraChange).toHaveBeenCalledWith({position:[2,3,4],target:[0,1,0],rotation:[.1,.2,.3]});
  });

  it('passes the selected transform mode to the object controls',()=>{
    const view=render(<DirectorCanvas objects={objects} camera={camera} selectedObjectId="character-1" mode="world" transformMode="rotate" onTransform={vi.fn()}/>);
    expect(within(view.container).getByTestId('transform-controls')).toHaveAttribute('data-mode','rotate');
  });
});
