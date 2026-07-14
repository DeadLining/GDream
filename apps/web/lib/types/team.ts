// Auto-split from lib/types.ts — domain: team
// Do not edit manually; regenerate via the split script if types.ts changes.

export type ProjectMemberRole='producer'|'writer'|'editor'|'character_artist'|'storyboard_artist'|'director'|'reviewer'|'admin';
export type ProjectMember={id:string;project_id:string;name:string;email:string;role:ProjectMemberRole;scope:Record<string,string[]>;capabilities:Record<string,string[]>;status:'active'|'invited'|'disabled';created_at:string;updated_at:string};
export type ProjectMemberCreate=Pick<ProjectMember,'name'|'email'|'role'|'scope'|'capabilities'>;
export type ProjectMemberPatch=Partial<Pick<ProjectMember,'name'|'role'|'scope'|'capabilities'|'status'>>;
export type TaskChecklistItem={label:string;done:boolean};
export type ProductionTask={id:string;project_id:string;episode_id:string|null;scene_id:string|null;shot_id:string|null;review_thread_id:string|null;title:string;description:string;priority:'low'|'medium'|'high'|'critical';status:'todo'|'in_progress'|'review'|'completed'|'cancelled';assignee:string;due_at:string|null;checklist:TaskChecklistItem[];created_at:string;updated_at:string};
export type ProductionTaskCreate=Pick<ProductionTask,'title'|'description'|'priority'|'assignee'|'due_at'|'episode_id'|'scene_id'|'shot_id'|'review_thread_id'|'checklist'>;
export type ProductionTaskPatch=Partial<Pick<ProductionTask,'title'|'description'|'priority'|'status'|'assignee'|'due_at'|'checklist'>>;
