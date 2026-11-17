/** Offline runtime regression: real DSH -> registry -> workshop tools -> store.
 * Model responses and disk persistence are injected. No API, media or user-project writes.
 */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
globalThis.fetch = async () => { throw new Error('Network is forbidden in episode-script regression'); };
const h = await import('./.gen/harness.mjs');
h.useChatStore.setState({ activeView: 'workshop' });
let disk;
let commits;
function seed() {
  const data = h.emptyWorkshopData('episode-test');
  data.currentStep = 'breakdown';
  data.episodes = Array.from({ length: 5 }, (_, i) => ({ no: String(i + 1), title: `集${i + 1}`, sceneList: '训练室', scriptStatus: 'planned' }));
  data.episodes[0] = { ...data.episodes[0], script: '第一集原有剧本', scriptStatus: 'draft' };
  data.shots = Array.from({ length: 5 }, (_, i) => ({ id: `existing-shot-${i}`, shotNo: `01-0${i + 1}`, episode: '1', description: '已有镜头', durationSec: 12, characterIds: [], voiceCharacterIds: [], productReferenceImages: [], sourceScriptRevisionId: undefined }));
  disk = structuredClone(data);
  commits = 0;
  h.useWorkshopStore.setState({ project: { id: data.projectId, name: '测试项目', sources: [] }, data,
    scheduleSave() {},
    async commitNow() { disk = structuredClone(h.useWorkshopStore.getState().data); commits++; },
  });
  return structuredClone(data);
}
function response(name, params) {
  return { text: '', reasoningText: '', thinkingBlocks: [], finishReason: 'tool_calls',
    toolCalls: [{ id: `call-${++sequence}`, type: 'function', function: { name, arguments: JSON.stringify(params) } }] };
}
let sequence = 0;
const write = (no, script = `第${no}集\n训练室，夜。\n甲：“这一次我来。”\n乙抬眼看向甲，点头回应。`) => response('workshop_set_episode_script', { episode_no: no, script });
const read = () => response('workshop_get_state', { detail: 'step', section: 'episode-script' });
async function run(responses, request = '先补写第2至5集的完整剧本和对白') {
  h.useRunStepStore.getState().startRun({ sessionId: 'offline-regression', userRequest: request });
  const registry = h.createDefaultRegistry();
  let turns = 0, final = '', error, execute;
  const results = [];
  const agent = new h.DshBridge({
    createTools(_r,_i,_registry,_cb,onDispatch,_context,onResult) {
      execute=async (name,params)=>{onDispatch(name); const result=await registry.execute(name,params,undefined,_context); results.push({name,...result}); onResult(name,params,result);};
      return {async start(){},abort(){},dispose(){}};
    },
    createAcp(_options,_instance,onUpdate) { return {
      async start(){},async cancel(){},async dispose(){},async prompt(){
        let next=responses[turns++];
        if(next instanceof Error)throw next;
        assert.ok(next,'DSH should stop after completed receipts');
        if(typeof next==='function')next=next();
        for(const tc of next.toolCalls ?? []) {
          onUpdate({sessionId:'episode',update:{sessionUpdate:'tool_call'}});
          await execute(tc.function.name,JSON.parse(tc.function.arguments));
        }
        if(next.text)onUpdate({sessionId:'episode',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:next.text}}});
        return {stopReason:next.finishReason};
      }
    };}
  });
  try { final=(await agent.run({runId:'episode',apiKey:'',baseUrl:'http://unused',model:'fixture',persona:'',workspace:'/offline',input:request,toolRegistry:registry,callbacks:{onTextDelta(){},onThinkingDelta(){},onToolStart(){},onToolEnd(){},onComplete(){},onError(){}}})).text; }
  catch(value){error=value;}
  return {turns,final,error,results,agent};
}

// Complete four episodes, ignore an attempted second write of an already-saved episode.
let original = seed();
let result = await run([read(), write('2'), write('2', '不应覆盖第二集'), write('3'), write('4'), write('5')]);
assert.equal(result.error, undefined);
assert.equal(result.turns, 6);
assert.equal(commits, 4);
assert.deepEqual(disk.shots, original.shots);
assert.deepEqual(disk.episodes[0], original.episodes[0]);
assert.notEqual(disk.episodes[1].script, '不应覆盖第二集');
assert.equal(disk.steps.breakdown.status, 'in-progress');
assert.match(result.final, /2、3、4、5/);
console.log('PASS actual runtime: four episode receipts, no duplicate overwrite, existing shots preserved');

// A failure after episode 2 does not erase it; retry selects only 3-5.
original = seed();
result = await run([read(), write('2'), new Error('simulated interruption')]);
assert.match(result.error.message, /simulated interruption/);
assert.equal(commits, 1);
h.useWorkshopStore.setState({ data: structuredClone(disk) });
result = await run([read(), write('3'), write('4'), write('5')]);
assert.equal(result.error, undefined);
assert.equal(commits, 4);
assert.deepEqual(disk.shots, original.shots);
assert.match(result.final, /3、4、5/);
console.log('PASS actual runtime: restart from persisted episode checkpoint, only unfinished episodes written');

// It must not fall back to the old 30-turn chat cap for this exact user instruction.
seed();
result = await run([...Array.from({ length: 30 }, read), write('2'), write('3'), write('4'), write('5')]);
assert.equal(result.error, undefined);
assert.equal(result.turns, 34);
assert.equal(commits, 4);
assert.doesNotMatch(result.final, /调用步骤过多|缩小/);
console.log('PASS actual runtime: reported request receives episode-workload budget, not chat default');

// Going into shot decomposition is blocked before mutation, then the model can correct course.
original = seed();
result = await run([response('workshop_set_shots', { mode: 'replace', shots: [] }), write('2'), write('3'), write('4'), write('5')]);
assert.equal(result.error, undefined);
assert.deepEqual(disk.shots, original.shots);
assert.equal(commits, 4);
console.log('PASS actual runtime: out-of-scope shot write is blocked, bounded recovery completes scripts');

// Repeating a completed fill request must not call the model or rewrite anything.
const beforeRepeat = commits;
result = await run([]);
assert.equal(result.error, undefined);
assert.equal(result.turns, 0);
assert.equal(commits, beforeRepeat);
assert.match(result.final, /没有重复覆盖/);
console.log('PASS actual runtime: completed fill request exits without model/tool replay');

// A partial model final is nudged toward the next episode instead of requiring user retries.
seed();
result = await run([write('2'), { text: '第2集已保存。', reasoningText: '', thinkingBlocks: [], toolCalls: [], finishReason: 'stop' }, write('3'), write('4'), write('5')]);
assert.equal(result.error, undefined);
assert.equal(result.turns, 5);
assert.equal(commits, 4);
assert.match(result.final, /2、3、4、5/);
console.log('PASS actual runtime: partial model final continues the remaining episodes once per checkpoint');

// If the bounded budget really expires, return persisted progress, not generic blame.
seed();
result = await run([write('2'), ...Array.from({ length: 47 }, read)]);
assert.equal(result.error, undefined);
assert.equal(result.turns, 48);
assert.equal(commits, 1);
assert.match(result.final, /已保存的目标集：2/);
assert.match(result.final, /仍待保存：3、4、5/);
assert.doesNotMatch(result.final, /请缩小任务范围/);
console.log('PASS actual runtime: budget stop reports actual saved and unfinished episodes');


// The screenshot's two missing-shot lookups must return repair guidance, not
// terminate a rejected-batch repair before the model can choose the right tool.
original = seed();
const missingPair = response('workshop_get_shot_refs', { shot_no: '02-02' });
missingPair.toolCalls.push(...response('workshop_get_shot_refs', { shot_no: '02-03' }).toolCalls);
const repairRequest = '请修复一批未写入的 Atomic Shot（第②步拆解）。';
result = await run([missingPair, { text: '已确认这些镜头尚未落库，需要修正原始 shots 后重提；本次尚未写入。', reasoningText: '', thinkingBlocks: [], toolCalls: [], finishReason: 'stop' }], repairRequest);
assert.equal(result.error, undefined);
assert.equal(result.turns, 2);
assert.equal(result.results.length, 2);
assert.ok(result.results.every((item) => !item.success && item.recoverable));
assert.ok(result.results.every((item) => item.error.includes('workshop_set_shots')));
assert.deepEqual(h.useWorkshopStore.getState().data.shots, original.shots);
assert.equal(commits, 0);
console.log('PASS actual runtime: two unsaved-shot lookups allow one corrective turn with original-payload guidance');

// A genuine unchanged bad lookup loop still stops after that one correction.
seed();
result = await run([response('workshop_get_shot_refs', { shot_no: '02-02' }), response('workshop_get_shot_refs', { shot_no: '02-02' })], repairRequest);
assert.equal(result.error, undefined);
assert.equal(result.turns, 2);
assert.match(result.final, /不在当前已保存/);
assert.equal(commits, 0);
console.log('PASS actual runtime: repeated unchanged missing-shot lookups remain bounded');

// Atomic acceptance is retired: real writes preserve authored content without
// filling tracks, inheriting states or assigning artificial review verdicts.
seed();
h.useWorkshopStore.setState({ data: { ...h.useWorkshopStore.getState().data, shots: [] } });
const authored = { shotNo: '02-01', description: '走进房间，转身，交谈后离开', durationSec: 30,
  characterIds: [], propIds: [], narrativeBeat: 'unmapped-beat',
  actionTimeline: { durationSec: 30, summary: '作者的时间轴', segments: [{ startSec: 0, endSec: 30, track: 'body', label: '连续动作' }] } };
result = await run([response('workshop_set_shots', { mode: 'merge', shots: [authored] }),
  { text: '本批已保存。', reasoningText: '', thinkingBlocks: [], toolCalls: [], finishReason: 'stop' }], '请拆解并写入分镜');
assert.equal(result.error, undefined);
assert.equal(result.results[0].success, true, result.results[0].error);
assert.equal(disk.shots.length, 1);
assert.equal(disk.shots[0].durationSec, 30);
assert.deepEqual(disk.shots[0].actionTimeline, authored.actionTimeline);
assert.equal(disk.shots[0].planningReview, undefined);
assert.equal(disk.shots[0].entryState, undefined);
h.useWorkshopStore.getState().updateShot('02-01', { description: '新的作者动作' });
assert.equal(h.useWorkshopStore.getState().data.shots[0].planningReview, undefined);
assert.deepEqual(h.useWorkshopStore.getState().data.shots[0].actionTimeline, authored.actionTimeline);
console.log('PASS actual runtime: authored long/multi-action shot saves without Beat/track/subject gates or automatic review/rewrites');

// Episode 1 already exists; episode 2's saved screenplay is independent evidence.
for (const batchSize of [1, 5]) {
  original = seed();
  const data = h.useWorkshopStore.getState().data;
  data.episodes[1] = { ...data.episodes[1], scriptStatus: 'draft', script: '乙：“第二集原文台词。”\n乙转身。\n甲：“继续。”' };
  const shots = Array.from({ length: batchSize }, (_, i) => ({
    shotNo: `02-0${i + 1}`, episode: '2', description: '乙转身与甲交谈', characterIds: [],
    dialogue: '乙：“第二集原文台词。”\n甲：“继续。”',
  }));
  result = await run([response('workshop_set_shots', { mode: 'merge', shots }),
    { text: '本批分镜已保存。', reasoningText: '', thinkingBlocks: [], toolCalls: [], finishReason: 'stop' }], '请继续拆解第2集并增量写入分镜，不改写剧本对白');
  assert.equal(result.error, undefined);
  assert.equal(result.results[0].success, true, result.results[0].error);
  assert.equal(disk.shots.length, 5 + batchSize);
  assert.deepEqual(disk.shots.slice(0, 5), original.shots);
  assert.equal(disk.shots[5].dialogue, shots[0].dialogue);
  console.log(`PASS actual runtime: episode 2 screenplay dialogue saved in batch of ${batchSize}, episode 1 preserved`);
}
original = seed();
result = await run([response('workshop_set_shots', { mode: 'merge', shots: [{ shotNo: '02-01', episode: '2', dialogue: '我编造的台词。' }] }),
  { text: '原文无此对白，未保存。', reasoningText: '', thinkingBlocks: [], toolCalls: [], finishReason: 'stop' }], '请继续拆解第2集并增量写入分镜，不改写剧本对白');
assert.equal(result.results[0].success, false);
assert.match(result.results[0].error, /02-01 对白/);
assert.equal(commits, 0);
assert.deepEqual(h.useWorkshopStore.getState().data.shots, original.shots);
console.log('PASS actual runtime: invented dialogue still rejected without changing saved shots');

// Reproduce the user's read-only final: the full breakdown task must continue
// using live checkpoints, save missing episodes, and explicitly mark completion.
original = seed();
const breakdownData = h.useWorkshopStore.getState().data;
for (const index of [1, 2]) breakdownData.episodes[index] = { ...breakdownData.episodes[index], scriptStatus: 'draft', script: '该集详细剧本' };
breakdownData.breakdownWork = h.recordBreakdownWork(breakdownData, h.breakdownWorkUnits(breakdownData)[0].id, ['01-01', '01-02', '01-03', '01-04', '01-05'], true);
breakdownData.steps.breakdown.status = 'done'; // legacy UI incorrectly marked it done
const final = (text) => ({ text, reasoningText: '', thinkingBlocks: [], toolCalls: [], finishReason: 'stop' });
const shotWrite = (no) => () => response('workshop_set_shots', { mode: 'merge', workUnitId: h.pendingBreakdownUnits(h.useWorkshopStore.getState().data).find((unit) => Number(unit.episode) === no).id, workUnitComplete: true, shots: [{ shotNo: `0${no}-01`, episode: String(no), description: `第${no}集已有剧情的镜头`, dialogue: no >= 4 ? '甲：“这一次我来。”' : '', characterIds: [] }] });
result = await run([
  response('workshop_get_state', { detail: 'step', section: 'breakdown' }),
  final('已读完快照，第2至5集尚无镜头，尚未新增。'),
  shotWrite(2), shotWrite(3), final('已完成第2、3集，第4、5集缺剧本。'),
  write('4'), shotWrite(4), final('第4集已保存，尚余第5集。'),
  write('5'), shotWrite(5), response('workshop_set_step_status', { step: 'breakdown', status: 'done' }),
  final('本次拆解写入完成。'),
], '请对当前工坊项目执行剧本拆解（第②步）：');
assert.equal(result.error, undefined);
assert.equal(result.turns, 11);
assert.equal(disk.shots.length, 9);
assert.deepEqual(disk.shots.slice(0, 5), original.shots);
assert.equal(h.useWorkshopStore.getState().data.steps.breakdown.status, 'done');
assert.ok(result.results.every((item) => item.success));
console.log('PASS actual runtime: read-only final continues, ready scripts split first, missing scripts saved, existing shots preserved');

seed();
result = await run([final('只核对，尚未写入。'), final('仍只核对，尚未写入。')], '请对当前工坊项目执行剧本拆解（第②步）：');
assert.equal(result.turns, 2);
assert.equal(commits, 0);
assert.match(result.error?.message ?? '', /没有完成后续写入/);
assert.equal(result.final, '');
console.log('PASS actual runtime: unchanged read-only checkpoint gets one correction, never an infinite loop');

// ACP may execute many tools within one prompt, not one prompt per tool.
seed();
const multi = read();
multi.toolCalls.push(...write('2').toolCalls, ...write('2', 'duplicate must not overwrite').toolCalls,
  ...response('workshop_set_shots', { mode: 'replace', shots: [] }).toolCalls,
  ...write('3').toolCalls, ...write('4').toolCalls, ...write('5').toolCalls);
result = await run([multi]);
assert.equal(result.error, undefined);
assert.equal(result.turns, 1);
assert.equal(commits, 4);
assert.equal(disk.shots.length, 5);
assert.notEqual(disk.episodes[1].script, 'duplicate must not overwrite');
assert.ok(result.results.some((entry) => entry.name === 'workshop_set_shots' && !entry.success));
assert.match(result.final, /2、3、4、5/);
console.log('PASS DSH: multiple calls in one ACP prompt enforce scope and duplicate receipt guards');
