'use client';

import {applyNodeChanges,Background,Controls,MiniMap,ReactFlow,type ReactFlowInstance} from '@xyflow/react';
import {Image as ImageIcon,Library,Moon,Network,PanelRight,Sun} from 'lucide-react';
import {useEffect,useMemo,useRef,useState} from 'react';

import {buildProductionCanvasGraph,highlightProductionGraph,layoutProductionGraph,productionNodeId,type ProductionCanvasNode} from '../../lib/production-canvas';
import type {EpisodeProductionGraph,ProductionCanvasLayout} from '../../lib/types';
import {AssetNode} from './nodes/AssetNode';
import {DomainNode} from './nodes/DomainNode';
import {SceneGroupNode} from './nodes/SceneGroupNode';
import {ShotNode} from './nodes/ShotNode';
import {ProductionCanvasInspector} from './ProductionCanvasInspector';
import {ProductionCanvasToolbar} from './ProductionCanvasToolbar';
import type {ProductionMediaMode} from './ProductionMediaWorkspace';

const nodeTypes={'scene-group':SceneGroupNode,shot:ShotNode,asset:AssetNode,'panel-render':DomainNode,dialogue:DomainNode,tts:DomainNode,'video-render':DomainNode,'visual-review':DomainNode};
type ProductionCanvasView='overview'|'focus'|'assets';
type ProductionCanvasTheme='dark'|'cream';

function shotNumber(shot:{position:number}|null){return String(shot?.position??0).padStart(2,'0');}

function ProductionCanvasChrome({view,onView,theme,onTheme,selectedShot,sceneCount,shotCount,assetCount,assetShotCount,inspectorOpen,onInspector}:{view:ProductionCanvasView;onView:(view:ProductionCanvasView)=>void;theme:ProductionCanvasTheme;onTheme:()=>void;selectedShot:EpisodeProductionGraph['shots'][number]|null;sceneCount:number;shotCount:number;assetCount:number;assetShotCount:number;inspectorOpen:boolean;onInspector:()=>void}){
  const modes:Array<{id:ProductionCanvasView;label:string;icon:typeof Network;requiresShot?:boolean}>=[
    {id:'overview',label:'整集画布',icon:Network},
    {id:'focus',label:'镜头聚焦',icon:ImageIcon,requiresShot:true},
    {id:'assets',label:'资产关系',icon:Library},
  ];
  const title=view==='assets'
    ? `${assetCount} 项资产 · ${assetShotCount} 个引用镜头`
    : view==='overview'
      ? `本集 · ${sceneCount} 个场景 · ${shotCount} 个镜头`
      : selectedShot?`镜头 ${shotNumber(selectedShot)} · ${selectedShot.shot_type}`:'请选择镜头';
  return <>
    <header className="production-canvas-chrome">
      <div><span>EPISODE PRODUCTION GRAPH</span><strong>{title}</strong></div>
      <nav aria-label="生产画布视图">
        {modes.map(({id,label,icon:Icon,requiresShot})=><button key={id} type="button" aria-pressed={view===id} disabled={Boolean(requiresShot&&!selectedShot)} onClick={()=>onView(id)}><Icon size={13}/>{label}</button>)}
      </nav>
      <button className="production-theme-toggle" type="button" aria-label={inspectorOpen?'关闭节点检查器':'打开节点检查器'} title={inspectorOpen?'关闭节点检查器':'打开节点检查器'} onClick={onInspector}><PanelRight size={15}/></button>
      <button className="production-theme-toggle" type="button" aria-label={theme==='dark'?'切换为奶白画布':'切换为暗色画布'} title={theme==='dark'?'切换为奶白画布':'切换为暗色画布'} onClick={onTheme}>{theme==='dark'?<Sun size={15}/>:<Moon size={15}/>}</button>
    </header>
  </>;
}

export function ProductionCanvas({graph,layout,selectedShotId,onSelectShot,onLayoutChange,onSelectedShotIdsChange,onOpenVisualReview,onOpenDialogue,onOpenMedia}:{graph:EpisodeProductionGraph;layout?:ProductionCanvasLayout|null;selectedShotId:string|null;onSelectShot:(id:string)=>void;onLayoutChange?:(layout:ProductionCanvasLayout)=>void;onSelectedShotIdsChange?:(shotIds:string[])=>void;onOpenVisualReview?:(shotId:string)=>void;onOpenDialogue?:(shotId:string)=>void;onOpenMedia?:(shotId:string,mode:ProductionMediaMode)=>void}){
  const effectiveLayout=layout?.version===3?layout:null;
  const restoredShotId=selectedShotId??effectiveLayout?.expanded_shots[0]??null;
  const [activeShotId,setActiveShotId]=useState(restoredShotId);
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(restoredShotId?productionNodeId.shot(restoredShotId):null);
  const [pinnedShotIds,setPinnedShotIds]=useState(()=>new Set(effectiveLayout?.pinned_shots??[]));
  const [collapsedSceneIds,setCollapsedSceneIds]=useState(()=>new Set(effectiveLayout?.collapsed_scene_ids??[]));
  const [positionedNodes,setPositionedNodes]=useState<any[]>([]);
  const [viewport,setViewport]=useState(effectiveLayout?.viewport??{x:0,y:0,zoom:.75});
  const [readOnly,setReadOnly]=useState(false);
  const [compact,setCompact]=useState(false);
  const [canvasView,setCanvasView]=useState<ProductionCanvasView>('overview');
  const [canvasTheme,setCanvasTheme]=useState<ProductionCanvasTheme>('dark');
  const [inspectorOpen,setInspectorOpen]=useState(true);
  const undoNodes=useRef<any[]|null>(null);
  const flowRef=useRef<ReactFlowInstance<any,any>|null>(null);
  const focusShotRef=useRef<string|null>(null);
  const selectionSignatureRef=useRef<string|null>(null);

  useEffect(()=>{
    if(!selectedShotId)return;
    if(activeShotId===selectedShotId)return;
    setActiveShotId(selectedShotId);
    setSelectedNodeId(productionNodeId.shot(selectedShotId));
  },[selectedShotId,activeShotId]);
  useEffect(()=>{
    setViewport(effectiveLayout?.viewport??{x:0,y:0,zoom:.75});
    setPinnedShotIds(new Set(effectiveLayout?.pinned_shots??[]));
    setCollapsedSceneIds(new Set(effectiveLayout?.collapsed_scene_ids??[]));
    const restored=selectedShotId??effectiveLayout?.expanded_shots[0]??null;
    setActiveShotId(restored);
    setSelectedNodeId(restored?productionNodeId.shot(restored):null);
    selectionSignatureRef.current=null;
  },[graph.episode_id]);
  useEffect(()=>{
    if(typeof window==='undefined'||!window.matchMedia)return;
    const readOnlyQuery=window.matchMedia('(max-width: 700px)');
    const compactQuery=window.matchMedia('(max-width: 1023px)');
    const update=()=>{
      setReadOnly(readOnlyQuery.matches);
      setCompact(compactQuery.matches);
      if(compactQuery.matches)setInspectorOpen(false);
    };
    update();
    readOnlyQuery.addEventListener('change',update);
    compactQuery.addEventListener('change',update);
    return()=>{
      readOnlyQuery.removeEventListener('change',update);
      compactQuery.removeEventListener('change',update);
    };
  },[]);
  useEffect(()=>{
    const saved=localStorage.getItem('ai-comic-production-canvas-theme');
    if(saved==='dark'||saved==='cream')setCanvasTheme(saved);
  },[]);

  const built=useMemo(()=>buildProductionCanvasGraph(graph,{
    selectedShotId:activeShotId,
    expandedShotIds:[...pinnedShotIds],
    collapsedSceneIds:[...collapsedSceneIds],
  }),[graph,activeShotId,pinnedShotIds,collapsedSceneIds]);
  const highlighted=useMemo(()=>highlightProductionGraph(built.nodes,built.edges,selectedNodeId),[built,selectedNodeId]);
  const selectedShot=graph.shots.find(shot=>shot.id===activeShotId)??null;
  const selectedNode=built.nodes.find(node=>node.id===selectedNodeId)??(activeShotId?built.nodes.find(node=>node.id===productionNodeId.shot(activeShotId)):null)??null;
  const relatedAssets=useMemo(()=>graph.assets.filter(asset=>asset.shot_ids.some(shotId=>graph.shots.some(shot=>shot.id===shotId))),[graph.assets,graph.shots]);
  const assetShotIds=useMemo(()=>new Set(relatedAssets.flatMap(asset=>asset.shot_ids)),[relatedAssets]);
  const assetSceneIds=useMemo(()=>new Set(graph.shots.filter(shot=>assetShotIds.has(shot.id)).map(shot=>shot.scene_id)),[graph.shots,assetShotIds]);

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
    setInspectorOpen(Boolean(node.data.blocked)||!compact);
    if(node.type==='scene-group'||node.type==='asset')return;
    const shotId=node.type==='shot'?node.id.slice(5):String(node.data.shotId??'');
    if(!shotId)return;
    focusShotRef.current=shotId;
    setActiveShotId(shotId);
    onSelectShot(shotId);
    if(node.type==='visual-review'&&!node.data.blocked)onOpenVisualReview?.(shotId);
    if(node.type==='dialogue'||node.type==='tts')onOpenDialogue?.(shotId);
    if(node.type==='panel-render')onOpenMedia?.(shotId,'panel');
    if(node.type==='video-render'&&!node.data.blocked)onOpenMedia?.(shotId,'video');
  };
  const visibleNodeIds=useMemo(()=>{
    if(canvasView==='overview')return new Set(positionedNodes.map(node=>node.id));
    if(canvasView==='focus'){
      if(!activeShotId)return new Set<string>();
      return new Set(positionedNodes.filter(node=>
        (node.type==='shot'&&node.data.id===activeShotId)
        ||(node.type==='asset'&&Array.isArray(node.data.shot_ids)&&node.data.shot_ids.includes(activeShotId))
        ||String(node.data.shotId??'')===activeShotId,
      ).map(node=>node.id));
    }
    return new Set(positionedNodes.filter(node=>
      (node.type==='asset'&&relatedAssets.some(asset=>asset.id===node.data.id))
      ||(node.type==='shot'&&assetShotIds.has(String(node.data.id)))
      ||(node.type==='scene-group'&&assetSceneIds.has(String(node.data.id))),
    ).map(node=>node.id));
  },[canvasView,positionedNodes,activeShotId,graph.shots,relatedAssets,assetShotIds,assetSceneIds]);
  const renderNodes=useMemo(()=>positionedNodes.map(node=>{
    const focusRoot=canvasView==='focus'&&node.type==='shot'&&node.data.id===activeShotId;
    return {
      ...node,
      ...(focusRoot?{parentId:undefined,extent:undefined}:{}),
      hidden:!visibleNodeIds.has(node.id),
      className:[node.data.dimmed?'production-node-dimmed':'',node.id===selectedNodeId?'production-node-selected':''].filter(Boolean).join(' '),
      data:{
        ...node.data,
        zoom:viewport.zoom,
        onSelect:()=>selectNode(node),
        onToggleCollapse:node.type==='scene-group'?()=>toggleScene(String(node.data.id)):undefined,
      },
    };
  }),[positionedNodes,visibleNodeIds,canvasView,activeShotId,selectedNodeId,viewport.zoom,readOnly]);
  const renderEdges=useMemo(()=>highlighted.edges.map(edge=>({
    ...edge,
    hidden:!visibleNodeIds.has(edge.source)||!visibleNodeIds.has(edge.target),
    type:'smoothstep',
    className:edge.type==='blocked'?'production-edge-blocked':edge.data.lineStyle==='dashed'?'production-edge-optional':'',
    style:{stroke:edge.data.highlighted?'var(--color-accent-strong)':edge.type==='blocked'?'var(--color-danger)':'var(--color-line-strong)',strokeWidth:edge.data.highlighted?2.4:1.4,strokeDasharray:edge.data.lineStyle==='dashed'?'6 5':'none'},
  })),[highlighted.edges,visibleNodeIds]);

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
  const focusAssets=()=>{
    if(!flowRef.current)return;
    const nodes=positionedNodes.filter(node=>
      (node.type==='asset'&&relatedAssets.some(asset=>asset.id===node.data.id))
      ||(node.type==='shot'&&assetShotIds.has(String(node.data.id)))
      ||(node.type==='scene-group'&&assetSceneIds.has(String(node.data.id))),
    ).map(node=>({id:node.id}));
    if(nodes.length)void flowRef.current.fitView({nodes,padding:.24,maxZoom:.95,duration:260});
  };
  const fitAll=()=>{if(flowRef.current)void flowRef.current.fitView({padding:.16,maxZoom:.88,duration:260});};
  const switchView=(next:ProductionCanvasView)=>{
    if(next==='focus'&&!selectedShot)return;
    setCanvasView(next);
    if(next==='overview')requestAnimationFrame(fitAll);
    if(next==='focus')requestAnimationFrame(focusSelection);
    if(next==='assets')requestAnimationFrame(focusAssets);
  };
  const toggleTheme=()=>{
    const next:ProductionCanvasTheme=canvasTheme==='dark'?'cream':'dark';
    setCanvasTheme(next);
    localStorage.setItem('ai-comic-production-canvas-theme',next);
  };
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
    const signature=shotIds.join('|');
    if(selectionSignatureRef.current===signature)return;
    selectionSignatureRef.current=signature;
    onSelectedShotIdsChange(shotIds);
  };

  return <section className={`production-canvas-shell production-canvas-shell-v2 view-${canvasView} ${canvasView==='assets'&&!relatedAssets.length?'assets-empty':''} ${inspectorOpen?'inspector-open':''}`}>
    <div className="production-canvas production-canvas-v2" role="region" aria-label="单集生产画布" data-canvas-theme={canvasTheme} data-canvas-view={canvasView}>
      <ProductionCanvasChrome view={canvasView} onView={switchView} theme={canvasTheme} onTheme={toggleTheme} selectedShot={selectedShot} sceneCount={graph.scenes.length} shotCount={graph.shots.length} assetCount={relatedAssets.length} assetShotCount={assetShotIds.size} inspectorOpen={inspectorOpen} onInspector={()=>setInspectorOpen(value=>!value)}/>
      <ProductionCanvasToolbar onLayout={()=>void autoLayout()} onUndo={undoLayout} canUndo={Boolean(undoNodes.current)} onFitAll={fitAll} onFocusSelection={focusSelection} canFocus={Boolean(activeShotId)}/>
      <div className="production-flow-layer">
      <ReactFlow key={topologySignature} nodes={renderNodes} edges={renderEdges as any} nodeTypes={nodeTypes as any} nodesConnectable={false} nodesDraggable={!readOnly} minZoom={readOnly?.2:.32} maxZoom={1.35} elementsSelectable selectionOnDrag={!readOnly} panOnDrag={readOnly?true:[1,2]} defaultViewport={viewport} fitView={!effectiveLayout} fitViewOptions={{padding:.22,maxZoom:.78}}
        onInit={instance=>{flowRef.current=instance;if(focusShotRef.current){focusShotRef.current=null;requestAnimationFrame(focusSelection);}}}
        onNodesChange={changes=>setPositionedNodes(current=>applyNodeChanges(changes,current))}
        onSelectionChange={handleSelectionChange}
        onNodeDragStop={(_,node)=>{const next=positionedNodes.map(item=>item.id===node.id?{...item,position:node.position}:item);setPositionedNodes(next);emitLayout(next);}}
        onMoveEnd={(_,nextViewport)=>{setViewport(nextViewport);emitLayout(positionedNodes,nextViewport);}}>
        <Background gap={18} size={1}/><Controls/><MiniMap pannable zoomable/>
      </ReactFlow>
      </div>
      {canvasView==='assets'&&!relatedAssets.length&&<section className="production-view-empty" role="status" aria-label="资产关系状态"><Library size={22}/><strong>尚未建立资产与镜头的使用关系</strong><span>在资产库确认变体或状态，并绑定镜头后，关系会显示在这里。</span></section>}
    </div>
    {inspectorOpen&&<ProductionCanvasInspector node={selectedNode} shot={selectedShot} workflows={graph.workflow_bindings} items={graph.production_items} pinned={Boolean(activeShotId&&pinnedShotIds.has(activeShotId))} onTogglePin={togglePin} onOpenVisualReview={()=>{if(activeShotId)onOpenVisualReview?.(activeShotId);}} onOpenDialogue={()=>{if(activeShotId)onOpenDialogue?.(activeShotId);}} onOpenMedia={mode=>{if(activeShotId)onOpenMedia?.(activeShotId,mode);}}/>}
  </section>;
}
