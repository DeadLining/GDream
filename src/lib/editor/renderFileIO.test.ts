import test from 'node:test';
import assert from 'node:assert/strict';
import { writeRenderTextFile } from './renderFileIO.ts';
test('writes Unicode and shell-sensitive contents without shell/python and verifies bytes',async()=>{
 const calls:string[]=[];let saved='';const path='/tmp/中文 $dir/list.txt';
 await writeRenderTextFile(path,"file '/tmp/一 段.mp4'\n",{mkdir:async p=>{calls.push(p);},write:async(p,s)=>{assert.equal(p,path);saved=s;},read:async()=>saved});
 assert.deepEqual(calls,['/tmp/中文 $dir']);assert.equal(saved,"file '/tmp/一 段.mp4'\n");
});
test('does not claim success on write or readback failure',async()=>{
 const fs={mkdir:async()=>{},write:async()=>{},read:async()=> 'different'};
 await assert.rejects(writeRenderTextFile('/tmp/a','expected',fs),/校验/);
 await assert.rejects(writeRenderTextFile('/tmp/a','expected',{...fs,write:async()=>{throw new Error('disk full');}}),/disk full/);
});
