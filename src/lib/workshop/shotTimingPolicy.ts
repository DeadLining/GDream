/**
 * Shared shot-timing policy.
 *
 * Timing is allocated by dramatic weight BEFORE shot count is decided. Keeping
 * these limits and the directive text in one place stops the planner, the
 * atomic-shot reviewer, the director report and the tool schema from drifting
 * apart (they previously disagreed enough that a climax shot could not be made
 * longer than an establishing shot).
 */

import { parseRef2vaDialogueLine } from './h3Ref2vaPrompt.ts';
import type { ShotActionTimeline } from './types.ts';

/** Current workshop single-clip budget, not a universal model capability claim. */
export const SINGLE_TIMELINE_MAX_SEC = 15;
/** A shot that only carries one strict action. */
export const ATOMIC_MAX_SEC = 7;
/** A shot whose single core change is a controlled transition. */
export const TRANSITION_MAX_SEC = 8;

/** Planning heuristics, not measured speech. The writer may allocate more time
 * for delivery, physical action and dramatic pauses. */
export function estimateDialogueSeconds(dialogue?: string): number {
  const turns = (dialogue ?? '').split(/\r?\n/u).map((line) => {
    const parsed = parseRef2vaDialogueLine(line);
    return parsed?.exactSpokenText ?? line.trim();
  }).filter(Boolean);
  if (!turns.length) return 0;
  let seconds = 0;
  for (const text of turns) {
    const syllabic = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
    const words = (text.match(/[\p{Script=Latin}\p{Script=Cyrillic}]+(?:['’-][\p{Script=Latin}\p{Script=Cyrillic}]+)*/gu) ?? []).length;
    const numbers = (text.match(/\d/gu) ?? []).length;
    const other = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Latin}\p{Script=Cyrillic}\d\p{P}\p{S}\s]/gu, '').length;
    seconds += syllabic / 3.6 + words / 2.3 + numbers / 3 + other / 3.6;
    seconds += (text.match(/[,，、;；:：]/gu) ?? []).length * 0.15;
    seconds += (text.match(/[。！？!?]|\.{3,}|…+/gu) ?? []).length * 0.3;
  }
  return Math.round((seconds + Math.max(0, turns.length - 1) * 0.35 + 1.2) * 100) / 100;
}

export function resolveShotTiming(input: {
  durationSec?: number;
  dialogue?: string;
  audioDurationSec?: number;
  /** Genuine media/caller floor, never a reference or a text-rate estimate. */
  minimumDurationSec?: number;
}) {
  const requestedSeconds = Number.isFinite(input.durationSec) && (input.durationSec ?? 0) > 0 ? input.durationSec! : 5;
  const measuredAudioSeconds = Number.isFinite(input.audioDurationSec) && (input.audioDurationSec ?? 0) > 0
    ? input.audioDurationSec! : 0;
  const callerMinimum = Number.isFinite(input.minimumDurationSec) && (input.minimumDurationSec ?? 0) > 0
    ? input.minimumDurationSec! : 0;
  const estimatedSpeechSeconds = estimateDialogueSeconds(input.dialogue);
  const minimumSeconds = Math.max(4, Math.ceil(measuredAudioSeconds), Math.ceil(callerMinimum));
  // Clamp the starting proposal, not the content. Only measured media or an
  // explicit floor can prove infeasibility before the writer sees the events.
  const proposal = Math.ceil(Math.max(requestedSeconds, estimatedSpeechSeconds, measuredAudioSeconds ? measuredAudioSeconds + 1.2 : 0));
  const effectiveSeconds = Math.max(minimumSeconds, Math.min(SINGLE_TIMELINE_MAX_SEC, proposal));
  return { requestedSeconds, measuredAudioSeconds, estimatedSpeechSeconds, minimumSeconds, effectiveSeconds, needsSplit: minimumSeconds > SINGLE_TIMELINE_MAX_SEC };
}

export function assertShotTimingFits(timing: ReturnType<typeof resolveShotTiming>): void {
  if (timing.needsSplit) {
    const basis = timing.measuredAudioSeconds > SINGLE_TIMELINE_MAX_SEC
      ? `实际注入配音长 ${timing.measuredAudioSeconds} 秒`
      : `明确的最低时长为 ${timing.minimumSeconds} 秒`;
    throw new Error(`H3_TIMING_UNRESOLVED: ${basis}，超过当前单镜预算 ${SINGLE_TIMELINE_MAX_SEC} 秒。请在完整话轮或动作落点处拆镜；不得加速、删词或截断对白。未覆盖原提示词。`);
  }
}

export function shotTimingAdviceEn(timing: ReturnType<typeof resolveShotTiming>): string {
  return `TIMING INPUTS: original/reference duration ${timing.requestedSeconds} seconds; text-only speech estimate ${timing.estimatedSpeechSeconds} seconds (advisory, not a measured minimum or fixed speech rate). Recompute from the complete dialogue and actual unfolding events; do not reject solely because a reference or estimate exceeds the budget. The genuine duration floor is ${timing.minimumSeconds} seconds${timing.measuredAudioSeconds ? `, including ${timing.measuredAudioSeconds} seconds of selected recorded audio` : ''}. Optional reaction buffers are flexible, not hard minima.`;
}

/** Preserve event order and overlapping lanes when the clip's time scale changes. */
export function retimeShotTimeline(timeline: ShotActionTimeline | undefined, durationSec: number): ShotActionTimeline | undefined {
  if (!timeline || timeline.durationSec === durationSec) return timeline;
  if (!Number.isFinite(timeline.durationSec) || timeline.durationSec <= 0) {
    throw new Error('动作时间轴原时长无效，无法同步调整时长。');
  }
  const scale = durationSec / timeline.durationSec;
  return { ...timeline, durationSec, segments: timeline.segments.map((segment) => ({
    ...segment,
    startSec: Math.max(0, Math.min(durationSec, segment.startSec * scale)),
    endSec: Math.max(0, Math.min(durationSec, segment.endSec * scale)),
  })) };
}

export const H3_FLEXIBLE_TIMING_EN = `TIMING POLICY: The supplied duration and existing time windows are planning references, not a demand to rush speech or retain an oversized old duration. Recompute time from the events that actually unfold in the video. First-frame composition, appearance, reference bindings and already-completed opening actions are states, not additional timed beats; their description length does not determine playback length. First allocate complete dialogue at a natural pace for its language and emotional delivery, with breaths, punctuation, turn handoffs and relevant listener reactions. Actions and listening may overlap speech where physically plausible; do not add all lanes as sequential time. Reflow flexible windows while preserving event order, exact words and opening/ending states. Add time for actions that cannot overlap, meaningful pauses and the final reaction. Do not use rapid-fire speech, time compression, chopped words or erased pauses to meet the initial target. Choose a shorter or longer effective duration within the supplied feasible range according to the actual content; do not pad a short exchange or static setup to fill the reference duration. A longer silent hold needs a supported dramatic or visual purpose. If the complete content genuinely cannot fit the current single-clip limit at a natural pace, return H3_TIMING_UNRESOLVED: explain the content that needs time and propose splitting at a natural speech/action boundary; do not truncate or paraphrase dialogue.
INTERNAL TIMING METADATA: Prefix the finished response with exactly H3_EFFECTIVE_DURATION: N seconds, where N is an integer in the supplied feasible range and matches every timeline and keyframe alignment. Then write the usable prompt. This first line is internal metadata removed before saving or video submission. Never put it in dialogue or append timing analysis to the video prompt.`;

/** Explicit metadata, never a duration guessed from arbitrary prose timestamps. */
export function readH3TimedPrompt(text: string, fallbackSeconds: number, minimumSeconds = 4): { prompt: string; durationSeconds: number } {
  const clean = text.trim().replace(/^```(?:text|markdown)?\s*/iu, '').replace(/\s*```$/iu, '').trim();
  if (/^H3_TIMING_UNRESOLVED:/u.test(clean)) throw new Error(`${clean}。未覆盖原提示词。`);
  const line = clean.match(/^H3_EFFECTIVE_DURATION:\s*([^\r\n]+)(?:\r?\n|$)/u);
  const parsed = line?.[1].trim().match(/^(\d+)\s*(?:seconds?|s|秒)\.?$/iu);
  const durationSeconds = line ? (parsed ? Number(parsed[1]) : NaN) : fallbackSeconds;
  if (!Number.isInteger(durationSeconds) || durationSeconds < minimumSeconds || durationSeconds > SINGLE_TIMELINE_MAX_SEC) {
    throw new Error(`H3_TIMING_UNRESOLVED: 有效时长须为 ${minimumSeconds}-${SINGLE_TIMELINE_MAX_SEC} 秒整数；不可靠加速缩短对白，超过上限应拆镜。未覆盖原提示词。`);
  }
  const prompt = line ? clean.slice(line[0].length).trim() : clean;
  if (!prompt) throw new Error('模型仅返回时长，没有可用的视频提示词。未覆盖原提示词。');
  // Check the explicit transport alignment, not incidental timestamps in prose.
  const lastFrameAlignment = prompt.match(/^How the reference pictures align[^\n]*;\s*Picture 2\s*\(from Shot [^)]+\)\s*aligns with the\s*(\d+(?:\.\d+)?)-second mark/iu);
  if (lastFrameAlignment && Number(lastFrameAlignment[1]) !== durationSeconds) {
    throw new Error('H3_TIMING_UNRESOLVED: 尾帧对齐时间与有效时长不一致，未覆盖原提示词。');
  }
  return { prompt, durationSeconds };
}

/**
 * Positive, actionable allocation rule. It deliberately avoids banning short
 * or long shots: the point is contrast, not a new fixed length.
 */
export function shotTimingDirectiveZh(episodeDurationSec?: number): string {
  const budget = Number.isFinite(episodeDurationSec) && (episodeDurationSec ?? 0) > 0
    ? `本集参考时长约 ${episodeDurationSec} 秒，不是硬上限。对白自然说完、必要动作和反应优先；容量不足可内部延长单镜与本集预计总时长，并汇报实际分配。只有用户明确要求精确卡时、固定时长或硬上限时才按硬约束处理。`
    : '按自然对白、动作与反应推导本集预计时长，不先定总量再压缩语速。';
  return `【镜头时长分配｜先分时间，再定镜数】
- 先估算完整对白按语言与情绪自然说完所需时间，计入呼吸、标点停顿、话轮交接、必要反应与不能并行的动作，再按剧情权重分配段落时间和镜头数量。不要先切出固定镜数或锁死总秒数再平均分配。动作、听者反应和环境声可合理重叠，不能把所有轨道机械相加。
- 每段时长由它本身的内容量决定，允许明显的长短对比：单一信息点、短应答、一次眼神或道具插入用较短时长；常规对话、连续走位和一次完整动作链用中等时长；高潮对撞、关键揭示、强情绪停顿和最重要的视觉兑现用更长时长，上限 ${SINGLE_TIMELINE_MAX_SEC} 秒。
- 内容量决定时间，而非时间决定内容量。首帧构图、外观、环境细节与开场已经完成的动作属于状态，不因描述较长而增加播放秒数或重新演一次。连续动作保留有意义的启动、接触、结果和状态变化；内容较少时缩短参考时长，不强塞停顿；较长静默须有明确的表演或视觉用途。延长镜头只用于已有对白、动作与反应的自然展开，原文内容保持不变，不用额外事件填时间。
- 镜头数量是时长分配的产物，不是目标。先确定每段需要多少秒才能演清楚，再合并或拆分：能在一个连续时间轴内自然演完的合并为一个镜头，并在该镜内展开完整动作链；只有并行动作线、超出 ${SINGLE_TIMELINE_MAX_SEC} 秒上限、多次场景切换或彼此独立的信息点才新增镜头。
- ${budget}
- 单镜容量不足时优先延长；超过当前 ${SINGLE_TIMELINE_MAX_SEC} 秒预算时，在完整话轮或动作落点处拆镜并承接状态。不得加速对白、删词或把一句话截断来卡秒数。
- 镜头内部的 actionTimeline 同样按真实动作与说话时值分段，不平均切分；调整 durationSec 时同步调整全部 startSec/endSec。`;
}
