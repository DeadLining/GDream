import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDirectorReport } from './directorReport.ts';
import type { WsShot } from './types.ts';

function shot(overrides: Partial<WsShot>): WsShot {
  return {
    shotNo: '01-01',
    description: '人物站在门边观察',
    characterIds: ['hero'],
    durationSec: 5,
    atomicAction: '观察门边异常',
    soundIntent: '低沉环境声与门轴轻响',
    ...overrides,
  };
}

test('director report exposes hook, progression, density and sound evidence', () => {
  const report = buildDirectorReport([
    shot({ shotNo: '01-01', description: '门外突然传来危险的撞击声', atomicAction: '抬头确认威胁' }),
    shot({ shotNo: '01-02', description: '人物握紧手中的钥匙', atomicAction: '握紧钥匙准备开门', soundIntent: '钥匙碰撞声' }),
  ], 100);
  assert.equal(report.generatedAt, 100);
  assert.equal(report.totalShots, 2);
  assert.equal(report.hook.status, 'pass');
  assert.equal(report.shotDensity.status, 'pass');
  assert.equal(report.soundIntent.status, 'pass');
});

test('director report flags overlong and under-authored shots', () => {
  const report = buildDirectorReport([shot({ durationSec: 16, shotPlanningMode: 'single-timeline', soundIntent: undefined })]);
  assert.equal(report.status, 'needs-review');
  assert.equal(report.shotDensity.status, 'blocked');
  assert.equal(report.soundIntent.status, 'warning');
});

test('director report keeps a complete eight-second single-timeline shot intact', () => {
  const report = buildDirectorReport([shot({ durationSec: 8, shotPlanningMode: 'single-timeline' })]);
  assert.equal(report.shotDensity.status, 'pass');
});

test('director report allows a longer single-timeline climax shot up to the model limit', () => {
  const report = buildDirectorReport([shot({ durationSec: 15, shotPlanningMode: 'single-timeline' })]);
  assert.equal(report.shotDensity.status, 'pass');
});

test('director report still blocks overlong strict atomic shots', () => {
  const report = buildDirectorReport([shot({ durationSec: 8, shotPlanningMode: 'atomic' })]);
  assert.equal(report.shotDensity.status, 'blocked');
});

test('creative warnings keep the report reviewable without becoming structural blockers', () => {
  const report = buildDirectorReport([shot({ description: '人物站在房间里', atomicAction: '站立', soundIntent: undefined })]);
  assert.equal(report.status, 'needs-review');
  assert.equal(report.hook.status, 'warning');
  assert.equal(report.soundIntent.status, 'warning');
  assert.equal(report.shotDensity.status, 'pass');
});

test('flags an opening that only establishes scenery and posing', () => {
  const report = buildDirectorReport([
    shot({
      shotNo: '01-01',
      description: '大远景，虚空深处一块方形石台悬浮着，边缘多处断裂。台外一侧悬着一枚布满裂纹的棱形核心。佐助自台面上方落下；萧炎几乎同时落在对侧。两人互不相识，视线先落在同一枚核心上，再同时转向对方。',
    }),
    shot({
      shotNo: '01-02',
      description: '双人中景，两人隔着台面中央的环形纹路相对。萧炎右手抽出背上巨尺，尺尖顿在台面；佐助左掌按住腰间剑鞘，右臂垂在身侧。谁都没有先开口，台面又震一次。',
    }),
  ]);
  assert.equal(report.shotFocus.status, 'warning');
  assert.deepEqual(report.shotFocus.shotNos, ['01-01', '01-02']);
});

test('passes an opening that enters action immediately', () => {
  const report = buildDirectorReport([
    shot({ shotNo: '01-01', description: '火球贴地压来，萧炎抡尺横扫迎上，两股火劲在半空炸散。', atomicAction: '萧炎挥尺挡下火球' }),
    shot({ shotNo: '01-02', description: '佐助压低身体冲刺，千鸟锐枪撞上气罩，雷光沿罩面爬开。', atomicAction: '佐助突进攻击' }),
  ]);
  assert.equal(report.shotFocus.status, 'pass');
});
