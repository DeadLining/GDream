import type {EpisodeProductionGraph,ProductionCanvasLayout} from './types';
import ELK from 'elkjs/lib/elk.bundled.js';

export type ProductionCanvasNode={
  id:string;
  type:'scene-group'|'shot'|'asset'|'panel-render'|'dialogue'|'tts'|'video-render'|'visual-review';
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
  sourceHandle?:string;
  targetHandle?:string;
  type:'dependency'|'inheritance'|'shot-order'|'blocked'|'stale';
  data:{lineStyle:'solid'|'dashed';highlighted?:boolean};
};

export const productionNodeId={
  scene:(id:string)=>`scene:${id}`,
  shot:(id:string)=>`shot:${id}`,
  variant:(id:string)=>`asset-variant:${id}`,
  state:(id:string)=>`asset-state:${id}`,
  panelRender:(shotId:string,assetId:string|null)=>`panel-render:${shotId}:${assetId??'pending'}`,
  dialogue:(shotId:string)=>`dialogue:${shotId}`,
  tts:(shotId:string)=>`tts:${shotId}`,
  videoRender:(shotId:string)=>`video-render:${shotId}`,
  visualReview:(shotId:string)=>`visual-review:${shotId}`,
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
    const panelId=productionNodeId.panelRender(shot.id,shot.active_panel_asset_id);
    const dialogueId=productionNodeId.dialogue(shot.id);
    const ttsId=productionNodeId.tts(shot.id);
    const videoId=productionNodeId.videoRender(shot.id);
    const reviewId=productionNodeId.visualReview(shot.id);
    const panelBinding=source.workflow_bindings.find(item=>item.capability==='panel'&&item.enabled);
    const videoBinding=source.workflow_bindings.find(item=>item.capability==='video'&&item.enabled);
    const hasPanel=Boolean(shot.active_panel_asset_id);
    const reviewApproved=shot.review_status==='approved';
    const reviewBlocked=!hasPanel;
	    const videoBlocked=!hasPanel||!reviewApproved;
	    const videoBlockedReason=!hasPanel?'请先生成分镜画面':!reviewApproved?'请先完成视觉审阅':null;
	    nodes.push(
      {id:panelId,type:'panel-render',position:{x:1050,y:80+index*188},data:{shotId:shot.id,shotPosition:shot.position,assetId:shot.active_panel_asset_id,mediaUrl:shot.active_panel_media_url,statusLabel:shot.active_panel_asset_id?'候选已生成':'待生成',executorLabel:panelBinding?'自定义工作流':'默认图片执行器',workflowLabel:panelBinding?`${panelBinding.workflow_id} · v${panelBinding.workflow_version}`:null}},
      {id:reviewId,type:'visual-review',position:{x:1280,y:80+index*188},data:{shotId:shot.id,shotPosition:shot.position,status:shot.review_status,blocked:reviewBlocked,blockedReason:reviewBlocked?'请先生成分镜画面':null,statusLabel:reviewBlocked?'等待画面':reviewApproved?'已通过':'待审阅'}},
      {id:videoId,type:'video-render',position:{x:1510,y:80+index*188},data:{shotId:shot.id,shotPosition:shot.position,assetId:shot.active_video_asset_id,mediaUrl:shot.active_video_media_url,blocked:videoBlocked,blockedReason:videoBlockedReason,statusLabel:shot.active_video_asset_id?'已生成':shot.video_render_status==='running'?'生成中':videoBlocked?'已锁定':'待生成',executorLabel:videoBinding?'自定义工作流':'默认视频执行器',workflowLabel:videoBinding?`${videoBinding.workflow_id} · v${videoBinding.workflow_version}`:null}},
      {id:dialogueId,type:'dialogue',position:{x:1050,y:208+index*188},data:{shotId:shot.id,shotPosition:shot.position,statusLabel:shot.dialogue_count?`${shot.dialogue_count} 条对白`:'无对白',detail:shot.dialogue_count?'台词、情绪与说话角色':'当前镜头没有对白'}},
      {id:ttsId,type:'tts',position:{x:1280,y:208+index*188},data:{shotId:shot.id,shotPosition:shot.position,complete:Boolean(shot.dialogue_count&&shot.speech_ready_count===shot.dialogue_count),statusLabel:shot.dialogue_count?`${shot.speech_ready_count??0} / ${shot.dialogue_count}`:'无需生成',executorLabel:'Qwen TTS'}},
    );
    const shotId=productionNodeId.shot(shot.id);
    edges.push(
      {id:`dependency:${shotId}:${panelId}`,source:shotId,target:panelId,sourceHandle:'production-main',targetHandle:'production-main',type:'dependency',data:{lineStyle:'solid'}},
      {id:`${reviewBlocked?'blocked':'dependency'}:${panelId}:${reviewId}`,source:panelId,target:reviewId,sourceHandle:'production-main',targetHandle:'production-main',type:reviewBlocked?'blocked':'dependency',data:{lineStyle:reviewBlocked?'dashed':'solid'}},
      {id:`${videoBlocked?'blocked':'dependency'}:${reviewId}:${videoId}`,source:reviewId,target:videoId,sourceHandle:'production-main',targetHandle:'production-main',type:videoBlocked?'blocked':'dependency',data:{lineStyle:videoBlocked?'dashed':'solid'}},
      {id:`dependency:${shotId}:${dialogueId}`,source:shotId,target:dialogueId,sourceHandle:'dialogue-branch',targetHandle:'production-main',type:'dependency',data:{lineStyle:'solid'}},
      {id:`dependency:${dialogueId}:${ttsId}`,source:dialogueId,target:ttsId,sourceHandle:'production-main',targetHandle:'production-main',type:'dependency',data:{lineStyle:'solid'}},
    );
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
  if(['panel-render','dialogue','tts','video-render','visual-review'].includes(type))return {width:188,height:112};
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
