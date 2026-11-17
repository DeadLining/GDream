import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import { canInheritAcceptedVideoTail, selectVideoStartFrame } from './inheritedVideoFrame.ts';

type FrameSource = Parameters<typeof selectVideoStartFrame>[0];

/** Video submission only reads selected frames. It must never create or repair media. */
export async function resolveExistingVideoFrames(
  shot: FrameSource,
  task: SglangH3Task,
  fileExists: (path: string) => Promise<boolean>,
  previous?: FrameSource,
): Promise<{ start?: string; end?: string; refs: string[] }> {
  if (task !== 'i2va' && task !== 'fl2va') return { refs: [] };
  const start = selectVideoStartFrame(shot, previous, task);
  const required = task === 'i2va'
    ? [{ path: start.path, label: '首帧' }]
    : [{ path: start.path, label: '首帧' }, { path: shot.videoEndFramePath, label: '尾帧' }];
  for (const frame of required) {
    if (!frame.path?.trim()) {
      if (task === 'i2va' && frame.label === '首帧' && previous?.videoPath
        && canInheritAcceptedVideoTail(shot, previous)) {
        throw new Error(`${shot.shotNo} 承接的上一镜视频尾帧尚未就绪，请等待截图完成或检查上一镜的截图错误；无需生成首尾帧。`);
      }
      throw new Error(`${shot.shotNo} 缺少${frame.label}，请先点击“生成${frame.label}”；生成视频不会自动生图。`);
    }
    let available = false;
    try {
      available = await fileExists(frame.path);
    } catch {
      // Missing files and filesystem failures both block, never trigger paid repair.
    }
    if (!available) {
      if (frame.label === '首帧' && start.inherited) {
        throw new Error(`${shot.shotNo} 承接的上一镜尾帧截图文件不存在或无法访问，请恢复文件或重新采用上一镜视频以提取尾帧；无需重新生图。`);
      }
      throw new Error(`${shot.shotNo} 的${frame.label}文件不存在或无法访问，请先恢复文件或显式重做${frame.label}；生成视频不会自动生图。`);
    }
  }
  return {
    start: start.path,
    end: task === 'fl2va' ? shot.videoEndFramePath : undefined,
    refs: required.map((frame) => frame.path!),
  };
}
