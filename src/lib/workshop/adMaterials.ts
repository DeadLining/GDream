import type { AdShotReferencePlan } from './adReferencePlan.ts';
import type { AdCreativeSpec } from './adSpec.ts';
export interface AdSource { url: string; title: string; content: string }
export interface AdMaterials {
  referencePlan?: {snapshot: string; createdAt: number; plans: AdShotReferencePlan[]};
  fingerprint: string;
  preparedAt: number;
  mode: 'online' | 'provided-only';
  sources: AdSource[];
  images: { url: string; path: string; purpose: 'inspiration' }[];
  productImages: string[];
  warnings: string[];
  /** DSH selected references, not identity or publication approval. */
  curatedSourceUrls?: string[];
  curatedImageUrls?: string[];
}
export function adMaterialsFingerprint(spec: AdCreativeSpec): string {
  return JSON.stringify([spec.productName.trim(), spec.productCategory, spec.audience, spec.objective,
    spec.keyMessage ?? '', spec.researchMode ?? 'online', spec.productImages ?? []]);
}
export function adMaterialsError(spec?: {workKind?: string; adSpec?: AdCreativeSpec}): string | undefined {
  if (spec?.workKind !== 'product-ad') return;
  const ad = spec.adSpec;
  if (!ad?.productName.trim()) return '请先填写产品 / 品牌名称。';
  if (!ad.materials || ad.materials.fingerprint !== adMaterialsFingerprint(ad)) {
    return '广告资料尚未准备或已过期，请先调用 workshop_prepare_ad_materials，查看返回的产品图和资料后再设计。联网不可用时请让用户开启联网并配置 Tavily，或明确选择「仅用已提供资料」，不要虚构已完成调研。';
  }
  if ((ad.researchMode ?? 'online') === 'online' && !ad.materials.sources.length) return '广告联网调研没有有效来源，请重新准备资料。';
}
function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try { const u = new URL(value); if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password) return value; } catch { /* invalid */ }
}
export function parseAdSearchResult(output: string): {sources: AdSource[]; images: string[]} {
  for (const line of output.split('\n')) {
    try {
      const json = JSON.parse(line);
      if (!Array.isArray(json.results)) continue;
      const sources: AdSource[] = json.results.flatMap((r: Record<string, unknown>) => {
        const url = httpUrl(r?.url);
        return url ? [{url,title:String(r.title ?? '').slice(0,300),content:String(r.content ?? '').slice(0,2400)}] : [];
      }).slice(0,8);
      if (!sources.length) continue;
      const candidates = [...(Array.isArray(json.images) ? json.images : []), ...json.results.flatMap((r: {images?: unknown[]}) => Array.isArray(r?.images) ? r.images : [])];
      const images = [...new Set(candidates.map(v => httpUrl(typeof v === 'string' ? v : v?.url)).filter((v): v is string => !!v))].slice(0,12);
      return {sources,images};
    } catch { /* prefixes/non-JSON content */ }
  }
  throw new Error('搜索未返回可保存的网页来源，不能视为已完成广告调研。');
}


export type AdGenerationReferenceRole = 'product-identity' | 'creative-reference';

export interface AdGenerationReference {
  path: string;
  role: AdGenerationReferenceRole;
  sourceUrl?: string;
}

/**
 * Resolve the references that an image/video generation call may inherit from
 * the current product-ad record.  Product identity is explicit user input;
 * web images are deliberately opt-in via curatedImageUrls.  A saved search
 * result without curation is evidence only and must never silently become a
 * provider reference.
 */
export function getAdGenerationReferences(
  ad: AdCreativeSpec | undefined,
  policy: 'auto' | 'product-only' | 'curated' | 'none' = 'auto',
): AdGenerationReference[] {
  if (!ad?.materials || ad.materials.fingerprint !== adMaterialsFingerprint(ad) || policy === 'none') return [];
  const refs: AdGenerationReference[] = [];
  if (policy !== 'curated') {
    for (const path of ad.productImages ?? ad.materials.productImages ?? []) {
      if (path && !refs.some((ref) => ref.path === path)) refs.push({ path, role: 'product-identity' });
    }
  }
  if (policy !== 'product-only') {
    const curated = new Set(ad.materials.curatedImageUrls ?? []);
    for (const image of ad.materials.images ?? []) {
      if (!curated.has(image.url) || !image.path || refs.some((ref) => ref.path === image.path)) continue;
      refs.push({ path: image.path, role: 'creative-reference', sourceUrl: image.url });
    }
  }
  return refs;
}
