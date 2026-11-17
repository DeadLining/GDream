import type { DirectorReport, DirectorReportCheck, WsShot } from './types.ts';
import { ATOMIC_MAX_SEC, SINGLE_TIMELINE_MAX_SEC, TRANSITION_MAX_SEC } from './shotTimingPolicy.ts';

const HOOK_TERMS = /异常|冲突|危险|威胁|问题|秘密|目标|承诺|发现|突然|紧急|追|逃|阻止|疑问|anomaly|conflict|danger|question/i;
const ESCALATION_TERMS = /风险|危险|威胁|失控|受伤|追|逃|崩溃|爆炸|失败|暴露|逼近|紧张|恐惧|愤怒|risk|danger|threat|injury|failure/i;

function textOf(shot: WsShot): string {
  return [shot.description, shot.atomicAction, shot.dialogue, shot.mood].filter(Boolean).join(' ');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。；、,.!?！？:："“”‘’()（）\[\]【】]/g, '')
    .slice(0, 180);
}

function check(status: DirectorReportCheck['status'], summary: string, shotNos: string[] = []): DirectorReportCheck {
  return { status, summary, shotNos: [...new Set(shotNos)] };
}

function buildHookCheck(shots: WsShot[]): DirectorReportCheck {
  const opening = shots.slice(0, 2);
  const matched = opening.filter((shot) => HOOK_TERMS.test(textOf(shot))).map((shot) => shot.shotNo);
  if (matched.length > 0) return check('pass', `前两镜已建立异常、冲突、问题或明确行动承诺（${matched.join('、')}）。`, matched);
  return check('warning', '前两镜未检测到明确 Hook 信号；请尽早给出异常、冲突、问题或承诺，不要先堆环境铺垫。', opening.map((shot) => shot.shotNo));
}

function buildProgressionCheck(shots: WsShot[]): DirectorReportCheck {
  const repeated: string[] = [];
  for (let index = 1; index < shots.length; index += 1) {
    const previous = normalize(`${shots[index - 1].atomicAction ?? ''}${shots[index - 1].description}`);
    const current = normalize(`${shots[index].atomicAction ?? ''}${shots[index].description}`);
    if (previous && current && (previous === current || previous.includes(current) || current.includes(previous))) {
      repeated.push(shots[index].shotNo);
    }
  }
  if (repeated.length === 0) return check('pass', '相邻原子镜头没有发现明显的同义重复，信息/动作应继续向前推进。');
  return check('warning', `相邻镜头可能只是同义改写，需确认每镜至少推进信息、关系、情绪或不可逆动作（${repeated.join('、')}）。`, repeated);
}

function buildEscalationCheck(shots: WsShot[]): DirectorReportCheck {
  const scored = shots.map((shot) => ({ shot, score: (ESCALATION_TERMS.test(textOf(shot)) ? 2 : 0) + (shot.dialogue?.trim() ? 1 : 0) }));
  const increases = scored.some((entry, index) => index > 0 && entry.score > scored[index - 1].score);
  const marked = scored.filter((entry) => entry.score >= 2).map((entry) => entry.shot.shotNo);
  if (shots.length < 2 || increases || marked.length >= 2) return check('pass', '已检测到风险、行动或情绪的推进信号。', marked);
  return check('warning', '未检测到明显的升级链；请确认限制、风险、行动或情绪是否逐步加压，或明确写出刻意降落的理由。', marked);
}

/**
 * A shot needs one visual focus: something the audience watches change within
 * this shot. Environment establishing, posing and "atmosphere" are not changes.
 * This is a creative warning, never a structural blocker.
 */
const VISIBLE_CHANGE_RE = /(?:击|打|挥|劈|斩|刺|踢|撞|砸|抓|夺|推|拉|冲|跃|跳|落|升|降|退|进|转|抬|举|按|握|拔|收|放|丢|掷|扑|闪|躲|挡|接|劈|崩|裂|碎|炸|爆|燃|烧|熄|灭|震|颤|亮|暗|散|聚|睁|闭|张口|伸手|迈步|结印|冲刺|格挡|转身|回头|低头|抬头|奔向|追上|拽|拖|压|挡下|击中|命中|甩|扫|切|划|斩落|掀|卷|裹|抽|顿|磕|碰|触|抛|掷出|打出|撞上|撞开|砸落|劈落|刺出|动|变化|发现|看见|听见|说出|开口|沉默|认出|明白|退开|逼近)/;
const STATIC_SCAFFOLD_RE = /(?:悬浮着|落在|站在|立着|相对|对视|对峙|凝视|环视|扫过|铺垫|气氛|环境|远景|全景)/;

function shotHasVisibleChange(shot: WsShot): boolean {
  const text = `${shot.description}\n${shot.atomicAction ?? ''}`;
  if (VISIBLE_CHANGE_RE.test(text)) return true;
  return Boolean(shot.dialogue?.trim());
}

function buildFocusCheck(shots: WsShot[]): DirectorReportCheck {
  const withoutFocus = shots.filter((shot) => !shotHasVisibleChange(shot)).map((shot) => shot.shotNo);
  // Opening must establish action, conflict or a clear question, not just scenery.
  const opening = shots.slice(0, 2);
  const openingStatic = opening.filter((shot) => !shotHasVisibleChange(shot) || STATIC_SCAFFOLD_RE.test(`${shot.description}${shot.atomicAction ?? ''}`)).map((shot) => shot.shotNo);
  const flags = [...new Set([...withoutFocus, ...openingStatic])];
  if (flags.length === 0) return check('pass', '每个镜头都有可辨识的视觉重点与可见变化，开场已直接进入动作、冲突或明确问题。');
  const notes: string[] = [];
  if (openingStatic.length) notes.push(`开场镜头仍是环境交代或人物摆位（${openingStatic.join('、')}），观众在该镜内看不到正在发生的事`);
  if (withoutFocus.length) notes.push(`镜头没有可见变化（${withoutFocus.join('、')}），请给每镜一个动作推进、信息揭示、情绪转折或关系变化`);
  return check('warning', `镜头重点需要复核：${notes.join('；')}。`, flags);
}

function buildDensityCheck(shots: WsShot[]): DirectorReportCheck {
  const longShots = shots.filter((shot) => {
    const duration = shot.durationSec ?? 0;
    const maxDuration = shot.shotPlanningMode === 'single-timeline'
      ? SINGLE_TIMELINE_MAX_SEC
      : shot.transitionPlan
        ? TRANSITION_MAX_SEC
        : ATOMIC_MAX_SEC;
    return duration > maxDuration;
  }).map((shot) => shot.shotNo);
  const missingDurations = shots.filter((shot) => !shot.durationSec || shot.durationSec <= 0).map((shot) => shot.shotNo);
  const affected = [...longShots, ...missingDurations];
  if (affected.length === 0) return check('pass', `镜头时长与规划模式匹配：连续时间轴不超过 ${SINGLE_TIMELINE_MAX_SEC} 秒，严格原子镜头不超过 ${ATOMIC_MAX_SEC} 秒，受控转场不超过 ${TRANSITION_MAX_SEC} 秒。`);
  return check(
    longShots.length > 0 ? 'blocked' : 'warning',
    `镜头时长超出当前规划模式上限：${longShots.length ? longShots.join('、') : ''}${missingDurations.length ? `${longShots.length ? '；' : ''}缺少时长：${missingDurations.join('、')}` : ''}`.trim(),
    affected,
  );
}

function buildSoundCheck(shots: WsShot[]): DirectorReportCheck {
  const missing = shots.filter((shot) => !shot.soundIntent?.trim()).map((shot) => shot.shotNo);
  if (missing.length === 0) return check('pass', '每个原子镜头都写明了对白、环境声、拟音或音乐意图。');
  return check('warning', `有 ${missing.length} 镜缺少声音意图；重要对白和动作不能留给视频模型自行猜测（${missing.slice(0, 12).join('、')}）。`, missing);
}

export function buildDirectorReport(shots: WsShot[], generatedAt = Date.now()): DirectorReport {
  const ordered = [...shots];
  if (ordered.length === 0) {
    const empty = check('blocked', '当前没有 Atomic Shot；Scene/Narrative Beat 尚未落到可生成镜头，不能判定结构通过。');
    return {
      generatedAt,
      status: 'needs-review',
      totalShots: 0,
      totalDurationSec: 0,
      hook: empty,
      informationProgression: empty,
      escalation: empty,
      shotFocus: empty,
      shotDensity: empty,
      soundIntent: empty,
    };
  }
  const checks = {
    hook: buildHookCheck(ordered),
    informationProgression: buildProgressionCheck(ordered),
    escalation: buildEscalationCheck(ordered),
    shotFocus: buildFocusCheck(ordered),
    shotDensity: buildDensityCheck(ordered),
    soundIntent: buildSoundCheck(ordered),
  };
  const status = Object.values(checks).some((item) => item.status !== 'pass') ? 'needs-review' : 'pass';
  return {
    generatedAt,
    status,
    totalShots: ordered.length,
    totalDurationSec: ordered.reduce((sum, shot) => sum + (shot.durationSec ?? 0), 0),
    ...checks,
  };
}
