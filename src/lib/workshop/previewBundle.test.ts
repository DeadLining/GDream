import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPreviewBundle } from './previewBundle.ts';
test('preview package is labelled and never creates a formal pass receipt', async()=>{
 const files=new Map<string,unknown>();const shots:any=[{shotNo:'01/01',videoPath:'/a.mp4',description:'',characterIds:[]}];
 const before=JSON.stringify(shots);
 const r=await exportPreviewBundle({projectId:'p',shots,directory:'/preview',io:{mkdir:async()=>{},read:async()=>new Uint8Array([1]),validate:()=>true,digest:async()=> 'hash',writeBytes:async(p,b)=>{files.set(p,b);},writeText:async(p,s)=>{files.set(p,s);}}});
 assert.equal(r.status,'internal-preview');assert.equal(r.formalDelivery,false);
 assert.equal(r.shots[0].review.state,'missing');assert.equal(JSON.stringify(shots),before);
 assert.ok(files.has('/preview/001-01_01.mp4'));assert.ok(files.has('/preview/README.txt'));
});
test('invalid container is rejected before creating output',async()=>{
 let writes=0;
 await assert.rejects(exportPreviewBundle({projectId:'p',shots:[{shotNo:'01',videoPath:'/bad'}] as any,directory:'/preview',io:{mkdir:async()=>{writes++;},read:async()=>new Uint8Array(),validate:()=>false,digest:async()=>'',writeBytes:async()=>{},writeText:async()=>{}}}),/视频文件无效/);
 assert.equal(writes,0);
});
