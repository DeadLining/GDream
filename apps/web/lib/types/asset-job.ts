// Auto-split from lib/types.ts — domain: asset-job
// Do not edit manually; regenerate via the split script if types.ts changes.

import type {JobStatus} from './common';

export type Asset = {
  id: string; kind: string; media_url: string; media_type: string; provider: string;
  model: string; generation_attempt: number; review_status: string; width: number | null;
  height: number | null; duration_seconds: number | null; created_at: string;
};
export type Job = {
  id: string; operation: string; target_type: string; target_id: string; status: JobStatus;
  progress: number; result_metadata: Record<string, unknown>; error: string; retry_count: number;
  created_at: string; updated_at: string;
};
