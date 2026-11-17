/** Isolated stage continuation regression. No providers or real project writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installShims } from './preload.mjs';
installShims();
window.__TAURI__ = { convertFileSrc: (filePath) => 'asset://' + filePath };
const root=await fs.mkdtemp(path.join(os.tmpdir(),'gdream-continuation-acceptance-'));
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


const ws=h.useWorkshopStore, unified=h.useUnifiedProjectStore, chat=h.useChatStore, tasks=h.useCanvasTaskStore;
const owner={projectId:'continuation-test',unifiedId:'continuation-test'};
const project={id:owner.projectId,name:'续做测试',sources:[],createdAt:1,updatedAt:1,stats:{},status:'draft'};
const data=h.emptyWorkshopData(project.id);
data.shots=[{shotNo:'01-01',description:'产品',characterIds:[],durationSec:5}];
ws.setState({project,data});unified.setState({activeId:owner.unifiedId});tasks.setState({tasks:[]});
chat.setState({currentSessionId:'s',sessions:[{id:'s',projectId:owner.unifiedId,name:'项目会话'}],streamingPhase:'idle',error:null});
const emitted=[];
const send=async prompt=>{
  const id=h.useRunStepStore.getState().startRun({sessionId:'s',userRequest:prompt,projectId:owner.unifiedId});
  emitted.push(prompt);
  if(prompt.includes('· prompts】')) {
    const old=ws.getState().data;
    ws.setState({data:{...old,shots:old.shots.map(s=>({...s,imagePrompt:'产品画面',videoPrompt:'产品运动'}))}});
  } else {
    tasks.setState({tasks:[{id:'job-existing',projectId:project.id,status:'running'}]});
  }
  h.useRunStepStore.getState().finishRun('done',id);
};
let result=await h.runWorkshopContinuation(owner,send,'');
assert.equal(result.status,'paused');assert.equal(emitted.length,2);
assert.match(emitted[0],/· prompts】/);assert.match(emitted[1],/· generate】/);
assert.match(result.message,/后台生成/);
const saved=JSON.parse(await fs.readFile(path.join(root,'.gdream/aigc-memory/projects/continuation-test/workshop.json'),'utf8'));
assert.equal(saved.shots[0].videoPrompt,'产品运动');
// Reopen from disk: no prompt rewrite and no duplicate paid submission.
ws.setState({data:structuredClone(saved)});
await h.runWorkshopContinuation(owner,async()=>assert.fail('must not replay active task'),'');
tasks.setState({tasks:[]});emitted.length=0;
result=await h.runWorkshopContinuation(owner,send,'');
assert.equal(emitted.length,1);assert.match(emitted[0],/· generate】/);
tasks.setState({tasks:[]});
// Provider-free failure injection: actual runtime must verify disk, not trust save() resolving.
failPrivateWrite=true;
ws.setState({data:{...saved,ideaDraft:'must not disappear'}});
await assert.rejects(h.runWorkshopContinuation(owner,async()=>assert.fail('write failure must not dispatch'),''),/回读|write|保存/);
failPrivateWrite=false;
// A project switch during readback never sends to the newly selected project.
switchOnRead=()=>unified.setState({activeId:'other'});
await assert.rejects(h.runWorkshopContinuation(owner,async()=>assert.fail('wrong project'),''),/项目已切换/);
unified.setState({activeId:owner.unifiedId});
// Session loading yields: the post-await owner check is mandatory.
const pending=h.sendScopedWorkshopMessage(owner,'测试',async()=>assert.fail('changed owner must not send'));
unified.setState({activeId:'other'});
await assert.rejects(pending,/项目已切换/);
unified.setState({activeId:owner.unifiedId});
// Promise resolution is not a normal DSH completion receipt.
result=await h.runWorkshopContinuation(owner,async()=>{},'');
assert.equal(result.status,'paused');assert.match(result.message,/执行回执/);
console.log('PASS: real runtime + isolated disk; scoped stage advancement, background pause, reopen without replay, disk failure, project/session race, execution receipt gate; no providers or paid calls');
