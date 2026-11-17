import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWorkshopEditScope } from './narrativeGuard.ts';
import { buildAssetPromptsPrompt, buildAtomicResplitPrompt, buildBreakdownPrompt, buildOptimizeShotPrompt, buildRefreshShotReferencesPrompt, buildRewriteSingleShotVideoPrompt, buildShotActionTimelinePrompt } from './workshopPrompts.ts';

test('asset planning favors recognizable continuity and viewer focus rather than every object', () => {
  for (const prompt of [buildBreakdownPrompt(), buildAssetPromptsPrompt(), buildRefreshShotReferencesPrompt()]) {
    assert.match(prompt, /参考资产选择｜按辨识价值，不按物件数量/);
    assert.match(prompt, /观众是否会注意到身份变化/);
    assert.match(prompt, /道具不做参考图，剧情和动作事实仍须完整保留/);
    assert.match(prompt, /优先复用已选场景图、角色设定板/);
    assert.match(prompt, /保留用户明确指定的参考/);
  }
  assert.match(buildBreakdownPrompt(), /允许 props:\[\]/);
  assert.match(buildAssetPromptsPrompt(), /不扩增道具目录，不删除已有资产/);
});

test('breakdown prompt reads the complete breakdown state and reuses a passed review', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /workshop_get_state\(\{ detail:"step", section:"breakdown" \}\)/);
  assert.match(prompt, /scriptReview\.revisionId === currentScriptRevisionId/);
  assert.match(prompt, /scriptReview\.status === "passed"/);
  assert.match(prompt, /禁止再次调用 workshop_set_script_review/);
  assert.match(prompt, /仅当当前 revision 没有匹配的审核凭据时才审核一次/);
});

test('breakdown prompt does not treat missing generated assets as an atomic-shot gate', () => {
  const prompt = buildBreakdownPrompt();

  assert.doesNotMatch(prompt, /白模|Blender|whitebox/);
  assert.match(prompt, /assetImagePath[\s\S]{0,80}尚未生成[\s\S]{0,30}不能阻塞 Atomic Shot/);
  assert.match(prompt, /不要要求用户先完成第③步/);
  assert.match(prompt, /不要按资产图片是否存在决定能否拆镜/);
});

test('breakdown prompt inspects persisted shots through prompts detail', () => {
  const prompt = buildBreakdownPrompt();

  const stateCall = 'workshop_get_state({ detail:"step", section:"prompts" })';
  assert.ok(prompt.includes(stateCall));
  assert.equal(prompt.split(stateCall).length - 1, 1);
  assert.match(prompt, /这里返回的 shots 为准/);
  assert.match(prompt, /不运行镜头质量验收/);
});

test('breakdown prompt repairs a rejected shot batch without querying unsaved shot numbers', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /若工具返回 success:false，本批数据没有保存/);
  assert.match(prompt, /以相同 mode 重提同一批/);
  assert.match(prompt, /不得调用 workshop_get_state 查询错误中的镜号/);
  assert.match(prompt, /每批最多进行两次有实质变化的修正重试/);
  assert.match(prompt, /若错误文本与上次相同/);
  assert.match(prompt, /禁止无变化循环/);
  assert.match(prompt, /唯一例外：若原始 error 明确以“上游拆解结构不完整”开头/);
  assert.match(prompt, /workshop_set_breakdown\(mode:"merge"\)/);
});

test('breakdown prompt requires canonical ids and smaller batches to avoid self-invented character ids', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /每批 ≤8 镜/);
  assert.match(prompt, /idManifest/);
  assert.match(prompt, /禁止按人物名、职业、语义自造/);
  assert.match(prompt, /qin_coach/);
  assert.match(prompt, /entryState\.characters[\s\S]{0,80}与 characterIds 一一对应/);
});

test('breakdown prompt retains timeline writing guidance without acceptance gates', () => {
  // Regression: the validator required body/camera/sound tracks but the
  // breakdown prompt never mentioned actionTimeline, so every batch was
  // rejected on a requirement the model could not have known. Prompt and
  // validator must stay in lockstep.
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /actionTimeline/);
  assert.match(prompt, /至少覆盖 body、camera、sound 三条轨道/);
  assert.match(prompt, /durationSec（必须与本镜 durationSec 一致）/);
  assert.match(prompt, /startSec, endSec, track, label, subject\?/);
  assert.match(prompt, /逐人覆盖 characterIds/);
  assert.match(prompt, /subject 写成该角色真实 id 或姓名/);
  assert.doesNotMatch(prompt, /整批会被拒绝/);
});

test('breakdown prompt recovers a rejected batch from its persisted file', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /breakdown\/rejected-shots\//);
  assert.match(prompt, /上下文已丢失原始 payload/);
  assert.match(prompt, /读取该项目 breakdown\/rejected-shots\/ 中最近一份 JSON/);
  assert.match(prompt, /禁止凭记忆重新编造整批数据/);
});

test('breakdown prompt restores a list truncated by a previous partial repair', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /scriptReview\.sceneCount 大于 scenes\.length/);
  assert.match(prompt, /scriptReview\.beatCount 大于 narrativeBeats\.length/);
  assert.match(prompt, /全量重建显式传 mode:"replace"/);
  assert.match(prompt, /补齐缺失 ID 时传 mode:"merge"/);
});

test('breakdown repair prompt carries current UI failures without acquiring story-edit scope', () => {
  const prompt = buildBreakdownPrompt('', [
    '拆解 Narrative Beat 不完整：审核记录 27 个，当前仅 4 个',
    '尚未生成 Atomic Shot',
  ]);

  assert.match(prompt, /当前界面已检测到的拆解阻塞项/);
  assert.match(prompt, /审核记录 27 个，当前仅 4 个/);
  assert.match(prompt, /最小增量修复/);
  assert.match(prompt, /修复顺序固定/);
  assert.match(prompt, /workshop_set_breakdown\(mode:"merge"\) 从 currentScriptRevision\.content 只补缺失 ID/);
  assert.match(prompt, /再按第 6 条分批补写缺失的 Atomic Shot/);
  assert.match(prompt, /不要在本轮重跑 Draft Review/);
  assert.equal(classifyWorkshopEditScope(prompt), 'breakdown');
});

test('single-shot prompt rewrites treat per-character timeline coverage as part of timeline legality', () => {
  // Regression: the write-time gate rejects a multi-person shot whose timeline
  // only names the lead, but the single-shot rewrite prompts only said "缺失或
  // 不合法", so the model could reuse a lead-only timeline and fail again.
  for (const prompt of [buildOptimizeShotPrompt('01-01', 'fl2va'), buildRewriteSingleShotVideoPrompt('01-01', 'fl2va')]) {
    assert.match(prompt, /actionTimeline 缺失或不合法/);
    assert.match(prompt, /多个 characterIds/);
    assert.match(prompt, /每个实体角色/);
    assert.match(prompt, /subject/);
    assert.match(prompt, /队员\/众人/);
  }
});

test('single-shot H3 prompts declare dialogue aliases as the same subject instead of extra people', () => {
  for (const prompt of [buildOptimizeShotPrompt('01-01', 'i2va'), buildRewriteSingleShotVideoPrompt('01-01', 'i2va')]) {
    assert.match(prompt, /每个物理人物只能出现一次/);
    assert.match(prompt, /字\/号、职务、爵位、亲属称谓、代词和对白中的敬称/);
    assert.match(prompt, /Lu Su \(S1; addressed as 子敬 in dialogue\)/);
    assert.match(prompt, /对白中的称呼只属于该行台词/);
    assert.match(prompt, /不得生成额外出场者、听者、口型或声源/);
  }
});

test('atomic resplit submits one complete replace table and allocates duration by story weight', () => {
  const prompt = buildAtomicResplitPrompt('', 90, 'short-film');
  assert.match(prompt, /\[工坊任务:breakdown-resplit\]/);
  assert.match(prompt, /旧的 breakdown=done 只代表上一版拆解完成/);
  assert.match(prompt, /workshop_set_shots\(mode:"replace", confirmRebuild:true\)/);
  assert.match(prompt, /提交完整新镜头表/);
  assert.match(prompt, /禁止只提交部分镜头/);
  assert.match(prompt, /严禁先 replace 再 merge/);
  assert.match(prompt, /参考时长约 90 秒，不是硬上限/);
  assert.match(prompt, /完整对白按语言与情绪自然说完/);
  assert.match(prompt, /同一句台词只属于一个说话人的一个时间段/);
  assert.match(prompt, /workshop_set_step_status\(step:"breakdown", status:"done"\)/);
});

test('action-timeline prompt demands action-duration segmentation, not fixed 2s blocks', () => {
  // Regression: the timeline generator returned uniform 2-second blocks, so
  // the H3 prompt inherited them verbatim and every shot felt mechanically
  // chopped. The generator must derive segment length from the real action.
  const prompt = buildShotActionTimelinePrompt('01-01', 'i2va');
  assert.match(prompt, /按动作真实时值分段，禁止机械等分/);
  assert.match(prompt, /不得默认每 2 秒一段/);
  assert.match(prompt, /不预设段数或最小间隔/);
  assert.match(prompt, /台词重音、停顿和听者反应/);
  assert.match(prompt, /长台词和持续动作允许长段/);
  assert.match(prompt, /时间分段不等于切镜/);
  assert.doesNotMatch(prompt, /8 秒镜头通常应有 4-8/);
});

test('breakdown plans adaptive episode information density and dialogue without forcing it', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /分集信息密度规划/);
  assert.match(prompt, /开场钩子→目标\/阻力→升级或关系变化→可见行动\/反应→转折或阶段性兑现→结尾状态/);
  assert.match(prompt, /对白密度按剧情自适应/);
  assert.match(prompt, /不能为凑密度硬塞对白/);
  assert.match(prompt, /只有当前集仍只有季纲\/规划/);
  assert.match(prompt, /展开时补写的对白必须先登记在该集正式剧本/);
  assert.match(prompt, /不要用固定镜头数或固定对白数衡量信息密度/);
  assert.match(prompt, /先分时间，再定镜数/);
  assert.match(prompt, /镜头数量是时长分配的产物/);
  assert.match(prompt, /一轮完整问答、一个动作结果和听者反应/);
});

test('breakdown applies slow-drama pacing without the fast short-drama density rule', () => {
  const prompt = buildBreakdownPrompt('', [], 'slow-drama');
  assert.match(prompt, /当前作品形式与节奏：慢剧/);
  assert.match(prompt, /慢剧节奏规则/);
  assert.match(prompt, /慢剧信息密度/);
  assert.match(prompt, /慢剧对白/);
  assert.doesNotMatch(prompt, /分集信息密度规划（不以数量硬验收）/);
  assert.equal(classifyWorkshopEditScope(prompt), 'breakdown');
});

test('breakdown preserves source dialogue and reaction coverage without gaining story-edit permission', () => {
  const prompt = buildBreakdownPrompt();
  assert.match(prompt, /原文台词→说话人→目标镜号/);
  assert.match(prompt, /写后核对无遗漏、重复和顺序颠倒/);
  assert.match(prompt, /不能把近景听者长期写成静止背景/);
  assert.match(prompt, /登记在 camera\/actionTimeline 的摄影轨道/);
  assert.equal(classifyWorkshopEditScope(prompt), 'breakdown');
});

test('timeline planning keeps existing camera choices and includes expressions and listener reactions', () => {
  const prompt = buildShotActionTimelinePrompt('01-03', 'i2va');
  assert.match(prompt, /表演与声音不能只写机械动作/);
  assert.match(prompt, /已有台词逐句绑定 sound 轨道中的说话人/);
  assert.match(prompt, /不将已有正反打或特写改成一条慢推/);
  assert.match(prompt, /只写 shotNo、durationSec 和 actionTimeline/);
});

test('camera timeline plans return from internal close-ups to an inheritable boundary composition only for I2VA', () => {
  const prompt = buildShotActionTimelinePrompt('01-01', 'i2va');
  const fl2vaPrompt = buildShotActionTimelinePrompt('01-01', 'fl2va');
  assert.doesNotMatch(fl2vaPrompt, /I2VA 继承边界构图规则/);
  assert.match(prompt, /开场机位\/景别、镜内特写或切点发生的原因与时刻/);
  assert.match(prompt, /结束前回到可继承中景或合适主构图的收束动作/);
  assert.match(prompt, /I2VA 继承边界构图规则/);
  assert.match(prompt, /镜头内部可以切近景、反应特写/);
});
