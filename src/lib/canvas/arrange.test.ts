import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeCanvasNodes } from './arrange.ts';
const n=(id:string,type='image',data={},extra={})=>({id,type,data,position:{x:0,y:0},style:{width:300,height:180},...extra});

test('production lanes keep prompt/reference/video/output in separate columns and aligned rows',()=>{
 const ns=[n('research-a','text',{adResearchStatus:'reference'}),n('prompt','text'),n('ref'),n('video','video',{workshopRef:{shotNoSnapshot:'01-01'}}),n('tail')];
 const es=[{id:'p',source:'prompt',target:'video'},{id:'r',source:'ref',target:'video'},{id:'t',source:'video',target:'tail',data:{relation:'provenance'}}];
 const r=arrangeCanvasNodes(ns,es); const at=(id:string)=>r.find(x=>x.id===id)!;
 assert.equal(at('prompt').position.y,at('ref').position.y);
 assert.equal(at('ref').position.y,at('video').position.y);
 assert.equal(at('video').position.y,at('tail').position.y);
 assert.ok(at('research-a').position.x < at('ref').position.x);
 assert.ok(at('ref').position.x < at('video').position.x);
 assert.ok(at('video').position.x < at('tail').position.x);
});

test('multiple inputs occupy paired rows without overlap',()=>{
 const ns=[n('p1','text'),n('p2','text'),n('r1'),n('r2'),n('v','video',{workshopRef:{shotNoSnapshot:'01-01'}})];
 const es=[{id:'p1e',source:'p1',target:'v'},{id:'p2e',source:'p2',target:'v'},{id:'r1e',source:'r1',target:'v'},{id:'r2e',source:'r2',target:'v'}];
 const r=arrangeCanvasNodes(ns,es); const at=(id:string)=>r.find(x=>x.id===id)!;
 assert.equal(at('p1').position.y,at('r1').position.y);
 assert.equal(at('p2').position.y,at('r2').position.y);
 assert.notEqual(at('p1').position.y,at('p2').position.y);
});

test('research stays as a separate left region and shared assets stay out of video lanes',()=>{
 const ns=[n('research','text',{adResearchStatus:'reference'}),n('asset-text','text'),n('asset-image'),n('v','video',{workshopRef:{shotNoSnapshot:'01'}})];
 const r=arrangeCanvasNodes(ns,[{id:'x',source:'asset-text',target:'asset-image'}]); const at=(id:string)=>r.find(x=>x.id===id)!;
 assert.ok(at('research').position.x < at('asset-image').position.x);
 assert.ok(at('asset-image').position.x < at('v').position.x);
});

test('position-only and idempotent',()=>{
 const ns=[n('v2','video',{workshopRef:{shotNoSnapshot:'02'}}),n('v1','video',{workshopRef:{shotNoSnapshot:'01'}})];
 const before=JSON.stringify(ns); const r=arrangeCanvasNodes(ns,[]);
 assert.equal(JSON.stringify(ns),before); assert.ok(r.find(x=>x.id==='v1')!.position.y<r.find(x=>x.id==='v2')!.position.y);
 assert.deepEqual(arrangeCanvasNodes(r,[]),r);
});

test('selected-only leaves unselected and grouped children untouched',()=>{
 const ns=[n('fixed'),n('chosen','text',{}, {selected:true}),n('child','image',{}, {parentNode:'fixed',selected:true})];
 const r=arrangeCanvasNodes(ns,[],true);
 assert.equal(r[0],ns[0]); assert.equal(r[2],ns[2]);
});

test('assets start at top independent of video count; research references never move',()=>{
 const ns=[n('research','image',{adResearchStatus:'reference'}),n('p','text',{}, {style:{width:300,height:360}}),n('asset'),...Array.from({length:6},(_,i)=>n('v'+i,'video'))];
 const es=[{id:'p-a',source:'p',target:'asset'},{id:'r-a',source:'research',target:'asset'},{id:'a-v',source:'asset',target:'v0'}];
 const r=arrangeCanvasNodes(ns,es);const at=(id:string)=>r.find(x=>x.id===id)!;
 assert.equal(at('research').position.x,0);
 assert.equal(at('p').position.y+180,at('asset').position.y+90);
 assert.ok(at('asset').position.y<360);
 assert.ok(at('research').position.x<at('p').position.x);
 assert.ok(at('asset').position.x<at('v0').position.x);
 assert.deepEqual(arrangeCanvasNodes(r,es),r);
});

test('production flow keeps base assets and derived first frames in different columns', () => {
  const ns = [
    n('research', 'text', { adResearchStatus: 'reference' }),
    n('image-prompt', 'text', { lineageLabel: '商品图 · 图片提示词', workshopRef: { role: 'prompt-reference', kind: 'prop' } }),
    n('base-asset', 'image', { lineageLabel: '基础商品图', lineageKind: 'prop', workshopRef: { role: 'asset', kind: 'prop' } }),
    n('first-frame', 'image', { lineageLabel: '镜头 01 · 合成首帧', provenanceStatus: 'verified', workshopRef: { role: 'prompt-reference', kind: 'shot' } }),
    n('video-prompt', 'text', { lineageLabel: '镜头 01 · 视频提示词', workshopRef: { role: 'prompt-reference', kind: 'shot' } }),
    n('video', 'video', { lineageLabel: '镜头 01 · 视频', workshopRef: { role: 'shot-video', kind: 'shot', shotNoSnapshot: '01' } }),
  ];
  const es = [
    { id: 'prompt-asset', source: 'image-prompt', target: 'base-asset' },
    { id: 'asset-frame', source: 'base-asset', target: 'first-frame', data: { relation: 'provenance', mediaProvenance: { operation: 'image-reference' } } },
    { id: 'vp-video', source: 'video-prompt', target: 'video' },
    { id: 'frame-video', source: 'first-frame', target: 'video' },
  ];
  const r = arrangeCanvasNodes(ns, es);
  const at = (id: string) => r.find((node) => node.id === id)!;
  assert.ok(at('research').position.x < at('image-prompt').position.x);
  assert.ok(at('image-prompt').position.x < at('base-asset').position.x);
  assert.ok(at('base-asset').position.x < at('first-frame').position.x);
  assert.ok(at('first-frame').position.x < at('video-prompt').position.x);
  assert.ok(at('video-prompt').position.x < at('video').position.x);
  assert.equal(at('image-prompt').position.y, at('base-asset').position.y);
  assert.equal(at('first-frame').position.y, at('video').position.y);
});

test('video stays aligned with the primary row when a shot has multiple inputs', () => {
  const ns = [n('prompt', 'text'), n('first'), n('tail'), n('video', 'video')];
  const es = [
    { id: 'p', source: 'prompt', target: 'video' },
    { id: 'first', source: 'first', target: 'video' },
    { id: 'tail', source: 'tail', target: 'video' },
  ];
  const r = arrangeCanvasNodes(ns, es);
  const at = (id: string) => r.find((node) => node.id === id)!;
  assert.equal(at('video').position.y, at('prompt').position.y);
  assert.equal(at('video').position.y, at('first').position.y);
  assert.ok(at('tail').position.y > at('first').position.y);
});

test('shared tail frame does not add a phantom row to the previous shot', () => {
  const ns = [n('prompt-1', 'text'), n('prompt-2', 'text'), n('first-1'), n('shared-tail'), n('video-1', 'video'), n('video-2', 'video')];
  const es = [
    { id: 'p1', source: 'prompt-1', target: 'video-1' },
    { id: 'p2', source: 'prompt-2', target: 'video-2' },
    { id: 'f1', source: 'first-1', target: 'video-1', data: { lineageRelation: 'video-extra-1' } },
    { id: 't1', source: 'shared-tail', target: 'video-1', data: { lineageRelation: 'video-extra-2' } },
    { id: 'f2', source: 'shared-tail', target: 'video-2', data: { lineageRelation: 'video-extra-1' } },
  ];
  const r = arrangeCanvasNodes(ns, es);
  const at = (id: string) => r.find((node) => node.id === id)!;
  assert.equal(at('video-1').position.y, 0);
  assert.equal(at('video-2').position.y, 200);
  assert.equal(at('shared-tail').position.y, at('video-2').position.y);
});
