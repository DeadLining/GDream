import { createDir, writeBinaryFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { readNativeImage } from '@/lib/agent/nativeImageInput';
import type { AgentUserContentBlock } from '@/lib/agent/types';

/** Copy validated bytes, not user-controlled paths, into durable project storage. */
export async function saveAdImage(projectId: string, input: string, signal?: AbortSignal): Promise<{path: string; media: AgentUserContentBlock}> {
  if (!/^[\w-]+$/.test(projectId)) throw new Error('无效项目 ID');
  const media = await readNativeImage(input, signal);
  if (media.type !== 'image' || media.source.type !== 'base64') throw new Error('图片读取失败');
  const ext = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[media.source.media_type];
  if (!ext) throw new Error('图片格式不支持');
  const dir = `.gdream/aigc-memory/projects/${projectId}/assets/ad-materials`;
  await createDir(dir, {dir:BaseDirectory.Home,recursive:true});
  signal?.throwIfAborted();
  const rel = `${dir}/${crypto.randomUUID()}.${ext}`;
  await writeBinaryFile(rel, Uint8Array.from(atob(media.source.data), c => c.charCodeAt(0)), {dir:BaseDirectory.Home});
  const home = await homeDir();
  signal?.throwIfAborted();
  return {path:`${home.replace(/\/$/,'')}/${rel}`,media};
}

/** Shared by the explicit product upload UI and the model's user-authorized binding tool. */
export async function importAdProductImages(paths: string[], replace = false, signal?: AbortSignal): Promise<string[]> {
  const { useWorkshopStore } = await import('@/stores/workshopStore');
  const { adMaterialsFingerprint } = await import('./adMaterials');
  const before = useWorkshopStore.getState();
  const id = before.project?.id;
  const spec = before.data?.creativeSpec;
  if (!id || spec?.workKind !== 'product-ad' || !spec.adSpec) throw new Error('请先选择产品广告');
  const fingerprint = adMaterialsFingerprint(spec.adSpec);
  const oldPaths = replace ? [] : spec.adSpec.productImages ?? [];
  const unique = [...new Set(paths)].filter(p => !oldPaths.includes(p));
  if (!unique.length || unique.length + oldPaths.length > 4) throw new Error('产品图片总数须为 1–4 张');
  if (unique.some(p => !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p))) throw new Error('请使用用户已确认的本地产品图片；网页检索图不能自动当作产品图');
  const saved: string[] = [];
  for (const path of unique) saved.push((await saveAdImage(id, path, signal)).path);
  signal?.throwIfAborted();
  const now = useWorkshopStore.getState();
  if (now.project?.id !== id || now.data?.creativeSpec?.workKind !== 'product-ad' || !now.data.creativeSpec.adSpec || adMaterialsFingerprint(now.data.creativeSpec.adSpec) !== fingerprint) throw new Error('项目或产品图片已改变，本次上传未绑定，请重试');
  const productImages = [...oldPaths, ...saved];
  now.setCreativeSpec({...now.data.creativeSpec,adSpec:{...now.data.creativeSpec.adSpec,productImages,materials:undefined}});
  await useWorkshopStore.getState().commitNow();
  return productImages;
}
