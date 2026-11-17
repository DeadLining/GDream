import { Body, fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { loadMediaInput } from '@/lib/agent/mediaInput';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { resolveApiKey } from '@/lib/credentials';
import { useSettingsStore } from '@/stores/settingsStore';
import { parseQualityReviewResponse, qualityReviewerFingerprint, type QualityReviewKind, type QualityReviewReport } from './qualityReview';
import { buildQualityReviewRequestDescriptor } from './qualityReviewRequest';

export interface RunQualityReviewInput {
  kind: QualityReviewKind;
  prompt: string;
  startFramePath?: string;
  endFramePath?: string;
  videoPath?: string;
  artifactFingerprint?: string;
  attempt: number;
  signal?: AbortSignal;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function imageDataUrl(pathOrUrl: string): Promise<string> {
  if (/^(https?:|data:image\/)/i.test(pathOrUrl)) return pathOrUrl;
  const localPath = assetUrlToLocalPath(pathOrUrl);
  const bytes = new Uint8Array(await readBinaryFile(localPath));
  const extension = localPath.split('.').pop()?.toLowerCase() ?? '';
  return `data:${IMAGE_MIME[extension] ?? 'image/png'};base64,${bytesToBase64(bytes)}`;
}

async function videoReviewUrl(pathOrUrl: string): Promise<string> {
  if (/^(https?:|data:video\/)/i.test(pathOrUrl)) return pathOrUrl;
  return (await loadMediaInput(assetUrlToLocalPath(pathOrUrl))).dataUrl;
}

function responseText(data: unknown): string {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return String((item as Record<string, unknown>).text ?? '');
    }).join('\n');
  }
  if (typeof record.output_text === 'string') return record.output_text;
  throw new Error('审核服务未返回可解析的文本结果');
}

export async function runQualityReview(input: RunQualityReviewInput): Promise<QualityReviewReport> {
  const settings = useSettingsStore.getState();
  if (!settings.qualityReviewEnabled) throw new Error('多模态质量审核尚未启用');
  const baseUrl = settings.qualityReviewBaseUrl.trim().replace(/\/+$/, '');
  const model = settings.qualityReviewModel.trim();
  if (!baseUrl || !model) throw new Error('请先配置多模态审核服务地址和模型');
  const apiKey = resolveApiKey(settings, 'qualityReview', '').trim();
  const request = buildQualityReviewRequestDescriptor({
    baseUrl,
    model,
    apiKey,
    kind: input.kind,
    prompt: input.prompt,
    startFrameUrl: input.startFramePath ? await imageDataUrl(input.startFramePath) : undefined,
    endFrameUrl: input.endFramePath ? await imageDataUrl(input.endFramePath) : undefined,
    videoUrl: input.videoPath ? await videoReviewUrl(input.videoPath) : undefined,
  });
  const response = await tauriFetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: Body.json(request.payload),
    responseType: ResponseType.JSON,
    timeout: 300,
  });
  if (!response.ok) throw new Error(`多模态审核失败（HTTP ${response.status}）`);
  return parseQualityReviewResponse({
    text: responseText(response.data),
    kind: input.kind,
    model,
    attempt: input.attempt,
    artifactPath: input.videoPath,
    artifactFingerprint: input.artifactFingerprint,
    reviewerFingerprint: qualityReviewerFingerprint(baseUrl, model),
  });
}
