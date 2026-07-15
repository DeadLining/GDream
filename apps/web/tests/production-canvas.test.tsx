import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

beforeEach(()=>localStorage.clear());
afterEach(cleanup);

vi.mock('@xyflow/react',()=>({
  ReactFlow:({nodes,nodeTypes,defaultViewport,fitView,onSelectionChange,nodesConnectable}:any)=><div data-testid="react-flow" data-default-zoom={defaultViewport?.zoom} data-fit-view={String(Boolean(fitView))} data-nodes-connectable={String(Boolean(nodesConnectable))}><button type="button" aria-label="模拟重复镜头选择" onClick={()=>{const shot=nodes.find((node:any)=>node.type==='shot');onSelectionChange?.({nodes:[shot]});onSelectionChange?.({nodes:[shot]});}}/>{nodes.filter((node:any)=>!node.hidden).map((node:any)=>{const Node=nodeTypes[node.type];return <Node key={node.id} id={node.id} type={node.type} data={node.data}/>;})}</div>,
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
  expect(screen.getByRole('button',{name:/镜头 02 分镜渲染/})).toBeVisible();
});

it('selecting a shot expands its chain and opens the inspector',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId={null} onSelectShot={vi.fn()}/>);
  await user.click(await screen.findByRole('button',{name:'镜头 02：近景'}));
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('镜头 02');
  expect(await screen.findByRole('button',{name:'镜头 02 分镜渲染'})).toBeVisible();
  expect(screen.getAllByText('comfy-panel · v3').length).toBeGreaterThan(0);
  expect(screen.getAllByText('comfy-video · v4').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button',{name:'镜头 01 分镜渲染'})).not.toBeInTheDocument();
});

it('removes the node inspector when the user closes it',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  expect(await screen.findByRole('complementary',{name:'生产节点检查器'})).toBeVisible();
  await user.click(screen.getByRole('button',{name:'关闭节点检查器'}));

  expect(screen.queryByRole('complementary',{name:'生产节点检查器'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'打开节点检查器'})).toBeVisible();
});

it('restores saved viewport, expanded shots, pinned shots, and collapsed scenes',async()=>{
  render(<ProductionCanvas graph={graph} layout={{version:3,viewport:{x:24,y:36,zoom:.82},nodes:{},expanded_shots:['shot-2'],pinned_shots:['shot-2'],collapsed_scene_ids:[]}} selectedShotId={null} onSelectShot={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'镜头 02 分镜渲染'})).toBeVisible();
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-zoom','0.82');
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view','false');
  expect(screen.getByRole('button',{name:'取消固定镜头 02'})).toBeVisible();
});

it('falls back to the readable auto layout for legacy layout versions',async()=>{
  render(<ProductionCanvas graph={graph} layout={{version:2,viewport:{x:-900,y:-400,zoom:.2},nodes:{'shot:shot-2':{x:1400,y:900}},expanded_shots:['shot-2'],pinned_shots:[],collapsed_scene_ids:[]}} selectedShotId={null} onSelectShot={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'镜头 02：近景'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'镜头 02 分镜渲染'})).not.toBeInTheDocument();
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
  await user.click(await screen.findByRole('button',{name:'镜头 02 分镜渲染'}));
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('分镜渲染');
  expect(screen.getByText('panel-2')).toBeVisible();
});

it('renders the episode canvas navigation without a duplicate public asset dock',async()=>{
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  expect(await screen.findByRole('region',{name:'单集生产画布'})).toHaveAttribute('data-canvas-theme','dark');
  expect(screen.getByRole('region',{name:'单集生产画布'})).toHaveAttribute('data-canvas-view','overview');
  expect(screen.getByRole('navigation',{name:'生产画布视图'})).toBeVisible();
  expect(screen.getByRole('button',{name:'整集画布'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('button',{name:'镜头聚焦'})).toBeVisible();
  expect(screen.getByRole('button',{name:'资产关系'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'ComfyUI'})).not.toBeInTheDocument();
  expect(screen.queryByRole('region',{name:'公共资产区'})).not.toBeInTheDocument();
  expect(screen.getByTestId('react-flow')).toHaveAttribute('data-nodes-connectable','false');
});

it('switches between materially different overview, shot focus, and asset relation views',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  expect(await screen.findByRole('button',{name:'镜头 01：中景'})).toBeVisible();
  await user.click(screen.getByRole('button',{name:'镜头聚焦'}));

  expect(screen.getByRole('region',{name:'单集生产画布'})).toHaveAttribute('data-canvas-view','focus');
  expect(screen.queryByRole('button',{name:'镜头 01：中景'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'镜头 02：近景'})).toBeVisible();
  expect(screen.queryByRole('group',{name:'场景 01：庭院'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'镜头 02 3D 导演'})).toBeVisible();
  expect(screen.getByRole('button',{name:'唐代造型'})).toBeVisible();

  await user.click(screen.getByRole('button',{name:'资产关系'}));

  expect(screen.getByRole('region',{name:'单集生产画布'})).toHaveAttribute('data-canvas-view','assets');
  expect(screen.getByRole('button',{name:'镜头 01：中景'})).toBeVisible();
  expect(screen.getByRole('button',{name:'镜头 02：近景'})).toBeVisible();
  expect(screen.getByRole('button',{name:'唐代造型'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'镜头 02 3D 导演'})).not.toBeInTheDocument();
  expect(screen.getByText('1 项资产 · 2 个引用镜头')).toBeVisible();
});

it('shows an honest empty state when the episode has no asset-to-shot bindings',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={{...graph,assets:[]}} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  await user.click(await screen.findByRole('button',{name:'资产关系'}));

  expect(screen.getByRole('status',{name:'资产关系状态'})).toHaveTextContent('尚未建立资产与镜头的使用关系');
  expect(screen.queryByText('庭院')).not.toBeInTheDocument();
});

it('switches and remembers the canvas theme without changing the graph',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  await user.click(await screen.findByRole('button',{name:'切换为奶白画布'}));

  expect(screen.getByRole('region',{name:'单集生产画布'})).toHaveAttribute('data-canvas-theme','cream');
  expect(localStorage.getItem('ai-comic-production-canvas-theme')).toBe('cream');
  expect(screen.getByRole('button',{name:'镜头 02：近景'})).toBeVisible();
});

it('expands AI comic domain nodes instead of a raw ComfyUI editor',async()=>{
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  expect(await screen.findByRole('button',{name:'镜头 02 3D 导演'})).toBeVisible();
  expect(screen.getByRole('button',{name:'镜头 02 分镜渲染'})).toHaveTextContent('自定义工作流');
  expect(screen.getByRole('button',{name:'镜头 02 视觉审阅'})).toBeVisible();
  expect(screen.getByRole('button',{name:'镜头 02 对白'})).toBeVisible();
  expect(screen.getByRole('button',{name:'镜头 02 Qwen TTS'})).toBeVisible();
  expect(screen.queryByTitle('ComfyUI 节点编辑器')).not.toBeInTheDocument();
});

it('opens the real visual review workspace from the selected review node',async()=>{
  const user=userEvent.setup();
  const onOpenVisualReview=vi.fn();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenVisualReview={onOpenVisualReview}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 视觉审阅'}));

  expect(onOpenVisualReview).toHaveBeenCalledWith('shot-2');
  expect(screen.queryByRole('region',{name:'镜头 02 圈点修改'})).not.toBeInTheDocument();
});

it('opens the real 3D director workspace from the selected optional node',async()=>{
  const user=userEvent.setup();
  const onOpenDirector=vi.fn();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenDirector={onOpenDirector}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 3D 导演'}));

  expect(onOpenDirector).toHaveBeenCalledWith('shot-2');
});

it('does not open visual review while the shot has no generated panel',async()=>{
  const user=userEvent.setup();
  const onOpenVisualReview=vi.fn();
  const missingPanel={...graph,shots:graph.shots.map(shot=>shot.id==='shot-2'?{...shot,active_panel_asset_id:null,active_panel_media_url:null}:shot)};
  render(<ProductionCanvas graph={missingPanel} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenVisualReview={onOpenVisualReview}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 视觉审阅'}));

  expect(onOpenVisualReview).not.toHaveBeenCalled();
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('请先生成分镜画面');
});

it('opens the panel production workspace from the render node',async()=>{
  const user=userEvent.setup();
  const onOpenMedia=vi.fn();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenMedia={onOpenMedia}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 分镜渲染'}));

  expect(onOpenMedia).toHaveBeenCalledWith('shot-2','panel');
});

it('keeps the video workspace locked until visual review is approved',async()=>{
  const user=userEvent.setup();
  const onOpenMedia=vi.fn();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenMedia={onOpenMedia}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 视频渲染'}));

  expect(onOpenMedia).not.toHaveBeenCalled();
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('请先完成视觉审阅');
});

it('opens the video production workspace after visual review approval',async()=>{
  const user=userEvent.setup();
  const onOpenMedia=vi.fn();
  const approved={...graph,shots:graph.shots.map(shot=>shot.id==='shot-2'?{...shot,review_status:'approved'}:shot)};
  render(<ProductionCanvas graph={approved} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenMedia={onOpenMedia}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 视频渲染'}));

  expect(onOpenMedia).toHaveBeenCalledWith('shot-2','video');
});

it('opens the shared dialogue and speech workspace from both domain nodes',async()=>{
  const user=userEvent.setup();
  const onOpenDialogue=vi.fn();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()} onOpenDialogue={onOpenDialogue}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 对白'}));
  expect(onOpenDialogue).toHaveBeenLastCalledWith('shot-2');

  await user.click(screen.getByRole('button',{name:'镜头 02 Qwen TTS'}));
  expect(onOpenDialogue).toHaveBeenLastCalledWith('shot-2');
  expect(onOpenDialogue).toHaveBeenCalledTimes(2);
});

it('shows prerequisite failures directly on blocked nodes and in the inspector',async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 视频渲染'}));

  expect(screen.getByRole('button',{name:'镜头 02 视频渲染'})).toHaveTextContent('请先完成视觉审阅');
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('阻塞原因');
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('请先完成视觉审阅');
});

it('describes built-in executors instead of calling them unbound',async()=>{
  const withoutBindings={...graph,workflow_bindings:[]};
  render(<ProductionCanvas graph={withoutBindings} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);

  const inspector=screen.getByRole('complementary',{name:'生产节点检查器'});
  expect(await screen.findByRole('button',{name:'镜头 02 分镜渲染'})).toBeVisible();
  expect(inspector).toHaveTextContent('画面默认图片执行器');
  expect(inspector).toHaveTextContent('视频默认视频执行器');
  expect(inspector).not.toHaveTextContent('未绑定');
});

it('keeps the selected domain node when the parent synchronizes the shot id',async()=>{
  const user=userEvent.setup();
  function Harness(){
    const [shotId,setShotId]=useState<string|null>(null);
    return <ProductionCanvas graph={graph} layout={{version:3,viewport:{x:0,y:0,zoom:.75},nodes:{},expanded_shots:['shot-2'],pinned_shots:[],collapsed_scene_ids:[]}} selectedShotId={shotId} onSelectShot={setShotId}/>;
  }
  render(<Harness/>);

  await user.click(await screen.findByRole('button',{name:'镜头 02 视觉审阅'}));

  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('视觉审阅');
  expect(screen.getByRole('button',{name:'打开视觉审阅'})).toBeVisible();
});

it('deduplicates repeated React Flow selection notifications',async()=>{
  const onSelectedShotIdsChange=vi.fn();
  const user=userEvent.setup();
  render(<ProductionCanvas graph={graph} selectedShotId="shot-2" onSelectShot={vi.fn()} onSelectedShotIdsChange={onSelectedShotIdsChange}/>);

  await screen.findByRole('button',{name:'镜头 01：中景'});
  await user.click(screen.getByRole('button',{name:'模拟重复镜头选择'}));

  expect(onSelectedShotIdsChange).toHaveBeenCalledTimes(1);
  expect(onSelectedShotIdsChange).toHaveBeenCalledWith(['shot-1']);
});
