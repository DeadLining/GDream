/** Real engines + registry + workshop store; only model transport/persistence are fake. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
globalThis.fetch = async () => { throw new Error('Network forbidden in queue regression'); };
const h = await import('./.gen/harness.mjs');
h.useChatStore.setState({ activeView: 'workshop' });
const input = `[工坊上下文：项目「离线拆解测试」，当前步骤 breakdown。]\n\n${h.buildBreakdownPrompt()}`;
let disk, sequence = 0;
const end = () => ({ text: '', reasoningText: '', thinkingBlocks: [], finishReason: 'stop', toolCalls: [] });
const call = (name, params) => ({ ...end(), finishReason: 'tool_calls', toolCalls: [{ id: `queue-${++sequence}`, type: 'function', function: { name, arguments: JSON.stringify(params) } }] });
const callbacks = () => ({ onTextDelta() {}, onThinkingDelta() {}, onToolStart() {}, onToolEnd() {}, onComplete() {}, onError() {} });
const source = (no) => `第${no}集\n甲走进训练室，抬眼看向桌面。\n`.repeat(150);
function seed(empty = false) {
  const data = h.emptyWorkshopData('queue-offline');
  data.currentStep = 'breakdown';
  data.currentScriptRevisionId = 'revision-1';
  data.scriptRevisions = [{ id: 'revision-1', content: source(1), sourceKind: 'idea' }];
  data.scriptReview = { revisionId: 'revision-1', status: 'passed', issues: [] };
  if (!empty) {
    data.episodes = Array.from({ length: 5 }, (_, i) => ({ no: String(i + 1), title: `集${i + 1}`, sceneList: '训练室', scriptStatus: 'planned' }));
    for (const i of [1, 2]) Object.assign(data.episodes[i], { script: source(i + 1), scriptStatus: 'draft' });
    data.shots = Array.from({ length: 5 }, (_, i) => ({ id: `legacy-${i}`, shotNo: `01-0${i + 1}`, episode: '1', description: '原有内容', durationSec: 12, characterIds: [], voiceCharacterIds: [], productReferenceImages: [], sourceScriptRevisionId: 'revision-1' }));
  }
  disk = structuredClone(data);
  h.useWorkshopStore.setState({ project: { id: data.projectId, name: '离线', sources: [] }, data, scheduleSave() {}, async commitNow() { disk = structuredClone(h.useWorkshopStore.getState().data); } });
  return structuredClone(data);
}

async function run(engine, { failOnce = false, interruptAfter = Infinity, request = input, reconcile = false } = {}) {
  h.useRunStepStore.getState().startRun({ sessionId: 'queue', userRequest: request });
  const registry = h.createDefaultRegistry();
  let turns = 0, final = '', error, failed = false;
  const calls = [], results = [];
  const next = () => {
    if (++turns === interruptAfter) throw new Error('injected transport interruption');
    assert.ok(turns < 100, 'must not loop');
    const data = h.useWorkshopStore.getState().data;
    if (data.steps.breakdown.status === 'done') return end();
    if (!data.episodes.length) return call('workshop_set_breakdown', {
      mode: 'merge', synopsis: '训练室中的故事',
      episodes: [{ no: '1', title: '训练', sceneList: '训练室', scriptStatus: 'draft', script: source(1) }],
      characters: [{ id: 'jia', name: '甲', appearance: '青年，短发，训练服' }],
      scenes: [{ id: 'room', name: '训练室', description: '室内' }],
      narrativeBeats: [{ id: 'beat-1', sceneId: 'room', title: '进入训练室', purpose: '信息' }],
    });
    const unit = h.pendingBreakdownUnits(data)[0];
    if (unit) {
      if (reconcile) return call('workshop_complete_breakdown_unit', {
        workUnitId: unit.id,
        shotNos: data.shots.filter((shot) => shot.sourceExcerpt === `fixture-unit-${unit.index}`).map((shot) => shot.shotNo),
      });
      // A deliberate two-batch unit proves that one successful write cannot skip its tail.
      const partial = data.breakdownWork?.receipts[unit.id];
      const suffix = data.shots.filter((shot) => String(Number(shot.episode || shot.shotNo.split('-')[0])) === String(Number(unit.episode))).length + 1;
      const shotNo = `${String(unit.episode).padStart(2, '0')}-${String(suffix).padStart(2, '0')}`;
      const params = { mode: 'merge', workUnitId: unit.id, workUnitComplete: Boolean(partial), shots: [{ shotNo, episode: unit.episode, description: '甲走进训练室。', characterIds: [] }] };
      if (failOnce && !failed) { failed = true; params.workUnitId = 'stale-unit'; }
      return call('workshop_set_shots', params);
    }
    const missing = data.episodes.find((ep) => !ep.script?.trim() && !data.shots.some((shot) => Number(shot.episode || shot.shotNo.split('-')[0]) === Number(ep.no)));
    if (missing) return call('workshop_set_episode_script', { episode_no: missing.no, script: source(missing.no) });
    return call('workshop_set_step_status', { step: 'breakdown', status: 'done' });
  };
  const cb = { ...callbacks(), onComplete(text) { final = text; }, onError(value) { error = value; }, onToolEnd(name, result) { results.push({ name, ...result }); } };
  {
    let dispatch, observe, execute;
    const bridge = new h.DshBridge({
      createTools(_run, _instance, _registry, _callbacks, onDispatch, _context, onResult) {
        dispatch = onDispatch; observe = onResult;
        execute = async (name, params) => { dispatch(name); const result = await registry.execute(name, params); results.push({ name, ...result }); observe(name, params, result); return result; };
        return { async start() {}, abort() {}, dispose() {} };
      },
      createAcp(_options, _instance, onUpdate) { return { async start() {}, async cancel() {}, async dispose() {}, async prompt(prompt) {
        const unit = h.pendingBreakdownUnits(h.useWorkshopStore.getState().data)[0];
        if (unit && !prompt.includes('失败批次定向修复')) assert.ok(prompt.includes(unit.id), 'actual ACP input must carry the next source unit');
        const response = next();
        for (const tc of response.toolCalls) {
          const name = tc.function.name; calls.push(name);
          onUpdate({ sessionId: 'queue', update: { sessionUpdate: 'tool_call' } });
          await execute(name, JSON.parse(tc.function.arguments));
        }
        return { stopReason: response.finishReason };
      } }; },
    });
    try { final = (await bridge.run({ runId: 'queue', apiKey: '', baseUrl: 'http://unused', model: 'deepseek-v4-flash', persona: '', workspace: '/offline', input: request, toolRegistry: registry, callbacks: cb })).text; }
    catch (value) { error = value; }
  }
  return { error, final, turns, calls, results };
}

for (const engine of ['harness']) {
  const before = seed();
  let result = await run(engine, { failOnce: true });
  assert.equal(result.error, undefined, result.error?.stack);
  assert.match(result.final, /完成状态的工具回执/);
  assert.equal(disk.steps.breakdown.status, 'done');
  assert.deepEqual(disk.shots.slice(0, 5), before.shots);
  assert.equal(h.pendingBreakdownUnits(disk).length, 0);
  assert.ok(disk.shots.length > 13);
  assert.equal(result.results.filter((r) => !r.success).length, 1);
  assert.equal(result.calls.filter((name) => name === 'workshop_set_episode_script').length, 2);
  assert.ok(result.calls.every((name) => !/generate|media|image/.test(name)));
  console.log(`PASS ${engine}: one kickoff completes five episodes, two-batch source units, scoped failure repair, preserving legacy shots`);

  seed();
  result = await run(engine, { interruptAfter: 5 });
  assert.ok(result.error);
  const saved = structuredClone(disk.shots);
  const pendingBefore = h.pendingBreakdownUnits(disk).length;
  h.useWorkshopStore.setState({ data: structuredClone(disk) });
  result = await run(engine);
  assert.equal(result.error, undefined, result.error?.stack);
  assert.deepEqual(disk.shots.slice(0, saved.length), saved);
  assert.equal(new Set(disk.shots.map((shot) => shot.shotNo)).size, disk.shots.length);
  assert.ok(pendingBefore > 0);
  assert.equal(h.pendingBreakdownUnits(disk).length, 0);
  console.log(`PASS ${engine}: interrupted run resumes persisted partial unit without replaying saved batches`);

  seed(true);
  result = await run(engine);
  assert.equal(result.error, undefined, result.error?.stack);
  assert.equal(disk.steps.breakdown.status, 'done');
  assert.equal(h.pendingBreakdownUnits(disk).length, 0);
  assert.equal(result.calls.filter((name) => name === 'workshop_set_breakdown').length, 1);
  console.log(`PASS ${engine}: first-time structure -> multi-batch shots -> saved completion`);
}

// Real tool safety checks independent of model behavior.
seed();
h.useRunStepStore.getState().startRun({ sessionId: 'queue-safety', userRequest: input });
const registry = h.createDefaultRegistry();
let result = await registry.execute('workshop_set_step_status', { step: 'breakdown', status: 'done' });
assert.equal(result.success, false);
const unit = h.pendingBreakdownUnits(h.useWorkshopStore.getState().data)[0];
result = await registry.execute('workshop_complete_breakdown_unit', { workUnitId: unit.id, shotNos: ['01-01'] });
assert.equal(result.success, false);
assert.equal(h.useWorkshopStore.getState().data.breakdownWork, undefined);
console.log('PASS actual tools reject false completion and cross-episode coverage without changing saved state');

// Register existing coverage without rewriting the shot, and refuse queue overwrites.
const state = h.useWorkshopStore.getState().data;
const existingShot = { id: 'existing-2', shotNo: '02-01', episode: '2', description: '保留这个镜头', characterIds: [], voiceCharacterIds: [], productReferenceImages: [], sourceScriptRevisionId: 'revision-1' };
h.useWorkshopStore.setState({ data: { ...state, shots: [...state.shots, existingShot] } });
result = await registry.execute('workshop_set_shots', { mode: 'merge', workUnitId: unit.id, workUnitComplete: true, shots: [{ shotNo: '02-01', episode: '2', description: '不允许覆盖' }] });
assert.equal(result.success, false);
assert.equal(h.useWorkshopStore.getState().data.shots.at(-1).description, '保留这个镜头');
result = await registry.execute('workshop_complete_breakdown_unit', { workUnitId: unit.id, shotNos: ['02-01'] });
assert.equal(result.success, true, result.error);
assert.deepEqual(disk.shots.at(-1), existingShot);
assert.notEqual(h.pendingBreakdownUnits(disk)[0].id, unit.id);
console.log('PASS existing coverage migration changes receipts only; queue writes cannot overwrite saved shots');


// Exact screenshot request, 35 pre-existing shots, 1/9 receipts; no shot writes needed.
const reconciliationRequest = '保留现有35条镜头。先核对它们与正文片段的对应关系，已完整覆盖的片段只补登记完成记录，不重写、不新增重复镜头；确实未覆盖的部分才继续拆解。不要仅因完成记录缺失就重新生成，也不要生成任何媒体。';
for (const engine of ['harness']) {
  seed();
  const data = h.useWorkshopStore.getState().data;
  data.episodes = [{ no: '1', title: '第一集', sceneList: '训练室', scriptStatus: 'draft', script: '甲抬眼。\n'.repeat(4000) }];
  const units = h.breakdownWorkUnits(data);
  assert.equal(units.length, 9);
  data.shots = Array.from({ length: 35 }, (_, i) => ({ id: `legacy-${i}`, shotNo: `01-${i + 1}`, episode: '1', description: `旧镜头剧情${i + 1}`, sourceExcerpt: `fixture-unit-${i % units.length}`, characterIds: [], universalVideoPrompt: 'HUGE_PROMPT'.repeat(2000) }));
  data.breakdownWork = h.recordBreakdownWork(data, units[0].id, data.shots.filter((shot) => shot.sourceExcerpt === 'fixture-unit-0').map((shot) => shot.shotNo), true);
  const saved = structuredClone(data.shots);
  const result = await run(engine, { request: reconciliationRequest, reconcile: true });
  assert.equal(result.error, undefined, result.error?.stack);
  assert.match(result.final, /完成状态的工具回执/);
  assert.equal(result.calls.filter((name) => name === 'workshop_complete_breakdown_unit').length, 8);
  assert.deepEqual(disk.shots, saved);
  assert.equal(h.pendingBreakdownUnits(disk).length, 0);
  assert.ok(result.calls.every((name) => ['workshop_complete_breakdown_unit', 'workshop_set_step_status'].includes(name)));
  assert.ok(result.turns < 30);
  console.log(`PASS ${engine}: exact 35-shot resume text activates queue, 1/9 -> 9/9 without reads or shot rewrites`);
}

// Actual compact-state tool strips production fields and supports lossless pagination.
seed();
const compactData = h.useWorkshopStore.getState().data;
compactData.shots.push({ shotNo: '02-01', episode: '2', description: '长剧情事实'.repeat(3000), sourceExcerpt: '原文事实', characterIds: [], universalVideoPrompt: 'DO_NOT_RETURN_PROMPT', videoPath: '/do-not-return-media' });
const compactUnit = h.pendingBreakdownUnits(compactData)[0];
let page = await registry.execute('workshop_get_state', { detail: 'step', section: 'breakdown-work', work_unit_id: compactUnit.id });
let joined = '', pageCount = 0;
while (true) {
  assert.equal(page.success, true, page.error);
  assert.ok(!page.output.includes('DO_NOT_RETURN_PROMPT') && !page.output.includes('do-not-return-media'));
  const header = JSON.parse(page.output.split('\n', 1)[0]);
  assert.ok(header.output_id);
  joined += page.output.split('\n').slice(2).join('\n');
  pageCount++;
  if (header.complete) break;
  assert.ok(pageCount < 10);
  page = await registry.execute('workshop_get_state', header.next_call);
}
const compactState = JSON.parse(joined);
assert.equal(compactState.shots.length, 1);
assert.equal(compactState.shots[0].description, compactData.shots.at(-1).description);
assert.equal(compactState.workUnitId, compactUnit.id);
assert.ok(pageCount > 1);
console.log('PASS actual reconciliation tool: only episode facts, complete paged output, no prompts/media payload');

// The screenshot regression: saved screenplay has dialogue, legacy shots do not.
seed();
const dialogueData = h.useWorkshopStore.getState().data;
dialogueData.episodes = [{ no: '1', title: '', sceneList: '', scriptStatus: 'draft', script: '朱元璋低声：“我朱启明……穿了？”\n马秀英：“朱元璋，还能走吗？”' }];
const visualBefore = structuredClone(dialogueData.shots[0]);
h.useRunStepStore.getState().startRun({ sessionId: 'dialogue-restore', userRequest: input });
const dialogueUnit = h.breakdownWorkUnits(dialogueData)[0];
result = await registry.execute('workshop_complete_breakdown_unit', { workUnitId: dialogueUnit.id, shotNos: ['01-01'] });
assert.equal(result.success, false);
assert.match(result.error, /原文对白尚未登记/);
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '01-01', dialogue: '朱元璋：“凭空添加的话。”' });
assert.equal(result.success, false);
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '01-01', dialogue: dialogueData.episodes[0].script });
assert.equal(result.success, true, result.error);
assert.deepEqual(disk.shots[0], { ...visualBefore, dialogue: dialogueData.episodes[0].script, promptNeedsRefresh: true });
result = await registry.execute('workshop_complete_breakdown_unit', { workUnitId: dialogueUnit.id, shotNos: ['01-01'] });
assert.equal(result.success, true, result.error);
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '01-01', dialogue: '马秀英：“朱元璋，还能走吗？”' });
assert.equal(result.success, false);
assert.equal(disk.shots.length, 5);
console.log('PASS source dialogue restoration: no invented lines, no deleted old lines, no visual edits or duplicate shots');

// Real decision-card answer must affect the very next fact-lock check.
seed();
const authData = h.useWorkshopStore.getState().data;
authData.episodes[4].script = '马秀英：“粮账交给你。”';
authData.episodes[4].scriptStatus = 'draft';
authData.shots.push({ shotNo: '05-01', episode: '5', description: '李善长移交粮账', dialogue: '旧版台词', characterIds: [] });
const authRunId = h.useRunStepStore.getState().startRun({ sessionId: 'auth', userRequest: input });
const patch = { shot_no: '05-01', patch: { dialogue: '马秀英：“粮账交给你。”', sourceExcerpt: '马秀英：“粮账交给你。”', description: '马秀英移交粮账' } };
result = await registry.execute('workshop_update_shot', patch);
assert.equal(result.success, false);
const option = '授权修改第5集旧镜头的对白和不一致动作';
const answerPromise = registry.execute('ask_user_question', { questions: [{ question: '解除版本冲突', header: '同步', options: [{ label: option }, { label: '取消' }], multiSelect: false }] });
for (let i = 0; i < 20 && !h.useAskUserStore.getState().pending; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(h.useAskUserStore.getState().pending);
h.useAskUserStore.getState().submit([{ selected: [option] }]);
assert.equal((await answerPromise).success, true);
assert.equal(h.useRunStepStore.getState().runsById[authRunId].workshopShotSync.episode, '5');
const beforeDialogueSync = structuredClone(h.useWorkshopStore.getState().data.shots.at(-1));
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '05-01', dialogue: patch.patch.dialogue });
assert.equal(result.success, true, result.error);
assert.deepEqual(disk.shots.at(-1), { ...beforeDialogueSync, dialogue: patch.patch.dialogue, promptNeedsRefresh: true });
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '05-01', dialogue: '马秀英：“凭空编造。”' });
assert.equal(result.success, false);
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '01-01', dialogue: patch.patch.dialogue });
assert.equal(result.success, false);
const syncUnit = h.breakdownWorkUnits(h.useWorkshopStore.getState().data).find((unit) => unit.episode === '5');
result = await registry.execute('workshop_complete_breakdown_unit', { workUnitId: syncUnit.id, shotNos: ['05-01'] });
assert.equal(result.success, true, result.error);
console.log('PASS selected consent also authorizes restore tool replacement -> coverage receipt, preserving all other shot fields');
result = await registry.execute('workshop_update_shot', patch);
assert.equal(result.success, true, result.error);
assert.equal(disk.shots.at(-1).dialogue, patch.patch.dialogue);
assert.equal(disk.shots.at(-1).description, '马秀英移交粮账');
result = await registry.execute('workshop_update_shot', { shot_no: '01-01', patch: { dialogue: '越权台词' } });
assert.equal(result.success, false);
const liveAuth = h.useWorkshopStore.getState().data;
h.useWorkshopStore.setState({ data: { ...liveAuth, currentScriptRevisionId: 'revision-2' } });
result = await registry.execute('workshop_update_shot', { shot_no: '05-01', patch: { description: '授权不应跨版本使用' } });
assert.equal(result.success, false);
console.log('PASS real decision-card consent fixes original stale-request lock, limited to episode 5 and current revision');

result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '05-01', dialogue: '马秀英：“粮账交给你。”\n马秀英：“粮账交给你。”' });
assert.equal(result.success, false);

seed();
const autoSync = h.useWorkshopStore.getState().data;
autoSync.episodes[0].script = '甲：“当前台词。”';
autoSync.episodes[0].scriptStatus = 'draft';
autoSync.shots[0].dialogue = '甲：“旧版台词。”';
h.useRunStepStore.getState().startRun({ sessionId: 'auto-sync', userRequest: input });
const syncBefore = structuredClone(autoSync.shots[0]);
result = await registry.execute('workshop_restore_shot_dialogue', { shotNo: '01-01', dialogue: '甲：“当前台词。”' });
assert.equal(result.success, true, result.error);
assert.deepEqual(disk.shots[0], { ...syncBefore, dialogue: '甲：“当前台词。”', promptNeedsRefresh: true });
assert.match(result.output, /冲突旧对白/);
console.log('PASS automatic source sync replaces stale dialogue during breakdown without another authorization');

// The exact reported entry point: breakdown resume -> workshop_update_shot dialogue.
for (const previous of ['', '甲：“过期台词。”']) {
  seed();
  const d = h.useWorkshopStore.getState().data;
  d.episodes[4].script = '甲：“当前台词。”\n乙：“另一句。”';
  d.episodes[4].scriptStatus = 'draft';
  d.shots.push({ shotNo: '05-02', episode: '5', description: '已有画面', dialogue: previous, characterIds: [], videoPath: '/accepted.mp4' });
  const before = structuredClone(d.shots.at(-1));
  h.useRunStepStore.getState().startRun({ sessionId: 'dialogue-entry', userRequest: '[工坊任务:breakdown] 保留现有镜头。先核对它们与正文片段的对应关系，已完整覆盖的片段只补登记完成记录，不重写、不新增重复镜头；确实未覆盖的部分才继续拆解。不要仅因完成记录缺失就重新生成，也不要生成任何媒体。' });
  result = await registry.execute('workshop_update_shot', { shot_no: '05-02', patch: { dialogue: '甲：“当前台词。”' } });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(disk.shots.at(-1), { ...before, dialogue: '甲：“当前台词。”', promptNeedsRefresh: true });
  result = await registry.execute('workshop_update_shot', { shot_no: '05-02', patch: { dialogue: '乙：“另一句。”' } });
  assert.equal(result.success, false); // must not drop valid old lines
  result = await registry.execute('workshop_update_shot', { shot_no: '05-02', patch: { dialogue: '甲：“编造。”' } });
  assert.equal(result.success, false);
  result = await registry.execute('workshop_update_shot', { shot_no: '05-02', patch: { dialogue: '甲：“当前台词。”', description: '顺便改剧情' } });
  assert.equal(result.success, false);
  h.useRunStepStore.getState().startRun({ sessionId: 'prompt-only', userRequest: '只重写视频提示词，不改对白' });
  result = await registry.execute('workshop_update_shot', { shot_no: '05-02', patch: { dialogue: '乙：“另一句。”' } });
  assert.equal(result.success, false);
}
console.log('PASS update_shot and restore dialogue share fill/replace rules in breakdown; visuals/media and prompt-only scope protected');

seed();
const promptData = h.useWorkshopStore.getState().data;
promptData.shots[0].genError = 'IRRELEVANT_HISTORY'.repeat(10000);
promptData.shots[0].universalVideoPrompt = 'saved H3 text';
promptData.shots[0].dialogue = '不能遗漏的台词';
promptData.characters.push({ id: 'unrelated', name: '不在本镜的人', appearance: 'UNRELATED_ASSET'.repeat(10000) });
result = await registry.execute('workshop_get_state', { detail: 'step', section: 'prompts', shot_no: '01-01', episode: '5' });
assert.equal(result.success, true, result.error);
assert.doesNotMatch(result.output, /IRRELEVANT_HISTORY|UNRELATED_ASSET|generationTasks|output_id/);
const focusedPrompt = JSON.parse(result.output);
assert.equal(focusedPrompt.shots.length, 1);
assert.equal(focusedPrompt.shots[0].dialogue, '不能遗漏的台词');
assert.equal(focusedPrompt.shots[0].universalVideoPrompt, 'saved H3 text');
assert.ok(focusedPrompt.shots[0].referenceSignature);
assert.equal(focusedPrompt.characters.length, 0);
result = await registry.execute('workshop_get_state', { detail: 'step', section: 'prompts', episode: '01' });
assert.equal(result.success, true, result.error);
assert.equal(JSON.parse(result.output).shots.length, 5);
console.log('PASS prompt state: focused facts/signature first, no production history or unrelated assets, shot precedence and padded episode');
