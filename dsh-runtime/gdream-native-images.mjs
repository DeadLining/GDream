/** Identify encoded raster bytes; the attachment validator still fully decodes them. */
function rasterMime(data) {
  const is = (offset, values) => values.every((value, i) => data[offset + i] === value);
  if (is(0,[137,80,78,71,13,10,26,10])) return 'image/png';
  if (is(0,[255,216,255])) return 'image/jpeg';
  if (is(0,[71,73,70,56,55,97]) || is(0,[71,73,70,56,57,97])) return 'image/gif';
  if (is(0,[82,73,70,70]) && is(8,[87,69,66,80])) return 'image/webp';
  throw new Error('Unsupported image bytes: expected PNG/JPEG/GIF/WebP');
}

/** Image admission shared by ACP input and MCP tool results. No LLM calls. */
export async function nativeContent(blocks, attachments) {
  if (!Array.isArray(blocks) || blocks.some((block) => !block || !['text', 'image', 'resource_link'].includes(block.type))) throw new Error('Unsupported media content');
  const images = blocks.filter((block) => block.type === 'image');
  const limits = attachments.imageLimits;
  if (images.length > limits.maxImagesPerMessage) throw new Error('Too many images');
  let bytes = 0;
  const inputs = images.map((block) => {
    if (typeof block.data !== 'string' || !block.data.length || block.data.length > Math.ceil(limits.maxImageBytes / 3) * 4
      || block.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)) {
      throw new Error('Invalid or oversized base64 image');
    }
    const data = Buffer.from(block.data, 'base64');
    if (data.toString('base64') !== block.data) throw new Error('Non-canonical base64 image');
    bytes += data.length;
    if (data.length > limits.maxImageBytes || bytes > limits.maxMessageImageBytes) throw new Error('Image byte limit exceeded');
    if (!limits.mediaTypes.includes(block.mimeType)) throw new Error('Unsupported image MIME type');
    const mediaType = rasterMime(data);
    if (!limits.mediaTypes.includes(mediaType)) throw new Error('Detected image MIME type is not supported by this channel');
    return { data, mediaType };
  });
  // Validate the entire batch before persisting any image.
  for (const input of inputs) await attachments.validateImage(input);
  const content = [];
  let index = 0;
  for (const block of blocks) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'image') content.push({ type: 'image', attachment: await attachments.saveImage(inputs[index++]) });
    else if (block.type === 'resource_link') content.push({ type: 'text', text: `[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]` });
    else throw new Error(`Unsupported media type: ${block.type}`);
  }
  return content;
}

/** Preserve actual MCP images through upstream's text-only output renderer. */
export function installNativeToolImages(ctx, enabled) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'content') || Object.hasOwn(decision, 'value') || result.isError
      || !exec.name.startsWith('mcp__gdream__') || !Array.isArray(result.value?.content)
      || !result.value.content.some((block) => block.type === 'image')) return decision;
    if (!enabled) return { kind: 'block', feedback: [{ type: 'text', text: '当前渠道不支持原生图片输入，请选择支持图片的模型。不能声称已经看过图片。' }] };
    exec.signal.throwIfAborted();
    const content = await nativeContent(result.value.content, ctx.attachments);
    exec.signal.throwIfAborted();
    return { ...decision, content };
  });
}

export const nativeToolImagesPlugin = {
  name: 'gdream-native-tool-images',
  inject: ['attachments'],
  apply(ctx, config) { installNativeToolImages(ctx, config.enabled); },
};
