import { readBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { MAX_NATIVE_IMAGE_BYTES, nativeImageBlock } from './nativeImageContent';
import { normalizeLocalMediaPath } from './mediaInput';
import type { AgentUserContentBlock } from './types';

/** Content acquisition only: no separate model, prompt, or provider credential. */
export async function readNativeImage(input: string, signal?: AbortSignal): Promise<AgentUserContentBlock> {
  signal?.throwIfAborted();
  const value = input.trim();
  let bytes: Uint8Array;
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error('图片 URL 不能包含凭证。');
    const response = await tauriFetch<number[]>(url.href, { method: 'GET', responseType: ResponseType.Binary, timeout: 30 });
    if (!response.ok) throw new Error(`图片读取失败：HTTP ${response.status}`);
    bytes = Uint8Array.from(response.data);
  } else if (value.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([\s\S]+)$/.exec(value);
    if (!match || match[1].length > Math.ceil(MAX_NATIVE_IMAGE_BYTES / 3) * 4) throw new Error('无效或过大的图片 data URL。');
    bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0));
  } else {
    const path = normalizeLocalMediaPath(value);
    if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error('图片必须是绝对文件路径或 HTTP(S) URL。');
    const size = await invoke<number>('get_file_size', { path });
    if (size > MAX_NATIVE_IMAGE_BYTES) throw new Error('图片超过 5 MB，请缩小图片后重试。');
    bytes = await readBinaryFile(path);
  }
  signal?.throwIfAborted();
  return nativeImageBlock(bytes);
}
