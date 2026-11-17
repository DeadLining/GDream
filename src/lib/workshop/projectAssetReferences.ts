import type { WorkshopData, WorkshopAssetKind, WsShot } from './types.ts';
import { buildImageRefBindings, buildRefAwarePatch, getSceneReferencePaths } from './shotRefs.ts';

type ProjectAssets = Pick<WorkshopData, 'characters' | 'scenes' | 'props' | 'colorPalettes'>;

export interface ProjectAssetImage {
  kind: WorkshopAssetKind;
  assetId: string;
  name: string;
  path: string;
  angle?: number;
}

/** Only adopted images and explicitly selected scene angles, never unadopted candidates. */
export function projectAssetImages(data: ProjectAssets): ProjectAssetImage[] {
  const images: ProjectAssetImage[] = [];
  const seen = new Set<string>();
  const add = (kind: WorkshopAssetKind, asset: { id: string; name: string }, path?: string, angle?: number) => {
    if (!path?.trim() || seen.has(path)) return;
    seen.add(path);
    images.push({ kind, assetId: asset.id, name: asset.name, path, ...(angle ? { angle } : {}) });
  };
  for (const character of data.characters) add('character', character, character.assetImagePath);
  for (const scene of data.scenes) {
    add('scene', scene, scene.assetImagePath);
    if (scene.sceneReferenceMode === 'multi') {
      scene.selectedImagePaths?.forEach((path, index) => add('scene', scene, path, index + 1));
    }
  }
  for (const prop of data.props ?? []) add('prop', prop, prop.assetImagePath);
  for (const palette of data.colorPalettes ?? []) add('colorPalette', palette, palette.assetImagePath);
  return images;
}

export function buildProjectAssetReferencePatch(
  shot: WsShot,
  data: ProjectAssets & Pick<WorkshopData, 'globalColorPaletteId' | 'creativeSpec'>,
  paths: readonly string[],
): Partial<WsShot> {
  const available = new Set(projectAssetImages(data).map((image) => image.path));
  if (paths.some((path) => !available.has(path))) {
    throw new Error('所选图片已不在当前项目资产中，请重新选择。');
  }
  const context = { ...data, props: data.props ?? [] };
  const existing = new Set(buildImageRefBindings(shot, context).map((ref) => ref.path));
  const additions = [...new Set(paths)].filter((path) => !existing.has(path));
  if (!additions.length) return {};
  const scenePath = data.scenes.find((scene) => scene.id === shot.sceneId)?.assetImagePath;
  // Re-adding the assigned scene must satisfy scene preflight, not become an anonymous extra.
  const restoreScene = scenePath && additions.includes(scenePath) && getSceneReferencePaths(shot, data.scenes).length === 0;
  const extras = additions.filter((path) => !restoreScene || path !== scenePath);
  return buildRefAwarePatch(shot, {
    ...(restoreScene ? { sceneImagePaths: [scenePath] } : {}),
    ...(extras.length ? { extraRefImages: [...new Set([...(shot.extraRefImages ?? []), ...extras])] } : {}),
    promptNeedsRefresh: true,
  }, context);
}
