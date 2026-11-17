import { loadImageInput } from '../agent/mediaInput';
import { quickChat } from '../agent/quickChat';
import { loadGroundedImageBlocks } from '../agent/frameGroundedChat';
import type { TextRunOptions } from '../agent/dsh/textRun';

/** Load once; forward real images on every DSH rewrite/targeted-repair turn. */
async function createGroundedRewriteChat(paths: string[], label: string, options: TextRunOptions) {
  if (options.signal?.aborted) throw new Error('已取消，原内容未修改');
  const mediaBlocks = await loadGroundedImageBlocks(paths, loadImageInput, label);
  return (messages: Array<{ role: string; content: string }>) => quickChat(messages, {
    ...options, mediaBlocks, workspaceScope: 'workshop', maxTokens: 16000,
  });
}

export async function createFirstFrameRewriteChat(framePath: string, options: TextRunOptions = {}) {
  return createGroundedRewriteChat([framePath], '实际首帧', options);
}

/** All reference pictures are attached in Picture order, never labels-only. */
export async function createReferenceRewriteChat(imagePaths: string[], options: TextRunOptions = {}) {
  return createGroundedRewriteChat(imagePaths, 'Ref2VA 参考图片', options);
}
