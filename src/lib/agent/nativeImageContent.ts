import type { AgentUserContentBlock } from './types.ts';

export const MAX_NATIVE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Validate raster signatures, not URL suffixes or untrusted Content-Type headers. */
export function nativeImageBlock(bytes: Uint8Array): AgentUserContentBlock {
  if (!bytes.length || bytes.length > MAX_NATIVE_IMAGE_BYTES) throw new Error('图片为空或超过 5 MB，请缩小图片后重试。');
  const is = (offset: number, values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  const mime = is(0, [137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : is(0, [255, 216, 255]) ? 'image/jpeg'
      : is(0, [71, 73, 70, 56]) ? 'image/gif'
        : is(0, [82, 73, 70, 70]) && is(8, [87, 69, 66, 80]) ? 'image/webp' : '';
  if (!mime) throw new Error('内容不是支持的 PNG/JPEG/GIF/WebP 图片；不能将网页或 SVG 当作图片输入。');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { type: 'image', source: { type: 'base64', media_type: mime, data: btoa(binary) } };
}

export interface WebImageReference { url: string; alt: string }
/** Extract image references only. Fetch selected images separately, never every tracker on a page. */
export function extractWebImages(html: string, pageUrl: string, limit = 12): WebImageReference[] {
  const images: WebImageReference[] = [];
  const seen = new Set<string>();
  const decode = (value: string) => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  const safeHtml = html.replace(/<!--[^]*?-->|<script\b[^]*?<\/script\s*>|<style\b[^]*?<\/style\s*>/gi, '');
  for (const match of safeHtml.matchAll(/<img\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const src = attrs['data-src'] || attrs['data-original'] || attrs.src || attrs.srcset?.split(',')[0]?.trim().split(/\s+/)[0];
    if (!src) continue;
    try {
      const url = new URL(src, pageUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
      if ((attrs.width && Number(attrs.width) <= 1) || (attrs.height && Number(attrs.height) <= 1)) continue;
      seen.add(url.href);
      images.push({ url: url.href, alt: (attrs.alt || '').slice(0, 300) });
      if (images.length >= limit) break;
    } catch { /* Invalid or unsupported image URL. */ }
  }
  return images;
}
