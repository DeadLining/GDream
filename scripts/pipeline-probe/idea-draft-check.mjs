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

const store=h.useWorkshopStore;
const project={id:'draft-A',name:'Draft test',sources:[],createdAt:1,updatedAt:1,stats:{},status:'draft'};
store.setState({project,data:h.emptyWorkshopData(project.id)});
const original='  广告原始要求\n产品必须保留原貌。\n不要自动生成。  ';
store.getState().setIdeaDraft(original);
assert.equal(store.getState().data.ideaDraft,original,'input must live in project data, not component memory');
store.getState().requestIdeaGeneration(original);
store.getState().clearIdeaGenerationRequest();
assert.equal(store.getState().data.ideaDraft,original,'consuming execution request must preserve input');
await store.getState().commitNow();
const saved=JSON.parse(await fs.readFile(path.join(root,'.gdream/aigc-memory/projects/draft-A/workshop.json'),'utf8'));
assert.equal(saved.ideaDraft,original,'lossless durable draft');
store.setState({project:null,data:null,ideaDraft:''});
await store.getState().openProject(project.id);
assert.equal(store.getState().ideaDraft,original,'reopening restores original input');
store.setState({project:{...project,id:'draft-B'},data:h.emptyWorkshopData('draft-B'),ideaDraft:''});
store.getState().setIdeaDraft('B only');
await store.getState().commitNow();
await store.getState().openProject(project.id);
assert.equal(store.getState().ideaDraft,original,'project isolation');
store.getState().setIdeaDraft('pending reload');
await store.getState().reloadCurrent();
assert.equal(store.getState().ideaDraft,'pending reload','tool reload must flush draft');
store.getState().setIdeaDraft('same project pending');
await store.getState().openProject(project.id);
assert.equal(store.getState().ideaDraft,'same project pending','same project reopen must flush draft');
store.getState().setIdeaDraft('');
await store.getState().commitNow();
await store.getState().openProject(project.id);
assert.equal(store.getState().ideaDraft,'','intentional clear persists');
console.log('PASS: lossless input, request consumption, disk persistence, reopen, project isolation, explicit clear');
