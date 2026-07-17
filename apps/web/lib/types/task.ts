export type TaskChecklistItem={label:string;done:boolean};
export type ProductionTask={id:string;project_id:string;episode_id:string|null;scene_id:string|null;shot_id:string|null;review_thread_id:string|null;title:string;description:string;priority:'low'|'medium'|'high'|'critical';status:'todo'|'in_progress'|'review'|'completed'|'cancelled';assignee:string;due_at:string|null;checklist:TaskChecklistItem[];created_at:string;updated_at:string};
export type ProductionTaskCreate=Pick<ProductionTask,'title'|'description'|'priority'|'assignee'|'due_at'|'episode_id'|'scene_id'|'shot_id'|'review_thread_id'|'checklist'>;
export type ProductionTaskPatch=Partial<Pick<ProductionTask,'title'|'description'|'priority'|'status'|'assignee'|'due_at'|'checklist'>>;
