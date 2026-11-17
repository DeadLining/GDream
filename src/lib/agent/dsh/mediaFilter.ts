import type { AgentUserContentBlock } from '../types.ts';
import type { AcpContent } from './types.ts';

/** GDream's owned ACP transport supports native images, never textual placeholders. */
export function mediaToAcpContent(block: AgentUserContentBlock): AcpContent {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type !== 'image') throw new Error('当前 DSH 传输暂不支持原生视频；请先提取关键帧，不能将视频当作已读取。');
  if (block.source.type !== 'base64') throw new Error('图片必须先加载为原生内容，不能仅传递 URL 引用。');
  return { type: 'image', data: block.source.data, mimeType: block.source.media_type };
}

export function buildAcpPromptContent(blocks: AgentUserContentBlock[] | undefined): AcpContent[] {
  return (blocks ?? []).map(mediaToAcpContent);
}
