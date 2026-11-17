import type { AigcProject, AigcProjectStatus } from './projectStore.ts';

export interface AigcPortfolioStats {
  projectCount: number;
  shotCount: number;
  completedVideoCount: number;
  activeProjectCount: number;
  statusCounts: Partial<Record<AigcProjectStatus, number>>;
}

export type AigcProjectFilterStatus = AigcProjectStatus | 'all';

const ACTIVE_STATUSES = new Set<AigcProjectStatus>([
  'parsed',
  'prompts-ready',
  'scenes-ready',
  'assets-ready',
  'video-generating',
]);

export function summarizeAigcProjects(projects: AigcProject[]): AigcPortfolioStats {
  const statusCounts: Partial<Record<AigcProjectStatus, number>> = {};
  for (const project of projects) statusCounts[project.status] = (statusCounts[project.status] ?? 0) + 1;
  return {
    projectCount: projects.length,
    shotCount: projects.reduce((total, project) => total + (project.stats?.shots ?? 0), 0),
    completedVideoCount: projects.reduce((total, project) => total + (project.stats?.videosCompleted ?? 0), 0),
    activeProjectCount: projects.filter((project) => ACTIVE_STATUSES.has(project.status)).length,
    statusCounts,
  };
}

export function searchAigcProjects(projects: AigcProject[], query: string): AigcProject[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return projects;
  return projects.filter((project) => [project.name, project.slug, project.id]
    .some((value) => value.toLocaleLowerCase().includes(normalized)));
}

export function filterAigcProjects(projects: AigcProject[], query: string, status: AigcProjectFilterStatus = 'all'): AigcProject[] {
  const searched = searchAigcProjects(projects, query);
  return status === 'all' ? searched : searched.filter((project) => project.status === status);
}
