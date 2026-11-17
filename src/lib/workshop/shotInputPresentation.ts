import { getBoundaryFrameBindings, type ShotRefsContext } from './shotRefs.ts';
import { shouldUsePreviousTail } from './shotContinuity.ts';
import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import { selectVideoStartFrame, acceptedVideoTailPath, canInheritAcceptedVideoTail } from './inheritedVideoFrame.ts';
import type { WsShot } from './types.ts';

/** Planning inputs are not video conditions. Keep them visible even before a
 * generated start frame exists, without adding them to an H3 video request. */
export function buildFirstFrameInputPresentation(
  shot: WsShot,
  previous: WsShot | undefined,
  context: ShotRefsContext,
  task?: SglangH3Task,
) {
  const assets = getBoundaryFrameBindings(shot, context);
  const inherits = task === 'i2va' ? canInheritAcceptedVideoTail(shot, previous) : shouldUsePreviousTail(shot, previous);
  const previousTail = inherits ? acceptedVideoTailPath(previous) ?? (task === 'i2va' ? undefined : previous?.videoEndFramePath) : undefined;
  const selected = task ? selectVideoStartFrame(shot, previous, task) : undefined;
  const continuityMessage = selected?.inherited
    ? `本镜首帧直接使用 ${previous!.shotNo} 已采用视频的尾帧截图，可直接生成视频，无需生成首尾帧。`
    : !previous
    ? '本镜是第一镜，没有上一镜尾帧。'
    : !inherits
      ? '本镜与上一镜的集号或场景不同（或场景信息缺失），不使用上一镜尾帧；请使用本镜素材生成新首帧（已有独立首帧可继续使用）。'
      : previousTail
        ? `承接 ${previous.shotNo} ${previous.videoPath ? '已采用视频的尾帧' : '计划尾帧（上一镜尚未采用视频）'}，用于制作本镜首帧。`
        : previous.videoPath
          ? previous.genError || `上一镜 ${previous.shotNo} 已采用视频，但尾帧尚未就绪。`
          : `上一镜 ${previous.shotNo} 尚无可用尾帧。`;
  return { assets, previousTail, continuityMessage };
}
