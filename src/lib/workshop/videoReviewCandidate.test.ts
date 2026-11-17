import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVideoReviewCandidate } from './videoReviewCandidate.ts';
const a={path:'/saved/a.mp4'},b={path:'/saved/b.mp4'};
test('unbound retained candidate can be reviewed without adopting it',()=>{
 const shot={videoCandidates:[a]};assert.equal(selectVideoReviewCandidate(shot),a);assert.equal('videoPath' in shot,false);
});
test('explicit selection is restricted to saved candidates',()=>{
 assert.equal(selectVideoReviewCandidate({videoCandidates:[a,b]},b.path),b);
 assert.throws(()=>selectVideoReviewCandidate({videoCandidates:[a]},'/foreign.mp4'),/不属于/);
});
test('multiple unbound candidates require explicit selection; current binding is preferred',()=>{
 assert.throws(()=>selectVideoReviewCandidate({videoCandidates:[a,b]}),/candidate_path/);
 assert.equal(selectVideoReviewCandidate({videoPath:b.path,videoCandidates:[a,b]}),b);
 assert.throws(()=>selectVideoReviewCandidate({videoCandidates:[]}),/没有已保存/);
});
