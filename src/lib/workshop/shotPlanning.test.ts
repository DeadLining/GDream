import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAtomicShotPlan } from './shotPlanning.ts';
import type { ShotContinuityState, WsShot } from './types.ts';

const state = (characters: string): ShotContinuityState => ({
  location: '雨夜街角铁门前',
  time: '同一雨夜连续时间',
  characters,
  props: '纸箱由陈默抱在胸前，手机在右手',
  environment: '冷蓝路灯，暴雨持续，铁门关闭',
});

const base: WsShot = {
  shotNo: '01-01',
  sceneId: 'street',
  description: '陈默站在铁门外低头查看手机。',
  narrativeBeat: '收到催促短信',
  atomicAction: '陈默读完短信并抬眼看向铁门',
  shotPlanningMode: 'atomic',
  continuityMode: 'scene-cut',
  entryState: state('陈默站在铁门外，面向铁门，低头看手机'),
  exitState: state('陈默仍站在铁门外，面向铁门，抬眼'),
  durationSec: 6,
  characterIds: ['chenmo'],
};

test('inherits the previous exit state without rewriting other facts', () => {
  const second: WsShot = {
    ...base,
    shotNo: '01-02',
    description: '陈默抬手敲门。',
    narrativeBeat: '尝试进入房屋',
    atomicAction: '陈默完成一次敲门动作',
    continuityMode: 'inherit',
    entryState: state('错误的另一位置'),
    exitState: state('陈默站在铁门外，右手停在门板前'),
  };
  const result = prepareAtomicShotPlan([base, second], 1);
  assert.deepEqual(result.shots[1].entryState, base.exitState);
  assert.equal(result.shots[1].planningReview?.status, 'pass');
});

test('rejects cross-space-time and overloaded actions inside inherited atomic shots', () => {
  const invalid: WsShot = {
    ...base,
    continuityMode: 'inherit',
    description: '陈默看手机，随后敲门，然后冲进屋，同时房东切到另一边报警，几小时后他又回到街角，最终离开。',
  };
  const result = prepareAtomicShotPlan([base, invalid], 1);
  assert.ok(result.issues.some((issue) => issue.code === 'cross-space-time'));
  assert.ok(result.issues.some((issue) => issue.code === 'action-overload'));
  assert.equal(result.shots[1].planningReview?.status, 'needs-repair');
});

test('rejects internal scene transitions even when the shot starts with a scene cut', () => {
  const invalid: WsShot = {
    ...base,
    continuityMode: 'scene-cut',
    description: '陈默站在铁门外查看手机，几小时后切到屋内继续争执。',
  };
  const result = prepareAtomicShotPlan([invalid], 1);
  assert.ok(result.issues.some((issue) => issue.code === 'cross-space-time'));
  assert.equal(result.shots[0].planningReview?.status, 'needs-repair');
});

test('rejects less explicit time and transition wording inside an atomic shot', () => {
  const result = prepareAtomicShotPlan([{ ...base,
    description: '几天后，画面转至码头，人物抬头寻找船只',
    atomicAction: '抬头寻找船只',
    continuityMode: 'scene-cut',
  }]);
  assert.equal(result.issues.some((issue) => issue.code === 'cross-space-time'), true);
});

test('warns when an atomic shot is longer than the preferred short generation unit', () => {
  const result = prepareAtomicShotPlan([{ ...base, durationSec: 9 }], 1);
  assert.ok(result.issues.some((issue) => issue.code === 'duration-overload' && issue.message.includes('4-7 秒')));
  assert.equal(result.shots[0].planningReview?.status, 'needs-repair');
});

test('allows one explicit controlled transition without mechanically splitting the shot', () => {
  const result = prepareAtomicShotPlan([{
    ...base,
    description: '陈默抬手遮满镜头，画面转至清晨站台的同构图。',
    atomicAction: '陈默用一次遮挡动作完成雨夜街角到清晨站台的视觉转场',
    durationSec: 8,
    transitionPlan: {
      kind: 'occlusion',
      trigger: '陈默的手掌完全遮满镜头',
      target: '清晨站台中陈默保持相同姿态的同构图',
      prompt: '遮挡前后保持人物身份、动作方向和主体构图一致，只发生一次场景变化。',
    },
  }], 1);
  assert.equal(result.issues.some((issue) => issue.severity === 'error'), false);
  assert.equal(result.shots[0].planningReview?.status, 'pass');
});

test('single timeline extends reference timing for complete chronological dialogue', () => {
  const result = prepareAtomicShotPlan([{
    ...base,
    shotPlanningMode: 'single-timeline',
    durationSec: 8,
    dialogue: '非要坐这个破车干什么。开家里的大奔去不好吗。我们该低调点。',
    description: '人物依次完成抱怨、靠近、回答和全息浮现，所有动作按时间轴连续发生。',
    atomicAction: '沿单一叙事线完成对话、拥抱承接和全息男孩出现',
  }], 1);
  assert.equal(result.shots[0].planningReview?.status, 'pass');
  assert.ok(result.shots[0].durationSec! > 8);
});

test('long text estimate warns for semantic timing review rather than proving infeasibility', () => {
  const result = prepareAtomicShotPlan([{ ...base, shotPlanningMode: 'single-timeline', durationSec: 8, dialogue: `陈默：${'完整的话需要自然表达'.repeat(10)}。` }], 1);
  assert.ok(result.issues.some((issue) => issue.code === 'duration-overload' && issue.severity === 'warning'));
  assert.equal(result.shots[0].planningReview?.status, 'pass');
  assert.equal(result.shots[0].durationSec, 8);
});

test('rejects repeated scene changes even with a transition plan', () => {
  const result = prepareAtomicShotPlan([{
    ...base,
    description: '画面转至清晨站台，随后切到码头。',
    transitionPlan: {
      kind: 'dissolve',
      trigger: '雨水漫过镜头',
      target: '清晨站台',
      prompt: '只做一次溶解转场。',
    },
  }], 1);
  assert.ok(result.issues.some((issue) => issue.code === 'transition-overload'));
  assert.equal(result.shots[0].planningReview?.status, 'needs-repair');
});

test('rejects parallel actions and multiple sequential transitions', () => {
  const result = prepareAtomicShotPlan([{
    ...base,
    description: '陈默一边敲门一边回头，同时又拿起手机查看消息。',
    atomicAction: '陈默随后转身并跑向街角。',
  }], 1);
  assert.ok(result.issues.some((issue) => issue.code === 'action-overload'));
  assert.equal(result.shots[0].planningReview?.status, 'needs-repair');
});
