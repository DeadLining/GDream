/** Image recognition using the current task’s language model, with no hidden vendor fallback. */

import type { Tool } from '../types';
import { loadImageInput } from '../mediaInput';
import { getProvider } from '../providers/registry';
import { describeWithSelectedModel } from '../selectedModelVision';

const DEFAULT_PROMPT = '详细描述这张图片的内容';

export const visionTool: Tool = {
  definition: {
    name: 'image_recognition',
    description:
      '识别/理解图片内容，回答关于图片的问题。' +
      '用于：描述画面、提取图中文字、以图问答、分析参考图。' +
      '使用当前任务选中的语言模型及其接口识图，不另行切换 Kimi/DMXAPI；模型必须支持图片输入。image 支持公网 URL 或本地文件路径。',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: '图片的公网 URL 或本地文件路径' },
        prompt: { type: 'string', description: `针对图片的问题/指令，默认"${DEFAULT_PROMPT}"` },
      },
      required: ['image'],
    },
  },
  risk: 'safe',
  async execute(params, signal, context) {
    const { image, prompt } = params as { image?: string; prompt?: string };
    if (!image || !image.trim()) {
      return { success: false, output: '', error: 'image required' };
    }
    const question = (prompt && prompt.trim()) || DEFAULT_PROMPT;

    try {
      const result = await describeWithSelectedModel(image, question, context, { loadImage: loadImageInput, getProvider }, signal);
      return {
        success: true,
        output: `${result.text}\n\n（识图渠道：${result.provider}；模型：${result.model}）`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  },
};
