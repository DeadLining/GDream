export type AspectRatio = '9:16' | '16:9' | '1:1';
export type ReviewStatus = 'draft' | 'needs_changes' | 'approved';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type Character = {
  id: string; project_id: string; name: string; role: string;
  appearance_bible: string; personality: string; continuity_rules: string;
  negative_constraints: string; voice_speaker: string; voice_instruction: string;
  created_at: string; updated_at: string;
};

export type EpisodeSummary = {
  id: string; project_id: string; title: string; premise: string;
  target_duration_seconds: number; status: string; created_at: string; updated_at: string;
};

export type Project = {
  id: string; title: string; logline: string; story_bible: string; visual_style: string;
  aspect_ratio: AspectRatio; language: string; created_at: string; updated_at: string;
};

export type ProjectDetail = Project & {characters: Character[]; episodes: EpisodeSummary[]};

export type DialogueLine = {
  id: string; character_id: string | null; position: number; text: string;
  subtitle_text: string; emotion: string; performance_instruction: string;
  audio_asset_id: string | null; start_seconds: number; duration_seconds: number;
};

export type Shot = {
  id: string; position: number; shot_type: string; duration_seconds: number;
  composition: string; camera_motion: string; character_state: Record<string, unknown>;
  image_prompt: string; negative_prompt: string; active_panel_asset_id: string | null;
  review_status: ReviewStatus; render_status: string; dialogue: DialogueLine[];
  video_prompt?: string; negative_video_prompt?: string; active_video_asset_id?: string | null; video_render_status?: string;
};

export type Scene = {
  id: string; position: number; location: string; time_of_day: string; summary: string;
  continuity_state: Record<string, unknown>; estimated_duration_seconds: number; shots: Shot[];
};

export type EpisodeDetail = EpisodeSummary & {scenes: Scene[]};
export type EpisodeDeletionPreview={episode_id:string;title:string;deleted:{scenes:number;shots:number;dialogue_lines:number;assets:number}};
export type EpisodeDeletionResult=EpisodeDeletionPreview&{deleted_episode_id:string;cleanup_warnings:string[]};

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

export type ProviderHealthKind = 'llm' | 'image' | 'tts' | 'video';
export type ProviderHealthItem = {
  status: 'ok' | 'failed' | 'disabled';
  model: string;
  host: string;
  elapsed_ms: number;
  check_scope: 'model' | 'endpoint' | 'audio';
  error: string | null;
};
export type ProviderHealth = Record<ProviderHealthKind, ProviderHealthItem>;

export type ProviderChannelKind = 'llm' | 'image' | 'tts' | 'video';
export type ProviderChannelRead = {
  name: string;
  enabled: boolean;
  base_url: string;
  model: string;
  ssh_host: string;
  api_key_configured: boolean;
  api_key_masked: string;
};
export type ProviderChannelsRead = Record<ProviderChannelKind, ProviderChannelRead> & {
  persistence: {status: 'defaults' | 'saved'; file_path: string};
  reloaded_at: string;
};
export type ProviderChannelUpdate = {
  name: string;
  enabled: boolean;
  base_url: string;
  model: string;
  api_key: string;
  clear_api_key: boolean;
  ssh_host: string;
};
export type ProviderChannelUpdateRead = {channel: ProviderChannelRead; current: ProviderChannelsRead};
export type ProviderChannelTestResult = {
  status: 'ok' | 'failed';
  model: string;
  host: string;
  elapsed_ms: number;
  check_scope: 'model' | 'endpoint' | 'audio';
  error: string | null;
};

export type ModelCapability = 'text' | 'image' | 'speech' | 'video';
export type ModelRuntimeCapabilityHealth = {
  status: 'healthy' | 'unavailable' | 'disabled';
  model: string;
  host: string;
  elapsed_ms: number;
  last_invocation_elapsed_ms: number | null;
  error: string | null;
};
export type ModelRuntimeHealth = {
  capabilities: Record<ModelCapability, ModelRuntimeCapabilityHealth>;
  infrastructure: {
    api: {status: string};
    mock_ssh: {state: string; error?: string | null};
    queue: {queued: number; running: number};
    persistence: {status: string};
  };
  checked_at: string;
};
export type ModelInvocation = {
  id: string;
  capability: ModelCapability;
  provider: string;
  model: string;
  target_type: string;
  target_id: string;
  job_id: string | null;
  status: 'running' | 'succeeded' | 'failed';
  elapsed_ms: number;
  error_code: string;
  retryable: boolean;
  created_at: string;
  updated_at?: string;
};
export type ModelRuntimeJob = {job_id: string; capability: ModelCapability; status: JobStatus};

export type MockSshHost = {id: string; name: string; type: string};
export type MockSshState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
export type MockSshStatus = {
  desired_running: boolean;
  state: MockSshState;
  host_id: string | null;
  alias: string | null;
  port: number | null;
  error: string | null;
  reused: boolean;
};
export type MockSshStart = {host_id: string; alias: string};

export type ProductionStage = 'panels' | 'speech' | 'videos';
export type ProductionRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_failures';
export type ProductionRun = {id:string;episode_id:string;status:ProductionRunStatus;stages:ProductionStage[];concurrency:number;regenerate_panels:boolean;regenerate_speech:boolean;regenerate_videos?:boolean;pause_requested:boolean;total_items:number;queued_items:number;running_items:number;succeeded_items:number;failed_items:number;skipped_items:number;summary_error:string;created_at:string;updated_at:string};
export type ProductionItem = {id:string;run_id:string;stage:'panel'|'speech'|'video';target_type:string;target_id:string;position:number;status:'queued'|'running'|'succeeded'|'failed'|'skipped';attempt_count:number;result_metadata:Record<string,unknown>;error:string;created_at:string;updated_at:string};
export type ProductionReadiness = {episode_id:string;ready:boolean;video_ready?:boolean;totals:{shots:number;dialogue:number};ready_counts:{panels:number;approved:number;speech:number;videos?:number};blockers:{missing_panels:string[];unapproved_shots:string[];missing_speech:string[];missing_videos?:string[]}};
export type ProductionRunCreate = {stages:ProductionStage[];concurrency:number;regenerate_panels:boolean;regenerate_speech:boolean;regenerate_videos?:boolean};

export type ProjectCreate = Pick<Project, 'title' | 'logline' | 'story_bible' | 'visual_style' | 'aspect_ratio'> & {language?: string};
export type ProjectPatch = Partial<ProjectCreate>;
export type EpisodeCreate = Pick<EpisodeSummary, 'title' | 'premise' | 'target_duration_seconds'>;
export type EpisodePatch = Partial<EpisodeCreate>;
export type ShotPatch = Partial<Pick<Shot, 'duration_seconds' | 'composition' | 'camera_motion' | 'image_prompt' | 'negative_prompt' | 'video_prompt' | 'negative_video_prompt' | 'review_status'>>;
export type DialoguePatch = Partial<Pick<DialogueLine, 'character_id' | 'text' | 'subtitle_text' | 'emotion' | 'performance_instruction' | 'start_seconds'>>;

export type ScriptImportMode = 'generate' | 'auto' | 'screenplay' | 'prose';
export type ScriptImportDialogue = {speaker_draft_id:string|null;narration:boolean;text:string;subtitle_text:string;emotion:string;performance_instruction:string};
export type ScriptImportShot = {shot_type:string;duration_seconds:number;composition:string;camera_motion:string;character_state:Record<string,unknown>;image_prompt:string;negative_prompt:string;dialogue:ScriptImportDialogue[]};
export type ScriptImportScene = {location:string;time_of_day:string;summary:string;continuity_state:Record<string,unknown>;estimated_duration_seconds:number;shots:ScriptImportShot[]};
export type ScriptImportEpisode = {draft_id:string;enabled:boolean;title:string;premise:string;target_duration_seconds:number;scenes:ScriptImportScene[]};
export type ScriptImportCharacter = {draft_id:string;name:string;aliases:string[];role:string;appearance_bible:string;personality:string;continuity_rules:string;negative_constraints:string;voice_speaker:string;voice_instruction:string};
export type ScriptImportDraft = {project:{title:string;logline:string};characters:ScriptImportCharacter[];episodes:ScriptImportEpisode[];warnings:Array<{code:string;message:string;path:string}>};
export type ScriptImport = {id:string;project_id:string;script_revision_id:string|null;status:string;mode:ScriptImportMode;source_format:string;original_filename:string;checksum:string;extracted_text:string;structured_draft:ScriptImportDraft|Record<string,never>;error:string;error_category:string;created_at:string;updated_at:string;applied_at:string|null;generated_episode_ids:string[]};
export type ScriptRevisionStatus='working'|'finalized';
export type ScriptRevision={id:string;document_id:string;revision_number:number;status:ScriptRevisionStatus;content:string;checksum:string;creation_method:string;original_filename:string;source_file_path:string;source_media_type:string;generation_brief:string;generation_metadata:Record<string,unknown>;created_at:string};
export type ScriptDocumentSummary={id:string;project_id:string;title:string;source_type:'ai'|'paste'|'upload';status:'draft'|'generating'|'generation_failed'|'ready'|'archived';revision_count:number;current_revision_id:string|null;created_at:string;updated_at:string};
export type ScriptDocument=ScriptDocumentSummary&{current_revision:ScriptRevision;latest_import_id:string|null;parse_is_stale:boolean};
export type ScriptCreate={title:string;source_type:'ai'|'paste';content:string};
export type ScriptPatch={title?:string;content?:string;expected_checksum?:string};
export type ScriptSaveState='idle'|'saving'|'saved'|'failed'|'conflict';
export type ScriptDeleteConflict={code:'script_has_episodes';episodes:Array<{id:string;title:string}>};
export type CharacterReferenceType='primary'|'front'|'three_quarter'|'side'|'back'|'expression'|'outfit';
export type CharacterReference={id:string;character_id:string;reference_type:CharacterReferenceType;label:string;position:number;is_active:boolean;review_status:ReviewStatus;created_at:string;asset:Asset};
