import type { StylePreset } from '@/lib/styleLibrary';
import { loadStyleLibrary } from '@/lib/styleLibrary';
import { loadMidjourneyStyleLibrary } from '@/lib/midjourney/styles';
import type { WorkshopAssetKind, WorkshopData } from './types';

export type StyleReferenceKind = 'character' | 'scene' | 'prop';

export interface StyleReferenceAsset {
  /** Stable preset identity. Names are display-only and may be localized. */
  presetId: string;
  /** Image actually submitted as the style reference. */
  imagePath: string;
  /** Optional per-kind strength hint for providers that expose one. */
  strength?: number;
  /** Source of the image, useful for UI diagnostics and migration. */
  source?: 'library' | 'user-upload';
}

export interface AssetStyleReferences {
  character?: StyleReferenceAsset;
  scene?: StyleReferenceAsset;
  prop?: StyleReferenceAsset;
}

/** The resolved style asset reference used for one concrete generation. */
export interface ResolvedStyleReference {
  kind: StyleReferenceKind;
  presetId: string;
  presetName: string;
  imagePath: string;
  strength?: number;
  source: 'library' | 'user-upload';
  /** True when the image was borrowed from another asset kind as a fallback. */
  fallback: boolean;
}

function normalizedName(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function kindForAsset(kind: WorkshopAssetKind): StyleReferenceKind | undefined {
  if (kind === 'character' || kind === 'scene' || kind === 'prop') return kind;
  return undefined;
}

/**
 * Resolve the configured reference for one asset kind. Character/scene keep
 * strict separation. Props may borrow the scene reference because their style
 * is normally the same world material language, but fallback is made explicit.
 */
export function resolveStyleReferenceFromConfig(
  references: AssetStyleReferences | undefined,
  kind: StyleReferenceKind,
): { reference: StyleReferenceAsset; fallback: boolean } | undefined {
  if (!references) return undefined;
  const direct = references[kind];
  if (direct?.imagePath) return { reference: direct, fallback: false };

  // A visual style reference must carry the same medium/colour/material
  // language. Borrowing character for scene (or vice versa) is worse than no
  // reference at all, so only props fall back to the scene pack.
  if (kind === 'prop' && references.scene?.imagePath) {
    return { reference: references.scene, fallback: true };
  }
  return undefined;
}

/** Parse the persisted project style config into a stable reference map. */
export function styleReferencesFromPreset(preset: StylePreset | undefined): AssetStyleReferences {
  if (!preset) return {};
  const direct = (preset.assetStyleReferences ?? {}) as AssetStyleReferences;
  const refs: AssetStyleReferences = {};
  for (const kind of ['character', 'scene', 'prop'] as const) {
    const item = direct[kind];
    if (item?.imagePath) refs[kind] = { ...item, presetId: item.presetId || preset.id, source: item.source ?? 'library' };
  }
  return refs;
}

/** Load the actual style preset selected on a project. */
export async function loadSelectedStylePreset(style: WorkshopData['style']): Promise<StylePreset | undefined> {
  if (!style?.styleLibraryRef && !style?.midjourneyStyleId) return undefined;
  const lib = style.library === 'midjourney'
    ? await loadMidjourneyStyleLibrary()
    : await loadStyleLibrary();
  return lib.styles.find((candidate) => (
    (style.midjourneyStyleId && candidate.id === style.midjourneyStyleId)
    || normalizedName(candidate.name) === normalizedName(style.styleLibraryRef)
  ));
}

/**
 * Resolve a concrete style reference for an asset. Persisted explicit refs win;
 * otherwise the selected preset's per-kind pack is used. Legacy libraries with
 * only one thumbnail intentionally return no reference for characters/scenes
 * so a mixed cover image cannot silently control the wrong asset type.
 */
export async function resolveAssetStyleReference(
  style: WorkshopData['style'],
  kind: WorkshopAssetKind,
): Promise<ResolvedStyleReference | undefined> {
  const refKind = kindForAsset(kind);
  if (!refKind || !style) return undefined;

  const explicit = resolveStyleReferenceFromConfig(style.assetStyleReferences, refKind);
  if (explicit) {
    return {
      kind: refKind,
      presetId: explicit.reference.presetId || style.midjourneyStyleId || style.styleLibraryRef || '',
      presetName: style.styleLibraryRef || explicit.reference.presetId || '',
      imagePath: explicit.reference.imagePath,
      strength: explicit.reference.strength,
      source: explicit.reference.source ?? 'library',
      fallback: explicit.fallback,
    };
  }

  const preset = await loadSelectedStylePreset(style);
  const resolved = resolveStyleReferenceFromConfig(styleReferencesFromPreset(preset), refKind);
  if (!resolved) return undefined;
  return {
    kind: refKind,
    presetId: resolved.reference.presetId || preset?.id || '',
    presetName: preset?.name || style.styleLibraryRef || resolved.reference.presetId || '',
    imagePath: resolved.reference.imagePath,
    strength: resolved.reference.strength,
    source: resolved.reference.source ?? 'library',
    fallback: resolved.fallback,
  };
}

/** Prompt language that prevents a style image from becoming an identity/layout reference. */
export function styleReferenceConstraint(kind: StyleReferenceKind, fallback = false): string {
  const subject = kind === 'character'
    ? 'the generated character'
    : kind === 'scene'
      ? 'the generated scene'
      : 'the generated prop';
  const borrowed = fallback ? ' This is a scene-style reference borrowed for the prop.' : '';
  return `STYLE REFERENCE ONLY: use the attached style reference to control the visual language of ${subject} - medium, line quality, brush or material texture, color grading, lighting treatment, rendering technique and degree of stylization. Do not copy its specific identity, face, costume, pose, composition, camera angle, individual props, environment layout or readable text.${borrowed}`;
}
