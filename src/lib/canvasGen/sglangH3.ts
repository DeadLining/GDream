import { deduplicateH3SectionDialogue } from '../workshop/h3DialoguePayload.ts';

export type SglangH3Task = 'i2va' | 'fl2va' | 'ref2va' | 't2va';

/** SGLang exposes all endpoint-frame variants through the fl2va API task. */
export const SGLANG_H3_SUPPORTED_TASKS: SglangH3Task[] = ['i2va', 'fl2va', 'ref2va', 't2va'];

/** Default reference-mode parameters used by the deployed MiniMax-H3 ref2va service. */
export const SGLANG_H3_REF2VA_DEFAULTS = {
  shortEdge: 768,
  aspectRatio: 'auto',
  quality: 'lossless',
  numInferenceSteps: 8,
  flowShift: 12,
  audioFlowShift: 3,
  seed: 3104,
} as const;

export function sglangH3TaskIsSupported(task: SglangH3Task): boolean {
  return SGLANG_H3_SUPPORTED_TASKS.includes(task);
}

export function sglangH3ApiTask(task: SglangH3Task): SglangH3Task {
  return task === 'i2va' ? 'fl2va' : task;
}

export type SglangH3Condition = {
  type: 'image' | 'audio' | 'video';
  uri: string;
  role: 'reference' | 'keyframe';
  frame_index?: number;
  start_time_seconds?: number;
};

export const SGLANG_H3_POLL_INTERVAL_MS = 10_000;

export function sglangH3TaskUsesBoundaryFrames(task: SglangH3Task): boolean {
  return task === 'i2va' || task === 'fl2va';
}

export function sglangH3TaskUsesReferenceAssets(task: SglangH3Task): boolean {
  return task === 'ref2va';
}

export function buildSglangH3Conditions(input: {
  imageUris?: string[];
  audioUris?: string[];
  videoUris?: string[];
}): SglangH3Condition[] {
  const images = (input.imageUris ?? []).map((uri) => uri.trim()).filter(Boolean);
  const audios = (input.audioUris ?? []).map((uri) => uri.trim()).filter(Boolean);
  const videos = (input.videoUris ?? []).map((uri) => uri.trim()).filter(Boolean);
  return [
    ...images.map((uri): SglangH3Condition => ({ type: 'image', uri, role: 'reference' })),
    ...audios.map((uri): SglangH3Condition => ({ type: 'audio', uri, role: 'reference' })),
    ...videos.map((uri): SglangH3Condition => ({ type: 'video', uri, role: 'reference', start_time_seconds: 0 })),
  ];
}

export function buildSglangH3ConditionsForTask(input: {
  task: SglangH3Task;
  boundaryFrameUris?: string[];
  imageUris?: string[];
  audioUris?: string[];
  videoUris?: string[];
}): SglangH3Condition[] {
  if (input.task === 't2va') return [];
  if (input.task === 'i2va') {
    const firstFrame = (input.boundaryFrameUris ?? []).map((uri) => uri.trim()).find(Boolean);
    return firstFrame ? [{ type: 'image', uri: firstFrame, role: 'keyframe', frame_index: 0 }] : [];
  }
  if (input.task === 'fl2va') {
    const frames = (input.boundaryFrameUris ?? []).map((uri) => uri.trim()).filter(Boolean).slice(0, 2);
    return frames.map((uri, index) => ({
      type: 'image',
      uri,
      role: 'keyframe',
      frame_index: index === 0 ? 0 : -1,
    }));
  }
  // Keyframes are separate anchors, not numbered <Picture N> references.
  // Keep the reference list intact, including an inherited tail used in both
  // roles, so the authored prompt retains its original picture numbering.
  const anchors = (input.boundaryFrameUris ?? []).map((uri) => uri.trim()).filter(Boolean);
  if (anchors.length > 2) throw new Error('H3 最多支持首尾两个关键帧');
  return [
    ...buildSglangH3Conditions(input),
    ...anchors.map((uri, index): SglangH3Condition => ({
      type: 'image', uri, role: 'keyframe', frame_index: index === 0 ? 0 : -1,
    })),
  ];
}

export interface SglangH3PayloadOptions {
  model: string;
  prompt: string;
  conditions: SglangH3Condition[];
  task?: SglangH3Task;
  durationSeconds: number;
  shortEdge?: unknown;
  aspectRatio?: string;
  quality?: string;
  numOutputsPerPrompt?: unknown;
  numInferenceSteps?: unknown;
  flowShift?: unknown;
  audioFlowShift?: unknown;
  seed?: unknown;
}

function referenceIndex(value: string): number | null {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized.includes('十')) {
    const [tensRaw, onesRaw] = normalized.split('十');
    const tens = tensRaw ? digits[tensRaw] : 1;
    const ones = onesRaw ? digits[onesRaw] : 0;
    return tens != null && ones != null ? tens * 10 + ones : null;
  }
  return digits[normalized] ?? null;
}

export function normalizeSglangH3PromptReferences(prompt: string): string {
  const replaceReference = (label: string, tag: 'Picture' | 'Audio' | 'Video') => {
    const pattern = new RegExp(`@${label}\\s*([一二两三四五六七八九十零〇]+|\\d+)`, 'gu');
    return (source: string) => source.replace(pattern, (match, rawIndex: string) => {
      const index = referenceIndex(rawIndex);
      return index ? `<${tag} ${index}>` : match;
    });
  };
  const normalized = replaceReference('视频', 'Video')(
    replaceReference('音频', 'Audio')(
      replaceReference('图片', 'Picture')(prompt),
    ),
  );
  return normalized.replace(
    /<(Picture|Audio|Video)\s+(\d+)>\s*[（(]\s*<\1\s+\2>\s*[）)]/giu,
    '<$1 $2>',
  );
}

export function prepareSglangH3PromptForTask(prompt: string, task: SglangH3Task): string {
  prompt = deduplicateH3SectionDialogue(prompt);
  if (task === 'ref2va') return normalizeSglangH3PromptReferences(prompt);
  return prompt
    .replace(/@(图片|音频|视频)\s*(?:[一二两三四五六七八九十零〇]+|\d+)/gu, '')
    .replace(/<(?:Picture|Audio|Video)\s+\d+>/giu, '')
    .replace(/[（(]\s*[）)]/gu, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\s+([，。；：、])/gu, '$1')
    .trim();
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Math.max(1, Math.round(finiteNumber(value, fallback)));
}

export function normalizeSglangH3Model(model: string): string {
  const configured = model.trim();
  return /^(?:MiniMax-?H3|MiniMaxAI\/MiniMax-?H3)$/i.test(configured)
    ? 'MiniMaxAI/MiniMax-H3'
    : configured;
}

export function extractSglangH3ResultUrl(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : undefined;
  const task = root.task && typeof root.task === 'object' ? root.task as Record<string, unknown> : undefined;
  const dataTask = data?.task && typeof data.task === 'object' ? data.task as Record<string, unknown> : undefined;
  const content = root.content && typeof root.content === 'object' ? root.content as Record<string, unknown> : undefined;
  const result = root.result && typeof root.result === 'object' ? root.result as Record<string, unknown> : undefined;
  const dataResult = data?.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : undefined;
  const candidates = [
    root.content_url,
    root.video_url,
    root.output_url,
    root.result_url,
    data?.content_url,
    data?.video_url,
    data?.output_url,
    data?.result_url,
    task?.content_url,
    task?.video_url,
    task?.output_url,
    task?.result_url,
    dataTask?.content_url,
    dataTask?.video_url,
    dataTask?.output_url,
    dataTask?.result_url,
    task?.content && typeof task.content === 'object' ? (task.content as Record<string, unknown>).url : undefined,
    dataTask?.content && typeof dataTask.content === 'object' ? (dataTask.content as Record<string, unknown>).url : undefined,
    dataResult?.url,
    dataResult?.video_url,
    dataResult?.download_url,
    content?.url,
    content?.video_url,
    content?.download_url,
    result?.url,
    result?.video_url,
    result?.download_url,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)?.trim() ?? '';
}

export function extractSglangH3TaskId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : undefined;
  const task = root.task && typeof root.task === 'object' ? root.task as Record<string, unknown> : undefined;
  const dataTask = data?.task && typeof data.task === 'object' ? data.task as Record<string, unknown> : undefined;
  const candidates = [root.job_id, root.id, root.task_id, data?.job_id, data?.id, data?.task_id, task?.job_id, task?.id, task?.task_id, dataTask?.job_id, dataTask?.id, dataTask?.task_id];
  return candidates.find((candidate): candidate is string | number => (typeof candidate === 'string' && candidate.trim().length > 0) || typeof candidate === 'number')?.toString().trim() ?? '';
}

export function extractSglangH3Status(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : undefined;
  const task = root.task && typeof root.task === 'object' ? root.task as Record<string, unknown> : undefined;
  const dataTask = data?.task && typeof data.task === 'object' ? data.task as Record<string, unknown> : undefined;
  const candidates = [root.status, root.state, data?.status, data?.state, task?.status, task?.state, dataTask?.status, dataTask?.state];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)?.trim().toLowerCase() ?? '';
}

function nestedSglangH3Records(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : undefined;
  const task = root.task && typeof root.task === 'object' ? root.task as Record<string, unknown> : undefined;
  const dataTask = data?.task && typeof data.task === 'object' ? data.task as Record<string, unknown> : undefined;
  return [root, data, task, dataTask].filter((item): item is Record<string, unknown> => Boolean(item));
}

export function extractSglangH3Phase(value: unknown): string {
  for (const record of nestedSglangH3Records(value)) {
    const phase = record.phase ?? record.stage ?? record.current_phase ?? record.currentPhase;
    if (typeof phase === 'string' && phase.trim()) return phase.trim();
  }
  return '';
}

export function extractSglangH3Progress(value: unknown): string | number | undefined {
  for (const record of nestedSglangH3Records(value)) {
    const progress = record.progress ?? record.percent ?? record.percentage;
    if ((typeof progress === 'string' && progress.trim()) || (typeof progress === 'number' && Number.isFinite(progress))) return progress;
  }
  return undefined;
}

export function extractSglangH3RequestId(value: unknown): string {
  for (const record of nestedSglangH3Records(value)) {
    const requestId = record.request_id ?? record.requestId ?? record.provider_request_id ?? record.providerRequestId;
    if ((typeof requestId === 'string' && requestId.trim()) || typeof requestId === 'number') return String(requestId).trim();
  }
  return '';
}

export function resolveSglangH3ResourceUrl(baseUrl: string, resource: string): string {
  const value = resource.trim();
  if (!value || /^https?:\/\//i.test(value) || /^data:/i.test(value) || /^file:/i.test(value)) return value;
  const base = baseUrl.trim().replace(/\/+$/, '');
  return `${base}/${value.replace(/^\/+/, '')}`;
}

export function buildSglangH3Payload(options: SglangH3PayloadOptions): Record<string, unknown> {
  const conditions = options.conditions.map((condition) => ({
    ...condition,
    uri: condition.uri.trim(),
  }));
  const task = options.task ?? 'fl2va';
  if (task === 'i2va') {
    const validFirstFrame = conditions.length === 1
      && conditions[0].type === 'image'
      && conditions[0].role === 'keyframe'
      && conditions[0].frame_index === 0;
    if (!validFirstFrame) throw new Error('SGLang MiniMax-H3 i2va 必须提交首帧 frame_index=0');
  } else if (task === 'fl2va') {
    const validKeyframes = (conditions.length === 1 || conditions.length === 2)
      && conditions[0].type === 'image'
      && conditions[0].role === 'keyframe'
      && conditions[0].frame_index === 0
      && (conditions.length === 1 || (
        conditions[1].type === 'image'
        && conditions[1].role === 'keyframe'
        && conditions[1].frame_index === -1
      ));
    if (!validKeyframes) {
      throw new Error('SGLang MiniMax-H3 fl2va 必须提交首帧 frame_index=0，可按需追加尾帧 frame_index=-1');
    }
  } else if (task === 'ref2va') {
    if (!conditions.some((condition) => condition.role === 'reference')) {
      throw new Error('SGLang MiniMax-H3 ref2va 必须至少指定一个参考素材');
    }
    const anchors = conditions.filter((condition) => condition.role === 'keyframe');
    const signature = anchors.map((condition) => condition.frame_index).join(',');
    if (anchors.some((condition) => condition.type !== 'image')
      || (anchors.length > 0 && !['0', '-1', '0,-1'].includes(signature))) {
      throw new Error('SGLang MiniMax-H3 ref2va 关键帧必须为图片，frame_index 为 [0]、[-1] 或 [0,-1]');
    }
    if (conditions.some((condition) => condition.role === 'reference' && condition.frame_index != null)) {
      throw new Error('SGLang MiniMax-H3 reference 素材不能携带 frame_index');
    }
  } else if (conditions.length > 0) {
    throw new Error('SGLang MiniMax-H3 t2va 不得提交图片、音频或视频条件');
  }
  if (conditions.some((condition) => !condition.uri)) throw new Error('SGLang MiniMax-H3 的参考素材 URI 不能为空');
  const modalityLimits = { image: 9, audio: 3, video: 3 } as const;
  for (const modality of Object.keys(modalityLimits) as Array<keyof typeof modalityLimits>) {
    const count = conditions.filter((condition) => condition.type === modality && condition.role === 'reference').length;
    if (count > modalityLimits[modality]) {
      throw new Error(`SGLang MiniMax-H3 的 ${modality} 参考素材最多 ${modalityLimits[modality]} 个，当前为 ${count} 个`);
    }
  }

  const durationSeconds = positiveInteger(options.durationSeconds, 5);
  const ref2va = task === 'ref2va';
  const defaults = ref2va ? SGLANG_H3_REF2VA_DEFAULTS : {
    shortEdge: 768,
    aspectRatio: 'auto',
    quality: 'lossless',
    numInferenceSteps: 50,
    flowShift: 12,
    audioFlowShift: 3,
    seed: 3101,
  };
  return {
    model: normalizeSglangH3Model(options.model),
    prompt: prepareSglangH3PromptForTask(options.prompt, task),
    seconds: durationSeconds,
    task,
    conditions,
    target: {
      short_edge: positiveInteger(options.shortEdge, defaults.shortEdge),
      aspect_ratio: options.aspectRatio?.trim() || defaults.aspectRatio,
      duration_seconds: durationSeconds,
    },
    quality: options.quality?.trim() || defaults.quality,
    num_outputs_per_prompt: positiveInteger(options.numOutputsPerPrompt, 1),
    num_inference_steps: positiveInteger(options.numInferenceSteps, defaults.numInferenceSteps),
    flow_shift: finiteNumber(options.flowShift, defaults.flowShift),
    audio_flow_shift: finiteNumber(options.audioFlowShift, defaults.audioFlowShift),
    seed: Math.round(finiteNumber(options.seed, defaults.seed)),
  };
}
