import type {AssetImpact} from './types';

export function normalizeAssetImpact(report: Partial<AssetImpact> | null | undefined): AssetImpact {
  const shots = Array.isArray(report?.shots) ? report.shots : [];
  return {
    shots,
    assets: Array.isArray(report?.assets) ? report.assets : [],
    usage_count: typeof report?.usage_count === 'number' ? report.usage_count : shots.length,
    episodes: Array.isArray(report?.episodes) ? report.episodes : [],
  };
}
