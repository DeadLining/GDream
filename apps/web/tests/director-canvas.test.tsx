import React from 'react';
import {Group} from 'three';
import {cleanup,fireEvent,render,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DirectorCanvas} from '../components/director/DirectorCanvas';
import type {DirectorObject,ShotCamera} from '../lib/types';

const threeCamera={position:{set:vi.fn()},rotation:{set:vi.fn()},fov:50,updateProjectionMatrix:vi.fn()};
vi.mock('@react-three/fiber',()=>({Canvas:({children,onPointerMissed}:React.PropsWithChildren<{onPointerMissed?:()=>void}>)=> <div data-testid="r3f-canvas" onClick={()=>onPointerMissed?.()}>{children}</div>,useFrame:vi.fn(),useThree:(select:(state:{camera:typeof threeCamera})=>unknown)=>select({camera:threeCamera})}));
vi.mock('@react-three/drei',()=>({
  Clone:({object}:{object:{name:string}})=><div data-testid="director-model" data-name={object.name}/>,
  Image:({url}:{url:string})=><div data-testid="director-image" data-url={url}/>,
  OrbitControls:({enabled,onEnd}:{enabled:boolean;onEnd?:(event:unknown)=>void})=><button data-testid="orbit" data-enabled={String(enabled)} onClick={()=>onEnd?.({target:{object:{position:{x:2,y:3,z:4},rotation:{x:.1,y:.2,z:.3}},target:{x:0,y:1,z:0}}})}>移动镜头</button>,
  TransformControls:({children,mode,translationSnap,rotationSnap,scaleSnap,onObjectChange,onMouseUp}:React.PropsWithChildren<{mode:string;translationSnap?:number|null;rotationSnap?:number|null;scaleSnap?:number|null;onObjectChange?:()=>void;onMouseUp?:()=>void}>)=><div data-testid="transform-controls" data-mode={mode} data-translation-snap={translationSnap??''} data-rotation-snap={rotationSnap??''} data-scale-snap={scaleSnap??''} onClick={()=>{const current=document.querySelector('[name="director-object-character-1"]') as unknown as {position:{x:number;y:number;z:number};rotation:{x:number;y:number;z:number};scale:{x:number;y:number;z:number}};current.position={x:1,y:0,z:0};current.rotation={x:0,y:.2,z:0};current.scale={x:1,y:1,z:1};onObjectChange?.();current.position={x:2,y:0,z:0};onObjectChange?.();onMouseUp?.();}}>{children}</div>,
  useGLTF:(url:string)=>{const scene=new Group();scene.name=url;return {scene};},
}));

const camera:ShotCamera={id:'camera-1',stage_id:'stage-1',shot_id:'shot-1',version:1,position:[0,1.6,5],target:[0,1.2,0],rotation:[0,0,0],focal_length_mm:50,near:.1,far:1000,shot_size:'medium',camera_motion:'static',framing_guides:{},object_overrides:{},preview_asset_id:null};
const objects:DirectorObject[]=[
  {id:'character-1',stage_id:'stage-1',kind:'character',source_type:'character_reference',source_id:'char-1',label:'林夏',position:1,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{image_url:'/media/linxia.png',aspect_ratio:.75},metadata:{asset_id:'asset-1'},visible:true},
  {id:'prop-1',stage_id:'stage-1',kind:'prop',source_type:'library_asset',source_id:'prop-image',label:'箱子',position:2,transform:{position:[1,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{image_url:'/media/box.png'},metadata:{requires_3d_model:true},visible:true},
  {id:'character-3d',stage_id:'stage-1',kind:'character',source_type:'model',source_id:'representation-1',label:'林夏 3D',position:3,transform:{position:[-1,0,0],rotation:[0,0,0],scale:[1,1,1]},appearance:{model_url:'/media/linxia.glb',model_scale:1.2,model_offset_y:.1},metadata:{asset_id:'model-asset-1'},visible:true},
  {id:'background-1',stage_id:'stage-1',kind:'background',source_type:'library_asset',source_id:'background-image',label:'雨夜天台',position:4,transform:{position:[0,1,-2],rotation:[0,0,0],scale:[2,2,2]},appearance:{image_url:'/media/rooftop.png',aspect_ratio:1.5},metadata:{},visible:true},
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
    expect(ui.getAllByTestId('director-image')).toHaveLength(1);
    expect(ui.getByTestId('director-image')).toHaveAttribute('data-url','/media/rooftop.png');
    expect(ui.getByTestId('director-model')).toHaveAttribute('data-name','/media/linxia.glb');
    expect(ui.getByTestId('transform-controls')).toBeInTheDocument();
    expect(ui.getByTestId('orbit')).toHaveAttribute('data-enabled','true');
  });

  it('renders a standard humanoid rig proxy when a character has no GLB',()=>{
    const view=render(<DirectorCanvas objects={[objects[0]]} camera={camera} selectedObjectId={null} mode="world" onTransform={vi.fn()}/>);

    expect(view.container.querySelector('[name="humanoid-rig-character-1"]')).toBeInTheDocument();
    for(const bone of ['Hips','Spine','Head','LeftUpperArm','RightUpperArm','LeftUpperLeg','RightUpperLeg']){
      expect(view.container.querySelector(`[name="humanoid-bone-${bone}"]`)).toBeInTheDocument();
    }
  });

  it('renders explicit quadruped, bird, and primitive 3D proxy templates',()=>{
    const proxyObjects:DirectorObject[]=[
      {...objects[0],id:'animal-1',label:'四足动物',metadata:{proxy_rig:'quadruped'}},
      {...objects[0],id:'bird-1',label:'飞鸟',metadata:{proxy_rig:'bird'}},
      {...objects[1],id:'cylinder-1',label:'立柱',metadata:{proxy_rig:'prop_cylinder'}},
      {...objects[1],id:'sphere-1',label:'圆球',metadata:{proxy_rig:'prop_sphere'}},
    ];
    const view=render(<DirectorCanvas objects={proxyObjects} camera={camera} selectedObjectId={null} mode="world" onTransform={vi.fn()}/>);

    expect(view.container.querySelector('[name="quadruped-rig-animal-1"]')).toBeInTheDocument();
    expect(view.container.querySelector('[name="bird-rig-bird-1"]')).toBeInTheDocument();
    expect(view.container.querySelector('[name="primitive-proxy-cylinder-1"]')).toHaveAttribute('data-proxy-shape','cylinder');
    expect(view.container.querySelector('[name="primitive-proxy-sphere-1"]')).toHaveAttribute('data-proxy-shape','sphere');
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

  it('selects objects from the canvas and clears selection on empty space',()=>{
    const onSelectObject=vi.fn();
    const view=render(<DirectorCanvas objects={objects} camera={camera} selectedObjectId={null} mode="world" onSelectObject={onSelectObject} onTransform={vi.fn()}/>);
    fireEvent.click(view.container.querySelector('[name="director-object-character-1"]') as Element);
    expect(onSelectObject).toHaveBeenLastCalledWith('character-1');
    fireEvent.click(within(view.container).getByTestId('r3f-canvas'));
    expect(onSelectObject).toHaveBeenLastCalledWith(null);
  });

  it('configures translation, rotation, and scale snapping',()=>{
    const view=render(<DirectorCanvas objects={objects} camera={camera} selectedObjectId="character-1" mode="world" snapEnabled onTransform={vi.fn()}/>);
    const controls=within(view.container).getByTestId('transform-controls');
    expect(controls).toHaveAttribute('data-translation-snap','0.25');
    expect(controls).toHaveAttribute('data-rotation-snap',String(Math.PI/12));
    expect(controls).toHaveAttribute('data-scale-snap','0.1');
  });

  it('commits only the final transform when a drag ends',()=>{
    const onTransform=vi.fn();
    const view=render(<DirectorCanvas objects={objects} camera={camera} selectedObjectId="character-1" mode="world" onTransform={onTransform}/>);
    fireEvent.click(within(view.container).getByTestId('transform-controls'));
    expect(onTransform).toHaveBeenCalledTimes(1);
    expect(onTransform).toHaveBeenCalledWith('character-1',{position:[2,0,0],rotation:[0,.2,0],scale:[1,1,1]});
  });
});
