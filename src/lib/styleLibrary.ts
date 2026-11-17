import { readTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';

export interface StylePreset {
  id: string;
  name: string;
  category: string;
  thumbnailPath: string;
  promptTemplate: string;
  visualDNA?: string;
  cameraLanguage?: string;
  promptSuffix?: string;
  /** Dedicated library identity. Generic legacy presets omit this field. */
  library?: 'general' | 'midjourney';
  creativityMode?: 'faithful' | 'balanced' | 'exploratory';
  stylize?: number;
  chaos?: number;
  raw?: boolean;
  negativePrompt?: string;
  recommendedVersion?: string;
  referenceStrategy?: 'prompt' | 'style-reference';
  styleWeight?: number;
  imageWeight?: number;
  weird?: number;
  /** Where the preset was calibrated; used as a quiet trust signal in the picker. */
  calibration?: 'api-tested' | 'director-calibrated';
  defaultAspectRatio?: string;
  /** Per-asset style reference images. A style may use different clean images for characters and scenes. */
  assetStyleReferences?: {
    character?: { presetId: string; imagePath: string; strength?: number; source?: 'library' | 'user-upload' };
    scene?: { presetId: string; imagePath: string; strength?: number; source?: 'library' | 'user-upload' };
    prop?: { presetId: string; imagePath: string; strength?: number; source?: 'library' | 'user-upload' };
  };
}

export interface StyleCategory {
  id: string;
  name: string;
  dir: string;
}

interface StyleIndex {
  categories: StyleCategory[];
  styles: Array<{
    id: string;
    name: string;
    category: string;
    thumbnail: string;
    promptTemplate: string;
    visualDNA?: string;
    cameraLanguage?: string;
    promptSuffix?: string;
    assetStyleReferences?: {
      character?: { presetId?: string; imagePath: string; strength?: number; source?: 'library' | 'user-upload' };
      scene?: { presetId?: string; imagePath: string; strength?: number; source?: 'library' | 'user-upload' };
      prop?: { presetId?: string; imagePath: string; strength?: number; source?: 'library' | 'user-upload' };
    };
  }>;
}

let cached: { categories: StyleCategory[]; styles: StylePreset[] } | null = null;

export async function loadStyleLibrary(): Promise<{ categories: StyleCategory[]; styles: StylePreset[] }> {
  if (cached) return cached;

  try {
    const raw = await readTextFile('.gdream/aigc-memory/style-library/index.json', {
      dir: BaseDirectory.Home,
    });
    const index = JSON.parse(raw) as StyleIndex;
    const home = await homeDir();
    const base = `${home}.gdream/aigc-memory/style-library/`;

    const styles: StylePreset[] = index.styles.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      thumbnailPath: `${base}${s.thumbnail}`,
      promptTemplate: s.promptTemplate,
      visualDNA: s.visualDNA,
      cameraLanguage: s.cameraLanguage,
      promptSuffix: s.promptSuffix,
      assetStyleReferences: s.assetStyleReferences ? Object.fromEntries(
        Object.entries(s.assetStyleReferences)
          .filter(([, value]) => Boolean(value?.imagePath))
          .map(([kind, value]) => [kind, {
            presetId: value!.presetId || s.id,
            imagePath: /^https?:\/\//i.test(value!.imagePath) ? value!.imagePath : `${base}${value!.imagePath}`,
            strength: value!.strength,
            source: value!.source ?? 'library',
          }]),
      ) : undefined,
    }));

    cached = { categories: index.categories, styles };
    return cached;
  } catch {
    return { categories: [], styles: [] };
  }
}

export function clearStyleLibraryCache(): void {
  cached = null;
}
