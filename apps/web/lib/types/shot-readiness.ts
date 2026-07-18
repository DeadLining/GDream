export type ShotGenerationReadiness={
  shot_id:string;
  project_id:string;
  script_revision_id:string;
  ready:boolean;
  asset_ready:boolean;
  blocking_ready:boolean;
  camera_ready:boolean;
  blockers:string[];
  requirement_ids:string[];
};
