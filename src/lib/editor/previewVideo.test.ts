import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewVideoSync, previewClipEnded } from './previewVideo.ts';
function fixture() {
 const events = new Map<string, Function>();
 const calls:string[]=[];
 const video:any = {dataset:{},style:{cssText:''},readyState:0,seeking:false,currentTime:0,videoWidth:20,videoHeight:10,paused:true,
 addEventListener:(k:string,f:Function)=>events.set(k,f),removeEventListener:(k:string)=>events.delete(k),
 pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){calls.push('load');this.readyState=0;},
 };
 const canvas:any={style:{cssText:'',display:'block'},getContext:()=>({drawImage:()=>calls.push('capture')})};
 return {video,canvas,events,calls,sync:createPreviewVideoSync(video,canvas,()=>{})};
}
test('holds outgoing frame until next source has decoded and completed seeking',()=>{
 const f=fixture();
 f.sync.update('a',0,true,1);f.video.readyState=2;f.events.get('loadeddata')!();
 f.sync.update('b',0,true,1);
 assert.deepEqual(f.calls,['load','capture','load']);assert.equal(f.canvas.style.display,'block');
 f.video.readyState=1;f.events.get('loadedmetadata')!();assert.equal(f.canvas.style.display,'block');
 f.video.readyState=2;f.video.seeking=true;f.events.get('loadeddata')!();assert.equal(f.canvas.style.display,'block');
 f.video.seeking=false;f.events.get('seeked')!();assert.equal(f.canvas.style.display,'block');
 f.sync.dispose();assert.equal(f.events.size,0);
});
test('updates pending playback without losing load listeners or reloading',()=>{
 const f=fixture();f.sync.update('a',0,true,1);f.sync.update('a',2,false,1);
 f.video.readyState=1;f.events.get('loadedmetadata')!();assert.equal(f.video.currentTime,2);assert.equal(f.video.paused,true);
 assert.deepEqual(f.calls,['load']);f.sync.dispose();
});
test('natural ended and video stream shorter than container advance the clip',()=>{
 assert.equal(previewClipEnded({ended:true,currentTime:5.12},5.175),true);
 assert.equal(previewClipEnded({ended:false,currentTime:5.16},5.175),true);
 assert.equal(previewClipEnded({ended:false,currentTime:2},5.175),false);
});
test('decoded-frame callback is required when supported and stale callbacks cannot reveal another source',()=>{
 const f=fixture();const frames:Function[]=[];const cancelled:number[]=[];
 f.video.requestVideoFrameCallback=(cb:Function)=>{frames.push(cb);return frames.length;};
 f.video.cancelVideoFrameCallback=(id:number)=>cancelled.push(id);
 f.sync.update('a',0,true,1);f.video.readyState=2;f.events.get('loadeddata')!();
 f.sync.update('b',0,true,1);assert.deepEqual(cancelled,[1]);
 frames[0]();assert.equal(f.canvas.style.display,'block');
 f.video.readyState=2;f.events.get('loadeddata')!();assert.equal(f.canvas.style.display,'block');
 frames[1]();assert.equal(f.canvas.style.display,'block');
 f.sync.dispose();
});
test('media errors stop playback rather than hanging silently',()=>{
 const f=fixture();f.sync.dispose();let failures=0;
 const sync=createPreviewVideoSync(f.video,f.canvas,()=>failures++);
 sync.update('broken',0,true,1);f.events.get('error')!();assert.equal(failures,1);sync.dispose();
});
test('presentation surface stays visible across decoded frames and source changes',()=>{
 const f=fixture();const callbacks:Function[]=[];
 f.video.requestVideoFrameCallback=(cb:Function)=>{callbacks.push(cb);return callbacks.length;};
 f.video.cancelVideoFrameCallback=()=>{};
 f.sync.update('a',0,true,1);f.video.readyState=2;f.events.get('loadeddata')!();callbacks.shift()!();
 assert.equal(f.canvas.style.display,'block');
 f.sync.update('b',0,true,1);
 assert.equal(f.canvas.style.display,'block');
 f.video.readyState=2;f.events.get('loadeddata')!();
 assert.equal(f.canvas.style.display,'block');
 f.sync.dispose();
});
test('continuous frame pump keeps drawing and rejects callbacks from the previous source',()=>{
 const f=fixture();const callbacks:Function[]=[];
 f.video.requestVideoFrameCallback=(cb:Function)=>{callbacks.push(cb);return callbacks.length;};
 f.video.cancelVideoFrameCallback=()=>{};
 f.sync.update('a',0,true,1);f.video.readyState=2;f.events.get('loadeddata')!();
 callbacks[0]();assert.equal(f.calls.filter(x=>x==='capture').length,1);
 callbacks[1]();assert.equal(f.calls.filter(x=>x==='capture').length,2);
 f.sync.update('b',0,true,1);callbacks[2]();
 assert.equal(f.calls.filter(x=>x==='capture').length,2);
 f.video.readyState=2;f.events.get('loadeddata')!();callbacks[3]();
 assert.equal(f.calls.filter(x=>x==='capture').length,3);
 f.sync.dispose();callbacks[4]();assert.equal(f.calls.filter(x=>x==='capture').length,3);
});
test('fallback frame pump retains pixels while loading or seeking',()=>{
 const f=fixture();let tick:Function=()=>{};let cancelled=false;
 const oldRequest=globalThis.requestAnimationFrame;const oldCancel=globalThis.cancelAnimationFrame;
 globalThis.requestAnimationFrame=((cb:Function)=>{tick=cb;return 1;}) as any;
 globalThis.cancelAnimationFrame=()=>{cancelled=true;};
 try {
  f.sync.update('a',0,true,1);f.video.readyState=2;f.events.get('loadeddata')!();
  const before=f.calls.length;tick();assert.equal(f.calls.length,before+1);
  f.video.seeking=true;tick();assert.equal(f.calls.length,before+1);
  f.sync.update('b',0,true,1);assert.equal(f.canvas.style.display,'block');assert.equal(cancelled,true);
 } finally {f.sync.dispose();globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel;}
});
