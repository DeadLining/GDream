import type { WsShot } from './types.ts';
import { validateVideoArtifact } from './mediaValidation.ts';

/** Editing is a production step, not final delivery. Validate files, never fake reviews. */
export async function prepareEditorImport(
  shots: WsShot[],
  read: (path: string) => Promise<Uint8Array>,
  validate = validateVideoArtifact,
): Promise<Array<{path:string;label:string}>> {
  const items = [];
  for (const shot of shots) {
    if (!shot.videoPath) continue;
    try {
      const check = validate(await read(shot.videoPath));
      if (!check.valid) throw new Error(check.reason || '视频容器无效');
    } catch (error) {
      throw new Error(`${shot.shotNo} 无法导入剪辑：${error instanceof Error ? error.message : String(error)}`);
    }
    items.push({path:shot.videoPath,label:`${shot.shotNo} ${shot.description}`.slice(0,24)});
  }
  if (!items.length) throw new Error('没有可导入剪辑的视频');
  return items;
}
