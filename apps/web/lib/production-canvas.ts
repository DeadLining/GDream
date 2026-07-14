import type {EpisodeProductionGraph,ProductionCanvasLayout} from './types';
import ELK from 'elkjs/lib/elk.bundled.js';

export type ProductionCanvasNode={
  id:string;
  type:'scene-group'|'shot'|'asset'|'panel'|'speech-task'|'video-task'|'review';
  position:{x:number;y:number};
  parentId?:string;
  extent?:'parent';
  style?:Record<string,string|number>;
  data:Record<string,unknown>;
};

export type ProductionCanvasEdge={
  id:string;
  source:string;
  target:string;
  type:'dependency'|'inheritance'|'shot-order'|'blocked'|'stale';
  data:{lineStyle:'solid'|'dashed';highlighted?:boolean};
};

export const productionNodeId={
  scene:(id:string)=>`scene:${id}`,
  shot:(id:string)=>`shot:${id}`,
  variant:(id:string)=>`asset-variant:${id}`,
  state:(id:string)=>`asset-state:${id}`,
  panel:(shotId:string,assetId:string|null)=>`panel:${shotId}:${assetId??'pending'}`,
  speech:(shotId:string)=>`speech:${shotId}`,
  video:(shotId:string)=>`video:${shotId}`,
  review:(shotId:string)=>`review:${shotId}`,
};

export function buildProductionCanvasGraph(
  source:EpisodeProductionGraph,
  options:{selectedShotId:string|null;expandedShotIds?:string[];collapsedSceneIds?:string[]},
):{nodes:ProductionCanvasNode[];edges:ProductionCanvasEdge[]}{
  const nodes:ProductionCanvasNode[]=[];
  const edges:ProductionCanvasEdge[]=[];
  const expanded=new Set(options.expandedShotIds??[]);
  const collapsedScenes=new Set(options.collapsedSceneIds??[]);
  if(options.selectedShotId)expanded.add(options.selectedShotId);

  source.scenes.forEach((scene)=>{
    const shotCount=source.shots.filter(shot=>shot.scene_id===scene.id).length;
    const collapsed=collapsedScenes.has(scene.id);
    const columns=Math.min(2,Math.max(1,shotCount));
    const rows=Math.max(1,Math.ceil(shotCount/columns));
    const width=collapsed?348:Math.max(456,48+columns*204);
    const height=collapsed?68:78+rows*136;
    nodes.push({id:productionNodeId.scene(scene.id),type:'scene-group',position:{x:320,y:80},style:{width,height},data:{...scene,shotCount,width,height,collapsed}});
  });
  source.shots.forEach((shot)=>{
    if(collapsedScenes.has(shot.scene_id))return;
    const sceneShots=source.shots.filter(item=>item.scene_id===shot.scene_id);
    const index=sceneShots.findIndex(item=>item.id===shot.id);
    const columns=Math.min(2,Math.max(1,sceneShots.length));
    nodes.push({id:productionNodeId.shot(shot.id),type:'shot',parentId:productionNodeId.scene(shot.scene_id),extent:'parent',position:{x:24+(index%columns)*204,y:58+Math.floor(index/columns)*136},data:{...shot}});
    if(!expanded.has(shot.id))return;
    const panelId=productionNodeId.panel(shot.id,shot.active_panel_asset_id);
    const speechId=productionNodeId.speech(shot.id);
    const videoId=productionNodeId.video(shot.id);
    const reviewId=productionNodeId.review(shot.id);
    nodes.push(
      {id:panelId,type:'panel',position:{x:920,y:80+index*148},data:{shotId:shot.id,assetId:shot.active_panel_asset_id,mediaUrl:shot.active_panel_media_url}},
      {id:speechId,type:'speech-task',position:{x:1420,y:32+index*184},data:{shotId:shot.id,complete:Boolean(shot.dialogue_count&&shot.speech_ready_count===shot.dialogue_count),statusLabel:shot.dialogue_count?`${shot.speech_ready_count??0} / ${shot.dialogue_count}`:'无对白'}},
      {id:videoId,type:'video-task',position:{x:1420,y:144+index*184},data:{shotId:shot.id,assetId:shot.active_video_asset_id,mediaUrl:shot.active_video_media_url}},
      {id:reviewId,type:'review',position:{x:1720,y:80+index*184},data:{shotId:shot.id,status:shot.review_status}},
    );
    const chain:Array<[string,string]>=[[productionNodeId.shot(shot.id),panelId],[panelId,speechId],[panelId,videoId],[speechId,reviewId],[videoId,reviewId]];
    chain.forEach(([sourceId,targetId])=>edges.push({id:`dependency:${sourceId}:${targetId}`,source:sourceId,target:targetId,type:'dependency',data:{lineStyle:'solid'}}));
  });
  source.assets.forEach((asset,index)=>{
    const id=asset.kind==='state'?productionNodeId.state(asset.id):productionNodeId.variant(asset.id);
    nodes.push({id,type:'asset',position:{x:40,y:80+index*168},data:{...asset}});
    asset.shot_ids.forEach(shotId=>{
      const target=productionNodeId.shot(shotId);
      if(nodes.some(node=>node.id===target))edges.push({id:`dependency:${id}:${shotId}`,source:id,target,type:'dependency',data:{lineStyle:'solid'}});
    });
  });
  return {nodes,edges};
}

export function mergeSavedProductionLayout(nodes:ProductionCanvasNode[],saved:ProductionCanvasLayout|null):ProductionCanvasNode[]{
  return nodes.map(node=>saved?.nodes[node.id]?{...node,position:saved.nodes[node.id]}:node);
}

export function highlightProductionGraph(nodes:ProductionCanvasNode[],edges:ProductionCanvasEdge[],selectedNodeId:string|null){
  const connected=new Set<string>(selectedNodeId?[selectedNodeId]:[]);
  const queue=selectedNodeId?[selectedNodeId]:[];
  while(queue.length){
    const current=queue.shift()!;
    for(const edge of edges){
      if(edge.source!==current&&edge.target!==current)continue;
      const next=edge.source===current?edge.target:edge.source;
      if(!connected.has(next)){connected.add(next);queue.push(next);}
    }
  }
  return {
    nodes:nodes.map(node=>({...node,data:{...node.data,dimmed:Boolean(selectedNodeId&&!connected.has(node.id))}})),
    edges:edges.map(edge=>({...edge,animated:false,data:{...edge.data,highlighted:Boolean(selectedNodeId&&connected.has(edge.source)&&connected.has(edge.target))}})),
  };
}

const nodeSize=(type:ProductionCanvasNode['type'])=>{
  if(type==='scene-group')return {width:456,height:214};
  if(type==='asset')return {width:184,height:142};
  if(type==='shot')return {width:180,height:116};
  return {width:152,height:92};
};

export async function layoutProductionGraph(
  nodes:ProductionCanvasNode[],
  edges:ProductionCanvasEdge[],
  saved:ProductionCanvasLayout|null,
):Promise<ProductionCanvasNode[]>{
  const elk=new ELK();
  const scenes=new Map(nodes.filter(node=>node.type==='scene-group').map(node=>[node.id,node]));
  const roots=nodes.filter(node=>!node.parentId);
  const rootId=(id:string)=>nodes.find(node=>node.id===id)?.parentId??id;
  const rootEdges=new Map<string,{id:string;sources:string[];targets:string[]}>();
  for(const edge of edges){
    const source=rootId(edge.source);
    const target=rootId(edge.target);
    if(source===target)continue;
    const id=`layout:${source}:${target}`;
    rootEdges.set(id,{id,sources:[source],targets:[target]});
  }
  const result=await elk.layout({
    id:'production-root',
    layoutOptions:{
      'elk.algorithm':'layered',
      'elk.direction':'RIGHT',
      'elk.spacing.nodeNode':'36',
      'elk.layered.spacing.nodeNodeBetweenLayers':'64',
      'elk.edgeRouting':'ORTHOGONAL',
    },
    children:roots.map(node=>({
      id:node.id,
      ...(node.type==='scene-group'
        ? {width:Number(node.style?.width??456),height:Number(node.style?.height??214)}
        : nodeSize(node.type)),
    })),
    edges:[...rootEdges.values()],
  });
  const positions=new Map((result.children??[]).map(node=>[node.id,{x:node.x??0,y:node.y??0}]));
  const sceneDeltas=new Map<string,number>();
  let sceneY=12;
  for(const scene of [...scenes.values()].sort((a,b)=>Number(a.data.position)-Number(b.data.position))){
    const previous=positions.get(scene.id)??scene.position;
    positions.set(scene.id,{x:previous.x,y:sceneY});
    sceneDeltas.set(String(scene.data.id),sceneY-previous.y);
    sceneY+=Number(scene.style?.height??214)+36;
  }
  const shotScenes=new Map(nodes.filter(node=>node.type==='shot').map(node=>[String(node.data.id),String(node.data.scene_id)]));
  for(const node of roots){
    const shotId=String(node.data.shotId??'');
    const sceneId=shotScenes.get(shotId);
    const delta=sceneId?sceneDeltas.get(sceneId):undefined;
    const position=positions.get(node.id);
    if(delta!==undefined&&position)positions.set(node.id,{x:position.x,y:position.y+delta});
  }
  const automatic=nodes.map(node=>{
    if(node.parentId&&scenes.has(node.parentId))return node;
    return positions.has(node.id)?{...node,position:positions.get(node.id)!}:node;
  });
  return mergeSavedProductionLayout(automatic,saved);
}
