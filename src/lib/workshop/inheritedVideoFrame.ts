import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import type { WsShot } from './types.ts';
import { shouldUsePreviousTail } from './shotContinuity.ts';

type FrameShot = Pick<WsShot, 'shotNo' | 'sceneId' | 'sceneImagePaths' | 'continuityMode' | 'episode' | 'videoPath'
  | 'videoStartFramePath' | 'videoEndFramePath' | 'acceptedVideoTail' | 'videoStartFrameInheritance' | 'usePreviousTailAsFirstFrame'>;

/** Automatic frame chaining follows the same scene/episode boundaries as planning. */
export function canInheritAcceptedVideoTail(shot: FrameShot, previous?: FrameShot): boolean {
  return shouldUsePreviousTail(shot, previous);
}

/** A planned end image is never evidence of the accepted video's actual last frame. */
export function acceptedVideoTailPath(shot?: FrameShot): string | undefined {
  if (!shot?.videoPath) return undefined;
  if (shot.acceptedVideoTail) {
    return shot.acceptedVideoTail.videoPath === shot.videoPath ? shot.acceptedVideoTail.framePath : undefined;
  }
  // Legacy acceptVideoCandidate stored actual FFmpeg captures in this dedicated naming scheme.
  return /-video-tail-\d+\.png$/i.test(shot.videoEndFramePath ?? '') ? shot.videoEndFramePath : undefined;
}

/** Shared by UI, preflight and submission. Explicitly chosen start images always win. */
export function selectVideoStartFrame(shot: FrameShot, previous: FrameShot | undefined, task: SglangH3Task) {
  const inheritedSelection = shot.videoStartFrameInheritance;
  const hasAutomaticFrame = Boolean(inheritedSelection && inheritedSelection.framePath === shot.videoStartFramePath);
  if (shot.videoStartFramePath && !hasAutomaticFrame) return { path: shot.videoStartFramePath, inherited: false };
  // An explicit per-shot opt-in turns the accepted previous tail into the
  // authored 0.00s opening state even in Ref2VA. It remains submitted as a
  // normal reference image, not as an API keyframe condition.
  if (shot.usePreviousTailAsFirstFrame && canInheritAcceptedVideoTail(shot, previous)) {
    const path = acceptedVideoTailPath(previous);
    if (path) return { path, inherited: true };
  }
  // ref2va/t2va submit reference assets or pure text; a boundary frame is
  // not part of their conditions. Keep it out of both the runtime payload and
  // the UI's automatic frame-chain affordances.
  if (task !== 'i2va') return {
    path: task === 'ref2va' || task === 't2va'
      ? undefined
      : (hasAutomaticFrame && !canInheritAcceptedVideoTail(shot, previous) ? undefined : shot.videoStartFramePath),
    inherited: false,
  };
  const canInherit = canInheritAcceptedVideoTail(shot, previous);
  const path = canInherit ? acceptedVideoTailPath(previous) : undefined;
  // Do not continue using an automatically inherited frame after its source changed or was removed.
  return { path, inherited: Boolean(path) };
}

export function inheritedStartFramePatch(shot: FrameShot, previous: FrameShot, task: SglangH3Task): Partial<WsShot> | undefined {
  if (task !== 'i2va') return undefined;
  const selected = selectVideoStartFrame(shot, previous, task);
  if (!selected.inherited || !selected.path || !previous.videoPath) return undefined;
  return {
    videoStartFramePath: selected.path,
    videoStartFrameInheritance: { shotNo: previous.shotNo, videoPath: previous.videoPath, framePath: selected.path },
    videoStartFramePrompt: undefined,
    videoStartFrameReferencePaths: undefined,
    videoStartFrameReferenceLabels: undefined,
    videoBoundaryFrameSignature: undefined,
    boundaryFrameQualityReview: undefined,
    boundaryFrameQualityReviewSignature: undefined,
  };
}
