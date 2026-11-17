import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryReviewStatus } from './deliveryReviewStatus.ts';
import { videoCandidateFingerprint } from './productionLifecycle.ts';
const c={path:'/a.mp4',createdAt:1,source:'generate' as const};
const base:any={shotNo:'01',videoPath:c.path,videoCandidates:[c]};
const report:any={kind:'video',artifactPath:c.path,artifactFingerprint:videoCandidateFingerprint(c),reviewedAt:1,passed:false,issues:[]};
test('distinguishes missing, stale, incomplete and failed reviews',()=>{
 assert.equal(deliveryReviewStatus(base).state,'missing');
 assert.equal(deliveryReviewStatus({...base,videoQualityReview:{...report,artifactPath:'/old'}}).state,'stale');
 assert.equal(deliveryReviewStatus({...base,videoQualityReview:{...report,evidence:{audio:'not-reviewed',temporal:'sampled-only'}}}).state,'incomplete');
 assert.equal(deliveryReviewStatus({...base,videoQualityReview:{...report,issues:[{severity:'error',message:'extra person'}]}}).state,'failed');
 assert.equal(deliveryReviewStatus({...base,videoQualityReview:{...report,passed:true}}).state,'passed');
});
