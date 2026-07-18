// Auto-split from lib/api.ts — domain: review-publish
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { PublicationRecord, ReleaseCandidate, ReleaseGate, RenderReview } from '../types';
export const createReleaseCandidate=(episodeId:string,data:{version:string;render_path:string;qc_snapshot:Record<string,unknown>})=>apiRequest<ReleaseCandidate>(`/api/episodes/${episodeId}/release-candidates`,json('POST',data));
export const listReleaseCandidates=(episodeId:string)=>apiRequest<ReleaseCandidate[]>(`/api/episodes/${episodeId}/release-candidates`);
export const getRenderReview=(episodeId:string)=>apiRequest<RenderReview>(`/api/episodes/${episodeId}/render-review`);
export const getReleaseGate=(candidateId:string)=>apiRequest<ReleaseGate>(`/api/release-candidates/${candidateId}/gate`);
export const approveReleaseCandidate=(candidateId:string)=>apiRequest<ReleaseCandidate>(`/api/release-candidates/${candidateId}/approve`,json('POST'));
export const publishReleaseCandidate=(candidateId:string,data:{platform:PublicationRecord['platform'];idempotency_key:string})=>apiRequest<PublicationRecord>(`/api/release-candidates/${candidateId}/publish`,json('POST',data));
