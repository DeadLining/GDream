import type { WsShot } from './types.ts';

export interface EpisodeContinuityIssue { shotNo: string; code: string; message: string }

/** Checks only explicit, machine-readable continuity facts; legacy text remains valid. */
export function validateEpisodeContinuity(shots: WsShot[]): EpisodeContinuityIssue[] {
  const issues: EpisodeContinuityIssue[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const previous = shots[i - 1];
    const timeline = shot.actionTimeline;
    if (timeline && shot.durationSec != null && timeline.durationSec !== shot.durationSec) {
      issues.push({ shotNo: shot.shotNo, code: 'timeline-duration-mismatch', message: `时间轴时长 ${timeline.durationSec}s 与镜头时长 ${shot.durationSec}s 不一致。` });
    }
    const implicitlyInherited = shot.continuityMode === undefined
      && Boolean(previous?.sceneId && shot.sceneId && previous.sceneId === shot.sceneId);
    if (!previous || (shot.continuityMode !== 'inherit' && !implicitlyInherited)) continue;
    if (shot.sceneId && previous.sceneId && shot.sceneId !== previous.sceneId) {
      issues.push({ shotNo: shot.shotNo, code: 'inherit-scene-mismatch', message: '镜头声明继承上一镜，但场景 ID 已改变。' });
    }
    const prev = previous.continuitySnapshot;
    const current = shot.continuitySnapshot;
    if (prev?.cameraSignature && current?.cameraSignature && prev.cameraSignature !== current.cameraSignature && !shot.transitionPlan) {
      issues.push({ shotNo: shot.shotNo, code: 'camera-signature-jump', message: '继承镜头相机签名发生变化，但未声明转场计划。' });
    }
    const prevProps = new Map((prev?.props ?? []).map((p) => [p.id, p]));
    for (const prop of current?.props ?? []) {
      const old = prevProps.get(prop.id);
      if (old?.holder && prop.holder && old.holder !== prop.holder && !shot.actionTimeline?.segments.some((s) => s.track === 'prop' && /交|放|取|递|接|落/u.test(s.label))) {
        issues.push({ shotNo: shot.shotNo, code: 'prop-holder-jump', message: `道具 ${prop.id} 持有人从 ${old.holder} 变为 ${prop.holder}，时间轴没有交接动作。` });
      }
    }
  }
  return issues;
}
