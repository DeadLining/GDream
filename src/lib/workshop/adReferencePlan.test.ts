import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdReferencePlan } from './adReferencePlan.ts';
const shots = ['01','02'];
const images = [{url:'https://example.com/a.png',path:'/a.png'}];
const plan = [
 {shotNo:'01',reason:'使用场景构图',references:[{url:images[0].url,visualSummary:'桌面和黑色设备',purpose:'composition',reason:'横构图适合本镜'}]},
 {shotNo:'02',reason:'本镜不需要网络参考',references:[]},
];
test('persists explicit per-shot decisions including no reference',()=>{
 const result=validateAdReferencePlan(plan,shots,images);
 assert.equal(result[0].references[0].path,'/a.png');
 assert.equal(result[1].references.length,0);
});
test('rejects missing shots, duplicates, unseen images and identity escalation',()=>{
 for(const value of [plan.slice(0,1),[plan[0],plan[0]], [{...plan[0],references:[{...plan[0].references[0],url:'https://other/a'}]},plan[1]], [{...plan[0],references:[{...plan[0].references[0],purpose:'product-identity'}]},plan[1]]]) {
  assert.throws(()=>validateAdReferencePlan(value,shots,images));
 }
});
test('rejects malformed payloads, empty analysis and repeated URLs',()=>{
 for(const input of [null, [null,plan[1]], [{...plan[0],references:[null]},plan[1]], [{...plan[0],references:[{...plan[0].references[0],visualSummary:''}]},plan[1]], [{...plan[0],references:[plan[0].references[0],plan[0].references[0]]},plan[1]]]) {
  assert.throws(()=>validateAdReferencePlan(input,shots,images));
 }
});
test('roundtrip preserves plan choices and does not invent references',()=>{
 const result=validateAdReferencePlan(plan,shots,images);
 const persisted=JSON.parse(JSON.stringify(result));
 assert.deepEqual(persisted,result);
 assert.equal(persisted[1].references.length,0);
});
