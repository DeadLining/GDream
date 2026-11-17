import type { AigcProject } from '@/lib/aigc/projectStore';
import type { WorkshopData, WorkshopStepId } from './types.ts';
import { reasonsForStepCompletion } from './stepStatus.ts';

export interface WorkshopNextAction {
  step: WorkshopStepId;
  label: string;
  detail: string;
  blocking: boolean;
}

const stepLabels: Record<WorkshopStepId, string> = {
  script: '剧本',
  breakdown: '拆解',
  assets: '资产',
  prompts: '提示词',
  generate: '生成',
  handoff: '交付',
};

export function getWorkshopNextAction(data: WorkshopData, project?: Pick<AigcProject, 'sources'> | null): WorkshopNextAction {
  const ordered: WorkshopStepId[] = ['script', 'breakdown', 'assets', 'prompts', 'generate', 'handoff'];
  for (const step of ordered) {
    if (data.steps[step]?.status === 'done') continue;
    const reasons = reasonsForStepCompletion({ data, project, step });
    return {
      step,
      label: `下一步：${stepLabels[step]}`,
      detail: reasons[0] ?? `完成${stepLabels[step]}步骤并保存当前结果。`,
      blocking: reasons.length > 0,
    };
  }
  return { step: 'handoff', label: '下一步：复核并交付', detail: '所有步骤已完成，请在交付页复核当前 manifest 和正式绑定。', blocking: false };
}
