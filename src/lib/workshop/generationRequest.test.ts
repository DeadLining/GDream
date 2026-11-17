import test from 'node:test';
import assert from 'node:assert/strict';
import { generationRequest, needsGeneration } from './generationRequest.ts';
test('boundary request generates frames only, never a video', () => {
 assert.deepEqual(generationRequest('boundary', false), {kind:'video',options:{skipPromptValidation:false,boundaryFramesOnly:true},label:'首尾帧'});
});
test('regular generation remains unchanged and invalid kinds fail closed', () => {
 assert.deepEqual(generationRequest('video', true), {kind:'video',options:{skipPromptValidation:true},label:'视频'});
 assert.throws(()=>generationRequest('unknown',false));
});
test('missing boundary selection depends on both frames, not video presence', () => {
 assert.equal(needsGeneration('boundary',{videoPath:'video'}),true);
 assert.equal(needsGeneration('boundary',{videoStartFramePath:'start'}),true);
 assert.equal(needsGeneration('boundary',{videoStartFramePath:'start',videoEndFramePath:'end'}),false);
 assert.equal(needsGeneration('video',{videoPath:'video'}),false);
 assert.equal(needsGeneration('image',{}),true);
});

test('boundary role is explicit and invalid combinations fail closed', () => {
 assert.equal(generationRequest('boundary',false,'end').options.boundaryFrameRole,'end');
 assert.throws(()=>generationRequest('video',false,'end'));
 assert.throws(()=>generationRequest('boundary',false,'invalid'));
});

test('strict-schema default both and null do not turn a video request into images',()=>{
 assert.equal(generationRequest('video',false,'both').options.boundaryFramesOnly,undefined);
 assert.equal(generationRequest('video',false,null).kind,'video');
});
