// Auto-split from lib/types.ts — domain: character
// Do not edit manually; regenerate via the split script if types.ts changes.

import type {ReviewStatus} from './common';
import type {Asset} from './asset-job';

export type CharacterReferenceType='primary'|'front'|'three_quarter'|'side'|'back'|'expression'|'outfit';
export type CharacterReference={id:string;character_id:string;reference_type:CharacterReferenceType;label:string;position:number;is_active:boolean;review_status:ReviewStatus;created_at:string;asset:Asset};
export type AssetVariantUsage={id:string;variant_id:string;state_id:string|null;shot_id:string;asset_id:string|null;usage_kind:'panel'|'video'|'reference';created_at:string};
export type AssetVariantState={id:string;variant_id:string;kind:'expression'|'outfit'|'injury'|'age'|'custom';label:string;overrides:Record<string,unknown>;version:number;created_at:string;updated_at:string};
export type AssetVariant={id:string;character_id:string;episode_id:string|null;parent_variant_id:string|null;kind:'master'|'episode';label:string;inherited_fields:string[];overrides:Record<string,unknown>;version:number;review_status:ReviewStatus;created_at:string;updated_at:string;states:AssetVariantState[];usages:AssetVariantUsage[]};
export type CharacterReferenceSetMetadata={
  capability:'image';mode:'reference_set';current_type:CharacterReferenceType|null;
  current_index:number;total:number;completed_types:CharacterReferenceType[];
  references:Partial<Record<CharacterReferenceType,{reference_id:string;asset_id:string;reused?:boolean}>>;
  anchor_reference_id:string;anchor_asset_id:string;failed_type?:CharacterReferenceType;
  error_code?:string;retryable?:boolean;
};
