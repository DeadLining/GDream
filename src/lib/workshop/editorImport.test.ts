import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEditorImport } from './editorImport.ts';
import { readFileSync } from 'node:fs';
const shots:any=[{shotNo:'01-01',description:'a',videoPath:'/a.mp4',videoQualityReview:{passed:false}},{shotNo:'01-02',description:'b',videoPath:'/b.mp4'}];
test('editing permits unreviewed and failed-review media without changing approval',async()=>{
 const before=JSON.stringify(shots);
 const result=await prepareEditorImport(shots,async()=>new Uint8Array([1]),()=>({valid:true}));
 assert.deepEqual(result.map(x=>x.path),['/a.mp4','/b.mp4']);
 assert.equal(JSON.stringify(shots),before);
});
test('missing or corrupt files prevent import before any clips are added',async()=>{
 await assert.rejects(prepareEditorImport(shots,async()=>{throw new Error('missing');},()=>({valid:true})),/01-01/);
 await assert.rejects(prepareEditorImport(shots,async()=>new Uint8Array(),()=>({valid:false,reason:'bad container'})),/bad container/);
});
test('editor entry is not gated by final delivery or marked as completed delivery',()=>{
 const source=readFileSync(new URL('../../components/workshop/steps/StepHandoff.tsx',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf('  const handleToEditor ='),source.indexOf('\n  return (',source.indexOf('  const handleToEditor =')));
 assert.ok(!handler.includes('persistDeliveryManifest'));
 assert.ok(!handler.includes("markStepStatus('handoff', 'done')"));
 assert.ok(handler.includes('prepareEditorImport'));
});
