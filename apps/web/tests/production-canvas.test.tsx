import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';

afterEach(cleanup);

vi.mock('@xyflow/react',()=>({
  ReactFlow:({nodes,nodeTypes,defaultViewport,fitView}:any)=><div data-testid="react-flow" data-default-zoom={defaultViewport?.zoom} data-fit-view={String(Boolean(fitView))}>{nodes.map((node:any)=>{const Node=nodeTypes[node.type];return <Node key={node.id} id={node.id} data={node.data}/>;})}</div>,
  Background:()=>null,Controls:()=>null,MiniMap:()=>null,
  Handle:()=>null,Position:{Left:'left',Right:'right'},applyNodeChanges:(_:any,nodes:any)=>nodes,
}));

import {ProductionCanvas} from '../components/production-canvas/ProductionCanvas';
import type {EpisodeProductionGraph} from '../lib/types';

const graph:EpisodeProductionGraph={
  episode_id:'episode-1',project_id:'project-1',
  scenes:[{id:'scene-1',position:1,location:'庭院',summary:'相遇'}],
  shots:[
    {id:'shot-1',scene_id:'scene-1',position:1,shot_type:'中景',duration_seconds:4,composition:'入场',review_status:'draft',render_status:'ready',video_render_status:'pending',active_panel_asset_id:'panel-1',active_panel_media_url:'/media/panel-1.png',active_video_asset_id:null,active_video_media_url:null},
    {id:'shot-2',scene_id:'scene-1',position:2,shot_type:'近景',duration_seconds:3,composition:'反应',review_status:'draft',render_status:'ready',video_render_status:'pending',active_panel_asset_id:'panel-2',active_panel_media_url:'/media/panel-2.png',active_video_asset_id:null,active_video_media_url:null},
  ],
  assets:[{id:'variant-1',kind:'variant',label:'唐代造型',media_url:null,version:1,status:'approved',shot_ids:['shot-1','shot-2']}],
  production_items:[],media_dependencies:[],workflow_bindings:[
    {id:'binding-panel',project_id:'project-1',capability:'panel',name:'default',workflow_id:'comfy-panel',workflow_version:3,input_mapping_version:2,enabled:true},
    {id:'binding-video',project_id:'project-1',capability:'video',name:'default',workflow_id:'comfy-video',workflow_version:4,input_mapping_version:1,enabled:true},
  ],
};

it('renders scene groups, peer shots, shared assets, and the selected shot chain',async()=>{
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);
  expect(await screen.findByRole('group',{name:'场景 01：庭院'})).toBeVisible();
  expect(screen.getByRole('button',{name:'镜头 01：中景'})).toBeVisible();
  expect(screen.getByRole('button',{name:'镜头 02：近景'})).toBeVisible();
  expect(screen.getByRole('button',{name:'唐代造型'})).toBeVisible();
  expect(screen.getByRole('button',{name:/镜头 02 画面/})).toBeVisible();
});

it('selecting a shot expands its chain and opens the inspector',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId={null} onSelectShot={vi.fn()}/>);
  await user.click(await screen.findByRole('button',{name:'镜头 02：近景'}));
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('镜头 02');
  expect(await screen.findByRole('button',{name:'镜头 02 画面'})).toBeVisible();
  expect(screen.getByText('comfy-panel · v3')).toBeVisible();
  expect(screen.getByText('comfy-video · v4')).toBeVisible();
  expect(screen.queryByRole('button',{name:'镜头 01 画面'})).not.toBeInTheDocument();
});

it('restores saved viewport, expanded shots, pinned shots, and collapsed scenes',async()=>{
  render(<ProductionCanvas graph={graph} layout={{version:3,viewport:{x:24,y:36,zoom:.82},nodes:{},expanded_shots:['shot-2'],pinned_shots:['shot-2'],collapsed_scene_ids:[]}} selectedShotId={null} onSelectShot={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'镜头 02 画面'})).toBeVisible();
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-zoom','0.82');
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view','false');
  expect(screen.getByRole('button',{name:'取消固定镜头 02'})).toBeVisible();
});

it('falls back to the readable auto layout for legacy layout versions',async()=>{
  render(<ProductionCanvas graph={graph} layout={{version:2,viewport:{x:-900,y:-400,zoom:.2},nodes:{'shot:shot-2':{x:1400,y:900}},expanded_shots:['shot-2'],pinned_shots:[],collapsed_scene_ids:[]}} selectedShotId={null} onSelectShot={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'镜头 02：近景'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'镜头 02 画面'})).not.toBeInTheDocument();
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-zoom','0.75');
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view','true');
});

it('collapses and restores a scene frame',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId={null} onSelectShot={vi.fn()}/>);
  await user.click(await screen.findByRole('button',{name:'折叠场景 01'}));
  expect(await screen.findByRole('button',{name:'展开场景 01'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'镜头 01：中景'})).not.toBeInTheDocument();
});

it('switches the inspector to the selected production node type',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);
  await user.click(await screen.findByRole('button',{name:'镜头 02 画面'}));
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('画面节点');
  expect(screen.getByText('panel-2')).toBeVisible();
});
