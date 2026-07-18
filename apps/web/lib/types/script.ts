// Auto-split from lib/types.ts — domain: script
// Do not edit manually; regenerate via the split script if types.ts changes.

export type ScriptImportMode = 'generate' | 'auto' | 'screenplay' | 'prose';
export type ScriptImportDialogue = {speaker_draft_id:string|null;narration:boolean;text:string;subtitle_text:string;emotion:string;performance_instruction:string};
export type ScriptImportShot = {shot_type:string;duration_seconds:number;composition:string;camera_motion:string;character_state:Record<string,unknown>;image_prompt:string;negative_prompt:string;dialogue:ScriptImportDialogue[]};
export type ScriptImportProp = {name:string;description:string;required:boolean};
export type ScriptImportScene = {location:string;time_of_day:string;summary:string;continuity_state:Record<string,unknown>;props:ScriptImportProp[];estimated_duration_seconds:number;shots:ScriptImportShot[]};
export type ScriptImportEpisode = {draft_id:string;enabled:boolean;title:string;premise:string;target_duration_seconds:number;scenes:ScriptImportScene[]};
export type ScriptImportCharacter = {entity_kind:'character';draft_id:string;name:string;aliases:string[];role:string;appearance_bible:string;personality:string;continuity_rules:string;negative_constraints:string;voice_speaker:string;voice_instruction:string};
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
