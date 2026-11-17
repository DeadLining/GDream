export interface AdShotReferencePlan {
  shotNo: string;
  reason: string;
  references: {url: string; path: string; visualSummary: string; purpose: string; reason: string}[];
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('参考计划缺少有效的图片分析或选择理由');
  return value.trim();
}
/** Validate DSH decisions, never infer image content or product identity in code. */
export function validateAdReferencePlan(input: unknown, shotNos: string[], images: {url:string;path:string}[]): AdShotReferencePlan[] {
  if (!Array.isArray(input) || input.length !== shotNos.length) throw new Error('参考计划必须覆盖本次读取的每个分镜；不用图片时传空 references 并说明理由');
  const seen = new Set<string>();
  return input.map(item => {
    if (!item || typeof item !== 'object') throw new Error('无效的分镜计划');
    const shotNo = text(item.shotNo);
    if (!shotNos.includes(shotNo) || seen.has(shotNo)) throw new Error('分镜不存在、超出范围或重复');
    seen.add(shotNo);
    if (!Array.isArray(item.references) || item.references.length > 6) throw new Error('每镜最多六张参考图');
    const urls = new Set<string>();
    const references = item.references.map((ref: Record<string, unknown>) => {
      if (!ref || typeof ref !== 'object') throw new Error('无效的图片引用');
      const image = images.find(i => i.url === ref.url);
      if (!image || urls.has(image.url)) throw new Error('图片未在本次原生阅读范围内或重复');
      urls.add(image.url);
      const purpose = text(ref.purpose);
      if (!['appearance-candidate','composition','environment','color-material'].includes(purpose)) throw new Error('网络图只能作为候选外观、构图、环境或配色材质参考，不能声明产品身份');
      return {...image, visualSummary:text(ref.visualSummary), purpose, reason:text(ref.reason)};
    });
    return {shotNo, reason:text(item.reason), references};
  });
}
