import type { AigcProject } from '@/lib/aigc/projectStore';
import type { WorkshopData, WorkshopStepId } from '@/lib/workshop/types';

export type PortfolioEventKind = 'project' | 'workflow';

export interface PortfolioEvent {
  id: string;
  projectId: string;
  projectName: string;
  at: number;
  kind: PortfolioEventKind;
  step?: WorkshopStepId;
  label: string;
  detail: string;
}

const stepLabels: Record<WorkshopStepId, string> = {
  script: '剧本',
  breakdown: '拆解',
  assets: '资产',
  prompts: '提示词',
  generate: '生成',
  handoff: '交付',
};

function safeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildPortfolioEvents(
  projects: AigcProject[],
  workshops: Record<string, WorkshopData | null | undefined>,
  limit = 40,
): PortfolioEvent[] {
  const events: PortfolioEvent[] = [];
  for (const project of projects) {
    events.push({
      id: `${project.id}:project-created`,
      projectId: project.id,
      projectName: project.name,
      at: safeTimestamp(project.createdAt, project.updatedAt),
      kind: 'project',
      label: '项目创建',
      detail: project.name,
    });
    const workshop = workshops[project.id];
    for (const [index, entry] of (workshop?.changelog ?? []).entries()) {
      const step = entry.step;
      events.push({
        id: `${project.id}:workflow:${entry.at}:${index}`,
        projectId: project.id,
        projectName: project.name,
        at: safeTimestamp(entry.at, project.updatedAt),
        kind: 'workflow',
        step,
        label: stepLabels[step] ?? step,
        detail: entry.summary,
      });
    }
  }
  return events
    .sort((left, right) => right.at - left.at || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, limit));
}
