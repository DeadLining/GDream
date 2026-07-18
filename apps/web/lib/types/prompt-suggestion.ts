export type MediaPromptSuggestion = {
  mode: 'panel' | 'video';
  prompt: string;
  negative_prompt: string;
  rationale: string;
  used_context: string[];
};

export type ShotGenerationContext={
  shot_id:string;mode:'panel'|'video';snapshot_hash:string;prompt_constraints:string;
  library_assets:Array<{id:string;kind:'scene'|'prop'|'costume'|'sound';name:string;description:string;tags:string[]}>;
  director:{environment:Record<string,unknown>;camera:{position:number[];target:number[];rotation:number[];focal_length_mm:number;shot_size:string;camera_motion:string;framing_guides:Record<string,unknown>}|null;objects:Array<{id:string;kind:string;source_type:string;source_id:string|null;label:string;position:number[];horizontal_facing_degrees:number}>}|null;
  references:Array<{asset_id:string;label:string;media_url:string;media_type:string;role:'previous_shot_tail'|'director_preview'|'director_guidance'|'character_reference'|'bound_asset';guidance_kind:string|null}>;
};
