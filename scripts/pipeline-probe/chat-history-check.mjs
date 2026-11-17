/** Real stores + archive writer, isolated filesystem IPC. No model, network, paid generation. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installShims } from './preload.mjs';
installShims();
const root=process.argv[2]==='--read-deleted' ? process.argv[3] : await fs.mkdtemp(path.join(os.tmpdir(),'gdream-chat-acceptance-'));
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
const store=h.useRunStepStore;
if(process.argv[2]==='--read-deleted'){
 await h.writeRunArchive('continuous',[{id:'stale',sessionId:'continuous',steps:[],progressUpdates:[],startedAt:1,updatedAt:Date.now(),status:'done',userRequest:'stale'}]);
 assert.deepEqual(await h.readRunArchive('continuous'),[]);
 store.setState({runsById:{stale:{id:'stale',sessionId:'continuous',steps:[],progressUpdates:[],startedAt:1,status:'done',userRequest:'old cache'}},runIdsBySession:{continuous:['stale']}});
 await store.getState().hydrateSession('continuous');
 assert.equal(store.getState().runIdsBySession.continuous,undefined);
 assert.equal(store.getState().runsById.stale,undefined);
 assert.equal(await fs.access(path.join(root,'.gdream/chats/run-history/continuous.json')).then(()=>true,()=>false),false);
 process.exit(0);
}

// Regression: continuous updates must not starve durable saves.
const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const streamId=store.getState().startRun({sessionId:'continuous',userRequest:'continuous fixture'});
for(let i=0;i<15;i++){store.getState().addProgressUpdate('stream '+i,streamId);await pause(100);}
assert.ok((await h.readRunArchive('continuous'))[0]?.progressUpdates.length > 0, 'continuous progress must reach disk before stream stops');
store.getState().beginToolBatch([{name:'fixture',params:{apiKey:'FAKE_SECRET_PARAMS'}}],streamId);
const receiptId=store.getState().startTool('fixture',{apiKey:'FAKE_SECRET_PARAMS'},streamId);
store.getState().finishTool(receiptId,true,{output:JSON.stringify({apiKey:'FAKE_SECRET_OUTPUT',business:'unchanged'})},streamId);
await h.flushRunArchive();
const snapshot=await h.readRunArchive('continuous');
assert.ok(snapshot[0].steps[0].toolCalls[0].endedAt, 'tool completion is an immediate checkpoint even during a running task');
assert.doesNotMatch(JSON.stringify(snapshot),/FAKE_SECRET/);
assert.doesNotMatch(localStorage.getItem('gdream-run-steps')??'',/FAKE_SECRET/);
// Regression: queued writes, stale snapshots and restore cannot resurrect deletion.
await h.writeSessionToFile('continuous',{messages:[{id:'m',role:'user',content:'user text',timestamp:1}],agentMessages:[]});
const pendingWrite=h.writeRunArchive('continuous',snapshot);
await store.getState().clearSession('continuous');
await h.deleteSessionFile('continuous');
await pendingWrite;
await h.writeRunArchive('continuous',snapshot);
await h.flushRunArchive();
await store.getState().hydrateSession('continuous');
assert.equal((await h.readRunArchive('continuous')).length,0);
assert.equal(store.getState().runIdsBySession.continuous?.length??0,0);
assert.equal(await fs.access(path.join(root,'.gdream/chats/run-history/continuous.json')).then(()=>true,()=>false),false);
await h.writeSessionToFile('continuous',{messages:[{id:'stale',role:'user',content:'late message',timestamp:2}],agentMessages:[]});
assert.equal(await h.readSessionFromFile('continuous'),null);
assert.equal(await fs.access(path.join(root,'.gdream/chats/continuous.json')).then(()=>true,()=>false),false);
const restart=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--read-deleted',root],{encoding:'utf8'});
assert.equal(restart.status,0,restart.stderr);
console.log('PASS: bounded streaming saves, immediate receipt checkpoints, secret-free disk/cache, deletion wins over stale writes');
const request='[工坊上下文：项目A]\n\n[一键全流程 · 广告]\n范围：8镜，先确认再生成。\n'+'长输入原始内容\n'.repeat(1000);
const id=store.getState().startRun({sessionId:'session-A',projectId:'project-A',userRequest:request});
// > legacy 30-step/24-progress caps; no stage can disappear after finishing.
for(let i=0;i<35;i++){
 store.getState().beginToolBatch([{name:'workshop_get_state',params:{page:i}}],id);
 const toolId=store.getState().startTool('workshop_get_state',{page:i},id);
 store.getState().finishTool(toolId,true,{output:`第${i}页完整检查结论\n`+'证据'.repeat(1000)},id);
 store.getState().finishToolBatch([{name:'workshop_get_state',success:true}],id);
 store.getState().addProgressUpdate(`阶段说明 ${i}\n`+'说明'.repeat(900),id);
}
const subId=store.getState().startSubAgent({task:'完整检查结果'});
store.getState().finishSubAgent(subId,'completed','完整检查结果'.repeat(1000));
const promise=h.useAskUserStore.getState().ask([{question:'是否继续？',options:[{label:'仅方案'},{label:'生成'}],multiSelect:false}],{sourceLabel:'验收',sourceView:'workshop',sourceSessionId:'session-A'});
assert.equal(store.getState().runsById[id].decisions[0].status,'pending');
await h.flushRunArchive();
assert.equal((await h.readRunArchive('session-A'))[0].decisions[0].status,'pending');
h.useAskUserStore.getState().submit([{selected:['仅方案']}]);
await promise;
await h.flushRunArchive();
assert.equal((await h.readRunArchive('session-A'))[0].decisions[0].status,'answered');
const data=h.emptyWorkshopData('project-A');data.shots=[{shotNo:'01',description:'产品画面',durationSec:5,camera:'推进',dialogue:'原始旁白',characterIds:[]}];
const outcome=h.savedShotOutcome('workshop_set_shots',{shots:[{shotNo:'01'}]},true,data,'project-A','saved');
store.getState().addOutcome(outcome,id);
await h.flushRunArchive();
assert.equal((await h.readRunArchive('session-A'))[0].outcomes.length,1);
store.getState().finishRun('done',id);
await h.flushRunArchive();
const disk=await h.readRunArchive('session-A');
assert.equal(disk[0].userRequest,request);assert.equal(disk[0].steps.length,36);
assert.equal(disk[0].progressUpdates.length,35);assert.ok(disk[0].steps[0].toolCalls[0].output.endsWith('证据'.repeat(1000)));
assert.equal(disk[0].decisions[0].answers[0],'仅方案');
// Simulate a process/WebView cache loss, not simply a component rerender.
localStorage.clear();store.setState({runsById:{},runIdsBySession:{},currentRunId:null});
h.useAskUserStore.setState({history:[],pending:null,queue:[]});
await store.getState().hydrateSession('session-B');assert.equal(store.getState().runIdsBySession['session-B'].length,0);
await store.getState().hydrateSession('session-A');
const restored=store.getState().runsById[id];
assert.equal(restored.steps.length,36);assert.equal(restored.progressUpdates.length,35);
assert.equal(restored.steps.flatMap(s=>s.subAgents)[0].outputSummary,'完整检查结果'.repeat(1000));
assert.equal(restored.userRequest,request);assert.equal(restored.outcomes[0].shots[0].description,'产品画面');
assert.equal(restored.decisions[0].status,'answered');assert.equal(h.useAskUserStore.getState().pending,null);
assert.equal(store.getState().currentRunId,null);
// Stale writes cannot replace a more recent archive.
await h.writeRunArchive('session-A',[{...restored,updatedAt:1,steps:[]}]);
assert.equal((await h.readRunArchive('session-A'))[0].steps.length,36);
await h.flushRunArchive();
console.log('PASS: long input -> 35 tool steps + full subtask -> real confirmation -> saved shots -> final -> cache loss -> disk restore; project isolation; no task replay');
console.log('Isolated evidence directory:',root);

// Both session evidence representations share the same sanitizer; user original is lossless.
const original='original user input '.repeat(300);
const full='full business '.repeat(300);
const output=JSON.stringify({api_key:'FAKE_SECRET_ALL_SINKS',full});
const messages=[{id:'original',role:'user',content:original,timestamp:1,metadata:{fullInput:original}},
 {id:'reply',role:'assistant',content:'done',timestamp:2,metadata:{toolExecutions:[{params:{password:'FAKE_SECRET_PARAMS'},result:{output}}]}}];
const agentMessages=[{role:'tool',tool_call_id:'t',content:output},
 {role:'assistant',content:'',tool_calls:[{id:'t',type:'function',function:{name:'fixture',arguments:JSON.stringify({apiKey:'FAKE_SECRET_ARGUMENTS'})}}]}];
assert.doesNotMatch(JSON.stringify(h.compactMessagesForStorage(messages)),/FAKE_SECRET/);
assert.doesNotMatch(JSON.stringify(h.prepareAgentMessagesForDisk(agentMessages)),/FAKE_SECRET/);
assert.equal(h.compactMessagesForStorage(messages)[0].content,original);
await h.writeSessionToFile('evidence',{messages,agentMessages});
assert.doesNotMatch(await fs.readFile(path.join(root,'.gdream/chats/evidence.json'),'utf8'),/FAKE_SECRET/);
// Failure is visible, retry is possible, and a failed delete does not silently remove the UI session.
const retryId=store.getState().startRun({sessionId:'retry',userRequest:'retry fixture'});
store.getState().finishRun('done',retryId);await h.flushRunArchive();
const beforeDelete=store.getState().runsById[retryId];
failRemoval=true;
await assert.rejects(store.getState().clearSession('retry'));
assert.equal(store.getState().runsById[retryId],beforeDelete);
assert.ok(h.useRunArchiveStatus.getState().error);
failRemoval=false;
await store.getState().clearSession('retry');
assert.equal(store.getState().runsById[retryId],undefined);
assert.equal(h.useRunArchiveStatus.getState().error,null);
failPrivateWrite=true;
await assert.rejects(h.writeRunArchive('retry-write',[{...restored,id:'retry-write',sessionId:'retry-write'}]));
assert.ok(h.useRunArchiveStatus.getState().error);
failPrivateWrite=false;
await h.writeRunArchive('retry-write',[{...restored,id:'retry-write',sessionId:'retry-write'}]);
assert.equal(h.useRunArchiveStatus.getState().error,null);
assert.equal((await h.readRunArchive('retry-write')).length,1);
assert.equal((await fs.stat(path.join(root,'.gdream/chats/run-history/retry-write.json'))).mode & 0o777,0o600);
console.log('PASS: fresh-process deletion tombstone, ordinary session deletion, lossless user input, all evidence sinks sanitized, write/delete failure retries');
