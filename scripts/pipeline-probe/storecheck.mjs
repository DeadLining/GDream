/**
 * 工具实现层集成校验（工具实现层 = 真实 tool.execute()）。
 *
 * 为什么需要它：run.mjs 的所有模块都走**桩执行器**，验证的是「提示词 + 工具 schema +
 * 校验契约」。真实的 tool.execute()（会写 zustand store、带致命门禁）**从未被执行过**。
 * 本文件补上「模型发对工具调用」与「应用真的落库」之间的缺口。
 *
 * 三个目的：
 *   A 正向：真实实现是否真的把数据写进 store。
 *   B 反向：**桩的契约复现是否与真实实现一致**。桩比产品更严 → 通过率被低估；
 *           桩比产品更松 → 通过率虚高。两个方向都会让 run.mjs 的结论失真。
 *   C 回放：把 ④ 模型写出的**真实提示词原文**喂给真实 workshop_set_prompts，
 *           核对「桩放行」是否等于「产品放行」（事实锁等致命门禁只在真实实现里）。
 *
 * 种子一律用仓库自己的 emptyWorkshopData()，避免手写对象漏字段
 * （早期手写种子漏了 steps，导致 markStepStatus 抛异常，被误判成产品缺陷）。
 *
 * 用法：
 *   node scripts/pipeline-probe/build.mjs      # 先打包
 *   node scripts/pipeline-probe/storecheck.mjs # 无需密钥，纯本地
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installShims } from './preload.mjs';

installShims();

const here = path.dirname(fileURLToPath(import.meta.url));
const h = await import(path.join(here, '.gen/harness.mjs'));

const byName = new Map(h.allWorkshopTools.map((t) => [t.definition.name, t]));
const call = (name, args) => byName.get(name).execute(args);

const PROJECT = 'it-project';
const REVISION = 'rev-it-0001';

/** 与 run.mjs 的 PROBE_CHARACTERS / PROBE_SCENES / PROBE_SHOTS 保持一致。 */
const CHARACTERS = [
  { id: 'char-linyue', name: '林越', personality: '克制', appearance: '三十岁男骑手，短寸头，左眉一道旧疤，黄色反光雨衣' },
  { id: 'char-suwan', name: '苏晚', personality: '谨慎', appearance: '二十七岁女记者，齐肩黑发，深灰风衣，右手戴薄手套' },
];
const SCENES = [
  { id: 'scene-s1', name: '雨夜便利店门口', description: '便利店门口雨棚下，地面积水反光，货架冷白光溢出玻璃门，街道深处一片昏黄' },
];

function makeShot(shotNo, description) {
  return {
    id: `shot-${shotNo}`,
    shotNo,
    sceneId: 'scene-s1',
    description,
    sourceExcerpt: `${description}。雨水沿棚檐成串落下。`,
    dialogue: '',
    characterIds: ['char-linyue'],
    durationSec: 5,
    shotPlanningMode: 'single-timeline',
    actionTimeline: { segments: [{ start: 0, end: 5, action: description }] },
  };
}

/** 忠实种子：真实工厂 + 真实字段。mutator 用于构造门禁用例。 */
function seed({ projectExtra = {}, dataMutator } = {}) {
  const data = h.emptyWorkshopData(PROJECT);
  data.currentStep = 'prompts';
  data.characters = CHARACTERS.map((c) => ({ ...c }));
  data.scenes = SCENES.map((s) => ({ ...s }));
  data.shots = [
    makeShot('S1-01', '林越站在雨棚下，右手举着手机，正对便利店玻璃门'),
    makeShot('S1-02', '林越跨上电动车，背对镜头，车头朝向街道深处'),
  ];
  data.videoModel = 'doubao-seedance-2-0-pro';
  data.videoPromptTemplate = 'legacy';
  dataMutator?.(data);
  h.useWorkshopStore.setState({
    project: { id: PROJECT, name: '集成测试项目', ...projectExtra },
    data,
  });
  return data;
}

const readData = () => h.useWorkshopStore.getState().data;
const shotOf = (no) => readData().shots.find((s) => s.shotNo === no);

const results = [];
/**
 * @param opts.knownIssue 已知缺陷编号（如 'F16'）。断言**期望正确行为**，
 *   若当前失败则记为 KNOWN 而**不计入退出码**——这样 CI 门禁只对回归报警，
 *   不会因为一个已知未修缺陷长期变红（长期红 = 门禁失效）。缺陷修好后自动转 OK。
 */
async function check(id, expect, fn, opts = {}) {
  let got = '';
  let ok = false;
  try {
    const r = await fn();
    got = r.got;
    ok = r.ok;
  } catch (e) {
    got = `抛异常：${e.message}`;
    ok = false;
  }
  const known = !ok && Boolean(opts.knownIssue);
  results.push({ id, ok, known, knownIssue: opts.knownIssue, expect, got });
  console.log(`  [${ok ? 'OK  ' : known ? 'KNOWN' : 'DIFF'}] ${id}`);
  if (known) console.log(`         ⚠ 已知缺陷 ${opts.knownIssue}：修复后本项应转为 OK`);
  console.log(`         预期: ${expect}`);
  console.log(`         实际: ${got}`);
}

// ─────────────────────────────── A. 正向落库 ───────────────────────────────
console.log('=== A. 正向：真实 execute() 是否真的写进 store ===');

await check('A1 角色资产提示词（GPT+MJ）落库',
  'success=true 且 assetPrompt / assetPromptMj 落到 char-linyue',
  async () => {
    seed();
    const r = await call('workshop_set_asset_prompt', {
      kind: 'character', id: 'char-linyue', prompt: 'GPT版三视图提示词', mjPrompt: 'character design sheet, turnaround',
    });
    const c = readData().characters.find((x) => x.id === 'char-linyue');
    return {
      ok: r.success === true && c.assetPrompt === 'GPT版三视图提示词' && c.assetPromptMj === 'character design sheet, turnaround',
      got: `success=${r.success} assetPrompt="${c.assetPrompt ?? ''}" assetPromptMj="${c.assetPromptMj ?? ''}"`,
    };
  });

await check('A2 场景资产提示词落库',
  'success=true 且落到 scene-s1',
  async () => {
    seed();
    const r = await call('workshop_set_asset_prompt', {
      kind: 'scene', id: 'scene-s1', prompt: '空景场景提示词', mjPrompt: 'empty environment overview, no people',
    });
    const s = readData().scenes.find((x) => x.id === 'scene-s1');
    return {
      ok: r.success === true && s.assetPrompt === '空景场景提示词' && s.assetPromptMj === 'empty environment overview, no people',
      got: `success=${r.success} assetPrompt="${s.assetPrompt ?? ''}"`,
    };
  });

await check('A3 legacy 模板写入 shot.videoPrompt（且不串到 universal）',
  'success=true 且 videoPrompt 以模型原文开头，universalVideoPrompt 保持未写',
  async () => {
    seed();
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', imagePrompt: '首帧提示词', videoPrompt: '经典版提示词' }],
    });
    const s = shotOf('S1-01');
    const vp = s.videoPrompt ?? '';
    return {
      ok: r.success === true && vp.startsWith('经典版提示词') && s.universalVideoPrompt === undefined,
      got: `success=${r.success} videoPrompt 以原文开头=${vp.startsWith('经典版提示词')}`
        + `｜落库长度=${vp.length}（模型原文 6 字）｜universalVideoPrompt=${s.universalVideoPrompt ?? '未写'}`,
    };
  });

await check('A4 universal 模板写入 shot.universalVideoPrompt（且不串到 legacy）',
  'success=true 且 universalVideoPrompt 以模型原文开头，videoPrompt 保持未写',
  async () => {
    seed({ dataMutator: (d) => { d.videoPromptTemplate = 'universal'; } });
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', imagePrompt: '首帧提示词', videoPrompt: '新版六段式提示词' }],
    });
    const s = shotOf('S1-01');
    const uv = s.universalVideoPrompt ?? '';
    return {
      ok: r.success === true && uv.startsWith('新版六段式提示词') && s.videoPrompt === undefined,
      got: `success=${r.success} universalVideoPrompt 以原文开头=${uv.startsWith('新版六段式提示词')}`
        + `｜落库长度=${uv.length}｜videoPrompt=${s.videoPrompt ?? '未写'}`,
    };
  });

await check('A5 落库值 = 模型原文 + 系统追加的【连续性与生成约束】块',
  '工具层把模型原文原样保留，并在其后追加一段连续性与生成约束块',
  async () => {
    seed();
    await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: '模型原文占位' }],
    });
    const s = shotOf('S1-01');
    const vp = s.videoPrompt ?? '';
    const hasGuard = vp.includes('【连续性与生成约束】') && vp.includes('【连续性与生成约束结束】');
    const guardLen = vp.length - '模型原文占位'.length;
    return {
      ok: vp.startsWith('模型原文占位') && hasGuard,
      got: `含约束块=${hasGuard}｜模型原文 6 字，落库 ${vp.length} 字，追加块约 ${guardLen} 字`,
    };
  });

// ── A6 / A7：F14 的回归用例。内容判定必须量「模型原文」而非「原文 + 约束块」。 ──
// 修复前：约束块自带约 1,007 字 → 「过短」永不触发；约束块正文含「特写」→
// 「缺少主要运镜」恒为真。这两条在修复前都**不可能通过**，因此是有意义的回归锁。

await check('A6 F14 回归：短 videoPrompt 必须报「过短」',
  'single-timeline 下限 500 字；修复前约束块 1,007 字，该警告永远不触发',
  async () => {
    seed();
    const shortPrompt = `林越站在雨棚下举起手机。${'雨滴沿棚檐落下。'.repeat(6)}`;
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: shortPrompt }],
    });
    const out = String(r.output ?? '');
    const hit = out.includes('videoPrompt 过短');
    return {
      ok: hit,
      got: `success=${r.success}｜模型原文 ${shortPrompt.length} 字（<500）｜是否报「过短」=${hit ? '是' : '否'}`,
    };
  });

await check('A7 F14 回归：没写运镜时必须报「缺少主要运镜」',
  '修复前约束块正文含「特写」，该存在性检查恒为真、永不报警',
  async () => {
    seed();
    // 刻意不写任何运镜词（推/拉/横移/跟拍/手持/摇/俯/仰/过肩/特写/焦点/景深/移焦）
    const noCamera = '林越站在雨棚下，右手举着手机，目光落在玻璃门上映出的自己。'.repeat(8);
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: noCamera }],
    });
    const out = String(r.output ?? '');
    const hit = out.includes('缺少明确的单一主要机位');
    return {
      ok: hit,
      got: `success=${r.success}｜模型原文 ${noCamera.length} 字、无运镜词｜是否报「缺少主要运镜」=${hit ? '是' : '否'}`,
    };
  });

// ── A8：F15 / F16 的回归用例（Run H 现场捕获的真实轨迹）。 ──
// 门禁 `unlinked-character` 给出的修法是「先补关联再重提」，而
// `workshop_update_shot_refs` 正是产品为此提供的工具。修复前这条路径被两道机制封死：
//   F16：update_shot_refs 把镜头打成 planningReview=needs-repair（因为 characterIds
//        曾被算作「规划字段」），而该状态对 workshop_set_prompts 是致命拒绝；
//   F15：即便没有 F16，重复写入刹车也会因「参数逐字相同」而终止任务。
// 本用例断言**修法必须走得通**——这是产品自己写进错误消息里的路径。

await check('A8 F15/F16 回归：门禁拒绝 → 补关联 → 重提同一载荷必须写入成功',
  '第 1 次因 unlinked-character 被拒；update_shot_refs 补关联后，逐字相同的载荷必须成功落库',
  async () => {
    seed(); // 种子 S1-01 只关联 char-linyue
    const payload = {
      items: [{
        shotNo: 'S1-01',
        videoPrompt: `苏晚从街道深处走近雨棚，深灰风衣被雨打湿。${'雨滴沿棚檐落下。'.repeat(30)}`,
      }],
    };
    const before = [...(shotOf('S1-01').characterIds ?? [])];
    const r1 = await call('workshop_set_prompts', payload);
    const err1 = String(r1.error ?? '');
    const fix = await call('workshop_update_shot_refs', { shot_no: 'S1-01', add_character_ids: ['char-suwan'] });
    const after = [...(shotOf('S1-01').characterIds ?? [])];
    const r2 = await call('workshop_set_prompts', payload); // 逐字相同的载荷
    const written = String(shotOf('S1-01').videoPrompt ?? '').startsWith('苏晚从街道深处走近雨棚');
    const blockedByLinkage = /没有关联该角色|characterIds 未包含该角色/.test(err1);
    // F16 修复前，第 2 次失败的原因不是关联门禁（已修好），而是 update_shot_refs 顺带
    // 把该镜打成 planningReview=needs-repair（缺 narrativeBeat/atomicAction/entryState），
    // 该状态在 workshopTools.ts:2545 是**致命**的 → 修法本身是死胡同。
    // 修复后同一载荷必须写入成功。**本项已不再是 knownIssue**——一旦回归就必须让门禁变红。
    const err2 = String(r2.error ?? '');
    const blockedByReview = err2.includes('原子镜头 Reviewer 未通过');
    return {
      ok: blockedByLinkage && r1.success === false && fix.success === true
        && r2.success === true && written,
      got: `第1次 success=${r1.success}（${blockedByLinkage ? '关联门禁' : err1.slice(0, 30)}）`
        + `｜补关联=${fix.success} characterIds ${JSON.stringify(before)}→${JSON.stringify(after)}`
        + `｜第2次同一载荷 success=${r2.success}`
        + `（${blockedByReview ? '被 planningReview 门禁挡住 → F16 回归！' : err2.slice(0, 40) || '空'}）`
        + `｜是否落库=${written ? '是' : '否'}`,
    };
  });

// ── A9 / A10：F14b 的回归用例——「告警阈值」必须等于「告知模型的区间」。 ──
// F14 修掉的是**错误反馈**（466 字被判「过长（1473字）」）；这里锁的是它的另一面：
// **缺失反馈**。修复前：
//   single-timeline：提示词说 500-1200，代码却在 1400 才报「过长」→ 1200-1400 是静默区；
//   原子镜头：      提示词说 280-520，代码阈值却是 240/650 → 两个静默区。
// 根因是同一组数字散落在四处（两条提示词 + 两条工具说明 + 两个阈值）并各自漂移。
// 现在全部由 `promptLengthBudget.ts` 派生，本用例用**真实 tool.execute()** 验证这一点：
// 阈值两侧各取一点（max+1 必须报「过长」、min-1 必须报「过短」），
// 且文案里引用的数字必须来自同一常量。数值调整时本用例会自动跟着走。

/**
 * 构造**精确长度**（忽略空白后）的模型原文。
 * 只用已存在于 sourceExcerpt 的中性填充，不引入新剧情事实——否则会被事实锁拒绝，
 * 测到的是门禁而不是长度判定。
 */
function authoredOfLength(target, lead = '林越站在雨棚下，右手举着手机，正对便利店玻璃门。') {
  const filler = '雨水沿棚檐成串落下。';
  let text = lead;
  while (text.length + filler.length <= target) text += filler;
  if (text.length < target) text += '雨'.repeat(target - text.length);
  return text;
}

/** 取该镜落库提示词剥离系统追加块后的长度，用来核实「构造的长度」确实精确。 */
const authoredLenOf = (shotNo) =>
  h.stripGeneratedVideoBlocks(String(shotOf(shotNo).videoPrompt ?? '')).replace(/\s+/g, '').length;

await check('A9 F14b 回归：single-timeline 长度阈值必须等于预算端点',
  '预算 max+1 必须报「过长」、min-1 必须报「过短」；修复前 1200-1400 为静默区',
  async () => {
    const budget = h.VIDEO_PROMPT_BUDGET['single-timeline'];
    seed();
    const over = authoredOfLength(budget.max + 1);
    const r1 = await call('workshop_set_prompts', { items: [{ shotNo: 'S1-01', videoPrompt: over }] });
    const out1 = String(r1.output ?? '');
    const overHit = out1.includes('videoPrompt 过长');
    const measuredOver = authoredLenOf('S1-01');

    seed();
    const under = authoredOfLength(budget.min - 1);
    const r2 = await call('workshop_set_prompts', { items: [{ shotNo: 'S1-01', videoPrompt: under }] });
    const out2 = String(r2.output ?? '');
    const underHit = out2.includes('videoPrompt 过短');
    const citesRange = out2.includes(h.budgetLabel(budget));

    return {
      ok: overHit && underHit && citesRange && measuredOver === budget.max + 1,
      got: `预算 ${h.budgetLabel(budget)}`
        + `｜max+1=${budget.max + 1}字 报「过长」=${overHit ? '是' : '否'}（落库剥离后实测 ${measuredOver} 字）`
        + `｜min-1=${budget.min - 1}字 报「过短」=${underHit ? '是' : '否'}`
        + `｜过短文案引用同一区间=${citesRange ? '是' : '否'}`,
    };
  });

await check('A10 F14b 回归：原子镜头长度阈值必须等于预算端点（修复前 240/650，静默区两段）',
  '预算 max+1 必须报「过长」、min-1 必须报「过短」；且不得沿用 single-timeline 的区间',
  async () => {
    const budget = h.VIDEO_PROMPT_BUDGET.atomic;
    const asAtomic = { dataMutator: (d) => { d.shots[0].shotPlanningMode = 'atomic'; } };

    seed(asAtomic);
    const over = authoredOfLength(budget.max + 1);
    const r1 = await call('workshop_set_prompts', { items: [{ shotNo: 'S1-01', videoPrompt: over }] });
    const out1 = String(r1.output ?? '');
    const overHit = out1.includes('videoPrompt 过长');
    const measuredOver = authoredLenOf('S1-01');

    seed(asAtomic);
    const under = authoredOfLength(budget.min - 1);
    const r2 = await call('workshop_set_prompts', { items: [{ shotNo: 'S1-01', videoPrompt: under }] });
    const out2 = String(r2.output ?? '');
    const underHit = out2.includes('videoPrompt 过短');
    const citesRange = out2.includes(h.budgetLabel(budget));
    // 反向：原子镜头不得被告知 single-timeline 的区间（修复前工具说明对两种模式一视同仁）。
    const timelineBudget = h.VIDEO_PROMPT_BUDGET['single-timeline'];
    const leakedTimelineRange = out2.includes(h.budgetLabel(timelineBudget));

    return {
      ok: overHit && underHit && citesRange && !leakedTimelineRange && measuredOver === budget.max + 1,
      got: `预算 ${h.budgetLabel(budget)}`
        + `｜max+1=${budget.max + 1}字 报「过长」=${overHit ? '是' : '否'}（落库剥离后实测 ${measuredOver} 字）`
        + `｜min-1=${budget.min - 1}字 报「过短」=${underHit ? '是' : '否'}`
        + `｜过短文案引用同一区间=${citesRange ? '是' : '否'}`
        + `｜是否误用 single-timeline 区间=${leakedTimelineRange ? '是（错）' : '否'}`,
    };
  });

// ─────────────────────── B. 桩与真实实现的逐点对照 ───────────────────────
console.log('\n=== B. 反向：桩的契约复现 vs 真实实现 ===');

await check('B1 未知资产 id',
  '真实：success=false「未找到资产」（F12 已修）；桩已按此对齐｜修复前为静默 true',
  async () => {
    seed();
    const r = await call('workshop_set_asset_prompt', {
      kind: 'character', id: 'char-不存在的id', prompt: 'GPT版', mjPrompt: 'mj版',
    });
    const c = readData().characters.find((x) => x.id === 'char-linyue');
    return {
      ok: r.success === false && c.assetPrompt === undefined,
      got: `success=${r.success}（应为 false）error="${String(r.error ?? '').slice(0, 60)}"`
        + `｜char-linyue 是否被误写=${c.assetPrompt ?? '未写'}（应为未写）`,
    };
  });

await check('B2 只给 prompt、不给 mjPrompt',
  '真实：success=true 且只写 assetPrompt，但 output 必须提示缺 MJ 版；桩已按此对齐',
  async () => {
    seed();
    const r = await call('workshop_set_asset_prompt', { kind: 'character', id: 'char-linyue', prompt: '只有GPT版' });
    const c = readData().characters.find((x) => x.id === 'char-linyue');
    const warned = String(r.output ?? '').includes('未提供 mjPrompt');
    return {
      ok: r.success === true && c.assetPrompt === '只有GPT版' && c.assetPromptMj === undefined && warned,
      got: `success=${r.success}｜assetPrompt=${c.assetPrompt ?? '未写'} assetPromptMj=${c.assetPromptMj ?? '未写'}`
        + `｜是否提示缺 MJ=${warned ? '是' : '否'}`,
    };
  });

await check('B3 set_prompts 全部镜号未知',
  'success=false「没有可写入的提示词」；桩与真实一致',
  async () => {
    seed();
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: '不存在的镜号', imagePrompt: 'x', videoPrompt: 'y' }],
    });
    return { ok: r.success === false, got: `success=${r.success} error="${String(r.error ?? '').slice(0, 70)}"` };
  });

await check('B4 planningReview 未通过（status=needs-repair）',
  '真实：拒绝；桩已补此门禁｜旧桩曾放行',
  async () => {
    seed({
      dataMutator: (d) => {
        d.shots[0].planningReview = { status: 'needs-repair', issues: ['动作跨了两条线'], reviewedAt: Date.now() };
      },
    });
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: '试图写入的视频提示词' }],
    });
    return { ok: r.success === false, got: `success=${r.success} error="${String(r.error ?? '').replace(/\n/g, ' ').slice(0, 90)}"` };
  });

await check('B5 剧本 revision 已变化',
  '真实：拒绝',
  async () => {
    seed({
      dataMutator: (d) => {
        d.currentScriptRevisionId = REVISION;
        d.shots.forEach((s) => { s.sourceScriptRevisionId = 'rev-旧版本'; });
      },
    });
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: '试图写入的视频提示词' }],
    });
    return { ok: r.success === false, got: `success=${r.success} error="${String(r.error ?? '').replace(/\n/g, ' ').slice(0, 90)}"` };
  });

await check('B6 expectedRefSignature 与当前签名不符',
  '真实：拒绝；桩已补此门禁',
  async () => {
    seed();
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: '试图写入的视频提示词', expectedRefSignature: '明显过期的签名' }],
    });
    return { ok: r.success === false, got: `success=${r.success} error="${String(r.error ?? '').replace(/\n/g, ' ').slice(0, 90)}"` };
  });

await check('B7 已知 + 未知镜号混合',
  'success=true 且跳过未知；桩与真实一致',
  async () => {
    seed();
    const r = await call('workshop_set_prompts', {
      items: [
        { shotNo: 'S1-01', videoPrompt: '已知镜号的提示词' },
        { shotNo: '不存在的镜号', videoPrompt: '未知镜号的提示词' },
      ],
    });
    const s = shotOf('S1-01');
    const landed = (s.videoPrompt ?? '').startsWith('已知镜号的提示词');
    return {
      ok: r.success === true && landed,
      got: `success=${r.success} output="${String(r.output).replace(/\n/g, ' ').slice(0, 60)}"｜S1-01 落库=${landed ? '是' : '否'}`,
    };
  });

await check('B8 提示词写了未关联本镜的角色名（事实锁）',
  '真实：拒绝；桩已补此门禁',
  async () => {
    // 注意：effectiveOpeningCharacterIds 会从 shot.description 反推关联角色，
    // 所以「本镜关联谁」不能只改 characterIds——必须让被写进提示词的角色名
    // 既不出现于 description，也不在 characterIds 里。这里 description 只提林越，
    // 提示词却写了苏晚。
    seed();
    const r = await call('workshop_set_prompts', {
      items: [{ shotNo: 'S1-01', videoPrompt: '苏晚站在雨棚下举起手机，雨水顺着袖口滴落' }],
    });
    return { ok: r.success === false, got: `success=${r.success} error="${String(r.error ?? '').replace(/\n/g, ' ').slice(0, 90)}"` };
  });

await check('B9 有源文件时拆解前未过 Draft Review',
  'success=false「尚未通过 Draft Review」；桩与真实一致',
  async () => {
    seed({
      projectExtra: { sources: [{ id: 'src-1', name: '剧本.txt', path: '/x/剧本.txt' }] },
      dataMutator: (d) => { d.currentScriptRevisionId = REVISION; },
    });
    const r = await call('workshop_set_breakdown', { synopsis: '测试梗概' });
    return { ok: r.success === false, got: `success=${r.success} error="${String(r.error ?? '').slice(0, 80)}"` };
  });

await check('B10 写入成功时的「检查警告」回执格式（桩保真度 F18）',
  '真实回执必须带「检查警告（提示词已经写入，本轮到此结束，不自动再次调用工具）：」块；'
  + '桩此前**完全不返回**这一块，导致探针看不到任何内容质量反馈',
  async () => {
    seed();
    const short = authoredOfLength(h.VIDEO_PROMPT_BUDGET['single-timeline'].min - 1);
    const r = await call('workshop_set_prompts', { items: [{ shotNo: 'S1-01', videoPrompt: short }] });
    const out = String(r.output ?? '');
    const header = '检查警告（提示词已经写入，本轮到此结束，不自动再次调用工具）：';
    const hasHeader = out.includes(header);
    const hasDirectorWarning = out.includes('videoPrompt 过短');
    return {
      ok: r.success === true && hasHeader && hasDirectorWarning,
      got: `success=${r.success}｜含检查警告块头=${hasHeader ? '是' : '否'}`
        + `｜含导演级警告=${hasDirectorWarning ? '是' : '否'}`
        + `｜回执长度 ${out.replace(/\s+/g, '').length} 字`,
    };
  });

// ─────────────────── C. 回放 ④ 的真实产出（关键：门禁保真） ───────────────────
console.log('\n=== C. 回放：模型真实产出的 videoPrompt 能否被真实工具接受 ===');

/**
 * 回放来源。每个条目 = 一份 run.mjs 留档 + 该留档里装 Agent 循环的字段名。
 * - shotprompts：④ 独立版
 * - autosteps34：一键全流程第 3 步（手写正文，与独立版不是同一份提示词）
 */
const REPLAY_SOURCES = [
  { file: 'shotprompts.json', loopKey: 'loop', label: '④ 独立版' },
  { file: 'autosteps34.json', loopKey: 'loop3', label: '一键全流程第 3 步' },
];

/**
 * 优先用新探针留的 rawItems；旧留档则从 loop.messages 的 tool_calls 还原。
 *
 * `sourceAccepted` = 该次留档里，桩是否真的放行过至少一批提示词。C/F 组回放的是
 * **最近一次留档**，所以断言不能写死「必须被接受」——留档一变（例如重跑后模型产出
 * 被真实门禁挡下），写死的断言就从「检验保真度」退化成「检验留档新旧」。
 * 正确的不变量是：**桩放行 ⟺ 产品放行**，因此期望值必须跟着源运行的结果走。
 */
function loadModelItems(file, loopKey) {
  const dumpPath = path.join(here, '.gen/artifacts', file);
  if (!fs.existsSync(dumpPath)) return { items: [], src: '无留档', sourceAccepted: null };
  const loop = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))?.[loopKey];
  if (!loop) return { items: [], src: '留档里没有该循环', sourceAccepted: null };
  const batches = loop.stubState?.promptBatches ?? [];
  const sourceAccepted = batches.length ? batches.some((b) => !b.error) : null;
  const fromBatches = batches.filter((b) => !b.error).flatMap((b) => b.rawItems ?? []);
  if (fromBatches.length > 0) {
    return { items: fromBatches, src: 'promptBatches[].rawItems', sourceAccepted };
  }
  const items = [];
  for (const m of loop.messages ?? []) {
    for (const c of (m.tool_calls ?? [])) {
      if (c.function?.name !== 'workshop_set_prompts') continue;
      try {
        const args = JSON.parse(c.function.arguments);
        for (const it of (args.items ?? [])) items.push(it);
      } catch { /* 忽略解析失败 */ }
    }
  }
  return { items, src: 'loop.messages tool_calls 还原', sourceAccepted };
}

const replayNotes = [];
/**
 * C 组覆盖度：**必须显式声明，不能静默缩水**。
 *
 * 一次失败的模块运行会覆盖 `.gen/artifacts/<模块>.json`，下一次 storecheck 就取不到产出、
 * 整个 C 组用例被 `continue` 跳过——门禁看起来仍然全绿，但覆盖面悄悄变小了。
 * （实测：一次网关故障导致 ④ 运行失败，C 组由 4 项掉到 2 项，而汇总仍显示「全部一致」。）
 * 这里把每个来源的取数结果记下来并打进汇总，让覆盖度下降可见。
 *
 * 不把它变成硬失败是有意的：「无留档」在全新环境（`.gen/` 是 gitignored）是正常状态，
 * 而把环境性问题变成长期红会让门禁失效——与 knownIssue 机制同一条原则。
 */
const replayCoverage = [];
let replaySeq = 0;

for (const src of REPLAY_SOURCES) {
  const { items: modelItems, src: itemSrc, sourceAccepted } = loadModelItems(src.file, src.loopKey);
  console.log(`\n  ── ${src.label}（${src.file}）：取到 ${modelItems.length} 条产出（来源：${itemSrc}）`);
  console.log(`     源运行桩是否放行过：${sourceAccepted === null ? '无记录（旧留档）' : sourceAccepted ? '是' : '否（本次留档本身就被真实门禁挡下）'}`);
  const covered = modelItems.length > 0;
  replayCoverage.push({
    label: src.label,
    file: src.file,
    items: modelItems.length,
    src: itemSrc,
    covered,
    // 「无留档」= 全新环境（.gen/ 是 gitignored），不算覆盖度下降。
    // 留档存在却取不到产出 = 最近一次运行失败覆盖了它 → 覆盖度下降，必须显式标出。
    degraded: !covered && itemSrc !== '无留档',
  });
  if (modelItems.length === 0) {
    console.log(itemSrc === '无留档'
      ? '     [SKIP] 没有留档（全新环境）。先跑 node run.mjs shotprompts 生成留档。'
      : `     [⚠ 覆盖度下降] 留档存在（${itemSrc}）但取不到产出——通常是最近一次运行失败覆盖了它。重跑该模块可恢复。`);
    continue;
  }
  const tag = String.fromCharCode(67 + replaySeq * 3); // C / F / I …
  replaySeq += 1;

  // Cx1 逐字回放：探针给模型塞了 probe-sig-* 专属签名，真实项目里必然不存在。
  // 但**只有当产出里确实带了签名**时这个断言才有意义；否则本项 N/A（不能算失败）。
  const sigCount = modelItems.filter((it) => typeof it.expectedRefSignature === 'string' && it.expectedRefSignature).length;
  seed();
  const r1 = await call('workshop_set_prompts', { items: modelItems });
  await check(`${tag}1 ${src.label}·逐字回放（含探针专属 expectedRefSignature）`,
    sigCount > 0
      ? '预期被真实工具拒绝：签名与真实项目不符'
      : 'N/A：本次产出未携带 expectedRefSignature，该项无检验力',
    async () => ({
      ok: sigCount > 0 ? r1.success === false : true,
      got: `带签名条数=${sigCount}｜success=${r1.success} error="${String(r1.error ?? '').replace(/\n/g, ' ').slice(0, 120)}"`,
    }));

  // Cx2 剔除探针专属签名后回放：这才是对「事实锁 / 角色关联 / Seedance 引用」等
  // 真实门禁的有效检验——桩放行的产出，产品是否也放行。
  const stripped = modelItems.map(({ expectedRefSignature, ...rest }) => rest);
  seed();
  const r2 = await call('workshop_set_prompts', { items: stripped });
  const expectedShotNos = [...new Set(stripped.map((it) => String(it.shotNo).trim()).filter(Boolean))];
  const landed = expectedShotNos.filter((no) => {
    const s = shotOf(no);
    return s && (s.videoPrompt || s.universalVideoPrompt);
  });
  // 期望值跟着源运行走：桩放行过的产出，产品也必须放行；桩就没放行的产出
  // （本次留档本身被真实门禁挡下），产品拒绝才是**一致**的。
  const expectAccepted = sourceAccepted !== false;
  await check(`${tag}2 ${src.label}·剔除签名后回放（检验事实锁等真实门禁）`,
    expectAccepted
      ? `真实工具接受：success=true 且 ${expectedShotNos.length} 条分镜都落库`
      : '源运行被真实门禁挡下，故回放也应被拒绝：success=false',
    async () => ({
      ok: expectAccepted
        ? r2.success === true && landed.length === expectedShotNos.length
        : r2.success === false,
      got: `success=${r2.success}｜落库分镜=${landed.join('、') || '无'}（应 ${expectedShotNos.length} 条）`
        + `｜error="${String(r2.error ?? '').replace(/\n/g, ' ').slice(0, 80)}"`,
    }));
  console.log('         真实工具反馈（原文前 900 字）：');
  console.log(`         ${String(r2.output ?? r2.error ?? '').replace(/\n/g, '\n         ').slice(0, 900)}`);
  replayNotes.push({ label: src.label, kind: 'real-tool-feedback', text: String(r2.output ?? r2.error ?? '') });

  // Cx3 落库后的实际长度：模型原文 vs 工具追加块。
  const lengthNotes = [];
  for (const no of landed) {
    const s = shotOf(no);
    const v = s.videoPrompt ?? s.universalVideoPrompt ?? '';
    const modelText = String(stripped.find((it) => String(it.shotNo).trim() === no)?.videoPrompt ?? '');
    const line = `${no}: 模型原文 ${modelText.length} 字 → 落库 ${v.length} 字（追加约 ${v.length - modelText.length} 字）`;
    lengthNotes.push(line);
    console.log(`         ${line}`);
  }
  replayNotes.push({ label: src.label, kind: 'length', lines: lengthNotes });
}

console.log('\n===== 汇总 =====');
const passed = results.filter((r) => r.ok).length;
const knownList = results.filter((r) => r.known);
const failed = results.filter((r) => !r.ok && !r.known);
console.log(`与真实实现一致: ${passed}/${results.length}`);
if (knownList.length) {
  console.log(`  ⚠ 已知缺陷（断言正确行为，当前未通过；不计入退出码，修复后自动转 OK）: ${knownList.length} 项`);
  for (const r of knownList) console.log(`      - [${r.knownIssue}] ${r.id}`);
}
for (const r of failed) console.log(`  ⚠ 不一致: ${r.id}`);

// C 组覆盖度必须显式打印：静默缩水会让「全部一致」变成一句误导。
const coveredSources = replayCoverage.filter((c) => c.covered).length;
console.log(`  C 组回放覆盖度: ${coveredSources}/${replayCoverage.length} 个来源`);
for (const c of replayCoverage) {
  const state = c.covered ? '有产出' : c.degraded ? '⚠ 覆盖度下降' : '无留档（全新环境）';
  console.log(`      - ${state}｜${c.label}（${c.file}，${c.items} 条）`);
}

const outDir = path.join(here, '.gen/results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'storecheck.json'),
  JSON.stringify({
    ranAt: new Date().toISOString(),
    passed,
    total: results.length,
    knownIssues: knownList.length,
    failed: failed.length,
    results,
    replayNotes,
    replayCoverage,
  }, null, 1),
);
console.log(`逐项结果已写入 ${path.relative(path.resolve(here, '../..'), path.join(outDir, 'storecheck.json'))}`);

// 退出码只看**非已知缺陷**的失败：已知缺陷长期变红会让门禁失效。
process.exitCode = failed.length === 0 ? 0 : 1;
