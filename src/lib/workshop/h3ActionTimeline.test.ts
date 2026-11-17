import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TIMELINE_PLANNER_SYSTEM,
  certifyActionTimelineReview,
  buildActionTimelinePlannerPrompt,
  isActionTimelineUsableForH3,
  parseActionTimelineResponse,
} from './h3ActionTimeline.ts';

const shot = {
  durationSec: 4,
  characterIds: ['chen'],
  actionTimeline: {
    durationSec: 4,
    summary: '陈屿推动卡片，苏禾看向卡片并停手。',
    segments: [
      { startSec: 0, endSec: 1.2, track: 'body' as const, label: '陈屿前倾并压住卡片', subject: 'chen' },
      { startSec: 1.2, endSec: 2.6, track: 'prop' as const, label: '卡片沿桌面滑向苏禾', subject: 'card' },
      { startSec: 0, endSec: 4, track: 'camera' as const, label: '中景保持两人和桌面可见' },
      { startSec: 0, endSec: 4, track: 'sound' as const, label: '对白与桌面摩擦声' },
    ],
  },
} as any;

shot.actionTimeline.motionReview = {
  version: 1, mode: 'visible-change', reason: '推动卡片把讨论意图交给对方',
  changes: [{ segmentLabel: '卡片沿桌面滑向苏禾', visibleStart: '卡片在陈屿手边', visibleEnd: '卡片移到苏禾面前' }],
};
shot.actionTimeline = certifyActionTimelineReview(shot, shot.actionTimeline);

test('Layer 1 is an internal action plan, not a long H3 prose template', () => {
  assert.match(ACTION_TIMELINE_PLANNER_SYSTEM, /cause -> physical action -> contact or path -> visible result -> resulting state/);
  assert.match(ACTION_TIMELINE_PLANNER_SYSTEM, /3-5 primary action beats/);
  assert.match(buildActionTimelinePlannerPrompt({ shotNo: '01-02', durationSec: 4, canonicalFacts: 'facts' }), /Return one JSON object only/);
});

test('Layer 1 parser normalizes fenced JSON and enforces required tracks', () => {
  const result = parseActionTimelineResponse('```json\n{"durationSec":4,"summary":"动作","segments":[{"startSec":0,"endSec":1,"track":"body","label":"起身"},{"startSec":0,"endSec":4,"track":"camera","label":"中景"},{"startSec":0,"endSec":4,"track":"sound","label":"环境声"}]}\n```', 4);
  assert.equal(result.durationSec, 4);
  assert.equal(result.segments.length, 3);
});

test('Layer 2 reuses a real timeline but rejects the legacy whole-shot fallback', () => {
  assert.equal(isActionTimelineUsableForH3(shot), true);
  assert.equal(isActionTimelineUsableForH3({
    durationSec: 4,
    characterIds: ['chen'],
    description: 'Canonical action',
    actionTimeline: {
      durationSec: 4,
      summary: 'Canonical action',
      segments: [
        { startSec: 0, endSec: 4, track: 'body', label: 'Canonical action' },
        { startSec: 0, endSec: 4, track: 'camera', label: '固定机位' },
        { startSec: 0, endSec: 4, track: 'sound', label: '环境声' },
      ],
    },
  } as any), false);
});


test('legacy static plan is not reused just because tracks and people are covered', () => {
  const legacy = structuredClone(shot);
  delete legacy.actionTimeline.motionReview;
  legacy.actionTimeline.segments = [
    { startSec: 0, endSec: 4, track: 'body', subject: 'chen', label: '保持静坐，无位移' },
    { startSec: 0, endSec: 4, track: 'camera', label: '固定全景，极轻微横移' },
    { startSec: 0, endSec: 4, track: 'sound', label: '环境声' },
  ];
  assert.equal(isActionTimelineUsableForH3(legacy), false);
});

test('an explicit deliberate hold is allowed without inventing motion', () => {
  const held = structuredClone(shot);
  held.actionTimeline.segments = [
    { startSec: 0, endSec: 4, track: 'body', subject: 'chen', label: '品牌片尾人物定格' },
    { startSec: 0, endSec: 4, track: 'camera', label: '锁定机位' },
    { startSec: 0, endSec: 4, track: 'sound', label: '品牌音效延续' },
  ];
  held.actionTimeline.motionReview = { version: 1, mode: 'intentional-hold', reason: '片尾产品定格四秒，留出品牌文字阅读时间', changes: [] };
  held.actionTimeline = certifyActionTimelineReview(held, held.actionTimeline);
  assert.equal(isActionTimelineUsableForH3(held), true);
});

test('motion evidence cannot be missing, sound-only or the same start/end state', () => {
  for (const changes of [[], [{ segmentLabel: '对白与桌面摩擦声', visibleStart: '安静', visibleEnd: '响声' }], [{ segmentLabel: '卡片沿桌面滑向苏禾', visibleStart: '静止', visibleEnd: '静止' }]]) {
    const invalid = structuredClone(shot);
    invalid.actionTimeline.motionReview.changes = changes;
    assert.throws(() => certifyActionTimelineReview(invalid, invalid.actionTimeline), /缺少可见变化依据/);
  }
});

test('facts and timeline changes invalidate a previously reviewed plan', () => {
  for (const mutate of [
    (s: any) => { s.atomicAction = '画面内无人动作'; },
    (s: any) => { s.camera = '固定机位'; },
    (s: any) => { s.actionTimeline.segments[0].label = '保持静止'; },
    (s: any) => { s.actionTimeline.segments[0].endSec = NaN; },
  ]) {
    const changed = structuredClone(shot);
    mutate(changed);
    assert.equal(isActionTimelineUsableForH3(changed), false);
  }
});

test('planner conflicts remain actionable and do not masquerade as a completed timeline', () => {
  assert.throws(() => parseActionTimelineResponse('{"planningIssue":"无人动作与开场交流意图冲突"}', 4), /动作规划需修正.*无人动作/);
});

test('normalizes exact cast names before stamping the motion review', async () => {
  const { normalizeActionTimelineSubjects, actionTimelineValidationIssue } = await import('./h3ActionTimeline.ts');
  const target = { durationSec: 4, characterIds: ['suhe', 'chenyu'] };
  const raw = { ...shot.actionTimeline, segments: [
    ...shot.actionTimeline.segments.map((s: any) => s.track === 'body' ? { ...s, subject: '陈屿' } : s),
    { startSec: 0, endSec: 4, track: 'gaze' as const, subject: '苏禾', label: '苏禾抬眼看向陈屿' },
  ] };
  const unbound = certifyActionTimelineReview(target, raw);
  assert.match(actionTimelineValidationIssue({ ...target, actionTimeline: unbound })!, /suhe、chenyu/);
  const normalized = normalizeActionTimelineSubjects(raw, [{ id: 'suhe', name: '苏禾' }, { id: 'chenyu', name: '陈屿' }]);
  const certified = certifyActionTimelineReview(target, normalized);
  assert.equal(actionTimelineValidationIssue({ ...target, actionTimeline: certified }), undefined);
  assert.equal(raw.segments.at(-1)?.subject, '苏禾');
});

test('cast checking rejects ambiguous names, partial IDs and camera-only mentions', async () => {
  const { normalizeActionTimelineSubjects, actionTimelineValidationIssue } = await import('./h3ActionTimeline.ts');
  const raw = { ...shot.actionTimeline, segments: shot.actionTimeline.segments.map((s: any) => ({ ...s, subject: s.track === 'camera' ? 'chen' : 'chenyu' })) };
  const certified = certifyActionTimelineReview(shot, raw);
  assert.match(actionTimelineValidationIssue({ ...shot, actionTimeline: certified })!, /缺少角色动作：chen/);
  assert.throws(() => normalizeActionTimelineSubjects(raw, [{ id: 'a', name: 'chenyu' }, { id: 'b', name: 'chenyu' }]), /对应多个角色/);
});
