import { readNativeImage } from './nativeImageInput';
import { loadMediaInput } from './mediaInput';
import type { AgentUserContentBlock } from './types';

/** Shared native attachment preparation for DSH and non-Kimi ordinary mode. */
export async function buildNativeMediaBlocks(filePaths: string[]): Promise<AgentUserContentBlock[]> {
  const blocks: AgentUserContentBlock[] = [];
  for (const path of filePaths) {
    const cleanPath = path.split('?')[0].toLowerCase();
    const isImage = /\.(png|jpe?g|webp|gif|bmp)$/.test(cleanPath);
    const isRemoteVideo = /^https?:\/\//i.test(path) && /\.(mp4|mov|webm|m4v)$/.test(cleanPath);
    if (!isImage && !isRemoteVideo) continue;
    try {
      if (isImage) { blocks.push(await readNativeImage(path)); continue; }
      const { dataUrl, mediaType } = await loadMediaInput(path);
      const source = dataUrl.startsWith('data:')
        ? { type: 'base64' as const, media_type: mediaType, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
        : { type: 'url' as const, url: dataUrl };
      blocks.push(isImage ? { type: 'image', source } : { type: 'video', source });
    } catch (error) {
      throw new Error(`附件读取失败，未发送给模型：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return blocks;
}

