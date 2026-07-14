// Auto-split from lib/types.ts — domain: review
// Do not edit manually; regenerate via the split script if types.ts changes.

export type VisualAnnotation={id:string;thread_id:string;kind:'circle'|'rectangle'|'path';geometry:Record<string,unknown>;color:string;label:string;created_at:string};
export type VisualReviewMessage={id:string;thread_id:string;author_kind:'user'|'assistant'|'system';content:string;created_at:string};
export type VisualReviewCandidate={id:string;thread_id:string;asset_id:string;status:'ready'|'accepted'|'rejected'|'failed';generation_metadata:Record<string,unknown>;created_at:string;updated_at:string};
export type VisualReviewThread={id:string;episode_id:string;shot_id:string;source_asset_id:string|null;title:string;status:'open'|'resolved';modification_scope:'shot'|'episode'|'master';created_at:string;updated_at:string;annotations:VisualAnnotation[];messages:VisualReviewMessage[];candidates:VisualReviewCandidate[]};
export type ReviewMessage={id:string;thread_id:string;author_kind:'user'|'assistant'|'system';content:string;created_at:string};
export type ReviewThread={id:string;episode_id:string;shot_id:string|null;timecode_seconds:number;severity:'critical'|'major'|'minor';title:string;status:'open'|'resolved';created_at:string;updated_at:string;messages:ReviewMessage[]};
export type ReleaseCandidate={id:string;episode_id:string;version:string;render_path:string;qc_snapshot:Record<string,unknown>;status:'draft'|'approved'|'published';created_at:string;updated_at:string};
export type ReleaseGate={ready:boolean;production_ready:boolean;production_blockers:Record<string,unknown>;open_critical_threads:string[]};
export type PublicationRecord={id:string;candidate_id:string;platform:'internal_master'|'short_video'|'widescreen';idempotency_key:string;external_reference:string;status:'published'|'failed';created_at:string;published_at:string|null};
