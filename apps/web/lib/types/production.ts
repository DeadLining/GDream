// Auto-split from lib/types.ts — domain: production
// Do not edit manually; regenerate via the split script if types.ts changes.

export type ProductionStage = 'panels' | 'speech' | 'videos';
export type ProductionRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_failures';
export type ProductionRunScope = 'episode' | 'shot_group';
export type ProductionRun = {id:string;episode_id:string;status:ProductionRunStatus;stages:ProductionStage[];concurrency:number;scope_type:ProductionRunScope;shot_ids:string[]|null;regenerate_panels:boolean;regenerate_speech:boolean;regenerate_videos?:boolean;panel_generation_mode:'solo'|'grid';budget_cap_usd:number|null;spent_usd:number;budget_mode:'observe'|'warn'|'cap';pause_requested:boolean;total_items:number;queued_items:number;running_items:number;succeeded_items:number;failed_items:number;skipped_items:number;summary_error:string;created_at:string;updated_at:string};
export type ProductionItem = {id:string;run_id:string;stage:'panel'|'speech'|'video';target_type:string;target_id:string;position:number;status:'queued'|'running'|'succeeded'|'failed'|'skipped';attempt_count:number;result_metadata:Record<string,unknown>;error:string;created_at:string;updated_at:string};
export type ProductionReadiness = {episode_id:string;ready:boolean;video_ready?:boolean;totals:{shots:number;dialogue:number};ready_counts:{panels:number;approved:number;speech:number;videos?:number};blockers:{missing_panels:string[];stale_panels?:string[];unapproved_shots:string[];missing_speech:string[];missing_videos?:string[]}};
export type ProductionRunCreate = {stages:ProductionStage[];concurrency:number;regenerate_panels:boolean;regenerate_speech:boolean;regenerate_videos?:boolean;panel_generation_mode?:'solo'|'grid';budget_cap_usd?:number;budget_mode?:'observe'|'warn'|'cap';shot_ids?:string[]};
export type ProductionGraphScene={id:string;position:number;location:string;summary:string};
export type ProductionGraphShot={id:string;scene_id:string;position:number;shot_type:string;duration_seconds:number;composition:string;review_status:string;render_status:string;video_render_status:string;active_panel_asset_id:string|null;active_panel_media_url?:string|null;active_video_asset_id:string|null;active_video_media_url?:string|null;dialogue_ids?:string[];dialogue_count?:number;speech_ready_count?:number};
export type ProductionGraphAsset={id:string;kind:'variant'|'state'|'asset';label:string;media_url:string|null;version:number;status:string;shot_ids:string[]};
export type ProductionMediaDependency={source_shot_id:string;target_shot_id:string;source_kind:string;target_kind:string};
export type ProductionWorkflowBinding={id:string;project_id:string;capability:'panel'|'video';name:string;workflow_id:string;workflow_version:number;input_mapping_version:number;enabled:boolean};
export type ProductionCanvasLayout={version:1|2|3;viewport:{x:number;y:number;zoom:number};nodes:Record<string,{x:number;y:number}>;expanded_shots:string[];pinned_shots:string[];collapsed_scene_ids?:string[]};
export type EpisodeProductionGraph={episode_id:string;project_id:string;scenes:ProductionGraphScene[];shots:ProductionGraphShot[];assets:ProductionGraphAsset[];production_items:ProductionItem[];media_dependencies:ProductionMediaDependency[];workflow_bindings:ProductionWorkflowBinding[]};
