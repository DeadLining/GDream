/** Isolated advertising research canvas persistence regression. No providers or real project writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installShims } from './preload.mjs';
installShims();
window.__TAURI__ = { convertFileSrc: (filePath) => 'asset://' + filePath };
const root=await fs.mkdtemp(path.join(os.tmpdir(),'gdream-ad-canvas-acceptance-'));
let failPrivateWrite=false;
let failCanvasWrite=false;
let switchOnRead;
let failRemoval=false;
globalThis.fetch=async()=>{throw new Error('Network forbidden');};
window.crypto=globalThis.crypto;
window.__TAURI_IPC__=async({callback,error,__tauriModule,message,cmd,path:privatePath,contents})=>{
 try {
  const resolve=(name)=>{const p=path.resolve(root,name);assert.ok(p.startsWith(root+path.sep));return p;};
  if(cmd==='write_text_file_private') {
    if(failPrivateWrite)throw new Error('injected write failure');
    await fs.writeFile(resolve(privatePath),contents,{mode:0o600});
    window[`_${callback}`]();return;
  }
  if (__tauriModule === 'Path') { window[`_${callback}`](root); return; }
  assert.equal(__tauriModule,'Fs');
  let result;
  if(message.cmd==='exists')result=await fs.access(resolve(message.path)).then(()=>true,()=>false);
  else if(message.cmd==='createDir')await fs.mkdir(resolve(message.path),{recursive:true});
  else if(message.cmd==='readTextFile'){result=await fs.readFile(resolve(message.path),'utf8');if(switchOnRead){switchOnRead();switchOnRead=undefined;}}
  else if(message.cmd==='writeFile'){if(failPrivateWrite && message.path.endsWith('/workshop.json'))throw new Error('fixture workshop write failed');if(failCanvasWrite && message.path.endsWith('/canvas.json'))throw new Error('fixture disk full');await fs.writeFile(resolve(message.path),Buffer.from(message.contents));}
  else if(message.cmd==='removeFile'){if(failRemoval)throw new Error('injected removal failure');await fs.rm(resolve(message.path));}
  else if(message.cmd==='renameFile')await fs.rename(resolve(message.oldPath),resolve(message.newPath));
  else throw new Error('Unexpected IPC '+message.cmd);
  window[`_${callback}`](result);
 }catch(e){window[`_${error}`](String(e));}
};
const h=await import('./.gen/harness.mjs');



const ws=h.useWorkshopStore, canvas=h.useCanvasStore, ps=h.useProjectStore;
const project={id:'sync-test',name:'同步测试',sources:[],createdAt:1,updatedAt:1,stats:{},status:'draft'};
const data=h.emptyWorkshopData(project.id);data.canvasProjectId='canvas-test';
data.scenes=[{id:'scene',name:'场景',description:'',assetPrompt:'白色台面',assetImagePath:'/a.png',candidates:[{path:'/a.png',createdAt:1,source:'generate',prompt:'白色台面'}]}];
data.colorPalettes=[];
ws.setState({project,data,loading:false});
canvas.setState({nodes:[{id:'manual',type:'text',position:{x:1,y:2},data:{description:'用户笔记'}}],edges:[]});
ps.setState({activeProjectId:'wrong-project',switching:false});
await h.syncWorkshopLineageToCanvas();assert.equal(canvas.getState().nodes.length,1);
ps.setState({activeProjectId:'canvas-test',switching:false});
await h.syncWorkshopLineageToCanvas();
const first=canvas.getState();assert.equal(first.nodes.length,3);assert.equal(first.edges.length,1);
const asset=first.nodes.find(n=>n.type==='image');assert.equal(asset.data.assetVersions.length,1);
canvas.setState({nodes:first.nodes.map(n=>n.id===asset.id?{...n,position:{x:999,y:777}}:n)});
await h.syncWorkshopLineageToCanvas();
assert.equal(canvas.getState().nodes.length,3);assert.deepEqual(canvas.getState().nodes.find(n=>n.id===asset.id).position,{x:999,y:777});
data.scenes=[{...data.scenes[0],assetImagePath:'/b.png',candidates:[...data.scenes[0].candidates,{path:'/b.png',createdAt:2,source:'generate'}]}];
ws.setState({data:{...data}});await h.syncWorkshopLineageToCanvas();
const updated=canvas.getState().nodes.find(n=>n.id===asset.id);assert.equal(updated.data.assetVersions.length,2);assert.equal(updated.data.adoptedVersionPath,'/b.png');
const disk=JSON.parse(await fs.readFile(path.join(root,'.gdream/projects/canvas-test/canvas.json'),'utf8'));
assert.equal(disk.nodes.find(n=>n.id===asset.id).data.assetVersions.length,2);
assert.equal(disk.nodes.find(n=>n.id==='manual').data.description,'用户笔记');
// Adjacent FL2VA shots reuse one physical boundary image, not one node per usage.
const shot = (id, shotNo, paths) => ({ id, shotNo, description: '', universalVideoPrompt: 'Prompt '+shotNo,
  videoPath: '/'+id+'.mp4', videoCandidates: [{path:'/'+id+'.mp4', createdAt:1,
    productionPacket:{ prompt:'saved prompt',referencePaths:paths,referenceLabels:['当前镜首帧','当前镜尾帧'] }}] });
data.shots=[shot('s1','01-01',['/start.png','/shared.png']),shot('s2','01-02',['/shared.png','/end.png'])];
const legacy=(id,shotId)=>({id,type:'image',position:{x:321,y:654},data:{lineageManaged:true,lineageLabel:'当前镜尾帧',
 localPath:'/shared.png',assetVersions:[{path:'/old-'+id+'.png',createdAt:1}],
 workshopRef:{projectId:project.id,kind:'shot',id:shotId+':extra::/shared.png',role:'prompt-reference',shotId}}});
canvas.setState({nodes:[...canvas.getState().nodes,legacy('old1','s1'),legacy('old2','s2')],
 edges:[...canvas.getState().edges,{id:'manual-edge',source:'old2',target:'manual',label:'用户连线'}],selectedNodeId:'old2'});
ws.setState({data:{...data}});await h.syncWorkshopLineageToCanvas();
let after=canvas.getState();
let shared=after.nodes.filter(n=>n.data.localPath==='/shared.png');
assert.equal(shared.length,1,'same file must have one reference node');
assert.match(shared[0].data.lineageLabel,/01-01.*尾帧.*01-02.*首帧/);
assert.deepEqual(shared[0].position,{x:321,y:654},'manual position retained');
assert.equal(shared[0].data.assetVersions.length,3,'merge both version histories without losing paths');
assert.equal(after.selectedNodeId,shared[0].id,'selected duplicate follows canonical node');
assert.equal(after.edges.find(e=>e.id==='manual-edge').source,shared[0].id);
assert.equal(after.edges.filter(e=>e.source===shared[0].id && e.data?.lineage).length,2);
assert.ok(after.edges.filter(e=>e.source===shared[0].id && e.data?.lineage).every(e=>String(e.data.lineageLabel).includes('01-')));
const stable=JSON.stringify({nodes:after.nodes,edges:after.edges});
await h.syncWorkshopLineageToCanvas();
after=canvas.getState();assert.equal(JSON.stringify({nodes:after.nodes,edges:after.edges}),stable,'sync is idempotent');
const saved=JSON.parse(await fs.readFile(path.join(root,'.gdream/projects/canvas-test/canvas.json'),'utf8'));
assert.equal(saved.nodes.filter(n=>n.data.localPath==='/shared.png').length,1);
assert.ok(saved.edges.every(e=>saved.nodes.some(n=>n.id===e.source)&&saved.nodes.some(n=>n.id===e.target)));
// Persisted historical provenance restores upstream chains and exact video versions.
const ledgerDir=path.join(root,'.gdream/aigc-memory/projects',project.id);
await fs.mkdir(ledgerDir,{recursive:true});
await fs.writeFile(path.join(ledgerDir,'media-provenance.json'),JSON.stringify({records:[
 {sourcePath:'/historical.mp4',outputPath:'/raw.png',operation:'extract',timeSec:1.25,evidence:'capture-receipt'},
 {sourcePath:'/raw.png',outputPath:'/shared.png',operation:'edit',evidence:'processing-receipt'},
]}));
await h.syncWorkshopLineageToCanvas();
let graph=canvas.getState();
let prov=graph.edges.filter(e=>e.data?.relation==='provenance');
assert.equal(prov.length,2);
assert.ok(prov.some(e=>e.data.lineageLabel==='取帧 @1.25s'));
const historical=graph.nodes.find(n=>n.data.localPath==='/historical.mp4');
assert.equal(historical.type,'video');
assert.ok(prov.some(e=>e.source===historical.id));
const beforeAgain=JSON.stringify({nodes:graph.nodes,edges:graph.edges});
await h.syncWorkshopLineageToCanvas();
graph=canvas.getState();assert.equal(JSON.stringify({nodes:graph.nodes,edges:graph.edges}),beforeAgain);
// Actual accepted tails are outputs of that exact video, not replacements for historical inputs.
data.shots[0].acceptedVideoTail={videoPath:'/s1.mp4',framePath:'/actual-last.png',extractionId:'verified-extraction'};
ws.setState({data:{...data}});await h.syncWorkshopLineageToCanvas();
graph=canvas.getState();
const actual=graph.nodes.find(n=>n.data.localPath==='/actual-last.png');
const sourceVideo=graph.nodes.find(n=>n.data.localPath==='/s1.mp4');
assert.ok(actual.position.x > sourceVideo.position.x,'actual frame belongs downstream of source video');
assert.match(actual.data.lineageLabel,/01-01.*实际末帧/);
assert.ok(graph.edges.some(e=>e.source===sourceVideo.id && e.target===actual.id && e.data?.relation==='provenance'));
assert.equal(graph.edges.filter(e=>e.source===actual.id && e.data?.relation!=='provenance').length,0,'never pretend completed next shot consumed a new extraction');
assert.ok(graph.nodes.some(n=>n.data.localPath==='/shared.png'),'historical design input retained');
const stableTail=JSON.stringify({nodes:graph.nodes,edges:graph.edges});
await h.syncWorkshopLineageToCanvas();graph=canvas.getState();
assert.equal(JSON.stringify({nodes:graph.nodes,edges:graph.edges}),stableTail);
// Delayed ledger read must not write stale nodes after a project switch.
switchOnRead=()=>ps.setState({activeProjectId:'elsewhere'});
const beforeSwitch=canvas.getState().nodes;
await h.syncWorkshopLineageToCanvas();assert.equal(canvas.getState().nodes,beforeSwitch);
console.log('PASS: project isolation, versions, reference dedup, numbered usages, manual edges/layout, selection, idempotence and persistence');
process.exit(0);
