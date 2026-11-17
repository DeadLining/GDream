import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFrameComparisons } from './frameComparison.ts';
const nodes = [
 {id:'planned',type:'image',position:{x:0,y:0},data:{localPath:'/planned',generatedImageUrl:'planned',lineageManaged:true}},
 {id:'actual',type:'image',position:{x:600,y:0},data:{localPath:'/actual',generatedImageUrl:'actual',lineageManaged:true}},
 {id:'video',type:'video',position:{x:300,y:0},data:{localPath:'/video'}},
];
const edges = [
 {id:'input',source:'planned',target:'video',data:{lineage:true,lineageLabel:'镜头 02 · 生成输入尾帧',lineageRelation:'video-extra-2'}},
 {id:'extract',source:'video',target:'actual',data:{relation:'provenance',mediaProvenance:{sourcePath:'/video',outputPath:'/actual',operation:'extract',position:'last'}}},
 {id:'next',source:'planned',target:'next-video'},
];
test('groups explicit target/actual pair without altering execution graph',()=>{
 const before=JSON.stringify({nodes,edges});
 const view=projectFrameComparisons(nodes,edges,new Set());
 assert.equal(view.nodes.find(n=>n.id==='planned')?.hidden,true);
 assert.equal(view.nodes.find(n=>n.id==='actual')?.type,'frameComparison');
 assert.equal(view.edges.find(e=>e.id==='input')?.sourceHandle,'planned-out');
 assert.equal(view.edges.find(e=>e.id==='next')?.source,'actual');
 assert.equal(view.edges.find(e=>e.id==='extract')?.targetHandle,undefined);
 assert.equal(JSON.stringify({nodes,edges}),before);
});
test('expand restores original nodes and edge endpoints',()=>{
 const view=projectFrameComparisons(nodes,edges,new Set(['actual']));
 assert.deepEqual(view,{nodes,edges});
});
test('does not guess pairs from appearance, intermediate captures or ambiguous inputs',()=>{
 assert.deepEqual(projectFrameComparisons(nodes,[],new Set()).nodes,nodes);
 const middle=edges.map(e=>e.id==='extract'?{...e,data:{relation:'provenance',mediaProvenance:{sourcePath:'/video',outputPath:'/actual',operation:'extract'}}}:e);
 assert.deepEqual(projectFrameComparisons(nodes,middle,new Set()).nodes,nodes);
 assert.deepEqual(projectFrameComparisons(nodes,[...edges,{...edges[0],id:'extra'}],new Set()).nodes,nodes);
});
test('selected or generating planned inputs stay accessible',()=>{
 for(const extra of [{selected:true},{data:{...nodes[0].data,isGenerating:true}}]) {
  const ns=nodes.map(n=>n.id==='planned'?{...n,...extra}:n);
  assert.deepEqual(projectFrameComparisons(ns,edges,new Set()).nodes,ns);
 }
});
