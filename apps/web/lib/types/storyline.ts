// Auto-split from lib/types.ts — domain: storyline
// Do not edit manually; regenerate via the split script if types.ts changes.

import type {EpisodeSummary} from './project-episode';

export type Volume = {
  id:string;project_id:string;position:number;title:string;summary:string;
  created_at:string;updated_at:string;episodes:EpisodeSummary[];
};
export type StorylineKind='foreshadowing'|'character_arc'|'conflict'|'mystery'|'theme';
export type StorylineStage='setup'|'development'|'escalation'|'payoff'|'resolved';
export type StorylineEvent={id:string;storyline_id:string;episode_id:string;scene_id:string|null;shot_id:string|null;position:number;stage:StorylineStage;title:string;description:string;setup_event_id:string|null;payoff_event_id:string|null;metadata:Record<string,unknown>;created_at:string;updated_at:string};
export type Storyline={id:string;project_id:string;title:string;kind:StorylineKind;color:string;description:string;created_at:string;updated_at:string;events:StorylineEvent[]};
