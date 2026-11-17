import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendShotSoundIntent,
  buildShotContinuityReferencePlan,
  buildShotEndFramePrompt,
  buildShotStartFramePrompt,
  buildShotVideoContinuityPrompt,
  buildPreviousTailContinuityPrompt,
  extractBoundaryFramePromptSegments,
  shouldUsePreviousTail,
  validateShotContinuityForGeneration,
  shotBoundaryFrameSignature,
} from './shotContinuity.ts';

test('video prompt carries authored sound intent without duplicating it', () => {
  assert.equal(appendShotSoundIntent('单一连续镜头', '门轴轻响与低沉环境声'), '单一连续镜头\n\n声音意图：门轴轻响与低沉环境声');
  assert.equal(appendShotSoundIntent('单一连续镜头\n声音意图：门轴轻响与低沉环境声', '门轴轻响与低沉环境声'), '单一连续镜头\n声音意图：门轴轻响与低沉环境声');
});
import type { WsShot } from './types.ts';

const previousShot: WsShot = {
  shotNo: '01-01',
  sceneId: 'room',
  description: '人物抬手。',
  characterIds: ['person'],
};

test('uses previous tail only for inherited shot relationships', () => {
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02', continuityMode: 'inherit' }, previousShot), true);
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02', continuityMode: 'scene-cut' }, previousShot), true);
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02', sceneId: 'street' }, previousShot), false);
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02' }, previousShot), true);
});

test('appends previous tail and current boundary frames after production assets', () => {
  assert.deepEqual(buildShotContinuityReferencePlan({ assetCount: 3, hasPreviousTail: true }), {
    previousTailIndex: 4,
    startFrameIndex: 5,
    endFrameIndex: 6,
  });
  assert.deepEqual(buildShotContinuityReferencePlan({ assetCount: 3, hasPreviousTail: false }), {
    previousTailIndex: undefined,
    startFrameIndex: 4,
    endFrameIndex: 5,
  });
});

test('start frame prompt constrains continuity and locks the requested ratio', () => {
  const prompt = buildShotStartFramePrompt({
    frameDescription: '镜头1-1：咖啡店中景。',
    aspectRatio: '16:9',
    previousTailIndex: 4,
    h3Task: 'i2va',
    assetReferences: [
      { index: 1, label: '场景 咖啡店' },
      { index: 2, label: '角色 女孩' },
      { index: 3, label: '道具 手机' },
      { index: 4, label: '上一镜尾帧（跨镜连续性）' },
    ],
  });
  assert.match(prompt, /@图片一：场景 咖啡店/);
  assert.match(prompt, /@图片二：角色 女孩/);
  assert.match(prompt, /@图片三：道具 手机/);
  assert.match(prompt, /上一镜头尾帧为 @图片四/);
  assert.match(prompt, /I2VA 继承边界构图规则/);
  assert.match(prompt, /镜头内部可以切近景、反应特写、道具插入/);
  assert.match(prompt, /严格为 16:9/);
});

test('end frame and video prompts identify temporal boundary frames', () => {
  const endPrompt = buildShotEndFramePrompt({
    frameDescription: '镜头1-3：女孩@图片一最终抬头看向@图片二中的收银台。',
    aspectRatio: '16:9',
    previousTailIndex: 4,
    startFrameIndex: 1,
    assetReferenceOffset: 1,
    assetReferences: [
      { index: 1, label: '当前镜首帧（最高优先级视觉主参考）' },
      { index: 2, label: '角色 女孩' },
      { index: 3, label: '场景 咖啡店' },
      { index: 4, label: '上一镜尾帧（跨镜连续性）' },
    ],
  });
  assert.match(endPrompt, /@图片一：当前镜首帧/);
  assert.match(endPrompt, /@图片二：角色 女孩/);
  assert.match(endPrompt, /@图片三：场景 咖啡店/);
  assert.match(endPrompt, /@图片一 是本镜首帧/);
  assert.match(endPrompt, /女孩@图片二最终抬头看向@图片三中的收银台/);
  assert.match(endPrompt, /唯一画面目标：时间轴最后一段的结束时刻/);
  assert.match(endPrompt, /道具已经落地、破碎、放下、交出、消失/);
  assert.doesNotMatch(endPrompt, /低头看手机/);
  assert.match(endPrompt, /上一镜尾帧 @图片四/);
  assert.match(endPrompt, /与首帧完全一致并严格为 16:9/);
  assert.match(endPrompt, /最高优先级视觉主参考/);
  assert.match(endPrompt, /严禁把写实首帧转换成漫画/);
  assert.match(endPrompt, /不得复制它的动作、手势、道具持有状态或开场构图/);
  assert.match(endPrompt, /严禁输出与首帧相同或近似相同的画面/);

  const videoPrompt = buildShotVideoContinuityPrompt('女孩抬头看向收银台。', {
    previousTailIndex: 4,
    startFrameIndex: 5,
    endFrameIndex: 6,
  });
  assert.match(videoPrompt, /<Picture 4>/);
  assert.match(videoPrompt, /<Picture 5>/);
  assert.match(videoPrompt, /<Picture 6>/);
  assert.doesNotMatch(videoPrompt, /@图片/);
  assert.match(videoPrompt, /首尾帧是时间边界，不是并列拼图/);
});

test('boundary prompts carry the full timeline and a one-way continuity state ledger', () => {
  const previousExitState = {
    location: '宗门广场高台下方',
    time: '退婚大典连续时间',
    characters: '林砚站在台下，沈清霜站在高台',
    props: '完整婚书已经由沈清霜交到林砚双手中',
    environment: '阴天冷灰顶光',
  };
  const exitState = {
    ...previousExitState,
    characters: '林砚低头站在台下，沈清霜仍在高台',
    props: '婚书已落在林砚脚前青石地面并破碎，无人持有',
  };
  const timeline = [
    '0.0-1.0秒，林砚双手持有婚书。',
    '1.0-3.0秒，林砚松手，婚书落到脚前地面。',
    '3.0-5.0秒，婚书被踩碎，纸片散落。',
    '5.0-6.0秒，林砚低头看向碎片。',
  ].join('\n');
  const endPrompt = buildShotEndFramePrompt({
    frameDescription: '5.0-6.0秒，林砚低头看向碎片。',
    startDescription: '0.0-1.0秒，林砚双手持有婚书。',
    timelineDescription: timeline,
    cameraContext: '固定机位，没有后移、拉远或变焦。',
    aspectRatio: '16:9',
    startFrameIndex: 1,
    previousExitState,
    entryState: previousExitState,
    exitState,
  });
  assert.match(endPrompt, /林砚松手，婚书落到脚前地面/);
  assert.match(endPrompt, /婚书被踩碎，纸片散落/);
  assert.match(endPrompt, /完整时间轴执行后的最终世界状态/);
  assert.match(endPrompt, /不得倒放、重演、反向交接或恢复旧状态/);
  assert.match(endPrompt, /道具不得回到之前的持有人/);
  assert.match(endPrompt, /不得为了容纳更多人物而自行后退镜头或扩大取景/);
  assert.match(endPrompt, /新人物只有在时间轴明确写出/);

  const videoPrompt = buildShotVideoContinuityPrompt('林砚松手，婚书落地。', {
    previousTailIndex: 2,
    startFrameIndex: 3,
    endFrameIndex: 4,
    previousExitState,
    entryState: previousExitState,
    exitState,
  });
  assert.match(videoPrompt, /上一镜结束状态/);
  assert.match(videoPrompt, /完整婚书已经由沈清霜交到林砚双手中/);
  assert.match(videoPrompt, /不得让道具反向飞回、回到旧持有人或恢复旧形态/);
});

test('start frame contains only the opening state and excludes the full timeline', () => {
  const prompt = buildShotStartFramePrompt({
    frameDescription: '0.0-1.0秒，空旷石阶前景没有人物。',
    timelineDescription: '0.0-1.0秒，空旷石阶前景没有人物。\n1.0-3.0秒，女子从石门进入画面。\n3.0-5.0秒，女子停在台阶旁。',
    cameraContext: '固定机位，无后移、拉远、变焦或切换机位。',
    aspectRatio: '9:16',
    h3Task: 'i2va',
  });
  assert.match(prompt, /当前镜头 0.00 秒唯一画面目标/);
  assert.doesNotMatch(prompt, /完整动作时间轴：只用于理解因果和人物何时进入画面/);
  assert.match(prompt, /后续才进入画面的角色不得提前出现/);
  assert.match(prompt, /I2VA 继承边界构图规则/);
  assert.match(prompt, /开场和结束都应优先使用可继承的中景/);
  assert.match(prompt, /不得把完整动作时间轴、后续人物、后续动作、道具结果或结尾状态提前画进首帧/);
});

test('start frame strips a persisted full H3 prompt from the visual target', () => {
  const prompt = buildShotStartFramePrompt({
    frameDescription: `How the reference picture aligns with the target video — Picture 1 aligns with 0.00 seconds.\n\nintegrated_multimodal_description: [Shot 1] A stable room opening. The subject is seated at the table.\n\n[CHARACTER_LOCK]\nThe subject later stands and exits.\n\noverall_soundscape: Room tone.\n\nnon_diegetic_music: N/A`,
    aspectRatio: '9:16',
  });
  assert.match(prompt, /A stable room opening/);
  assert.doesNotMatch(prompt, /integrated_multimodal_description|CHARACTER_LOCK|subject later stands/);
});

test('start frame unwraps recursively nested legacy prompt wrappers', () => {
  const nested = `资产清单。\n【当前镜头 0.00 秒唯一画面目标】\n资产清单。\n【当前镜头 0.00 秒唯一画面目标】\nFor the target video, at 0.00 seconds into the target video, <Picture 1> is fully referenced.\\n\\nintegrated_multimodal_description: [Shot 1] Opening frame only. The subject is seated.\\n\\n[CHARACTER_LOCK] Later action must not appear.`;
  const prompt = buildShotStartFramePrompt({ frameDescription: nested, aspectRatio: '9:16' });
  assert.match(prompt, /Opening frame only\. The subject is seated\./);
  assert.doesNotMatch(prompt, /资产清单。|CHARACTER_LOCK|Later action/);
});

test('non-H3 continuity prompt anchors the next shot to the previous tail', () => {
  const prompt = buildPreviousTailContinuityPrompt('人物向门口迈出一步。', 4);
  assert.match(prompt, /上一镜头尾帧是 @图片四/);
  assert.match(prompt, /单一 atomicAction/);
  assert.match(prompt, /atomicAction 明确包含瞬移/);
  assert.match(prompt, /相对目标的落点\/朝向\/距离和环境反馈/);
});

test('inherited shots require a previous tail before non-H3 generation', () => {
  const inherited = { ...previousShot, shotNo: '01-02', continuityMode: 'inherit' as const };
  assert.match(validateShotContinuityForGeneration(inherited, previousShot)[0], /没有可用尾帧/);
  assert.match(validateShotContinuityForGeneration({ ...inherited, continuityMode: 'scene-cut' }, previousShot)[0], /没有可用尾帧/);
});

test('boundary signature changes with prompt, assets, or previous tail', () => {
  const base = {
    videoPrompt: '动作',
    referencePaths: ['/scene.png'],
    previousTailPath: '/previous.png',
    aspectRatio: '16:9',
    imageEngine: 'gpt-image-2',
  };
  const signature = shotBoundaryFrameSignature(base);
  assert.equal(signature, shotBoundaryFrameSignature(base));
  assert.notEqual(signature, shotBoundaryFrameSignature({ ...base, videoPrompt: '新动作' }));
  assert.notEqual(signature, shotBoundaryFrameSignature({ ...base, previousTailPath: '/other.png' }));
  assert.notEqual(signature, shotBoundaryFrameSignature({ ...base, imageEngine: 'seedream-v5-pro' }));
});

test('extracts only the first and last numbered shots for boundary generation', () => {
  const result = extractBoundaryFramePromptSegments(`分镜场景设定在咖啡店。\n\n镜头1-1 2.5s：女孩低头看手机。\n开场保持静止。\n镜头1-2 2.5s：女孩抬头，镜头缓推。\n镜头1-3 2.5s：女孩走到点单台并停下。`);
  assert.equal(result.segmentCount, 3);
  assert.match(result.start, /镜头1-1/);
  assert.match(result.start, /开场保持静止/);
  assert.doesNotMatch(result.start, /镜头1-2|镜头1-3/);
  assert.match(result.end, /镜头1-3/);
  assert.doesNotMatch(result.end, /镜头1-1|镜头1-2/);
});

test('extracts first and last timed sections from universal prompts', () => {
  const result = extractBoundaryFramePromptSegments(`【时间戳动作与机位】\n0-3s：人物站在门口。\n3-6s：人物向前走。\n6-8s：人物停在柜台前。\n【物理与一致性】\n人物身份保持一致。`);
  assert.equal(result.segmentCount, 3);
  assert.equal(result.start, '0-3s：人物站在门口。');
  assert.equal(result.end, '6-8s：人物停在柜台前。');
});

test('extracts boundary states from the official H3 integrated description', () => {
  const result = extractBoundaryFramePromptSegments(`How the reference pictures align with the target video — Picture 1 aligns with 0.00 seconds; Picture 2 aligns with 6.00 seconds.

integrated_multimodal_description: [Shot 1] 2D animation. Shen Qing-shuang stands on the rear of the platform facing the crowd while Lin Yan stands three steps below, looking up at the document. She raises the red document and begins speaking: <d>[Chinese] 我沈清霜，今日与你退婚。</d> The document leaves her hand and travels toward Lin Yan. He steps forward and catches it with both hands, then lowers his gaze to the document and tightens his grip.

overall_soundscape: Cold wind and low crowd murmurs continue throughout.

non_diegetic_music: N/A`);

  assert.match(result.start, /stands on the rear of the platform/);
  assert.match(result.end, /lowers his gaze to the document/);
  assert.match(result.timeline, /The document leaves her hand/);
  assert.equal(result.spatialContext, '');
});

test('extracts H3 boundary frames only from the action timeline and accepts comma separators', () => {
  const result = extractBoundaryFramePromptSegments(`[WORLD_CONTINUITY]
宗门广场，林砚站在高台下方。
[ACTION_ENGINE]
0.0-1.0秒，林砚低头看向手中的完整婚书，右手开始松开。
1.0-3.0秒，婚书落地，沈清霜移动到婚书右侧半步处。
3.0-5.0秒，沈清霜踩碎婚书，红色纸片散落在林砚脚前。
5.0-6.0秒，林砚双手不再持有婚书，右拳垂在体侧，碎片只散落在脚前青石地面。
[DIALOGUE]
5.0-6.0秒，哄笑声逐渐降低为环境底噪。
[RESTRICTIONS]
婚书初始完整，结尾破碎。`);
  assert.equal(result.segmentCount, 4);
  assert.equal(result.start, '0.0-1.0秒，林砚低头看向手中的完整婚书，右手开始松开。');
  assert.equal(result.end, '5.0-6.0秒，林砚双手不再持有婚书，右拳垂在体侧，碎片只散落在脚前青石地面。');
  assert.match(result.timeline, /婚书落地/);
  assert.match(result.timeline, /沈清霜踩碎婚书/);
  assert.equal(result.spatialContext, '宗门广场，林砚站在高台下方。');
  assert.doesNotMatch(result.end, /哄笑声|RESTRICTIONS/);
});

test('extracts distinct H3 start and end states when the full timeline is written on one line', () => {
  const result = extractBoundaryFramePromptSegments(`[WORLD_CONTINUITY]\n石阶前景为空。\n[ACTION_ENGINE]\n0.0-1.0秒，前景没有人物。1.0-3.0秒，女子从石门进入画面。3.0-5.0秒，女子走到台阶旁。5.0-6.0秒，女子停步回望。\n[CAMERA_LOGIC]\n固定机位。`);
  assert.equal(result.segmentCount, 4);
  assert.equal(result.start, '0.0-1.0秒，前景没有人物。');
  assert.equal(result.end, '5.0-6.0秒，女子停步回望。');
  assert.notEqual(result.start, result.end);
  assert.match(result.timeline, /女子从石门进入画面/);
});

test('adjacent legacy shots inherit accepted tail by default within an episode', () => {
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02', continuityMode: undefined, sceneId: undefined }, previousShot), false);
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02', continuityMode: undefined, sceneId: 'street' }, previousShot), false);
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '02-01', continuityMode: undefined }, previousShot), false);
  assert.equal(shouldUsePreviousTail({ ...previousShot, shotNo: '01-02', continuityMode: 'time-jump' }, previousShot), true);
});
