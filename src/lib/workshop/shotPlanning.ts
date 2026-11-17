import type { ShotContinuityMode, ShotContinuityState, WsShot } from './types.ts';
import { buildDirectorReport } from './directorReport.ts';
import { ATOMIC_MAX_SEC, estimateDialogueSeconds, retimeShotTimeline, SINGLE_TIMELINE_MAX_SEC, TRANSITION_MAX_SEC } from './shotTimingPolicy.ts';

export interface AtomicShotIssue {
  shotNo: string;
  code: 'missing-plan' | 'cross-space-time' | 'missing-transition-plan' | 'transition-overload' | 'action-overload' | 'continuity-mismatch' | 'duration-overload';
  severity: 'error' | 'warning';
  message: string;
}

const CROSS_SPACE_TIME_RE = /(?:与此同时|另一边|切到|切换至|转场到|转场至|画面转至|镜头转至|来到另一个|回到此前|回到过去|(?:几|数|一|两|二|三|四|五|六|七|八|九|十|百|千|\d+)(?:秒|分钟|小时|天|周|月|年)后|第二天|次日|多年后|回忆中|梦境中|闪回|时间跳跃)/u;
const SCENE_TRANSITION_RE = /(?:切到|切换到|切换至|转场到|转场至|画面转至|镜头转至|来到另一个|回到此前|回到过去)/gu;
const TIME_TRANSITION_RE = /(?:(?:几|数|一|两|二|三|四|五|六|七|八|九|十|百|千|\d+)(?:秒|分钟|小时|天|周|月|年)后|第二天|次日|多年后|回忆中|梦境中|闪回|时间跳跃)/gu;
const ACTION_CONNECTOR_RE = /(?:随后|然后|接着|紧接着|同时|并且|继而|又|再|最终|转身后|说完后)/gu;
const PARALLEL_ACTION_RE = /(?:同时|一边.{0,40}一边|另一边|并在此时)/u;

function hasCompleteTransitionPlan(shot: WsShot): boolean {
  return Boolean(shot.transitionPlan?.kind
    && shot.transitionPlan.trigger?.trim()
    && shot.transitionPlan.target?.trim()
    && shot.transitionPlan.prompt?.trim());
}

function transitionSignalCount(text: string): number {
  const sceneChanges = (text.match(SCENE_TRANSITION_RE) ?? []).length;
  const timeChanges = (text.match(TIME_TRANSITION_RE) ?? []).length;
  return Math.max(sceneChanges, timeChanges, CROSS_SPACE_TIME_RE.test(text) ? 1 : 0);
}

function hasCompleteState(state?: ShotContinuityState): boolean {
  return Boolean(state?.location?.trim()
    && state.time?.trim()
    && state.characters?.trim()
    && state.props?.trim()
    && state.environment?.trim());
}

function cloneState(state: ShotContinuityState): ShotContinuityState {
  return { ...state };
}

function defaultMode(previous: WsShot | undefined, shot: WsShot): ShotContinuityMode {
  if (!previous || previous.sceneId !== shot.sceneId) return 'scene-cut';
  return 'inherit';
}

/**
 * Apply deterministic continuity inheritance, then review atomicity. This only
 * patches entryState when inheritance is explicit; it never rewrites story facts.
 */
export function prepareAtomicShotPlan(shots: WsShot[], now = Date.now()): {
  shots: WsShot[];
  issues: AtomicShotIssue[];
  directorReport: ReturnType<typeof buildDirectorReport>;
} {
  const issues: AtomicShotIssue[] = [];
  const prepared: WsShot[] = [];

  shots.forEach((source, index) => {
    const previous = prepared[index - 1];
    const continuityMode = source.continuityMode ?? defaultMode(previous, source);
    const shot: WsShot = {
      ...source,
      shotPlanningMode: source.shotPlanningMode ?? 'single-timeline',
      continuityMode,
      entryState: continuityMode === 'inherit' && previous?.exitState
        ? cloneState(previous.exitState)
        : source.entryState,
    };
    const shotIssues: AtomicShotIssue[] = [];

    if (!shot.narrativeBeat?.trim() || !shot.atomicAction?.trim() || !hasCompleteState(shot.entryState) || !hasCompleteState(shot.exitState)) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'missing-plan',
        severity: 'error',
        message: '缺少 narrativeBeat、atomicAction 或完整 entryState/exitState。状态必须包含地点、时间、人物、道具和环境。',
      });
    }
    if (continuityMode === 'inherit' && previous && previous.sceneId !== shot.sceneId) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'continuity-mismatch',
        severity: 'error',
        message: `声明继承上一镜，但 sceneId 已从 ${previous.sceneId ?? '未设置'} 变为 ${shot.sceneId ?? '未设置'}；请改为 scene-cut/time-jump/montage。`,
      });
    }
    const planningText = `${shot.description}\n${shot.atomicAction ?? ''}`;
    const transitionSignals = transitionSignalCount(planningText);
    const hasTransitionPlan = hasCompleteTransitionPlan(shot);
    if (transitionSignals > 0 && !hasTransitionPlan) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: shot.transitionPlan ? 'missing-transition-plan' : 'cross-space-time',
        severity: 'error',
        message: shot.transitionPlan
          ? '镜头包含场景变化，但受控转场计划不完整；请补齐转场类型、可见触发物、目标画面和模型约束。'
          : '镜头内部出现切场、跳时、闪回或并行地点信号；默认必须拆镜。若这是一次必要的视觉转场，请显式配置受控转场计划。',
      });
    }
    if (hasTransitionPlan && transitionSignals === 0) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'missing-transition-plan',
        severity: 'warning',
        message: '已配置受控转场，但镜头描述未明确场景变化；请确认确有必要，否则关闭转场以保持镜头简洁。',
      });
    }
    if (hasTransitionPlan && (transitionSignals > 1 || PARALLEL_ACTION_RE.test(planningText))) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'transition-overload',
        severity: 'error',
        message: '受控转场镜头最多允许一次明确场景变化，不能同时包含并行动作线、多次切换或往返场景。',
      });
    }
    const actionText = `${shot.description}；${shot.atomicAction ?? ''}`;
    const connectorCount = (actionText.match(ACTION_CONNECTOR_RE) ?? []).length;
    const isTimelineShot = shot.shotPlanningMode === 'single-timeline';
    if (PARALLEL_ACTION_RE.test(actionText) || (!isTimelineShot && connectorCount >= 2)) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'action-overload',
        severity: 'error',
        message: isTimelineShot
          ? '检测到并行动作线；单镜时间轴可以包含连续节拍，但不能并行发展两条动作线。'
          : `检测到并行动作或至少 ${connectorCount + 1} 个连续动作阶段；本镜只能保留一个主要动作目标和一次核心状态变化，请拆镜。`,
      });
    }
    const speechSeconds = Math.ceil(estimateDialogueSeconds(shot.dialogue));
    if (speechSeconds > SINGLE_TIMELINE_MAX_SEC) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'duration-overload',
        severity: 'warning',
        message: `按字数粗估对白约需 ${speechSeconds} 秒，可能超过当前单镜预算 ${SINGLE_TIMELINE_MAX_SEC} 秒；重写时结合自然语气、动作和反应核实，确实放不下再按完整话轮拆镜，不得加速或截断对白。`,
      });
    } else if (speechSeconds > (shot.durationSec ?? 5)) {
      shot.durationSec = speechSeconds;
      shot.actionTimeline = retimeShotTimeline(shot.actionTimeline, speechSeconds);
    }
    const maxDurationSec = isTimelineShot ? SINGLE_TIMELINE_MAX_SEC : (hasTransitionPlan ? TRANSITION_MAX_SEC : ATOMIC_MAX_SEC);
    if (shot.durationSec && shot.durationSec > maxDurationSec) {
      shotIssues.push({
        shotNo: shot.shotNo,
        code: 'duration-overload',
        severity: 'error',
        message: isTimelineShot
          ? `当前镜头为 ${shot.durationSec} 秒，超过单镜时间轴上限 ${SINGLE_TIMELINE_MAX_SEC} 秒；请按完整话轮或动作落点拆镜，不得加速对白。`
          : `当前镜头为 ${shot.durationSec} 秒；普通单一动作建议控制在 4-7 秒，单次受控转场建议控制在 5-8 秒，超出后应拆镜。`,
      });
    }

    issues.push(...shotIssues);
    prepared.push({
      ...shot,
      planningReview: {
        status: shotIssues.some((issue) => issue.severity === 'error') ? 'needs-repair' : 'pass',
        issues: shotIssues.map((issue) => issue.message),
        reviewedAt: now,
      },
    });
  });

  return { shots: prepared, issues, directorReport: buildDirectorReport(prepared, now) };
}
