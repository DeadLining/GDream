import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_DRAMA_BAN,
  findAiDramaPerformanceHits,
  PERFORMANCE_GUIDE,
} from './performance.ts';
import {
  MINIMAX_H3_VIDEO_PROMPT_BRIEF,
  miniMaxH3RepairGuidance,
  miniMaxH3TaskPromptRule,
  buildAssetPromptsPrompt,
  buildAutoRunPrompt,
  buildCharacterSheetPrompt,
  buildOptimizeShotPrompt,
  buildRewriteSingleShotVideoPrompt,
  buildShotPromptsPrompt,
} from '../workshop/workshopPrompts.ts';
import { MINIMAX_H3_REQUIRED_PROMPT_SECTIONS, validateMiniMaxH3VideoPrompt } from '../workshop/h3PromptContract.ts';

test('performance guide covers layering timeline and behavior purpose', () => {
  assert.match(PERFORMANCE_GUIDE, /触发期/);
  assert.match(PERFORMANCE_GUIDE, /发酵期/);
  assert.match(PERFORMANCE_GUIDE, /释放期/);
  assert.match(PERFORMANCE_GUIDE, /开关式瞬变/);
  assert.match(PERFORMANCE_GUIDE, /行为目的/);
  assert.match(PERFORMANCE_GUIDE, /性格锚点/);
  assert.match(PERFORMANCE_GUIDE, /每个时间段都要写出可执行的表情与身体细节/);
  assert.match(PERFORMANCE_GUIDE, /情绪转折点可以把多个表演通道同时写满/);
  assert.match(PERFORMANCE_GUIDE, /次要人物(?:与|和)远景群像/);
  assert.match(PERFORMANCE_GUIDE, /表情特写、手部特写、动作接触特写或关键道具特写/);
  assert.match(PERFORMANCE_GUIDE, /单一连续镜头内可以组合多种运镜/);
  assert.match(PERFORMANCE_GUIDE, /人物位置变化使用画面中的稳定参照物/);
  assert.match(PERFORMANCE_GUIDE, /相对台阶、门框、桌边、车辆、道具或另一人物的起点/);
  assert.match(PERFORMANCE_GUIDE, /进入伸手或落脚范围/);
  assert.match(PERFORMANCE_GUIDE, /瞬移、闪现、缩地、遁光或空间跃迁/);
  assert.match(PERFORMANCE_GUIDE, /相对目标的落点\/朝向\/距离/);
  assert.match(PERFORMANCE_GUIDE, /躯干\/骨盆朝向/);
  assert.match(PERFORMANCE_GUIDE, /时间轴每个区间都先交代/);
  assert.match(PERFORMANCE_GUIDE, /主体与目标处于同一可达空间/);
  assert.match(PERFORMANCE_GUIDE, /人物尺度用可见参照维持/);
  assert.match(PERFORMANCE_GUIDE, /对白必须绑定可定位声源/);
});

test('AI drama ban lists the exaggerated-performance tells', () => {
  for (const term of ['瞪眼', '嘶吼', '嚎啕大哭', '开关式情绪瞬变', '邪魅', '暴跳如雷']) {
    assert.ok(AI_DRAMA_BAN.includes(term), `AI_DRAMA_BAN should mention ${term}`);
  }
  assert.match(AI_DRAMA_BAN, /除非用户明确要求/);
});

test('performance hints do not ban strong emotions by keyword', () => {
  assert.deepEqual(findAiDramaPerformanceHits('陈墨瞪眼嘶吼，暴跳如雷'), []);
  assert.deepEqual(findAiDramaPerformanceHits('失去亲人后嚎啕大哭；重逢后仰天大笑'), []);
  assert.deepEqual(findAiDramaPerformanceHits('毫无原因突然狂喜'), ['毫无原因突然狂喜']);
  assert.deepEqual(findAiDramaPerformanceHits('眼眶泛红，泪珠在眼眶聚集未落，下唇被牙齿轻咬'), []);
  assert.deepEqual(findAiDramaPerformanceHits(undefined), []);
  assert.deepEqual(findAiDramaPerformanceHits(''), []);
});

test('workshop prompt builders carry the performance brief', () => {
  for (const prompt of [buildShotPromptsPrompt(), buildShotPromptsPrompt('', 'universal'), buildOptimizeShotPrompt('1'), buildAutoRunPrompt()]) {
    assert.ok(prompt.includes('触发→发酵→释放'), 'builder output should include the performance layering rule');
    assert.ok(prompt.includes('行为目的'), 'builder output should include the behavior-purpose rule');
    assert.ok(prompt.includes('不默认沉默开场'), 'builder output must carry the shared expression policy');
    assert.ok(prompt.includes('不要求一律克制'));
    assert.ok(!prompt.includes('默认禁止瞪眼'));
    assert.ok(prompt.includes('允许关键节拍之间自然插值'), 'builder output should leave natural acting room between key beats');
    assert.ok(prompt.includes('主动设计表情、手部、动作接触或道具特写'), 'builder output should encourage motivated close-ups');
  }
});

test('H3 video prompt contract guides executable events without mandatory blocks', () => {
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /不强制八个子标题/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /字段每个只出现一次，独占行首，顺序固定且非空/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /字数不是创作目标/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /输入首帧和 entryState 是 0\.00 秒的唯一开场事实/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /保留 actionTimeline 的事件顺序/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /总时长和时间窗是参考/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /按动作启动、接触、完成、台词重音、停顿与听者反应分段/);
  // Regression: the direct rewrite path used to demand intervals come *exactly*
  // from the timeline, so a coarse 4x2s timeline was copied verbatim into the
  // prompt. The rewrite contract must now allow splitting inside a beat.
  const rewritten = buildRewriteSingleShotVideoPrompt('01-01', 'i2va');
  assert.match(rewritten, /输入首帧和 entryState 是 0\.00 秒的唯一开场事实/);
  assert.match(rewritten, /固定物体保持原世界位置即可/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /不固定每 2 秒一段/);
  // Regression: a fixed 2s-per-block timeline produced flat, evenly chopped shots.
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /不得为了凑字数新增剧情、人物、道具/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /按动作、对白与听者反应需要写相关通道/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /以实际提供的图片确定可见空间/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /按动作启动、接触、完成/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /声源绑定/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /是否使用素材编号必须服从当前 H3 task/);
  assert.doesNotMatch(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /每 0\.8-1\.5 秒一个区间/);

  for (const prompt of [buildShotPromptsPrompt(), buildOptimizeShotPrompt('1'), buildAutoRunPrompt()]) {
    assert.ok(prompt.includes(MINIMAX_H3_VIDEO_PROMPT_BRIEF));
  }
  assert.match(buildShotPromptsPrompt(), /用户明确发起的强制重写/);
  assert.match(buildShotPromptsPrompt(), /不得只审核、只修一两镜、沿用旧提示词/);
});

test('H3 rewrite contract demands rich performance and motivated camera language', async () => {
  // Regression: the H3 brief and direct rewrite prompt used to cap detail
  // ("one or two performance channels", "one primary camera movement"), which
  // produced flat, body-action-only 提示词 exactly like the user reported.
  const { rewriteMiniMaxH3ShotPrompt } = await import('../workshop/workshopPrompts.ts');
  assert.equal(typeof rewriteMiniMaxH3ShotPrompt, 'function');

  // ACTION_ENGINE must demand relevant executable detail without forcing invented channels.
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /按动作、对白与听者反应需要写相关通道/);
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /按动作、对白与听者反应需要写相关通道/);
  // CAMERA_LOGIC must not invent cinematic movement to pad a simple shot.
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /缺省时可根据已有情节的信息揭示/);

  const optimized = buildOptimizeShotPrompt('01-01', 'i2va');
  assert.match(optimized, /眼睑\/眉间\/唇线\/下颌\/呼吸/);
  assert.match(optimized, /推\/拉\/摇\/移\/升降\/变焦/);
});

test('H3 task rules separate endpoint frames, references, and text-only prompts', () => {
  assert.match(miniMaxH3TaskPromptRule('fl2va'), /提示词正文不得出现 @图片N/);
  assert.match(miniMaxH3TaskPromptRule('fl2va'), /中间允许人物自然走位和表演/);
  assert.match(miniMaxH3TaskPromptRule('ref2va'), /subject_definitions 建立真实素材与语义身份的映射/);
  assert.match(miniMaxH3TaskPromptRule('ref2va'), /后续段落只使用人物名、场景名和道具名/);
  assert.match(miniMaxH3TaskPromptRule('t2va'), /conditions 为空/);
});

test('H3 validator enforces task-specific reference usage', () => {
  const naturalTimeline = '0.0-1.2秒，人物自然抬眼并调整呼吸；1.2-2.5秒，沿连续路径完成核心动作；2.5-3.8秒，动作接触形成可见反馈；3.8-5.0秒，视线随结果自然收束。';
  const basePrompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => `${section}\n${section === '[ACTION_ENGINE]' ? naturalTimeline : '可执行镜头细节。'.repeat(18)}`).join('\n');
  assert.ok(validateMiniMaxH3VideoPrompt(`${basePrompt}\n@图片一`, 5, undefined, 'fl2va').some((warning) => warning.includes('不得出现素材编号')));
  assert.ok(validateMiniMaxH3VideoPrompt(`${basePrompt}\n@图片一 场景；@图片一 人物`, 5, undefined, 'ref2va').some((warning) => warning.includes('素材编号重复过多')));
});

test('H3 validator requires supernatural movement effects and accepts complete teleport or anchored movement', () => {
  const sections = (timeline: string) => MINIMAX_H3_REQUIRED_PROMPT_SECTIONS
    .map((section) => `${section}\n${section === '[ACTION_ENGINE]' ? timeline : '可执行镜头细节。'.repeat(18)}`)
    .join('\n');
  const teleport = sections('0.0-1.2秒，人物调整呼吸并注视地面道具；1.2-2.5秒，她瞬间移动到道具旁边；2.5-3.8秒，抬脚完成接触，重心前移；3.8-5.0秒，视线与呼吸自然收束。');
  assert.ok(validateMiniMaxH3VideoPrompt(teleport, 5).some((warning) => warning.includes('超自然位移细节不足')));

  const completeTeleport = sections('0.0-1.2秒，沈清霜站在高台边缘，视线落向石阶下方的婚书；1.2-2.5秒，她双指结印，脚下月白灵光收束，身后留下短促残影，周围空气向内扭曲；2.5-3.8秒，残影消散，她在婚书右侧半步处面向红卷现身，落点灵光向外扩散，风压掀动裙摆与纸边，她顺势抬脚踩向婚书中段；3.8-5.0秒，鞋底压实，纸面皱裂，尘屑和红纸边受力弹开。');
  assert.ok(!validateMiniMaxH3VideoPrompt(completeTeleport, 5).some((warning) => warning.includes('超自然位移细节不足')));

  const anchored = sections('0.0-1.2秒，她在石阶边缘转身，注视落在台阶下方的道具；1.2-2.5秒，她迈下两级石阶，沿道具落点方向走近，与道具的距离从数步缩短到一步；2.5-3.8秒，她在道具侧后方半步处收住重心，抬脚越过边缘后完成接触；3.8-5.0秒，她落稳支撑脚，视线与呼吸自然收束。');
  assert.ok(!validateMiniMaxH3VideoPrompt(anchored, 5).some((warning) => warning.includes('超自然位移细节不足')));

  const blanketBan = `${anchored}\n[RESTRICTIONS]禁止瞬移、闪现和空间跃迁。`;
  assert.ok(validateMiniMaxH3VideoPrompt(blanketBan, 5).some((warning) => warning.includes('不应笼统禁止超自然位移')));
});

test('H3 validator accepts headerless events and legacy English blocks without requiring either layout', () => {
  const oldPrompt = `${'旧版时间轴描述。'.repeat(120)}0.0-1.0秒，动作；1.0-3.0秒，动作；3.0-5.0秒，动作。`;
  assert.equal(validateMiniMaxH3VideoPrompt(oldPrompt, 5).some((warning) => /缺少 H3 专用段落|细节不足/.test(warning)), false);

  const oldChineseTemplate = `【视觉媒介与主体锁】人物。\n【空间与初始状态】房间。\n【物理反馈与环境响应】道具。\n【时间轴动作与表演】0.0-5.0秒，人物完成动作。\n【声音设计】环境声。\n【摄影机与构图】固定机位。\n【尾帧与动作验收】动作完成。\n【连续性与禁止项】不增加人物。`;
  const oldChineseWarnings = validateMiniMaxH3VideoPrompt(oldChineseTemplate, 5);
  assert.ok(oldChineseWarnings.some((warning) => warning.includes('不再支持旧中文九段模板')));
  assert.equal(oldChineseWarnings.some((warning) => warning.includes('缺少 H3 专用段落')), false);

  const naturalTimeline = '0.0-1.2秒，位置状态：人物站在门口内侧，距离桌边两步；眼睑轻停，注视目标转向道具，呼吸变浅；1.2-2.5秒，位置状态：人物仍在门口至桌边通道，距离缩短到一步；主体沿既定路径完成动作，肩颈张力自然传导；2.5-3.8秒，位置状态：人物停在桌边半步处，已进入伸手范围；动作接触形成可见反馈，注视随结果移动；3.8-5.0秒，位置状态：人物仍位于桌边，关键道具停在手边；呼吸逐渐恢复，人物在尾帧状态自然收束。';
  const completePrompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[ACTION_ENGINE]') return `${section}\n${naturalTimeline}`;
    if (section === '[WORLD_CONTINUITY]') return `${section}\n人物脚下落点位于台阶前沿，躯干朝向高台，脸部面朝台上人物，视线目标明确，屏幕方向稳定；两名人物相对身高关系固定，以台阶踏步和另一人物肩线作为尺度参照，头身比例不变。`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n摄影机固定在动作轴线同一侧，保持人物尺度与屏幕方向。${'可执行镜头细节。'.repeat(14)}`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  assert.deepEqual(validateMiniMaxH3VideoPrompt(completePrompt, 5), []);
});

test('H3 prompt validator rejects mannequin-like stillness and frozen no-dialogue faces', () => {
  const prompt = `${MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => `${section}\n${'镜头细节。'.repeat(24)}`).join('\n')}\n[ACTION_ENGINE]0.0-0.7秒，人物保持冷然；0.7-1.4秒，固定站立；1.4-2.1秒，静止不变；2.1-2.8秒，僵硬站定；2.8-3.5秒，几乎不动；3.5-4.2秒，表情没有变化；4.2-5.0秒，人物全程闭嘴，不产生任何口型。\n[CAMERA_LOGIC]固定。`;
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5);
  assert.ok(warnings.some((warning) => warning.includes('不能冻结整张脸')));
  assert.ok(warnings.some((warning) => warning.includes('表情被写成静态锁')));
  assert.equal(warnings.some((warning) => warning.includes('至少选择两类')), false);
});

test('H3 prompt validator enforces exact dialogue, mouth motion, and dynamic continuity', () => {
  const prompt = `${MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => `${section}\n${'镜头细节。'.repeat(24)}`).join('\n')}\n0.0-0.7秒；0.7-1.4秒；1.4-2.1秒；2.1-2.8秒；2.8-3.5秒；3.5-4.2秒；4.2-5.0秒。\n站位不变。`;
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5, '我沈清霜，今日与你退婚。');
  assert.ok(warnings.some((warning) => warning.includes('对白不完整')));
  assert.ok(warnings.some((warning) => warning.includes('对白表演不足')));
  assert.ok(warnings.some((warning) => warning.includes('对白白名单不明确')));
  assert.ok(warnings.some((warning) => warning.includes('对白声源绑定不足')));
  assert.ok(warnings.some((warning) => warning.includes('不能冻结动态状态')));
});

test('H3 validator enforces close-up axis, scale references, and dialogue source binding', () => {
  const timeline = '0.0-1.2秒，少女抬眼并吸气；1.2-2.5秒，少女启唇说出指定对白，下颌与脸颊自然运动；2.5-3.8秒，听者保持无声反应；3.8-5.0秒，少女自然收口并恢复呼吸。';
  const prompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[WORLD_CONTINUITY]') return `${section}\n少女站在台阶上，脚下落点明确，躯干朝向台下，脸部面朝听者，视线目标为听者；少女相对听者略矮，以台阶踏步和听者肩线作为尺度参照，头身比例固定。`;
    if (section === '[ACTION_ENGINE]') return `${section}\n${timeline}`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n摄影机位于动作轴线同一侧，连续推近到面部特写；特写前后面朝同一目标，保持相同屏幕方向、视线轴和人物真实身高，只改变取景范围。`;
    if (section === '[DIALOGUE]') return `${section}\n声源绑定：唯一说话人为画面上方的17岁少女，使用年轻女声音色，声音只从少女口部位置发出，不得交给其他人物。严禁新增、改写或重复对白、旁白和人声。`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(`${prompt}\n我沈清霜，今日与你退婚。`, 5, '我沈清霜，今日与你退婚。');
  assert.ok(!warnings.some((warning) => warning.includes('人物朝向坐标不足')));
  assert.ok(!warnings.some((warning) => warning.includes('人物尺度参照不足')));
  assert.ok(!warnings.some((warning) => warning.includes('特写连续性不足')));
  assert.ok(!warnings.some((warning) => warning.includes('对白声源绑定不足')));
});

test('H3 validator rejects timeline contact actions without reachable spatial states', () => {
  const prompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[WORLD_CONTINUITY]') return `${section}\n沈清霜脚下落点位于高台台面，躯干朝向台下，脸部面朝林砚；林砚位于台下青石地面。两人相对身高关系稳定，以台阶作为尺度参照。`;
    if (section === '[ACTION_ENGINE]') return `${section}\n0.0-1.0秒，林砚松开婚书；1.0-2.0秒，婚书落在台下青石地面；2.0-3.0秒，沈清霜仍站在高台边缘，抬起右脚；3.0-4.0秒，沈清霜踩住台下青石地面的婚书；4.0-5.0秒，碎片散开，林砚低头。`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n摄影机保持在动作轴线同一侧，人物真实身高和头身比例稳定。`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5);
  assert.ok(warnings.some((warning) => warning.includes('接触可达性不足')));
  assert.ok(warnings.some((warning) => warning.includes('垂直空间不可达')));
});

test('H3 contact reachability inherits the immediately previous movement segment', () => {
  const prompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[WORLD_CONTINUITY]') return `${section}\n林砚脚下落点位于台下青石地面，躯干朝向婚书，脸部面朝地面落点；沈清霜位于高台。两人相对身高关系明确，以台阶和肩线作为尺度参照。`;
    if (section === '[ACTION_ENGINE]') return `${section}\n0.0-1.2秒，位置状态：林砚位于台下青石地面，婚书在前方两步；动作与表演：林砚沿台阶前沿走近婚书。1.2-2.4秒，位置状态：林砚仍位于台下青石地面，婚书已经落在他脚边；动作与表演：林砚俯身抓起婚书。2.4-3.6秒，位置状态：林砚仍在婚书落点旁，婚书位于胸前；动作与表演：他起身观察纸面，视线随纸面移动。3.6-5.0秒，位置状态：林砚停在台阶前沿，沈清霜仍在高台；动作与表演：林砚呼吸逐渐恢复，手指压力自然放松。`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n摄影机位于动作轴线同一侧，人物真实身高和头身比例保持一致。`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5);
  assert.ok(!warnings.some((warning) => warning.includes('接触可达性不足')));
});

test('H3 vertical reachability binds the high platform state to the actual contact actor', () => {
  const prompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[WORLD_CONTINUITY]') return `${section}\n沈清霜脚下落点位于高台台面，躯干朝向台下，脸部面朝林砚；林砚位于台下青石地面，面朝婚书落点。两人相对身高关系明确，以台阶和肩线作为尺度参照。`;
    if (section === '[ACTION_ENGINE]') return `${section}\n0.0-1.2秒，位置状态：沈清霜仍位于高台，林砚位于台下青石地面，婚书在林砚脚边；动作与表演：沈清霜垂眼观察。1.2-2.4秒，位置状态：林砚仍位于台下同一地面，婚书紧邻脚边，已经进入伸手范围；动作与表演：林砚俯身抓起婚书。2.4-3.6秒，位置状态：林砚仍在台下婚书落点旁，沈清霜仍在高台；动作与表演：林砚起身，注视纸面并调整呼吸。3.6-5.0秒，位置状态：两人各自在原支撑平面，距离由台阶分隔；动作与表演：视线和衣摆随山风自然变化。`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n摄影机位于动作轴线同一侧，人物真实身高和头身比例保持一致。`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5);
  assert.ok(!warnings.some((warning) => warning.includes('垂直空间不可达')));
});

test('H3 static-density check ignores camera and identity continuity language', () => {
  const prompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[WORLD_CONTINUITY]') return `${section}\n人物脚下落点位于台阶前沿，躯干朝向高台，脸部面朝对手；两人相对身高关系明确，以栏杆和肩线作为尺度参照。`;
    if (section === '[ACTION_ENGINE]') return `${section}\n0.0-1.2秒，位置状态：人物位于台阶前沿，距离目标两步；动作与表演：视线转向目标，呼吸略缓。1.2-2.4秒，位置状态：人物沿台阶走近一步；动作与表演：肩颈与衣摆自然响应。2.4-3.6秒，位置状态：人物停在目标面前，进入伸手范围；动作与表演：手指轻触道具。3.6-5.0秒，位置状态：人物仍在目标旁边；动作与表演：重心回稳，眼睑自然眨动。`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n固定机位，固定焦段，保持动作轴线，保持屏幕方向，人物真实身高保持一致。`;
    if (section === '[RESTRICTIONS]') return `${section}\n保持身份、服装、场景拓扑、光源方向和道具身份不变。`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5);
  assert.ok(!warnings.some((warning) => warning.includes('静态约束过密')));
});

test('H3 close-up continuity may be stated across camera and continuity sections', () => {
  const prompt = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[WORLD_CONTINUITY]') return `${section}\n人物脚下落点位于台阶前沿，躯干朝向高台，脸部面朝对手；两人相对身高关系明确，以栏杆和肩线作为尺度参照。`;
    if (section === '[ACTION_ENGINE]') return `${section}\n0.0-1.2秒，位置状态：人物位于台阶前沿，距离目标两步；动作与表演：视线转向目标，呼吸略缓。1.2-2.4秒，位置状态：人物沿台阶走近一步；动作与表演：肩颈与衣摆自然响应。2.4-3.6秒，位置状态：人物停在目标面前，进入伸手范围；动作与表演：手指轻触道具。3.6-5.0秒，位置状态：人物仍在目标旁边；动作与表演：重心回稳，眼睑自然眨动。`;
    if (section === '[CAMERA_LOGIC]') return `${section}\n摄影机沿同一空间轴线连续推近至面部特写。`;
    if (section === '[RESTRICTIONS]') return `${section}\n特写前后人物面朝同一世界目标，屏幕方向和视线关系保持一致，人物真实身高、头身比例和体型关系不改变；特写只改变取景范围。`;
    return `${section}\n${'可执行镜头细节。'.repeat(18)}`;
  }).join('\n');
  const warnings = validateMiniMaxH3VideoPrompt(prompt, 5);
  assert.ok(!warnings.some((warning) => warning.includes('特写连续性不足')));
});

test('H3 focused repair guidance preserves timeline segments and reachable contact paths', () => {
  const guidance = miniMaxH3RepairGuidance([
    'H3 接触可达性不足：4 个时间区间包含接触动作',
    'H3 垂直空间不可达：高台人物直接接触台下目标',
  ]);
  assert.match(guidance, /沿用 actionTimeline 的事件顺序和轨道内容/);
  assert.match(guidance, /时长与时间窗是参考/);
  assert.match(guidance, /不要逐段重复固定空间清单/);
  assert.match(guidance, /先检查主体与目标是否处于同一支撑平面和可达距离/);
  assert.match(guidance, /不能直接接触/);
  assert.match(guidance, /不得通过缩小场景距离、拉长肢体或瞬间重置站位解决/);
});

test('single-shot rewrite prompt only overwrites the selected video prompt slot', () => {
  const prompt = buildRewriteSingleShotVideoPrompt('01-03');
  assert.match(prompt, /单镜强制重写/);
  assert.match(prompt, /只处理这一镜/);
  assert.match(prompt, /不得修改 imagePrompt、audioPrompts、description、dialogue/);
  assert.match(prompt, /shotNo: "01-03"/);
  assert.match(prompt, /MiniMax H3 专用视频提示词契约/);
  assert.doesNotMatch(prompt, /当前项目全部分镜/);
});

test('character assets use a multi-panel bible sheet contract', () => {
  const zh = buildCharacterSheetPrompt('林风', '28岁，黑色短发，深灰色风衣');
  const en = buildCharacterSheetPrompt('Lin Feng', '28-year-old man, black short hair, dark grey trench coat', 'en');
  for (const prompt of [zh, en, buildAssetPromptsPrompt()]) {
    assert.match(prompt, /正脸|face/i);
    assert.match(prompt, /正面.*侧面.*背面|front.*side.*back/i);
    assert.match(prompt, /细节|detail/i);
    assert.match(prompt, /同一个角色|same identity/i);
  }
  assert.match(zh, /后续生图和视频的角色一致性母版/);
  assert.match(en, /single character bible sheet/);
});

test('character asset sheets preserve personality and lifecycle visual context', () => {
  const prompt = buildCharacterSheetPrompt('林风', '黑色短发，深灰色风衣', 'zh', {
    personality: '克制、警觉',
    lifecycleStages: [{ stage: '受伤后', appearance: '左眉有浅疤，风衣袖口沾雨' }],
  });
  assert.match(prompt, /性格气质：克制、警觉/);
  assert.match(prompt, /生命周期造型变化：受伤后：左眉有浅疤，风衣袖口沾雨/);
});

test('official I2VA validator rejects legacy mixed prompts and accepts only Picture 1 as the runtime keyframe', () => {
  const mixed = `Refs: @图片一 大堂, @图片二 江野.\nintegrated_multimodal_description: [Shot 1] 0.0-3.0s: short action.\noverall_soundscape: room tone.\nnon_diegetic_music: none.\n【受控转场】旧约束【受控转场结束】`;
  const mixedWarnings = validateMiniMaxH3VideoPrompt(mixed, 9, undefined, 'i2va');
  assert.ok(mixedWarnings.some((warning) => warning.includes('旧模板污染')));
  assert.ok(mixedWarnings.some((warning) => warning.includes('只允许在关键帧对齐说明中使用 Picture 1')));

  const detailedTimeline = Array.from({ length: 7 }, (_, index) => {
    const start = (index * 1.2).toFixed(1);
    const end = Math.min(9, (index + 1) * 1.2).toFixed(1);
    return `${start}-${end}s: The fixed medium camera preserves the lobby axis while the subjects maintain plausible relative scale, facing direction, eye line, grounded foot placement, continuous hand motion, fabric inertia, restrained facial response, visible object contact, and synchronized room sound as the action advances toward the defined ending state without introducing any new event.`;
  }).join(' ');
  const sectionDetails = MINIMAX_H3_REQUIRED_PROMPT_SECTIONS.map((section) => {
    if (section === '[ACTION_ENGINE]') return `${section}\n${detailedTimeline}`;
    return `${section}\n${'The established people, world state, object identities, performance logic, camera axis, sound sources, and final state remain concrete and physically continuous throughout this shot. '.repeat(2)}`;
  }).join('\n\n');
  const official = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: [Shot 1] Live-action dramatic scene. ${detailedTimeline}\n\noverall_soundscape: Continuous lobby room tone, water movement, cloth friction, restrained crowd reactions, and synchronized object impacts.\n\nnon_diegetic_music: A restrained low drone remains beneath the diegetic sound. `;
  assert.deepEqual(validateMiniMaxH3VideoPrompt(official, 9, undefined, 'i2va'), []);

  const legacyAppendix = official + '\n' + sectionDetails;
  assert.ok(validateMiniMaxH3VideoPrompt(legacyAppendix, 9, undefined, 'i2va').some((issue) => /旧分块台账/.test(issue)));
});

test('H3 camera instructions no longer mandate one continuous take', () => {
  assert.match(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /缺省时可根据已有情节的信息揭示/);
  assert.doesNotMatch(MINIMAX_H3_VIDEO_PROMPT_BRIEF, /保持同一空间轴线下的单一连续镜头/);
  assert.match(PERFORMANCE_GUIDE, /不要把所有情绪替换成低头、下颌收紧、呼吸变浅/);
  assert.match(AI_DRAMA_BAN, /并非一律禁止/);
  assert.doesNotMatch(AI_DRAMA_BAN, /人物表演一律禁止/);
});
