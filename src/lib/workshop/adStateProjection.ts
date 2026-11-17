import type { WorkshopData } from './types';

/** Keep source identities in ordinary state; expose complete evidence via an explicit paged read. */
export function projectAdCreativeSpec(spec: WorkshopData['creativeSpec']) {
  const materials = spec?.workKind === 'product-ad' ? spec.adSpec?.materials : undefined;
  if (!materials || !spec?.adSpec) return spec;
  return {
    ...spec,
    adSpec: {
      ...spec.adSpec,
      materials: {
        ...materials,
        sources: materials.sources.map(({ url, title, content }) => ({ url, title, contentChars: content.length })),
        sourceContentOmitted: true,
        readFullEvidence: { detail: 'step', section: 'ad-materials' },
        instruction: '此处只有来源索引，不是完整事实证据；需要核实产品事实时用 readFullEvidence 读取已保存原文，按 next_call 续读，不必重新联网。',
      },
    },
  };
}
