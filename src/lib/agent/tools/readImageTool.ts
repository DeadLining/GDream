import type { Tool } from '../types';
import { readNativeImage } from '../nativeImageInput';

export const readImageTool: Tool = {
  definition: {
    name: 'read_image',
    description: '读取指定图片原始内容并直接提供给当前模型。只读取图片，不调用另一个模型识图。image 可为网页图片 HTTP(S) URL 或本地绝对路径。附件或工具结果中已有原生图片时无需重复读取。支持 PNG/JPEG/GIF/WebP，单张最多 5 MB。',
    parameters: { type: 'object', properties: { image: { type: 'string', description: '图片 URL 或本地绝对路径' } }, required: ['image'] },
  },
  risk: 'safe',
  async execute(params, signal) {
    if (typeof params.image !== 'string' || !params.image.trim()) return { success: false, output: '', error: 'image required' };
    try {
      const image = await readNativeImage(params.image, signal);
      return { success: true, output: `图片已作为原生图片内容附加，请直接观察。来源：${params.image.startsWith('data:') ? '[内联图片]' : params.image}`, media: [image] };
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
    }
  },
};
