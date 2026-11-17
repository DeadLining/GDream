import type { Provider } from './providers/types.ts';
import type { AgentMessage, AgentUserContentBlock } from './types.ts';

/** Load actual pictures in reference order; fail before starting a model run. */
export async function loadGroundedImageBlocks(
  imagePaths: string[],
  loadImage: (path: string) => Promise<string>,
  failureLabel: string,
): Promise<AgentUserContentBlock[]> {
  if (!imagePaths.length) throw new Error(`${failureLabel}未提供实际图片，未重写或保存提示词。`);
  const blocks: AgentUserContentBlock[] = [];
  try {
    for (const imagePath of imagePaths) {
      const image = await loadImage(imagePath);
      const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(image);
      if (!match && !/^https?:\/\//i.test(image)) {
        throw new Error(`图片不是有效的 data URL 或 HTTPS URL：${imagePath}`);
      }
      blocks.push({ type: 'image', source: match
        ? { type: 'base64', media_type: match[1], data: match[2] }
        : { type: 'url', url: image } });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    throw new Error(`${failureLabel}读取失败，未重写或保存提示词。${detail ? ` ${detail}` : ''}`);
  }

  return blocks;
}

/** Native-image request only: never silently replace an image with its filename. */
async function nativeImageChat(
  messages: Array<{ role: string; content: string }>,
  imagePaths: string[],
  selection: { providerId: string; modelId?: string },
  dependencies: {
    loadImage: (path: string) => Promise<string>;
    getProvider: (id: string) => Provider | undefined;
  },
  failureLabel: string,
): Promise<string> {
  const provider = dependencies.getProvider(selection.providerId);
  if (!provider) throw new Error('当前语言模型渠道不可用，无法根据参考图片重写；请检查工坊模型设置。');
  if (imagePaths.length === 0) throw new Error(`${failureLabel}未提供实际图片，未重写或保存提示词。`);

  const blocks = await loadGroundedImageBlocks(imagePaths, dependencies.loadImage, failureLabel);

  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  if (lastUser < 0) throw new Error(`${failureLabel}重写缺少用户请求。`);
  const multimodal = messages.map((message, index) => index === lastUser
    ? { role: 'user', content: [{ type: 'text', text: message.content }, ...blocks] }
    : message) as AgentMessage[];
  const modelId = selection.modelId || provider.defaultModelId;
  let text = '';
  try {
    for await (const delta of provider.streamChat({
      modelId, requireNativeImages: true, maxTokens: 16000, messages: multimodal,
    }, { source: 'foreground' })) {
      for (const choice of delta.choices) {
        if (choice.index !== 0) continue;
        if (choice.finish_reason === 'length' || choice.finish_reason === 'max_tokens') throw new Error('truncated');
        text += choice.delta.content ?? '';
      }
    }
    if (!text.trim()) throw new Error('empty');
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    const detail = reason === 'truncated' ? '重写结果被截断'
      : reason === 'empty' ? '未返回重写内容'
      : '图片请求失败，请确认当前模型和接口支持多图输入，并检查连接与配置';
    throw new Error(`${provider.displayName}（${modelId}）：${detail}。未降级为纯文字，未保存提示词。`);
  }
  return text.trim();
}

/** Native-image request for the existing single-frame rewrite path. */
export function frameGroundedChat(
  messages: Array<{ role: string; content: string }>,
  framePath: string,
  selection: { providerId: string; modelId?: string },
  dependencies: {
    loadImage: (path: string) => Promise<string>;
    getProvider: (id: string) => Provider | undefined;
  },
): Promise<string> {
  return nativeImageChat(messages, [framePath], selection, dependencies, '首帧');
}

/** Native multi-image request used by the independent Ref2VA route. */
export function referenceGroundedChat(
  messages: Array<{ role: string; content: string }>,
  images: string[],
  selection: { providerId: string; modelId?: string },
  dependencies: {
    getProvider: (id: string) => Provider | undefined;
  },
): Promise<string> {
  return nativeImageChat(messages, images, selection, {
    loadImage: async (image) => image,
    getProvider: dependencies.getProvider,
  }, 'Ref2VA 参考图片');
}
