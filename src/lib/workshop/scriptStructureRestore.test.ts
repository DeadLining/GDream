import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferBeatPurpose,
  parseRevisionStructure,
  planStructureRestore,
} from './scriptStructureRestore.ts';
import { validateBreakdownInput } from './breakdownValidation.ts';
import type { WsNarrativeBeat, WsScene } from './types.ts';

const CONTENT = [
  '故事核心：边缘战队在关键常规赛惨败后重建决策。',
  '',
  '第1集《败者的复盘》',
  '',
  'Scene 1：败战后训练室',
  '连续地点：边缘战队训练室。连续时间：惨败后的当晚。进入状态：比赛刚结束，队员沉默，陆沉坐在操作位。核心目标与冲突：陆沉确认失败是否来自个人实力。可拍动作：陆沉反复回看败战录像，在纸上记下集体迟疑的时间点。离开状态：秦教练停在桌边，队伍未解散。',
  'Beat 1.1“惨败后的沉默”：比赛结果停在屏幕上，队员低头坐着，陆沉重新打开败战录像。',
  'Beat 1.2“提出最后训练机会”：陆沉把集体迟疑记录推到秦教练面前，秦教练只留下战术板。',
  '',
  'Scene 2：录像复盘区',
  '连续地点：训练室内复盘大屏区域。连续时间：同一晚，紧接 Scene 1。进入状态：陆沉已暂停败战录像。核心目标与冲突：陆沉证明过度集中指挥造成迟疑。可拍动作：陆沉圈出多个停顿点，重播完整片段。离开状态：新分工成为训练赛验证内容。',
  'Beat 2.1“发现指挥迟疑根因”：多人等待指令的失败节点被标出，战术板形成连续停顿标记。',
  'Beat 2.2“新人正面冲突”：周野擦掉一处标记，冲突转为必须通过训练赛验证。',
  '',
  '第2集《越过资格线》',
  '',
  'Scene 3：赛场后台·资格战前夜',
  '连续地点：资格战赛场后台准备区。连续时间：资格战前夜。进入状态：队伍抽中豪门。核心目标与冲突：新分工能否进入正式比赛。可拍动作：陆沉移开个人指挥标记。离开状态：秦教练允许新分工进入正式比赛。',
  'Beat 3.1“豪门抽签施压”：抽签屏幕亮起，周野敲击停下，队伍进入资格战状态。',
].join('\n');

const SCENES: WsScene[] = [
  { id: 'scene-01', name: '败战后训练室', description: '既有描述一' },
  { id: 'scene-02', name: '录像复盘区', description: '既有描述二' },
];

const EXISTING_BEATS: WsNarrativeBeat[] = [
  { id: 'scene-01-beat-01', sceneId: 'scene-01', title: '惨败后的沉默', purpose: '情绪', shotNos: [] },
  { id: 'scene-01-beat-02', sceneId: 'scene-01', title: '提出最后训练机会', purpose: '不可逆动作', shotNos: [] },
  { id: 'scene-02-beat-01', sceneId: 'scene-02', title: '发现指挥迟疑根因', purpose: '信息', shotNos: [] },
  { id: 'scene-02-beat-02', sceneId: 'scene-02', title: '新人正面冲突', purpose: '关系', shotNos: [] },
];

test('parseRevisionStructure 读取 Scene 字段、Beat 标题与集号', () => {
  const parsed = parseRevisionStructure(CONTENT);
  assert.equal(parsed.scenes.length, 3);
  assert.deepEqual(parsed.scenes.map((scene) => scene.title), ['败战后训练室', '录像复盘区', '赛场后台·资格战前夜']);
  assert.equal(parsed.scenes[0].fields.location, '边缘战队训练室');
  assert.equal(parsed.scenes[0].fields.time, '惨败后的当晚');
  assert.equal(parsed.scenes[0].fields.exitState, '秦教练停在桌边，队伍未解散');
  assert.equal(parsed.scenes[0].episode, '1');
  assert.equal(parsed.scenes[2].episode, '2');
  assert.equal(parsed.beats.length, 5);
  assert.deepEqual(parsed.beats.map((beat) => beat.title), [
    '惨败后的沉默', '提出最后训练机会', '发现指挥迟疑根因', '新人正面冲突', '豪门抽签施压',
  ]);
  assert.equal(parsed.beats[4].action, '抽签屏幕亮起，周野敲击停下，队伍进入资格战状态。');
});

test('parseRevisionStructure 对无法识别的正文返回空结构', () => {
  const parsed = parseRevisionStructure('这是一段没有 Scene/Beat 标签的自由文本。');
  assert.deepEqual(parsed, { scenes: [], beats: [] });
});

test('planStructureRestore 只补缺口，保留已有 Beat 与作者修改', () => {
  const plan = planStructureRestore({
    content: CONTENT,
    scenes: SCENES,
    beats: EXISTING_BEATS,
    expectedSceneCount: 3,
    expectedBeatCount: 5,
  });
  assert.equal(plan.newScenes.length, 1);
  assert.equal(plan.newScenes[0].id, 'scene-03');
  assert.match(plan.newScenes[0].description, /连续地点：资格战赛场后台准备区/u);
  assert.equal(plan.newBeats.length, 1);
  assert.equal(plan.newBeats[0].id, 'scene-03-beat-01');
  assert.equal(plan.newBeats[0].episode, '2');
  assert.equal(plan.newBeats[0].sourceExcerpt, '抽签屏幕亮起，周野敲击停下，队伍进入资格战状态。');
  // 已有记录原样保留（包括作者手写的 purpose）
  const kept = plan.nextBeats.find((beat) => beat.id === 'scene-01-beat-01');
  assert.equal(kept?.purpose, '情绪');
  assert.equal(plan.nextBeats.length, 5);
  const sceneOrder = plan.nextBeats.map((beat) => beat.id);
  assert.deepEqual(sceneOrder, [
    'scene-01-beat-01', 'scene-01-beat-02',
    'scene-02-beat-01', 'scene-02-beat-02',
    'scene-03-beat-01',
  ]);
});

test('planStructureRestore 在解析数量低于审核数量时不写入半截 Beat', () => {
  const partial = 'Scene 1：败战后训练室\n连续地点：训练室。\nBeat 1.1“惨败后的沉默”：队员低头坐着。';
  const plan = planStructureRestore({
    content: partial,
    scenes: SCENES,
    beats: EXISTING_BEATS,
    expectedBeatCount: 5,
  });
  assert.equal(plan.newBeats.length, 0);
  assert.equal(plan.nextBeats.length, 4);
});

test('planStructureRestore 对同场景同名 Beat 不重复创建', () => {
  const plan = planStructureRestore({
    content: CONTENT,
    scenes: SCENES,
    beats: [
      ...EXISTING_BEATS,
      { id: 'scene-03-beat-09', sceneId: 'scene-03', title: '豪门抽签施压', purpose: '信息' },
    ],
  });
  assert.equal(plan.newBeats.length, 0);
  assert.deepEqual(plan.skippedExistingTitles, ['豪门抽签施压']);
  assert.equal(plan.nextBeats.find((beat) => beat.title === '豪门抽签施压')?.id, 'scene-03-beat-09');
});

test('planStructureRestore 按正文序号兜底匹配自定义 Scene id', () => {
  const plan = planStructureRestore({
    content: CONTENT,
    scenes: [
      { id: 'opening-room', name: '败战后训练室', description: 'A' },
      { id: 'replay-zone', name: '录像复盘区', description: 'B' },
      { id: 'qualifier-backstage', name: '赛场后台·资格战前夜', description: 'C' },
    ],
    beats: [],
  });
  assert.deepEqual(plan.newBeats.map((beat) => beat.id), [
    'opening-room-beat-01', 'opening-room-beat-02',
    'replay-zone-beat-01', 'replay-zone-beat-02',
    'qualifier-backstage-beat-01',
  ]);
});

test('inferBeatPurpose 只做保守判断并落到允许的取值', () => {
  assert.equal(inferBeatPurpose('摘下护腕', '陆沉摘下护腕放在战术板旁'), '不可逆动作');
  assert.equal(inferBeatPurpose('新人正面冲突', '周野擦掉标记，冲突升级'), '关系');
  assert.equal(inferBeatPurpose('惨败后的沉默', '队员低头坐着，房间一片沉默'), '情绪');
  assert.equal(inferBeatPurpose('豪门抽签施压', '抽签屏幕亮起'), '信息');
});

test('审核计数高于实际计数时，确定性恢复能把结构补到门禁线以上并通过原子校验', () => {
  // 复现真实阻塞：Draft Review 记录 3 Scene / 5 Beat，落盘却只有 2 Scene / 4 Beat，
  // 任何一次低于门槛的写入都会被原子拒绝，形成“重试永远撞同一堵墙”的闭环。
  const plan = planStructureRestore({
    content: CONTENT,
    scenes: SCENES,
    beats: EXISTING_BEATS,
    expectedSceneCount: 3,
    expectedBeatCount: 5,
  });
  assert.equal(plan.nextScenes.length, 3);
  assert.equal(plan.nextBeats.length, 5);
  const errors = validateBreakdownInput({
    synopsis: '边缘战队在关键常规赛惨败后重建集体决策。',
    episodes: [{ no: '1', title: '败者的复盘', sceneList: '败战后训练室；录像复盘区；赛场后台' }],
    narrativeBeats: plan.nextBeats,
    characters: [{ id: 'lu-chen', name: '陆沉', personality: '克制', appearance: '青年选手，深色队服' }],
    scenes: plan.nextScenes,
    props: [],
  });
  assert.deepEqual(errors, []);
});
