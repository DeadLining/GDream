export type ProviderCapabilityStatus = 'native' | 'degraded' | 'unsupported';
export type ProviderMediaKind = 'image' | 'audio' | 'video';

export interface ProviderCapabilityItem {
  kind: ProviderMediaKind;
  count: number;
  status: ProviderCapabilityStatus;
  reason: string;
}

export interface ProviderCapabilityProjection {
  engineId: string;
  items: ProviderCapabilityItem[];
  canSubmit: boolean;
  summary: string;
}

export function isMiniMaxH3Model(engineId: string): boolean {
  const normalized = engineId.trim().toLowerCase();
  return normalized.includes('minimax-h3')
    || normalized.includes('minimax-hailuo-h3')
    || normalized.includes('hailuo-h3');
}

function statusFor(engineId: string, kind: ProviderMediaKind, count: number): ProviderCapabilityItem {
  if (count === 0) return { kind, count, status: 'native', reason: '未使用此类参考素材' };
  const normalized = engineId.toLowerCase();
  if (isMiniMaxH3Model(engineId)) {
    const limit = kind === 'image' ? 9 : 3;
    return count <= limit
      ? { kind, count, status: 'native', reason: `通过 H3 conditions 原生传入，当前 ${count}/${limit}` }
      : { kind, count, status: 'unsupported', reason: `超过 H3 conditions 上限 ${limit}` };
  }
  if (normalized.includes('seedance-2.5')) {
    const limit = kind === 'image' ? 30 : 3;
    return count <= limit
      ? { kind, count, status: 'native', reason: `原生支持，当前 ${count}/${limit}` }
      : { kind, count, status: 'unsupported', reason: `超过当前通道上限 ${limit}` };
  }
  if (normalized.includes('seedance-2.0')) {
    const limit = kind === 'image' ? 10 : 3;
    return count <= limit
      ? { kind, count, status: 'native', reason: `原生支持，当前 ${count}/${limit}` }
      : { kind, count, status: 'unsupported', reason: `超过当前通道上限 ${limit}` };
  }
  if (normalized.includes('wan') || normalized.includes('万相')) {
    const limit = kind === 'image' ? 10 : 5;
    return count <= limit
      ? { kind, count, status: 'native', reason: `原生支持，当前 ${count}/${limit}` }
      : { kind, count, status: 'unsupported', reason: `超过当前通道上限 ${limit}` };
  }
  if (kind === 'image') return { kind, count, status: 'native', reason: '原生参考图输入' };
  return { kind, count, status: 'unsupported', reason: '当前 Provider 不声明此类输入' };
}

export function projectProviderCapabilities(input: {
  engineId: string;
  imageCount?: number;
  audioCount?: number;
  videoCount?: number;
}): ProviderCapabilityProjection {
  const items = (['image', 'audio', 'video'] as ProviderMediaKind[]).map((kind) => statusFor(
    input.engineId,
    kind,
    Math.max(0, Math.floor(input[`${kind}Count` as 'imageCount' | 'audioCount' | 'videoCount'] ?? 0)),
  ));
  const unsupported = items.filter((item) => item.status === 'unsupported');
  const degraded = items.filter((item) => item.status === 'degraded');
  return {
    engineId: input.engineId,
    items,
    canSubmit: unsupported.length === 0,
    summary: unsupported.length > 0
      ? `有 ${unsupported.length} 类参考素材不支持，提交前请移除或更换 Provider`
      : degraded.length > 0
        ? `有 ${degraded.length} 类参考素材将降级处理`
        : '所有已选参考素材均为原生输入',
  };
}

export function projectMiniMaxH3Ref2vaCapabilities(input: {
  imageCount?: number;
  audioCount?: number;
  videoCount?: number;
}): ProviderCapabilityProjection {
  const projection = projectProviderCapabilities({
    engineId: 'minimax-h3',
    imageCount: input.imageCount,
    audioCount: input.audioCount,
    videoCount: input.videoCount,
  });
  const total = projection.items.reduce((sum, item) => sum + item.count, 0);
  if (total > 0) return projection;
  return {
    ...projection,
    canSubmit: false,
    summary: 'ref2va 至少需要一项实际参考图片、音频或视频；当前镜首尾帧不计入 conditions',
  };
}

export type H3InputTask = 'i2va' | 'fl2va' | 'ref2va' | 't2va';

/**
 * How many conditions each H3 task ACTUALLY submits.
 *
 * This mirrors `buildSglangH3ConditionsForTask` (the real submission path) so
 * the pre-submit capability check cannot disagree with what gets sent:
 * - t2va:  nothing
 * - i2va:  first boundary frame only (frame_index=0); asset images are NOT conditions
 * - fl2va: at most two boundary frames
 * - ref2va: the reference assets (scene/character/prop/...)
 *
 * Regression: i2va used to fall into the `ref2va` bucket, so a shot with many
 * asset references (e.g. 8 assets + 2 boundary frames = 10) was reported as
 * exceeding the 9-image limit and blocked, even though i2va submits 1 image.
 */
export function projectH3SubmissionCounts(input: {
  task: H3InputTask;
  boundaryFrameCount?: number;
  assetImageCount?: number;
  audioCount?: number;
  videoCount?: number;
}): { imageCount: number; audioCount: number; videoCount: number } {
  const bounds = Math.max(0, input.boundaryFrameCount ?? 0);
  if (input.task === 't2va') return { imageCount: 0, audioCount: 0, videoCount: 0 };
  if (input.task === 'i2va') return { imageCount: Math.min(1, bounds), audioCount: 0, videoCount: 0 };
  if (input.task === 'fl2va') return { imageCount: Math.min(2, bounds), audioCount: 0, videoCount: 0 };
  return {
    imageCount: Math.max(0, input.assetImageCount ?? 0),
    audioCount: Math.max(0, input.audioCount ?? 0),
    videoCount: Math.max(0, input.videoCount ?? 0),
  };
}
