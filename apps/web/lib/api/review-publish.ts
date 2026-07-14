// Auto-split from lib/api.ts — domain: review-publish
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { PublicationRecord, ReleaseCandidate, ReleaseGate, ReviewMessage, ReviewThread } from '../types';

export const listReviewThreads=(episodeId:string)=>apiRequest<ReviewThread[]>(`/api/episodes/${episodeId}/review-threads`);
export const createReviewThread=(episodeId:string,data:{shot_id:string|null;timecode_seconds:number;severity:ReviewThread['severity'];title:string})=>apiRequest<ReviewThread>(`/api/episodes/${episodeId}/review-threads`,json('POST',data));
export const updateReviewThread=(id:string,data:{status:'open'|'resolved'})=>apiRequest<ReviewThread>(`/api/review-threads/${id}`,json('PATCH',data));
export const createReviewMessage=(id:string,data:{author_kind:'user'|'assistant'|'system';content:string})=>apiRequest<ReviewMessage>(`/api/review-threads/${id}/messages`,json('POST',data));
export const createReleaseCandidate=(episodeId:string,data:{version:string;render_path:string;qc_snapshot:Record<string,unknown>})=>apiRequest<ReleaseCandidate>(`/api/episodes/${episodeId}/release-candidates`,json('POST',data));
export const listReleaseCandidates=(episodeId:string)=>apiRequest<ReleaseCandidate[]>(`/api/episodes/${episodeId}/release-candidates`);
export const getReleaseGate=(candidateId:string)=>apiRequest<ReleaseGate>(`/api/release-candidates/${candidateId}/gate`);
export const approveReleaseCandidate=(candidateId:string)=>apiRequest<ReleaseCandidate>(`/api/release-candidates/${candidateId}/approve`,json('POST'));
export const publishReleaseCandidate=(candidateId:string,data:{platform:PublicationRecord['platform'];idempotency_key:string})=>apiRequest<PublicationRecord>(`/api/release-candidates/${candidateId}/publish`,json('POST',data));
