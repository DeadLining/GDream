export type GlobalSection = 'overview' | 'script' | 'assets' | 'episode' | 'review';

export type WorkArea =
  | 'overview'
  | 'scene'
  | 'import'
  | 'characters'
  | 'storyboard'
  | 'director'
  | 'production'
  | 'visual-review'
  | 'review'
  | 'inspector';

export type PlatformPage =
  | 'project'
  | 'models'
  | 'settings'
  | 'home'
  | 'tasks'
  | 'versions'
  | 'trash'
  | 'team'
  | 'export';

export type OperationsDestination =
  | 'recent'
  | 'projects'
  | 'shared'
  | 'archive'
  | 'trash'
  | 'team'
  | 'export'
  | 'settings';

export const globalSectionWorkAreas = {
  overview: 'overview',
  script: 'import',
  assets: 'characters',
  episode: 'overview',
  review: 'review',
} as const satisfies Record<GlobalSection, WorkArea>;

export const operationsPlatformPages = {
  recent: 'home',
  projects: 'home',
  shared: 'home',
  archive: 'home',
  trash: 'trash',
  team: 'team',
  export: 'export',
  settings: 'settings',
} as const satisfies Record<OperationsDestination, PlatformPage>;

export function resolveOperationsPage(destination: string): PlatformPage | null {
  return destination in operationsPlatformPages
    ? operationsPlatformPages[destination as OperationsDestination]
    : null;
}
