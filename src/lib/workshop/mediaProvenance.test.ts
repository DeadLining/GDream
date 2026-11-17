import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMediaProvenance } from './mediaProvenance.ts';
test('only recorded extraction links video to frame; planned end does not imply extraction', () => {
 const result=collectMediaProvenance([{videoPath:'/v.mp4',videoEndFramePath:'/planned.png',acceptedVideoTail:{videoPath:'/v.mp4',framePath:'/actual.png',extractionId:'e'}}]);
 assert.deepEqual(result.map(r=>[r.sourcePath,r.outputPath,r.operation]),[['/v.mp4','/actual.png','extract']]);
});
test('inheritance records the precise historical video rather than the newly adopted one',()=>{
 const result=collectMediaProvenance([{videoPath:'/new.mp4',videoStartFramePath:'/tail.png',videoStartFrameInheritance:{videoPath:'/old.mp4',framePath:'/tail.png',shotNo:'01'}}]);
 assert.equal(result[0].sourcePath,'/old.mp4');
});
test('generation inputs and local processing remain different from extraction',()=>{
 const result=collectMediaProvenance([{videoStartFramePath:'/start.png',videoStartFrameReferencePaths:['/asset.png']}],[{sourcePath:'/start.png',outputPath:'/end.png',operation:'edit',evidence:'script.py'}]);
 assert.deepEqual(result.map(r=>r.operation).sort(),['edit','image-reference']);
});
test('unknown paths, self links and duplicate records are rejected',()=>{
 const r={sourcePath:'/a',outputPath:'/b',operation:'edit',evidence:'script'};
 assert.equal(collectMediaProvenance([], [r,r,{...r,outputPath:'/a'},{...r,sourcePath:''},{...r,operation:'guessed'}]).length,1);
});
