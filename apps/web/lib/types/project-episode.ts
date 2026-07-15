// Auto-split from lib/types.ts — domain: project-episode
// Do not edit manually; regenerate via the split script if types.ts changes.

import type {AspectRatio, ReviewStatus} from './common';

export type CharacterBodyPlan='humanoid'|'quadruped'|'bird'|'other';
export type Character = {
  id: string; project_id: string; name: string; role: string;
  body_plan?: CharacterBodyPlan;
  appearance_bible: string; personality: string; continuity_rules: string;
  negative_constraints: string; voice_speaker: string; voice_instruction: string;
  created_at: string; updated_at: string;
};
export type EpisodeSummary = {
  id: string; project_id: string; title: string; premise: string;
  volume_id?: string | null; position?: number; target_duration_seconds: number; status: string; created_at: string; updated_at: string;
};
export type Project = {
  id: string; title: string; logline: string; story_bible: string; visual_style: string;
  aspect_ratio: AspectRatio; language: string; created_at: string; updated_at: string;
};
export type ProjectDetail = Project & {characters: Character[]; episodes: EpisodeSummary[]};
export type ProjectOverviewMetrics={project_id:string;scene_count:number;script_locked:boolean;asset_total:number;asset_ready:number};
export type DialogueLine = {
  id: string; character_id: string | null; position: number; text: string;
  subtitle_text: string; emotion: string; performance_instruction: string;
  audio_asset_id: string | null; start_seconds: number; duration_seconds: number;
};
export type Shot = {
  id: string; position: number; shot_type: string; duration_seconds: number;
  composition: string; camera_motion: string; character_state: Record<string, unknown>;
  image_prompt: string; negative_prompt: string; active_panel_asset_id: string | null;
  previous_shot_tail_asset_id?: string | null;
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
export type ProjectCreate = Pick<Project, 'title' | 'logline' | 'story_bible' | 'visual_style' | 'aspect_ratio'> & {language?: string};
export type ProjectPatch = Partial<ProjectCreate>;
export type EpisodeCreate = Pick<EpisodeSummary, 'title' | 'premise' | 'target_duration_seconds'>;
export type EpisodePatch = Partial<EpisodeCreate>;
export type ShotPatch = Partial<Pick<Shot, 'duration_seconds' | 'composition' | 'camera_motion' | 'image_prompt' | 'negative_prompt' | 'video_prompt' | 'negative_video_prompt' | 'review_status' | 'previous_shot_tail_asset_id'>>;
export type DialoguePatch = Partial<Pick<DialogueLine, 'character_id' | 'text' | 'subtitle_text' | 'emotion' | 'performance_instruction' | 'start_seconds'>>;
export type SceneCreate=Pick<Scene,'location'|'time_of_day'|'summary'|'continuity_state'|'estimated_duration_seconds'>;
export type ScenePatch=Partial<SceneCreate>;
export type StructureShotCreate=Pick<Shot,'shot_type'|'duration_seconds'|'composition'|'camera_motion'|'character_state'|'image_prompt'|'negative_prompt'>&Pick<Shot,'video_prompt'|'negative_video_prompt'>;
export type StructureMutation={episode_id:string;resource_id:string;affected_shot_ids:string[];invalidated_stages:Array<'panels'|'videos'>};
