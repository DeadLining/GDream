/** Isolated project-draft persistence regression. No providers or real project writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installShims } from './preload.mjs';
installShims();
const root=await fs.mkdtemp(path.join(os.tmpdir(),'gdream-brief-acceptance-'));
let failPrivateWrite=false;
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
  else if(message.cmd==='readTextFile')result=await fs.readFile(resolve(message.path),'utf8');
  else if(message.cmd==='writeFile')await fs.writeFile(resolve(message.path),Buffer.from(message.contents));
  else if(message.cmd==='removeFile'){if(failRemoval)throw new Error('injected removal failure');await fs.rm(resolve(message.path));}
  else if(message.cmd==='renameFile')await fs.rename(resolve(message.oldPath),resolve(message.newPath));
  else throw new Error('Unexpected IPC '+message.cmd);
  window[`_${callback}`](result);
 }catch(e){window[`_${error}`](String(e));}
};
const h=await import('./.gen/harness.mjs');

const data=h.emptyWorkshopData('ad-empty-cast');
data.creativeSpec={workKind:'product-ad',adSpec:{productName:'软件广告',productCategory:'software',audience:['partner'],objective:'recruitment',durationSec:30,researchMode:'provided-only'}};
h.useWorkshopStore.setState({project:{id:data.projectId,name:'广告回归',sources:[]},data});
const registry=h.createDefaultRegistry();
assert.equal((await registry.execute('workshop_prepare_ad_materials',{})).success,true);
const payload={synopsis:'软件演示广告，不含人物。',episodes:[{no:'1',title:'产品演示',sceneList:'s1',script:'产品功能介绍，申请演示。'}],scenes:[{id:'s1',name:'软件演示',description:'白色功能示意舞台'}],narrativeBeats:[{id:'b1',sceneId:'s1',title:'展示功能',purpose:'信息'}],characters:[],props:[]};
let result=await registry.execute('workshop_set_breakdown',payload);
assert.equal(result.success,true,result.error);
await h.useWorkshopStore.getState().commitNow();
const saved=JSON.parse(await fs.readFile(path.join(root,'.gdream/aigc-memory/projects/ad-empty-cast/workshop.json'),'utf8'));
assert.deepEqual(saved.characters,[]);
assert.equal(saved.episodes[0].script,payload.episodes[0].script);
assert.ok(saved.currentScriptRevisionId);
await h.useWorkshopStore.getState().openProject(data.projectId);
assert.deepEqual(h.useWorkshopStore.getState().data.characters,[]);
console.log('PASS empty-cast ad: real tool, script revision, disk persistence and reopen');

let onResult,onDispatch,rejectPrompt,toolAborted=false,disposed=false;
const bridge=new h.DshBridge({
 createTools(_r,_i,_registry,_callbacks,dispatch,_context,observe){onResult=observe;onDispatch=dispatch;return {async start(){},abort(){toolAborted=true;},dispose(){}};},
 createAcp(){return {async start(){},async cancel(){},async dispose(){disposed=true;rejectPrompt?.(new Error('transport disposed'));},prompt(){return new Promise((_resolve,reject)=>{
  rejectPrompt=reject;
  onDispatch('workshop_set_breakdown');
  onResult('workshop_set_breakdown',{synopsis:'first'},{success:false,output:'',error:'missing characters'});
  onResult('workshop_get_state',{}, {success:true,output:'state'});
  onResult('workshop_set_breakdown',{synopsis:'changed'},{success:false,output:'',error:'missing characters'});
 });}};}
});
await assert.rejects(bridge.run({runId:'guard-test',sessionId:'offline',model:'fixture',providerId:'custom',input:'验证广告',cwd:root,messages:[],systemPrompt:'',contextWindow:10000,toolRegistry:registry,callbacks:{onTextDelta(){},onThinkingDelta(){},onToolStart(){},onToolEnd(){},onComplete(){},onError(){}}}),/重复失败/);
assert.equal(toolAborted,true);assert.equal(disposed,true);assert.equal(bridge.hasVisibleOutput(),true);
console.log('PASS active ACP tool loop is stopped immediately; failure is surfaced and replay is prohibited');
