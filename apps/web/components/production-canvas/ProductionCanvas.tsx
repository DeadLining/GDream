'use client';

import {applyNodeChanges,Background,Controls,MiniMap,ReactFlow,type ReactFlowInstance} from '@xyflow/react';
import {useEffect,useMemo,useRef,useState} from 'react';

import {buildProductionCanvasGraph,highlightProductionGraph,layoutProductionGraph,productionNodeId,type ProductionCanvasNode} from '../../lib/production-canvas';
import type {EpisodeProductionGraph,ProductionCanvasLayout} from '../../lib/types';
import {AssetNode} from './nodes/AssetNode';
import {MediaNode} from './nodes/MediaNode';
import {SceneGroupNode} from './nodes/SceneGroupNode';
import {ShotNode} from './nodes/ShotNode';
import {ProductionCanvasInspector} from './ProductionCanvasInspector';
import {ProductionCanvasToolbar} from './ProductionCanvasToolbar';

const nodeTypes={'scene-group':SceneGroupNode,shot:ShotNode,asset:AssetNode,panel:MediaNode,'speech-task':MediaNode,'video-task':MediaNode,review:MediaNode};

export function ProductionCanvas({graph,layout,selectedShotId,onSelectShot,onLayoutChange,onSelectedShotIdsChange}:{graph:EpisodeProductionGraph;layout?:ProductionCanvasLayout|null;selectedShotId:string|null;onSelectShot:(id:string)=>void;onLayoutChange?:(layout:ProductionCanvasLayout)=>void;onSelectedShotIdsChange?:(shotIds:string[])=>void}){
  const effectiveLayout=layout?.version===3?layout:null;
  const restoredShotId=selectedShotId??effectiveLayout?.expanded_shots[0]??null;
  const [activeShotId,setActiveShotId]=useState(restoredShotId);
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(restoredShotId?productionNodeId.shot(restoredShotId):null);
  const [pinnedShotIds,setPinnedShotIds]=useState(()=>new Set(effectiveLayout?.pinned_shots??[]));
  const [collapsedSceneIds,setCollapsedSceneIds]=useState(()=>new Set(effectiveLayout?.collapsed_scene_ids??[]));
  const [positionedNodes,setPositionedNodes]=useState<any[]>([]);
  const [viewport,setViewport]=useState(effectiveLayout?.viewport??{x:0,y:0,zoom:.75});
  const [readOnly,setReadOnly]=useState(false);
  const undoNodes=useRef<any[]|null>(null);
  const flowRef=useRef<ReactFlowInstance<any,any>|null>(null);
  const focusShotRef=useRef<string|null>(null);

  useEffect(()=>{
    if(!selectedShotId)return;
    setActiveShotId(selectedShotId);
    setSelectedNodeId(productionNodeId.shot(selectedShotId));
  },[selectedShotId]);
  useEffect(()=>{
    setViewport(effectiveLayout?.viewport??{x:0,y:0,zoom:.75});
    setPinnedShotIds(new Set(effectiveLayout?.pinned_shots??[]));
    setCollapsedSceneIds(new Set(effectiveLayout?.collapsed_scene_ids??[]));
    const restored=selectedShotId??effectiveLayout?.expanded_shots[0]??null;
    setActiveShotId(restored);
    setSelectedNodeId(restored?productionNodeId.shot(restored):null);
  },[graph.episode_id]);
  useEffect(()=>{
    if(typeof window==='undefined'||!window.matchMedia)return;
    const query=window.matchMedia('(max-width: 700px)');
    const update=()=>setReadOnly(query.matches);
    update();query.addEventListener('change',update);
    return()=>query.removeEventListener('change',update);
  },[]);

  const built=useMemo(()=>buildProductionCanvasGraph(graph,{
    selectedShotId:activeShotId,
    expandedShotIds:[...pinnedShotIds],
    collapsedSceneIds:[...collapsedSceneIds],
  }),[graph,activeShotId,pinnedShotIds,collapsedSceneIds]);
  const highlighted=useMemo(()=>highlightProductionGraph(built.nodes,built.edges,selectedNodeId),[built,selectedNodeId]);
  const selectedShot=graph.shots.find(shot=>shot.id===activeShotId)??null;
  const selectedNode=built.nodes.find(node=>node.id===selectedNodeId)??(activeShotId?built.nodes.find(node=>node.id===productionNodeId.shot(activeShotId)):null)??null;

  const emitLayout=(nextNodes:any[],nextViewport=viewport,overrides?:{pinned?:Set<string>;collapsed?:Set<string>;active?:string|null})=>{
    const pinned=overrides?.pinned??pinnedShotIds;
    const collapsed=overrides?.collapsed??collapsedSceneIds;
    const active=overrides?.active===undefined?activeShotId:overrides.active;
    onLayoutChange?.({
      version:3,
      viewport:nextViewport,
      nodes:Object.fromEntries(nextNodes.map(node=>[node.id,node.position])),
      expanded_shots:[...new Set([...pinned,...(active?[active]:[])])],
      pinned_shots:[...pinned],
      collapsed_scene_ids:[...collapsed],
    });
  };
  const toggleScene=(sceneId:string)=>{
    const next=new Set(collapsedSceneIds);
    const willCollapse=!next.has(sceneId);
    if(willCollapse)next.add(sceneId);else next.delete(sceneId);
    setCollapsedSceneIds(next);
    let nextActive=activeShotId;
    if(willCollapse&&graph.shots.find(shot=>shot.id===activeShotId)?.scene_id===sceneId){
      nextActive=null;
      setActiveShotId(null);
      setSelectedNodeId(productionNodeId.scene(sceneId));
    }
    emitLayout(positionedNodes,viewport,{collapsed:next,active:nextActive});
  };
  const togglePin=()=>{
    if(!activeShotId)return;
    const next=new Set(pinnedShotIds);
    if(next.has(activeShotId))next.delete(activeShotId);else next.add(activeShotId);
    setPinnedShotIds(next);
    emitLayout(positionedNodes,viewport,{pinned:next});
  };
  const selectNode=(node:ProductionCanvasNode)=>{
    setSelectedNodeId(node.id);
    if(node.type==='scene-group'||node.type==='asset')return;
    const shotId=node.type==='shot'?node.id.slice(5):String(node.data.shotId??'');
    if(!shotId)return;
    focusShotRef.current=shotId;
    setActiveShotId(shotId);
    onSelectShot(shotId);
  };
  const renderNodes=useMemo(()=>positionedNodes.map(node=>({
    ...node,
    className:[node.data.dimmed?'production-node-dimmed':'',node.id===selectedNodeId?'production-node-selected':''].filter(Boolean).join(' '),
    data:{
      ...node.data,
      zoom:viewport.zoom,
      onSelect:()=>selectNode(node),
      onToggleCollapse:node.type==='scene-group'?()=>toggleScene(String(node.data.id)):undefined,
    },
  })),[positionedNodes,selectedNodeId,viewport.zoom]);
  const renderEdges=useMemo(()=>highlighted.edges.map(edge=>({
    ...edge,
    type:'smoothstep',
    style:{stroke:edge.data.highlighted?'var(--color-accent-strong)':'var(--color-line-strong)',strokeWidth:edge.data.highlighted?2.4:1.4,strokeDasharray:edge.data.lineStyle==='dashed'?'6 5':'none'},
  })),[highlighted.edges]);

  useEffect(()=>{
    let active=true;
    void layoutProductionGraph(highlighted.nodes,highlighted.edges,effectiveLayout).then(next=>{if(active)setPositionedNodes(next as any[]);});
    return()=>{active=false;};
  },[highlighted.nodes,highlighted.edges,effectiveLayout]);
  const topologySignature=useMemo(()=>positionedNodes.map(node=>node.id).join('|'),[positionedNodes]);
  const focusSelection=()=>{
    if(!flowRef.current||!activeShotId)return;
    const nodes=positionedNodes.filter(node=>node.id===productionNodeId.shot(activeShotId)||node.data.shotId===activeShotId).map(node=>({id:node.id}));
    if(nodes.length)void flowRef.current.fitView({nodes,padding:.18,maxZoom:.9,duration:260});
  };
  const fitAll=()=>{if(flowRef.current)void flowRef.current.fitView({padding:.16,maxZoom:.88,duration:260});};
  const autoLayout=async()=>{
    undoNodes.current=positionedNodes;
    const next=await layoutProductionGraph(highlighted.nodes,highlighted.edges,null);
    setPositionedNodes(next as any[]);
    emitLayout(next);
    requestAnimationFrame(()=>fitAll());
  };
  const undoLayout=()=>{
    if(!undoNodes.current)return;
    const previous=undoNodes.current;
    undoNodes.current=null;
    setPositionedNodes(previous);
    emitLayout(previous);
  };
  const handleSelectionChange=({nodes}:{nodes:any[]})=>{
    if(!onSelectedShotIdsChange)return;
    const shotIds:string[]=[];
    for(const node of nodes){
      if(node.type==='shot'){
        const shotId=node.id.startsWith('shot:')?node.id.slice(5):String(node.data?.shotId??'');
        if(shotId)shotIds.push(shotId);
      }
    }
    onSelectedShotIdsChange(shotIds);
  };

  return <section className="production-canvas-shell">
    <div className="production-canvas" role="region" aria-label="单集生产画布">
      <ProductionCanvasToolbar onLayout={()=>void autoLayout()} onUndo={undoLayout} canUndo={Boolean(undoNodes.current)} onFitAll={fitAll} onFocusSelection={focusSelection} canFocus={Boolean(activeShotId)}/>
      <ReactFlow key={topologySignature} nodes={renderNodes} edges={renderEdges as any} nodeTypes={nodeTypes as any} nodesConnectable={false} nodesDraggable={!readOnly} minZoom={readOnly?.2:.32} maxZoom={1.35} elementsSelectable selectionOnDrag={!readOnly} panOnDrag={readOnly?true:[1,2]} defaultViewport={viewport} fitView={!effectiveLayout} fitViewOptions={{padding:.16,maxZoom:.88}}
        onInit={instance=>{flowRef.current=instance;if(focusShotRef.current){focusShotRef.current=null;requestAnimationFrame(focusSelection);}}}
        onNodesChange={changes=>setPositionedNodes(current=>applyNodeChanges(changes,current))}
        onSelectionChange={handleSelectionChange}
        onNodeDragStop={(_,node)=>{const next=positionedNodes.map(item=>item.id===node.id?{...item,position:node.position}:item);setPositionedNodes(next);emitLayout(next);}}
        onMoveEnd={(_,nextViewport)=>{setViewport(nextViewport);emitLayout(positionedNodes,nextViewport);}}>
        <Background gap={18} size={1}/><Controls/><MiniMap pannable zoomable/>
      </ReactFlow>
    </div>
    <ProductionCanvasInspector node={selectedNode} shot={selectedShot} workflows={graph.workflow_bindings} items={graph.production_items} pinned={Boolean(activeShotId&&pinnedShotIds.has(activeShotId))} onTogglePin={togglePin}/>
  </section>;
}
