import { safeEvidence } from './evidence.ts';
export { safeEvidence } from './evidence.ts';
import type { RunStep, RunSession } from '../../stores/runStepStore';
import type { WorkshopData } from '../workshop/types';

export interface ShotReceipt {
  shotNo: string; description: string; durationSec?: number; camera?: string; dialogue?: string;
  materials: string[]; imagePath?: string; videoPath?: string;
}
export interface RunOutcome {
  id: string; at: number; toolId: string; title: string; projectId: string;
  shots: ShotReceipt[]; summary: string; receipt?: string;
}
export interface RunDecision {
  id: string; at: number; resolvedAt?: number; title: string;
  questions: string[]; answers?: string[]; status: 'pending' | 'answered' | 'cancelled' | 'interrupted';
}

/** Model todo declarations are plans, not evidence of successful execution. */
export function evidencedStepStatus(step: RunStep): RunStep['status'] {
  const calls = step.toolCalls.filter((t) => t.name !== 'todo_write');
  const subtasks = step.subAgents ?? [];
  if (subtasks.some((sub) => sub.status === 'failed')) return 'failed';
  if (calls.some((tool) => tool.status === 'failed')) return 'failed';
  if (subtasks.some((sub) => sub.status === 'running')) return 'active';
  if (calls.some((tool) => tool.status === 'running')) return 'active';
  if ((calls.length || subtasks.length) && calls.every((tool) => tool.status === 'done') && subtasks.every((sub) => sub.status === 'completed')) return 'done';
  return step.status === 'done' ? 'pending' : step.status;
}
export function settledRun(run: RunSession): RunSession {
  if (run.status !== 'running') return run;
  return { ...run, workshopShotSync: undefined, status: 'aborted', endedAt: run.endedAt ?? Date.now(),
    decisions: run.decisions?.map((d) => d.status === 'pending' ? { ...d, status: 'interrupted' } : d),
    steps: run.steps.map((s) => ({ ...s, status: s.status === 'active' ? 'skipped' : s.status,
      subAgents: (s.subAgents ?? []).map((sub) => sub.status === 'running' ? { ...sub, status: 'failed', error: '运行已中断，未收到完成回执。' } : sub),
      toolCalls: s.toolCalls.map((t) => t.status === 'running' ? { ...t, status: 'interrupted' } : t) })) };
}

/** Apply the same evidence boundary to cache, old archives and new writes. */
export function sanitizeRunEvidence(run: RunSession): RunSession {
  const { userRequest, workshopShotSync: _authority, ...evidence } = run;
  return { ...(safeEvidence(evidence) as Omit<RunSession, 'userRequest'>), userRequest };
}

/** Snapshot only a successful write's saved project data, never model prose. */
export function savedShotOutcome(name: string, params: Record<string, unknown>, success: boolean,
  data: WorkshopData | null, projectId: string | undefined, toolId: string, output?: string): RunOutcome | undefined {
  if (!success || !data || data.projectId !== projectId) return undefined;
  if (!['workshop_set_shots', 'workshop_set_prompts', 'workshop_update_shot'].includes(name)) {
    if (!/^workshop_(?:prepare_ad_materials|set_ad_product_images|generate|set_assets|record_|review_|complete_|set_step_status)/.test(name) || !output) return undefined;
    return { id: `outcome-${toolId}`, toolId, at: Date.now(), projectId: data.projectId, shots: [],
      title: name.includes('generate') ? '生成操作回执（不代表媒体全部完成）' : name.includes('ad_') ? '广告资料与素材回执' : '检查／保存回执',
      summary: '实际工具回执，非模型总结。', receipt: safeEvidence(output) as string };
  }
  const entries = (Array.isArray(params.shots) ? params.shots : Array.isArray(params.prompts) ? params.prompts : []) as Array<Record<string, unknown>>;
  const selected = new Set(entries.map((s) => String(s.shotNo ?? s.shot_no ?? '')));
  if (params.shot_no) selected.add(String(params.shot_no));
  const shots = data.shots.filter((shot) => selected.has(shot.shotNo));
  if (!shots.length) return undefined;
  return { id: `outcome-${toolId}`, toolId, at: Date.now(), projectId: data.projectId,
    title: name === 'workshop_set_prompts' ? '已保存分镜提示词' : '已保存分镜方案',
    summary: '来自成功写入回执与当时的项目快照；不代表素材已生成或审核通过。',
    shots: shots.map((s) => ({ shotNo: s.shotNo, description: s.description, durationSec: s.durationSec,
      camera: s.camera, dialogue: s.dialogue,
      materials: [...s.characterIds.map((id) => `角色：${data.characters.find((c) => c.id === id)?.name ?? id}`),
        ...(s.sceneId ? [`场景：${data.scenes.find((c) => c.id === s.sceneId)?.name ?? s.sceneId}`] : []),
        ...(s.propIds ?? []).map((id) => `道具：${id}`), ...(s.extraRefImages ?? []), ...(s.productReferenceImages ?? [])],
      imagePath: s.imagePath, videoPath: s.videoPath })) };
}
