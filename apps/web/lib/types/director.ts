// Auto-split from lib/types.ts — domain: director
// Do not edit manually; regenerate via the split script if types.ts changes.

export type Vector3=[number,number,number];
export type Transform={position:Vector3;rotation:Vector3;scale:Vector3};
export type DirectorTransformMode='translate'|'rotate'|'scale';
export type DirectorPosePreset='neutral'|'dialogue'|'action'|'injured';
export type DirectorAnimationClip='idle'|'walk'|'run'|'talk'|'turn'|'injured';
export type DirectorObjectOverride={transform?:Transform;visible?:boolean;pose_preset?:DirectorPosePreset;animation_clip?:DirectorAnimationClip;animation_playing?:boolean};
export type DirectorObject={id:string;stage_id:string;kind:'character'|'prop'|'background'|'light'|'primitive';source_type:'placeholder'|'character_reference'|'scene_context'|'library_asset'|'asset'|'model';source_id:string|null;label:string;position:number;transform:Transform;appearance:Record<string,unknown>;metadata:Record<string,unknown>;visible:boolean};
export type ShotCamera={id:string;stage_id:string;shot_id:string;version:number;position:Vector3;target:Vector3;rotation:Vector3;focal_length_mm:number;near:number;far:number;shot_size:string;camera_motion:string;framing_guides:Record<string,unknown>;object_overrides:Record<string,DirectorObjectOverride>;preview_asset_id:string|null};
export type DirectorStage={id:string;scene_id:string;version:number;environment:Record<string,unknown>;objects:DirectorObject[];shot_cameras:ShotCamera[]};
export type DirectorAsset={key:string;kind:'character'|'prop'|'background';source_type:'character_reference'|'scene_context'|'library_asset'|'asset'|'model';source_id:string;asset_id:string|null;label:string;media_url:string|null;media_type?:string|null;metadata:Record<string,unknown>};
export type DirectorSuggestionKind='stage_layout'|'shot_composition';
export type DirectorSuggestion={id:string;stage_id:string;shot_id:string|null;kind:DirectorSuggestionKind;status:'ready'|'applied'|'failed';request_context:Record<string,unknown>;suggested_patch:Record<string,unknown>;error_category:string;error:string;created_at:string;applied_at:string|null};
export type DirectorApplyField='composition'|'camera_motion'|'image_prompt'|'negative_prompt';
