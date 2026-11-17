import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDshVideoReview, validateVideoReading } from './dshVideoReview.ts';
const reading = { projectId:'p1', shotNo:'01-01', candidatePath:'/tmp/video.mp4', candidateFingerprint:'f1', sha256:'a'.repeat(64), model:'model', provider:'gateway', expiresAt:200, frames:[{path:'/tmp/0.jpg',time:0},{path:'/tmp/1.jpg',time:1}], hasAudio:true };
const review = {summary:'Actual sampled frames show a stable workstation.', score:85, criteria:{continuity:'pass',visualIdentity:'pass',performance:'pass',pacing:'pass'}, observations:{continuity:'Same room in both sampled frames',visualIdentity:'Case matches reference',performance:'No people present',pacing:'Two stable sampled positions'}};
test('reading is bound to project, candidate, bytes, model and expiry',()=>{
 validateVideoReading(reading,{...reading},100);
 for(const patch of [{projectId:'p2'},{candidateFingerprint:'f2'},{sha256:'b'.repeat(64)},{model:'other'},{provider:'other'}]) assert.throws(()=>validateVideoReading(reading,{...reading,...patch},100));
 assert.throws(()=>validateVideoReading(reading,{...reading},201));
});
test('sampled images never certify audio or full temporal review',()=>{
 const result=buildDshVideoReview(reading,review,100);
 assert.equal(result.passed,false);
 assert.equal(result.evidence?.method,'sampled-frames');
 assert.equal(result.evidence?.audio,'not-reviewed');
 assert.equal(result.artifactFingerprint,'f1');
 assert.equal(result.evidence?.sha256,reading.sha256);
});
test('reject malformed verdicts, missing observations and invented passing evidence',()=>{
 for(const patch of [{criteria:{}},{score:NaN},{score:101},{summary:''},{observations:{}},{criteria:{...review.criteria,pacing:'maybe'}}]) assert.throws(()=>buildDshVideoReview(reading,{...review,...patch},100));
});
test('failed and unreviewed criteria are preserved rather than adopted',()=>{
 const result=buildDshVideoReview(reading,{...review,criteria:{...review.criteria,visualIdentity:'fail',pacing:'not-reviewed'}},100);
 assert.equal(result.passed,false);
 assert.equal(result.evidence?.criteria.visualIdentity,'fail');
 assert.ok(result.issues.some(i=>i.severity==='error'));
});
