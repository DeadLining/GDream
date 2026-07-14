import {describe,expect,it} from 'vitest';

import {buildProductionCanvasGraph,highlightProductionGraph,layoutProductionGraph,mergeSavedProductionLayout} from '../lib/production-canvas';
import type {EpisodeProductionGraph,ProductionCanvasLayout} from '../lib/types';

const fixture:EpisodeProductionGraph={
  episode_id:'episode-1',project_id:'project-1',
  scenes:[
    {id:'scene-1',position:1,location:'庭院',summary:'相遇'},
    {id:'scene-2',position:2,location:'正厅',summary:'冲突'},
  ],
  shots:[
    {id:'shot-1',scene_id:'scene-1',position:1,shot_type:'中景',duration_seconds:4,composition:'入场',review_status:'draft',render_status:'ready',video_render_status:'pending',active_panel_asset_id:'panel-1',active_panel_media_url:'/media/panel-1.png',active_video_asset_id:null,active_video_media_url:null},
    {id:'shot-2',scene_id:'scene-1',position:2,shot_type:'近景',duration_seconds:3,composition:'反应',review_status:'draft',render_status:'ready',video_render_status:'pending',active_panel_asset_id:'panel-2',active_panel_media_url:'/media/panel-2.png',active_video_asset_id:null,active_video_media_url:null,dialogue_ids:['line-1','line-2'],dialogue_count:2,speech_ready_count:1},
    {id:'shot-3',scene_id:'scene-2',position:1,shot_type:'全景',duration_seconds:5,composition:'对峙',review_status:'draft',render_status:'pending',video_render_status:'pending',active_panel_asset_id:null,active_panel_media_url:null,active_video_asset_id:null,active_video_media_url:null},
  ],
  assets:[{id:'variant-1',kind:'variant',label:'主造型',media_url:null,version:1,status:'approved',shot_ids:['shot-1','shot-2']}],
  production_items:[],media_dependencies:[],workflow_bindings:[],
};

describe('production canvas graph',()=>{
  it('keeps all shots as peer nodes inside scene frames',()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    expect(graph.nodes.filter(node=>node.type==='shot').map(node=>node.id)).toEqual(['shot:shot-1','shot:shot-2','shot:shot-3']);
    expect(graph.nodes.find(node=>node.id==='shot:shot-2')?.parentId).toBe('scene:scene-1');
  });

  it('expands media nodes only for the selected shot',()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    expect(graph.nodes.some(node=>node.id==='panel:shot-2:panel-2')).toBe(true);
    expect(graph.nodes.some(node=>node.id.startsWith('panel:shot-1:'))).toBe(false);
    expect(graph.nodes.find(node=>node.id==='panel:shot-2:panel-2')?.data.mediaUrl).toBe('/media/panel-2.png');
    expect(graph.nodes.find(node=>node.id==='speech:shot-2')?.data.statusLabel).toBe('1 / 2');
    expect(graph.nodes.find(node=>node.id==='speech:shot-2')?.data.complete).toBe(false);
  });

  it('collapses a scene without changing the peer hierarchy of other scenes',()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:null,collapsedSceneIds:['scene-1']});
    expect(graph.nodes.find(node=>node.id==='scene:scene-1')?.data.collapsed).toBe(true);
    expect(graph.nodes.some(node=>node.id==='shot:shot-1')).toBe(false);
    expect(graph.nodes.some(node=>node.id==='shot:shot-2')).toBe(false);
    expect(graph.nodes.find(node=>node.id==='shot:shot-3')?.parentId).toBe('scene:scene-2');
  });

  it('fans a shared asset out to every authoritative shot usage',()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    expect(graph.edges.filter(edge=>edge.source==='asset-variant:variant-1').map(edge=>edge.target).sort()).toEqual(['shot:shot-1','shot:shot-2']);
  });

  it('merges saved positions without dropping new nodes',()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:null});
    const saved:ProductionCanvasLayout={version:3,viewport:{x:0,y:0,zoom:.75},nodes:{'shot:shot-1':{x:420,y:160}},expanded_shots:[],pinned_shots:[],collapsed_scene_ids:[]};
    const merged=mergeSavedProductionLayout(graph.nodes,saved);
    expect(merged.find(node=>node.id==='shot:shot-1')?.position).toEqual({x:420,y:160});
    expect(merged.find(node=>node.id==='shot:shot-2')).toBeDefined();
  });

  it('highlights the complete connected production chain',()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    const highlighted=highlightProductionGraph(graph.nodes,graph.edges,'shot:shot-2');
    expect(highlighted.nodes.find(node=>node.id==='review:shot-2')?.data.dimmed).toBe(false);
    expect(highlighted.nodes.find(node=>node.id==='shot:shot-3')?.data.dimmed).toBe(true);
  });

  it('auto-places new nodes while preserving saved positions',async()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    const saved:ProductionCanvasLayout={version:3,viewport:{x:0,y:0,zoom:.75},nodes:{'shot:shot-1':{x:420,y:160}},expanded_shots:[],pinned_shots:[],collapsed_scene_ids:[]};
    const laidOut=await layoutProductionGraph(graph.nodes,graph.edges,saved);
    expect(laidOut.find(node=>node.id==='shot:shot-1')?.position).toEqual({x:420,y:160});
    expect(laidOut.find(node=>node.id==='shot:shot-2')?.position.x).toBeGreaterThanOrEqual(0);
  });

  it('lays shot positions out relative to their scene frame',async()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    const laidOut=await layoutProductionGraph(graph.nodes,graph.edges,null);
    const scene=laidOut.find(node=>node.id==='scene:scene-1')!;
    const shots=laidOut.filter(node=>node.parentId===scene.id);
    expect(shots).toHaveLength(2);
    for(const shot of shots){
      expect(shot.position.x).toBeGreaterThanOrEqual(24);
      expect(shot.position.x).toBeLessThan(680-220);
      expect(shot.position.y).toBeGreaterThanOrEqual(48);
      expect(shot.position.y).toBeLessThan(520-132);
    }
  });

  it('keeps scene frames in authoritative episode order',async()=>{
    const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
    const laidOut=await layoutProductionGraph(graph.nodes,graph.edges,null);
    const first=laidOut.find(node=>node.id==='scene:scene-1')!;
    const second=laidOut.find(node=>node.id==='scene:scene-2')!;
    expect(first.position.y).toBeLessThan(second.position.y);
  });
});
