// Auto-split from lib/types.ts — domain: workspace
// Do not edit manually; regenerate via the split script if types.ts changes.

export type EpisodeVersion={id:string;episode_id:string;version:number;label:string;source:'manual'|'autosave'|'checkpoint'|'restore';author:string;snapshot:Record<string,unknown>;restored_from_id:string|null;created_at:string};
export type DeliveryOutput={kind:'landscape_video'|'vertical_video'|'clean_master'|'subtitles'|'audio_mix'|'asset_manifest';format:string;enabled:boolean};
export type DeliveryPackage={id:string;project_id:string;episode_id:string;release_candidate_id:string;preset_name:string;outputs:DeliveryOutput[];checks:Record<string,boolean>;status:'queued'|'running'|'completed'|'failed';artifact_path:string;created_at:string;updated_at:string};
export type TrashItem={id:string;project_id:string;resource_type:'asset_variant'|'asset_variant_state';resource_id:string;name:string;original_location:string[];lineage:string[];deleted_by:string;deleted_at:string;expires_at:string;reference_count:number;can_permanently_delete:boolean};
export type TrashRestore={restored:boolean;resource_type:TrashItem['resource_type'];resource_id:string};
export type WorkspaceProjectSummary={project_id:string;title:string;logline:string;volume_count:number;episode_count:number;scene_count:number;shot_count:number;open_task_count:number;pending_review_count:number;completion_percent:number;current_stage:string;latest_task_titles:string[];updated_at:string};
export type WorkspaceSummary={active_project_count:number;active_task_count:number;pending_review_count:number;updated_today_count:number;projects:WorkspaceProjectSummary[]};
export type ProjectSearchResult={kind:'script'|'character'|'asset_variant'|'asset_state'|'library_asset'|'episode'|'scene'|'shot'|'task';id:string;title:string;subtitle:string;hierarchy:string[];status:string;project_id:string;episode_id:string|null;scene_id:string|null;shot_id:string|null;character_id:string|null;variant_id:string|null;state_id:string|null;library_asset_id:string|null;library_asset_kind:'scene'|'prop'|'costume'|'sound'|null;reference_count:number};
export type ProjectSearchResponse={query:string;results:ProjectSearchResult[]};
