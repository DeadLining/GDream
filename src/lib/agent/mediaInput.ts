import { nativeImageBlock } from './nativeImageContent.ts';
import { readBinaryFile } from '@tauri-apps/api/fs';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

export function normalizeLocalMediaPath(input: string): string {
  const value = input.trim();
  return value.startsWith('file://')
    ? decodeURIComponent(value.replace(/^file:\/\//, ''))
    : value;
}

export function mediaTypeForPath(input: string): string {
  if (input.startsWith('data:')) return input.match(/^data:([^;,]+)/)?.[1] || '';
  const path = input.split('?')[0];
  const extension = (path.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[extension] || 'application/octet-stream';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** File suffixes are hints only: providers sometimes save JPEG bytes as .png. */
export function imageBytesInput(bytes: Uint8Array): {dataUrl:string; mediaType:string} {
  const block = nativeImageBlock(bytes);
  if (block.type !== 'image' || block.source.type !== 'base64') throw new Error('未获得原生图片');
  return {dataUrl:`data:${block.source.media_type};base64,${block.source.data}`,mediaType:block.source.media_type};
}

export async function loadImageInput(image: string): Promise<string> {
  const input = image.trim();
  if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return input;

  const path = normalizeLocalMediaPath(input);
  const bytes = await readBinaryFile(path);
  return imageBytesInput(bytes).dataUrl;
}

export async function loadMediaInput(media: string): Promise<{ dataUrl: string; mediaType: string }> {
  const input = media.trim();
  if (/^https?:\/\//i.test(input)) {
    return { dataUrl: input, mediaType: '' };
  }
  if (input.startsWith('data:')) {
    const mediaType = input.match(/^data:([^;,]+)/)?.[1] || '';
    return { dataUrl: input, mediaType };
  }

  const path = normalizeLocalMediaPath(input);
  const mediaType = mediaTypeForPath(path);
  const bytes = await readBinaryFile(path);
  if (mediaType.startsWith('image/')) return imageBytesInput(bytes);
  return { dataUrl: `data:${mediaType};base64,${bytesToBase64(bytes)}`, mediaType };
}
