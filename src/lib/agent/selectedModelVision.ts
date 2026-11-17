import type { AgentUserContentBlock, ToolExecutionContext } from './types.ts';
import type { Provider } from './providers/types.ts';

/** No fallback chain: vision must use the task's selected provider and model. */
export async function describeWithSelectedModel(
  image: string,
  question: string,
  context: ToolExecutionContext | undefined,
  dependencies: {
    loadImage: (path: string) => Promise<string>;
    getProvider: (id: string) => Provider | undefined;
  },
  signal?: AbortSignal,
): Promise<{ text: string; model: string; provider: string }> {
  const selection = context?.languageModel;
  if (!selection) throw new Error('当前任务未传入语言模型配置，无法识图；请重新发起任务。无需另配 Kimi 或 DMXAPI。');
  const provider = dependencies.getProvider(selection.providerId);
  if (!provider) throw new Error(`当前语言模型渠道 ${selection.providerId} 不可用，请检查该渠道的语言模型配置。`);
  const model = selection.modelId || provider.defaultModelId;
  signal?.throwIfAborted();
  let url: string;
  try {
    url = await dependencies.loadImage(image);
  } catch {
    throw new Error('读取参考图失败，请检查文件是否存在及访问权限；尚未调用识图模型。');
  }
  signal?.throwIfAborted();
  const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!match && !/^https?:\/\//i.test(url)) throw new Error('参考图不是有效的图片数据或 HTTP(S) 图片地址。');
  const block: AgentUserContentBlock = {
    type: 'image',
    source: match
      ? { type: 'base64', media_type: match[1], data: match[2] }
      : { type: 'url', url },
  };
  let text = '';
  try {
    for await (const delta of provider.streamChat({
      modelId: model,
      requireNativeImages: true,
      maxTokens: 4096,
      messages: [
        { role: 'system', content: '请实际查看所附图片，按用户要求描述可见事实。不要编造看不到的外观或剧情；如果无法读取图片，请明确说明。' },
        { role: 'user', content: [{ type: 'text', text: question }, block] },
      ],
    }, { source: 'foreground', signal })) {
      signal?.throwIfAborted();
      for (const choice of delta.choices) {
        if (choice.index !== 0) continue;
        if (choice.delta.content) text += choice.delta.content;
        if (choice.finish_reason === 'length' || choice.finish_reason === 'max_tokens') {
          throw new Error('vision-output-truncated');
        }
      }
    }
    signal?.throwIfAborted();
    if (!text.trim()) throw new Error('vision-output-empty');
  } catch (error) {
    if (signal?.aborted) throw error;
    // Do not expose gateway response bodies: they can contain credentials or image bytes.
    const reason = error instanceof Error ? error.message : '';
    const detail = reason === 'vision-output-truncated' ? '识图回答被截断'
      : reason === 'vision-output-empty' ? '未返回有效识图内容'
        : '图片请求失败，请确认该模型和接口支持图片输入，并检查连接、鉴权及额度';
    throw new Error(`当前语言模型 ${provider.displayName}（${model}）：${detail}。未切换其他供应商。`);
  }
  return { text: text.trim(), model, provider: provider.displayName };
}
