/** MiniMax's native image-01 protocol is not OpenAI Images compatible. */
export function isMinimaxImageSlot(baseUrl: string, model: string): boolean {
  if (model === 'image-01') return true;
  try { return ['api.minimax.io', 'api.minimaxi.com'].includes(new URL(baseUrl).hostname); }
  catch { return false; }
}

export function minimaxImageEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('MiniMax 图片服务地址无效');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!['', '/v1', '/v1/image_generation'].includes(path)) throw new Error('MiniMax 图片服务路径无效');
  return `${url.origin}/v1/image_generation`;
}

export interface MinimaxSubjectReference {
  type: 'character';
  image_file: string;
}

export function buildMinimaxImagePayload(params: {
  prompt: string;
  aspectRatio?: string;
  hasReferences?: boolean;
  subjectReferences?: MinimaxSubjectReference[];
}) {
  const subjectReferences = params.subjectReferences ?? [];
  if (params.hasReferences && subjectReferences.length === 0) {
    throw new Error('MiniMax image-01 图生图需要 subject_reference；不能把参考图静默丢弃');
  }
  if (!params.prompt.trim() || Array.from(params.prompt).length > 1500) throw new Error('MiniMax 图片提示词须为 1–1500 字符，请精简后再提交');
  const aspect = params.aspectRatio || '16:9';
  if (!['1:1','16:9','4:3','3:2','2:3','3:4','9:16','21:9'].includes(aspect)) throw new Error('MiniMax 图片比例不受支持');
  return {
    model: 'image-01',
    prompt: params.prompt,
    aspect_ratio: aspect,
    ...(subjectReferences.length > 0 ? { subject_reference: subjectReferences } : {}),
    n: 1,
    response_format: 'url',
    prompt_optimizer: false,
  };
}

export function parseMinimaxImageResponse(value: unknown): {url?: string; b64?: string} {
  const response = value as {base_resp?: {status_code?: number}; data?: {image_urls?: unknown[]; image_base64?: unknown[]}} | null;
  const status = response?.base_resp?.status_code;
  if (typeof status !== 'number') throw new Error('MiniMax 图片响应缺少有效状态回执，请核对任务，勿自动重提');
  if (status !== 0) {
    const known: Record<number,string> = {1002:'触发限流',1004:'账户认证失败',1008:'账户余额不足',1026:'内容审核未通过',2013:'输入参数无效',2049:'API Key 无效'};
    // Never include arbitrary provider text: it may echo credentials/request data.
    throw new Error(`MiniMax 图片服务错误 ${status}：${known[status] || '请核对官方任务回执'}`);
  }
  const url = response?.data?.image_urls?.[0];
  if (typeof url === 'string' && /^https?:\/\//.test(url)) return {url};
  const b64 = response?.data?.image_base64?.[0];
  if (typeof b64 === 'string' && b64.length > 0) return {b64};
  throw new Error('MiniMax 成功回执没有可用图片，请核对任务，勿自动重提');
}

/** Explicit known model capabilities; never discard references to make a route work. */
export function supportsCustomImageMode(baseUrl: string, model: string, mode: string): boolean {
  if (isMinimaxImageSlot(baseUrl, model)) return mode === 'text-to-image' || mode === 'image-to-image';
  if (/qwen-image-edit/i.test(model)) return mode === 'image-to-image';
  return true;
}
