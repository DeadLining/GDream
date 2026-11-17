import type { WorkshopData } from './types.ts';

/** Idempotent migration: keep the chosen primary; never delete paid media files. */
export function migrateSingleSceneReferences(data: WorkshopData): boolean {
  let changed = false;
  for (const scene of data.scenes ?? []) {
    const paths = scene.selectedImagePaths ?? [];
    if (paths.length <= 1 && scene.sceneReferenceMode !== 'multi') continue;
    const primary = scene.assetImagePath || paths[0];
    if (!primary) continue;
    scene.assetImagePath = primary;
    scene.selectedImagePaths = [primary];
    scene.candidates = (scene.candidates ?? []).filter((candidate) => candidate.path === primary);
    delete scene.sceneReferenceMode;
    for (const shot of data.shots ?? []) {
      if (shot.sceneId !== scene.id) continue;
      shot.sceneImagePaths = [primary];
      shot.promptNeedsRefresh = true;
    }
    changed = true;
  }
  return changed;
}
