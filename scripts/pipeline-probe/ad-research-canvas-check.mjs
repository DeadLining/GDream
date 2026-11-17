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
const project={id:'ad-canvas-test',name:'广告测试',sources:[],createdAt:1,updatedAt:1,stats:{},status:'draft'};
const data=h.emptyWorkshopData(project.id);data.canvasProjectId='canvas-test';
const ad={productName:'测试产品',productCategory:'physical',audience:['consumer'],objective:'awareness',keyMessage:'',researchMode:'provided-only',productImages:[]};
const imagePath=path.join(root,'reference.png');await fs.writeFile(imagePath,Buffer.from([1]));
ad.materials={fingerprint:JSON.stringify([ad.productName,ad.productCategory,ad.audience,ad.objective,'','provided-only',[]]),mode:'provided-only',preparedAt:1,sources:[],images:[{url:'https://example.test/ref.png',path:imagePath,purpose:'inspiration'}],productImages:[],warnings:[]};
data.creativeSpec={workKind:'product-ad',adSpec:ad};
ws.setState({project,data});ps.setState({activeProjectId:'canvas-test',switching:false,projects:[{id:'canvas-test',aigcProjectId:project.id,name:'画布'}]});
canvas.setState({nodes:[{id:'user-node',type:'text',position:{x:1,y:1},data:{generatedContent:'用户内容'}}],edges:[]});
const tool=h.createDefaultRegistry().get('workshop_publish_ad_research');assert.ok(tool);
const params={sources:[{url:'https://example.test/product',title:'产品资料',content:'已提供的资料内容',reason:'广告卖点参考'}],images:[{url:'https://example.test/ref.png',reason:'场景构图'}]};
let result=await tool.execute(params);assert.equal(result.success,true,result.error);
const firstIds=JSON.parse(result.output).nodeIds;assert.equal(firstIds.length,2);
result=await tool.execute(params);assert.equal(result.success,true,result.error);
assert.deepEqual(JSON.parse(result.output).nodeIds,firstIds);assert.equal(canvas.getState().nodes.length,3);
const readCanvas=async()=>JSON.parse(await fs.readFile(path.join(root,'.gdream/projects/canvas-test/canvas.json'),'utf8'));
assert.equal((await readCanvas()).nodes.length,3);
const saved=JSON.parse(await fs.readFile(path.join(root,'.gdream/aigc-memory/projects/ad-canvas-test/workshop.json'),'utf8'));
assert.equal(saved.creativeSpec.adSpec.materials.sources[0].url,params.sources[0].url);
assert.deepEqual(saved.creativeSpec.adSpec.productImages,[]);assert.deepEqual(canvas.getState().edges,[]);
ps.setState({activeProjectId:'other'});result=await tool.execute(params);assert.equal(result.success,false);assert.equal(canvas.getState().nodes.length,3);
ps.setState({activeProjectId:'canvas-test'});
failCanvasWrite=true;result=await tool.execute({...params,sources:[{...params.sources[0],content:'新的资料摘要'}]});assert.equal(result.success,false,'silent canvas IO failure must not report success');failCanvasWrite=false;
result=await tool.execute({...params,sources:[{...params.sources[0],content:'新的资料摘要'}]});assert.equal(result.success,true,result.error);assert.equal(canvas.getState().nodes.length,3);
result=await tool.execute({images:[{url:'https://example.test/new.png',reason:'新图'}]});assert.equal(result.success,false,'offline mode forbids network download');
const controller=new AbortController();controller.abort();result=await tool.execute(params,controller.signal);assert.equal(result.success,false);
console.log('PASS: actual tool -> project and canvas disk, idempotent retry, original nodes preserved, cross-project guard, offline guard, cancellation, write failure detection; no identity binding/generation');

const beforeFailure=ws.getState().data.creativeSpec.adSpec.materials;
const nodesBeforeFailure=canvas.getState().nodes;
failPrivateWrite=true;
result=await tool.execute({...params,sources:[{...params.sources[0],content:'不得落盘'}]});
assert.equal(result.success,false);assert.equal(ws.getState().data.creativeSpec.adSpec.materials,beforeFailure);
assert.equal(canvas.getState().nodes,nodesBeforeFailure);failPrivateWrite=false;
switchOnRead=()=>ps.setState({activeProjectId:'other'});
result=await tool.execute(params);assert.equal(result.success,false,'switch during save verification must not report success');
ps.setState({activeProjectId:'canvas-test'});
const reopened=await readCanvas();canvas.setState({nodes:reopened.nodes,edges:reopened.edges});
assert.deepEqual(reopened.nodes.filter(n=>n.data.adResearchKey).map(n=>n.id),firstIds);
assert.equal(reopened.nodes.find(n=>n.type==='image').data.localPath,imagePath);
console.log('PASS: workshop write rollback, project switch during readback, persisted node restoration');
