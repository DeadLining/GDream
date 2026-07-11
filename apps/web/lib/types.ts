export type DialogueLine = {
  id: string;
  character_id?: string | null;
  text?: string;
  subtitle_text?: string;
  emotion?: string;
  performance_instruction?: string;
  audio_asset_id?: string | null;
  start_seconds?: number;
  duration_seconds?: number;
};

export type Shot = {
  id: string;
  position: number;
  shot_type: string;
  duration_seconds: number;
  composition: string;
  camera_motion: string;
  review_status: string;
  image_prompt: string;
  active_panel_asset_id: string | null;
  dialogue: DialogueLine[];
};

export type Scene = {
  id: string;
  position: number;
  location: string;
  time_of_day: string;
  summary: string;
  estimated_duration_seconds: number;
  shots: Shot[];
};

export type EpisodeDetail = {
  id: string;
  project_id: string;
  title: string;
  premise: string;
  target_duration_seconds: number;
  status: string;
  scenes: Scene[];
};

export type ProjectSummary = {
  id: string;
  title: string;
};
