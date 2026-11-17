import { emptyWorkshopData } from './types.ts';
import { isTextSupportedByCanonical } from './narrativeGuard.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveShots,
  compileNarrativeBeatShotNos,
  hasShotSpatialBlocking,
  inferPhysicalOpeningCharacterIds,
  mergeBreakdownRecords,
  mergeNarrativeBeats,
  resolveBreakdownWriteMode,
  collectShotWriteConflicts,
  shotScreenplaySource,
  dialogueSupportedByScreenplay,
  repairDerivableTimelineTracks,
  repairTimelineCharacterCoverage,
  sortNarrativeBeats,
  validateNarrativeBeatRefs,
  validateShotEntityIds,
  validateTimelineCharacterCoverage,
} from './breakdownWrite.ts';
import type { ShotContinuityState, WsNarrativeBeat, WsScene, WsShot } from './types.ts';

const continuityState = (characters: string): ShotContinuityState => ({
  location: '出租屋',
  time: '23:00 雨夜',
  characters,
  props: '花枝散落在床面',
  environment: '雨声持续，电视发出冷光',
});

const shot = (patch: Partial<WsShot> = {}): WsShot => ({
  shotNo: '01-01',
  sceneId: 'room',
  description: '顾念坐在床沿，面向旧电视。',
  narrativeBeat: 'beat-1',
  atomicAction: '顾念停止整理花枝',
  entryState: continuityState('顾念坐在床沿，面向旧电视'),
  exitState: continuityState('顾念仍坐在床沿，视线落向旧电视'),
  characterIds: ['gu-nian'],
  ...patch,
});

const beats: WsNarrativeBeat[] = [
  { id: 'beat-1', sceneId: 'room', title: '停止整理花枝', purpose: '情绪' },
  { id: 'beat-2', sceneId: 'room', title: '抬眼看电视', purpose: '信息', shotNos: ['old-shot'] },
  { id: 'beat-3', sceneId: 'hall', title: '门外异响', purpose: '信息' },
];

test('mergeBreakdownRecords incrementally updates by id without losing old records or assets', () => {
  const existing: WsScene[] = [
    {
      id: 'room',
      name: '出租屋',
      description: '旧描述',
      assetImagePath: '/assets/room.png',
      selectedImagePaths: ['/assets/room-a.png', '/assets/room-b.png'],
      candidates: [{ path: '/assets/candidate.png', source: 'generate', createdAt: 1 }],
    },
    { id: 'hall', name: '走廊', description: '保留的走廊' },
  ];
  const merged = mergeBreakdownRecords(existing, [
    { id: 'room', description: '补充后的描述' },
    { id: 'roof', name: '天台', description: '新增天台' },
  ]);

  assert.deepEqual(merged.map((item) => item.id), ['room', 'hall', 'roof']);
  assert.equal(merged[0].description, '补充后的描述');
  assert.equal(merged[0].assetImagePath, '/assets/room.png');
  assert.deepEqual(merged[0].selectedImagePaths, ['/assets/room-a.png', '/assets/room-b.png']);
  assert.equal(merged[1].description, '保留的走廊');
});

test('replace drops omitted ids but preserves fields and assets on matching ids', () => {
  const existing: WsScene[] = [
    { id: 'room', name: '出租屋', description: '旧描述', assetImagePath: '/assets/room.png' },
    { id: 'hall', name: '走廊', description: '旧走廊' },
  ];
  const replaced = mergeBreakdownRecords(existing, [
    { id: 'room', name: '小城出租屋', description: '新描述' },
  ], 'replace');

  assert.deepEqual(replaced.map((item) => item.id), ['room']);
  assert.equal(replaced[0].assetImagePath, '/assets/room.png');
});

test('an incomplete persisted breakdown still honours merge repair mode', () => {
  assert.equal(resolveBreakdownWriteMode(false, 'merge'), 'replace');
  assert.equal(resolveBreakdownWriteMode(true, 'merge'), 'merge');
  assert.equal(resolveBreakdownWriteMode(true, 'replace'), 'replace');
});

test('mergeNarrativeBeats keeps omitted beats and shotNos not explicitly submitted', () => {
  const merged = mergeNarrativeBeats(beats, [
    { id: 'beat-2', purpose: '不可逆动作' },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[1].purpose, '不可逆动作');
  assert.deepEqual(merged[1].shotNos, ['old-shot']);

  const explicitlyCleared = mergeNarrativeBeats(beats, [{ id: 'beat-2', shotNos: [] }]);
  assert.deepEqual(explicitlyCleared[1].shotNos, []);
});

test('a four-beat repair cannot truncate an existing 27-beat breakdown', () => {
  const existing = Array.from({ length: 27 }, (_, index): WsNarrativeBeat => ({
    id: `beat-${index + 1}`,
    sceneId: `scene-${Math.floor(index / 3) + 1}`,
    title: `节拍 ${index + 1}`,
    purpose: '信息',
    shotNos: [`shot-${index + 1}`],
  }));
  const repair = [3, 8, 14, 22].map((index) => ({
    id: `beat-${index}`,
    purpose: '情绪',
  }));
  const merged = mergeNarrativeBeats(existing, repair);

  assert.equal(merged.length, 27);
  assert.deepEqual(merged.map((beat) => beat.id), existing.map((beat) => beat.id));
  assert.equal(merged.find((beat) => beat.id === 'beat-14')?.purpose, '情绪');
  assert.deepEqual(merged.find((beat) => beat.id === 'beat-14')?.shotNos, ['shot-14']);
});

test('mergeNarrativeBeats replace drops omitted ids and retains matching shotNos', () => {
  const replaced = mergeNarrativeBeats(beats, [{ id: 'beat-2', purpose: '关系' }], 'replace');
  assert.deepEqual(replaced.map((item) => item.id), ['beat-2']);
  assert.deepEqual(replaced[0].shotNos, ['old-shot']);
});

test('validateNarrativeBeatRefs accepts id or exact title only within the same scene', () => {
  const errors = validateNarrativeBeatRefs([
    shot({ shotNo: '01-01', narrativeBeat: 'beat-1' }),
    shot({ shotNo: '01-02', narrativeBeat: '抬眼看电视' }),
    shot({ shotNo: '01-03', narrativeBeat: '门外异响' }),
    shot({ shotNo: '01-04', sceneId: 'hall', narrativeBeat: '不存在的节拍' }),
  ], beats);

  assert.deepEqual(errors, [
    '01-03: sceneId "room" 中不存在 narrativeBeat "门外异响"；请填写该 Scene 下已有 Beat 的 id 或精确 title',
    '01-04: sceneId "hall" 中不存在 narrativeBeat "不存在的节拍"；请填写该 Scene 下已有 Beat 的 id 或精确 title',
  ]);
});

test('compileNarrativeBeatShotNos only rebuilds links and never invents a beat', () => {
  const compiled = compileNarrativeBeatShotNos(beats, [
    shot({ shotNo: '01-01', narrativeBeat: 'beat-1' }),
    shot({ shotNo: '01-02', narrativeBeat: '抬眼看电视' }),
    shot({ shotNo: '01-03', narrativeBeat: '未知节拍' }),
  ]);

  assert.equal(compiled.length, beats.length);
  assert.deepEqual(compiled.find((beat) => beat.id === 'beat-1')?.shotNos, ['01-01']);
  assert.deepEqual(compiled.find((beat) => beat.id === 'beat-2')?.shotNos, ['01-02']);
  assert.equal(compiled.some((beat) => beat.title === '未知节拍'), false);
});

test('buildProspectiveShots deeply merges states and timelines while keeping stable order', () => {
  const existing = [shot({
    actionTimeline: {
      durationSec: 8,
      summary: '旧概述',
      segments: [{ startSec: 0, endSec: 8, track: 'body', label: '坐在床沿' }],
    },
    sceneImagePaths: ['/assets/room-a.png'],
  })];
  const prospective = buildProspectiveShots(existing, [{
    shotNo: '01-01',
    entryState: { characters: '顾念坐在床沿左边，面向电视' } as ShotContinuityState,
    actionTimeline: { summary: '新概述' } as WsShot['actionTimeline'],
  }]);

  assert.equal(prospective[0].entryState?.location, '出租屋');
  assert.equal(prospective[0].entryState?.characters, '顾念坐在床沿左边，面向电视');
  assert.equal(prospective[0].actionTimeline?.durationSec, 8);
  assert.equal(prospective[0].actionTimeline?.summary, '新概述');
  assert.equal(prospective[0].actionTimeline?.segments.length, 1);
  assert.deepEqual(prospective[0].sceneImagePaths, ['/assets/room-a.png']);
});

test('buildProspectiveShots replace removes omitted shots but deep-merges matching shots', () => {
  const replaced = buildProspectiveShots([
    shot(),
    shot({ shotNo: '01-02' }),
  ], [{ shotNo: '01-02', exitState: { characters: '顾念走到电视机旁' } as ShotContinuityState }], 'replace');

  assert.deepEqual(replaced.map((item) => item.shotNo), ['01-02']);
  assert.equal(replaced[0].exitState?.location, '出租屋');
  assert.equal(replaced[0].exitState?.characters, '顾念走到电视机旁');
});

test('merge restores a missing numeric shot at its canonical continuity position', () => {
  const restored = buildProspectiveShots([
    shot({ shotNo: '01-01' }),
    shot({ shotNo: '01-03' }),
  ], [shot({ shotNo: '01-02' })], 'merge');

  assert.deepEqual(restored.map((item) => item.shotNo), ['01-01', '01-02', '01-03']);
});

test('physical opening character inference excludes television and photo identities', () => {
  const characters = [
    { id: 'gu-nian', name: '许清晚（化名顾念）' },
    { id: 'lin-yuwei', name: '林雨薇' },
  ];

  assert.deepEqual(inferPhysicalOpeningCharacterIds(
    '顾念站在旧电视前，盯着屏幕上林雨薇的笑脸',
    characters,
  ), ['gu-nian']);
  assert.deepEqual(inferPhysicalOpeningCharacterIds(
    '林雨薇只出现在电视画面中，房间里没有实体人物',
    characters,
  ), []);
  assert.deepEqual(inferPhysicalOpeningCharacterIds('房间内无实体人物，是一个空镜', characters), []);
});

test('hasShotSpatialBlocking reads structured character states and common blocking words', () => {
  assert.equal(hasShotSpatialBlocking({
    description: '顾念忽然停下动作。',
    entryState: continuityState('顾念坐在床沿左边，面朝旧电视，距离电视两米'),
  }), true);
  assert.equal(hasShotSpatialBlocking({ description: '顾念从窗旁走到门边，视线始终落在门把手上。' }), true);
  assert.equal(hasShotSpatialBlocking({ description: '顾念呼吸变得急促，手指轻轻发抖。' }), false);
});

test('sortNarrativeBeats restores Scene → Beat order after an appending merge', () => {
  const beats: WsNarrativeBeat[] = [
    { id: 'scene-01-beat-01', sceneId: 'scene-01', title: 'A', purpose: '信息' },
    { id: 'scene-02-beat-01', sceneId: 'scene-02', title: 'B', purpose: '信息' },
    { id: 'scene-01-beat-02', sceneId: 'scene-01', title: 'C', purpose: '信息' },
    { id: 'scene-02-beat-02', sceneId: 'scene-02', title: 'D', purpose: '信息' },
  ];
  const sorted = sortNarrativeBeats(beats, ['scene-01', 'scene-02']);
  assert.deepEqual(sorted.map((beat) => beat.id), [
    'scene-01-beat-01', 'scene-01-beat-02', 'scene-02-beat-01', 'scene-02-beat-02',
  ]);
  // 幂等：再次排序不改变结果
  assert.deepEqual(sortNarrativeBeats(sorted, ['scene-01', 'scene-02']).map((beat) => beat.id), sorted.map((beat) => beat.id));
});

test('sortNarrativeBeats keeps custom id schemes and unknown scenes stable', () => {
  const beats: WsNarrativeBeat[] = [
    { id: 'opening', sceneId: 'act-one', title: 'A', purpose: '信息' },
    { id: 'turning', sceneId: 'act-one', title: 'B', purpose: '信息' },
  ];
  assert.deepEqual(sortNarrativeBeats(beats, ['act-one']).map((beat) => beat.id), ['opening', 'turning']);
  assert.deepEqual(sortNarrativeBeats(beats).map((beat) => beat.id), ['opening', 'turning']);
});


test('validateShotEntityIds names unknown ids and the exact legal manifest', () => {
  const manifest = {
    characters: [{ id: 'qin_ting', name: '秦婷' }, { id: 'zhou_ming', name: '周明' }],
    scenes: [{ id: 'scene-02-01', name: '健身房走廊' }],
    props: [{ id: 'whistle', name: '哨子' }],
  };
  const errors = validateShotEntityIds({
    shotNo: '02-01',
    sceneId: 'scene-02-01',
    characterIds: ['qin_coach'],
    propIds: [],
  }, manifest);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /qin_coach/);
  assert.match(errors[0], /qin_ting=秦婷/);
  assert.match(errors[0], /禁止自造 ID/);
});

test('validateShotEntityIds accepts canonical ids and reports unknown scene/prop', () => {
  assert.deepEqual(validateShotEntityIds({
    shotNo: '02-01',
    sceneId: 'scene-02-01',
    characterIds: ['qin_ting'],
    propIds: ['whistle'],
  }, {
    characters: [{ id: 'qin_ting', name: '秦婷' }],
    scenes: [{ id: 'scene-02-01', name: '健身房走廊' }],
    props: [{ id: 'whistle', name: '哨子' }],
  }), []);

  const errors = validateShotEntityIds({
    shotNo: '02-02',
    sceneId: 'missing-scene',
    characterIds: [],
    propIds: ['missing-prop'],
  }, {
    characters: [{ id: 'qin_ting' }],
    scenes: [{ id: 'scene-02-01' }],
    props: [{ id: 'whistle' }],
  });
  assert.equal(errors.some((error) => error.includes('不存在的场景：missing-scene')), true);
  assert.equal(errors.some((error) => error.includes('不存在的道具 ID：missing-prop')), true);
});


const valuesEqualStrict = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test('collectShotWriteConflicts always returns an array and flags a forbidden replace', () => {
  const conflicts = collectShotWriteConflicts({
    existing: [{ shotNo: '01-01', description: 'a', characterIds: [] }],
    incoming: [{ shotNo: '01-01', description: 'a' }],
    mode: 'replace',
    canRestructureShots: false,
    scope: 'prompts',
    canonicalDialogue: '',
    valuesEqual: valuesEqualStrict,
    isTextSupportedByCanonical: () => true,
  });
  assert.ok(Array.isArray(conflicts));
  assert.deepEqual(conflicts, ['全量替换分镜表']);
});

test('collectShotWriteConflicts allows restructure and reports new shot under narrow scope', () => {
  const base = {
    existing: [{ shotNo: '01-01', description: 'a', characterIds: [] }],
    canonicalDialogue: '',
    valuesEqual: valuesEqualStrict,
    isTextSupportedByCanonical: () => true,
  };
  assert.deepEqual(collectShotWriteConflicts({
    ...base,
    incoming: [{ shotNo: '01-02', description: 'b' }],
    mode: 'merge',
    canRestructureShots: true,
    scope: 'breakdown',
  }), []);
  assert.deepEqual(collectShotWriteConflicts({
    ...base,
    incoming: [{ shotNo: '01-02', description: 'b' }],
    mode: 'merge',
    canRestructureShots: false,
    scope: 'prompts',
  }), ['01-02 新增分镜']);
});


test('validateTimelineCharacterCoverage requires every physical character to be traceable', () => {
  const errors = validateTimelineCharacterCoverage({
    shotNo: '01-01',
    characterIds: ['lu_chen', 'qin_yan', 'zhou_ye'],
    actionTimeline: {
      durationSec: 8,
      summary: '陆沉重开录像',
      segments: [
        { startSec: 0, endSec: 8, track: 'body', label: '陆沉操作鼠标', subject: 'lu_chen' },
        { startSec: 0, endSec: 8, track: 'camera', label: '沿桌侧推近' },
        { startSec: 0, endSec: 8, track: 'sound', label: '设备低鸣' },
      ],
    },
  }, [
    { id: 'lu_chen', name: '陆沉' },
    { id: 'qin_yan', name: '秦教练' },
    { id: 'zhou_ye', name: '周野' },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /qin_yan=秦教练/);
  assert.match(errors[0], /zhou_ye=周野/);
});

test('validateTimelineCharacterCoverage accepts id or display-name subjects', () => {
  const errors = validateTimelineCharacterCoverage({
    shotNo: '01-01',
    characterIds: ['lu_chen', 'qin_yan', 'zhou_ye'],
    actionTimeline: {
      durationSec: 8,
      summary: '三人各自反应',
      segments: [
        { startSec: 0, endSec: 8, track: 'body', label: '陆沉重开录像', subject: 'lu_chen' },
        { startSec: 0, endSec: 8, track: 'gaze', label: '秦教练观察陆沉', subject: '秦教练' },
        { startSec: 0, endSec: 8, track: 'emotion', label: '周野仍低头沉默', subject: '周野' },
      ],
    },
  }, [
    { id: 'lu_chen', name: '陆沉' },
    { id: 'qin_yan', name: '秦教练' },
    { id: 'zhou_ye', name: '周野' },
  ]);
  assert.deepEqual(errors, []);
});

test('validateTimelineCharacterCoverage does not require coverage for an empty cast', () => {
  assert.deepEqual(validateTimelineCharacterCoverage({
    shotNo: '01-02',
    characterIds: [],
    actionTimeline: {
      durationSec: 4,
      summary: '空镜',
      segments: [{ startSec: 0, endSec: 4, track: 'camera', label: '固定空镜' }],
    },
  }, []), []);
});

test('repairTimelineCharacterCoverage restates stored entry/exit facts for uncovered cast', () => {
  const { shot: repaired, repair } = repairTimelineCharacterCoverage({
    shotNo: '01-01',
    durationSec: 8,
    characterIds: ['lu_chen', 'qin_yan', 'zhou_ye'],
    entryState: continuityState('lu_chen坐操作位面向屏幕；zhou_ye坐相邻操作位低头；qin_yan站桌端一步之外面向陆沉'),
    exitState: continuityState('lu_chen仍坐操作位注视录像；zhou_ye仍坐相邻操作位低头；qin_yan仍站桌端一步之外面向陆沉'),
    actionTimeline: {
      durationSec: 8,
      summary: '陆沉重开录像',
      segments: [
        { startSec: 0, endSec: 8, track: 'body', label: '陆沉操作鼠标', subject: 'lu_chen' },
        { startSec: 0, endSec: 8, track: 'camera', label: '沿桌侧推近' },
        { startSec: 0, endSec: 8, track: 'sound', label: '设备低鸣' },
      ],
    },
  }, [
    { id: 'lu_chen', name: '陆沉' },
    { id: 'qin_yan', name: '秦教练' },
    { id: 'zhou_ye', name: '周野' },
  ]);
  assert.ok(repair);
  assert.deepEqual(repair.addedSubjects.sort(), ['秦教练', '周野'].sort());
  // Repaired timeline now passes the coverage gate.
  assert.deepEqual(validateTimelineCharacterCoverage(repaired, [
    { id: 'lu_chen', name: '陆沉' },
    { id: 'qin_yan', name: '秦教练' },
    { id: 'zhou_ye', name: '周野' },
  ]), []);
  const added = repaired.actionTimeline!.segments.slice(-2);
  assert.ok(added.every((segment) => segment.track === 'body'));
  assert.ok(added.every((segment) => segment.startSec === 0 && segment.endSec === 8));
});

test('repairTimelineCharacterCoverage leaves a genuinely undocumented cast member uncovered', () => {
  const { shot: repaired, repair } = repairTimelineCharacterCoverage({
    shotNo: '01-01',
    durationSec: 8,
    characterIds: ['lu_chen', 'qin_yan'],
    entryState: continuityState('lu_chen坐操作位面向屏幕'),
    exitState: continuityState('lu_chen仍坐操作位'),
    actionTimeline: {
      durationSec: 8,
      summary: '单人',
      segments: [{ startSec: 0, endSec: 8, track: 'body', label: '陆沉操作鼠标', subject: 'lu_chen' }],
    },
  }, [
    { id: 'lu_chen', name: '陆沉' },
    { id: 'qin_yan', name: '秦教练' },
  ]);
  assert.equal(repair, null);
  assert.deepEqual(repaired, {
    shotNo: '01-01',
    durationSec: 8,
    characterIds: ['lu_chen', 'qin_yan'],
    entryState: continuityState('lu_chen坐操作位面向屏幕'),
    exitState: continuityState('lu_chen仍坐操作位'),
    actionTimeline: {
      durationSec: 8,
      summary: '单人',
      segments: [{ startSec: 0, endSec: 8, track: 'body', label: '陆沉操作鼠标', subject: 'lu_chen' }],
    },
  });
  assert.equal(validateTimelineCharacterCoverage(repaired, [
    { id: 'lu_chen', name: '陆沉' },
    { id: 'qin_yan', name: '秦教练' },
  ]).length, 1);
});

test('repairDerivableTimelineTracks fills only tracks backed by existing shot facts', () => {
  const { shots, repairs } = repairDerivableTimelineTracks([{
    shotNo: '03-10',
    durationSec: 6,
    atomicAction: '陆沉抬手示意暂停',
    camera: '缓慢推近',
    soundIntent: '键盘敲击声与短促呼吸',
    actionTimeline: {
      durationSec: 6,
      summary: '暂停示意',
      segments: [
        { startSec: 0, endSec: 6, track: 'body', label: '抬手示意' },
        { startSec: 0, endSec: 6, track: 'camera', label: '缓慢推近' },
      ],
    },
  }]);

  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].addedTracks, ['sound']);
  const tracks = shots[0].actionTimeline!.segments.map((segment) => segment.track);
  assert.deepEqual(tracks.sort(), ['body', 'camera', 'sound']);
  const sound = shots[0].actionTimeline!.segments.find((segment) => segment.track === 'sound')!;
  assert.equal(sound.label, '键盘敲击声与短促呼吸');
  assert.equal(sound.endSec, 6);
});

test('repairDerivableTimelineTracks leaves genuinely missing facts for the validator', () => {
  // No soundIntent on the shot means the sound track is NOT derivable; we must
  // not invent it, so the batch should still fail loudly downstream.
  const { shots, repairs } = repairDerivableTimelineTracks([{
    shotNo: '03-11',
    durationSec: 5,
    atomicAction: '起身',
    camera: '固定',
    actionTimeline: {
      durationSec: 5,
      summary: '起身',
      segments: [
        { startSec: 0, endSec: 5, track: 'body', label: '起身' },
        { startSec: 0, endSec: 5, track: 'camera', label: '固定' },
      ],
    },
  }]);
  assert.deepEqual(repairs, []);
  const tracks = shots[0].actionTimeline!.segments.map((segment) => segment.track);
  assert.equal(tracks.includes('sound'), false);
});

test('new episode dialogue uses saved screenplay rather than existing episode shots', () => {
  const data = emptyWorkshopData('p');
  data.episodes = [
    { no: '1', title: '', sceneList: '', script: '甲：“第一集。”', scriptStatus: 'draft' },
    { no: '2', title: '', sceneList: '', script: '乙：“第二集原话。”\n乙看向门口。\n甲：“我来。”', scriptStatus: 'draft' },
  ];
  const check = (dialogue: string, episode = '2') => collectShotWriteConflicts({
    existing: [shot({ dialogue: '甲：“第一集。”' })],
    incoming: [{ shotNo: '02-01', episode, dialogue }], mode: 'merge', scope: 'breakdown',
    canRestructureShots: true, canonicalDialogue: '甲：“第一集。”', valuesEqual: valuesEqualStrict,
    isTextSupportedByCanonical, screenplayForShot: (candidate) => shotScreenplaySource(data, candidate),
  });
  assert.deepEqual(check('乙：“第二集原话。”\n甲：“我来。”'), []);
  assert.deepEqual(check('乙：“第二集原话。”', '02'), []);
  assert.deepEqual(check('乙：“第二集原话。”加上编造对白'), ['02-01 对白']);
  assert.deepEqual(check('甲：“第一集。”'), ['02-01 对白']);
  assert.deepEqual(check('甲：“第二集原话。”'), ['02-01 对白']);
  assert.deepEqual(check('甲：“我来。”\n乙：“第二集原话。”'), ['02-01 对白']);
  assert.equal(shotScreenplaySource(data, { shotNo: '02-01' }), data.episodes[1].script);
});

test('screenplay fallback uses current revision only, not planned script or stale revision', () => {
  const data = emptyWorkshopData('p');
  data.episodes = [{ no: '2', title: '', sceneList: '', script: '规划中的文字', scriptStatus: 'planned' }];
  assert.equal(shotScreenplaySource(data, { shotNo: '02-01' }), '');
  data.currentScriptRevisionId = 'current';
  data.scriptRevisions = [
    { id: 'old', sourceNames: [], sourceKind: 'manual', fingerprint: 'old', createdAt: 1, content: '旧台词' },
    { id: 'current', sourceNames: [], sourceKind: 'manual', fingerprint: 'new', createdAt: 2, content: '当前原文对白' },
  ];
  assert.equal(shotScreenplaySource(data, { shotNo: '02-01' }), '当前原文对白');
  assert.equal(dialogueSupportedByScreenplay('新台词', ''), false);
  assert.equal(dialogueSupportedByScreenplay('原话加了新台词', '原话'), false);
});
